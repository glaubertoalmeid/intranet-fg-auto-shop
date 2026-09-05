import {getRuntimeDb} from "../../../../../db/runtime";
import {getBlingConfig} from "../../../../../lib/bling";
import {syncSingleSale} from "../cmv/route";
import {syncSingleProduct} from "../../../../../lib/products";
import {logAudit} from "../../../../../lib/audit";

async function init(){
 await getRuntimeDb().prepare(`CREATE TABLE IF NOT EXISTS bling_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL DEFAULT '',
  company_id TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'recebido',
  error TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT NOT NULL DEFAULT ''
 )`).run();
}

const text=(v:unknown)=>String(v??"").trim();
const resourceId=(body:Record<string,unknown>)=>{
 const data=body.data as Record<string,unknown>|undefined;
 return text(body.resourceId||body.id||data?.id||(Array.isArray(body.data)?(body.data[0] as Record<string,unknown>|undefined)?.id:undefined));
};

/** Dispatches a stored event by type. Order/sale events feed cmv_sales incrementally; stock/product
 *  events now update the products master table (Etapa 1) — this used to be a dead end that only
 *  marked the event as "aguardando_modulo_estoque"; now it's fully wired. */
async function processEvent(eventType:string,body:Record<string,unknown>):Promise<{status:string;error:string}>{
 const type=eventType.toLowerCase();
 const id=resourceId(body);
 if(type.includes("pedido")||type.includes("order")||type.includes("venda")){
  if(!id)return {status:"erro",error:"Evento de pedido sem id de recurso."};
  try{await syncSingleSale(id,{});return {status:"processado",error:""}}
  catch(error){return {status:"erro",error:error instanceof Error?error.message:"Falha ao sincronizar o pedido."}}
 }
 if(type.includes("estoque")||type.includes("stock")||type.includes("produto")||type.includes("product")){
  if(!id)return {status:"erro",error:"Evento de produto/estoque sem id de recurso."};
  try{const ok=await syncSingleProduct(id);return {status:ok?"processado":"erro",error:ok?"":"Produto não encontrado no Bling."}}
  catch(error){return {status:"erro",error:error instanceof Error?error.message:"Falha ao sincronizar o produto."}}
 }
 return {status:"tipo_nao_tratado",error:""};
}

export async function POST(request:Request){
 try{
  const raw=await request.text(),config=await getBlingConfig();
  if(config.clientSecret){
   const supplied=request.headers.get("x-bling-signature-256")||"";
   const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(config.clientSecret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
   const signed=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(raw)));
   const expected=`sha256=${[...signed].map(byte=>byte.toString(16).padStart(2,"0")).join("")}`;
   if(supplied.length!==expected.length||![...expected].every((char,index)=>char===supplied[index]))return Response.json({error:"Assinatura inválida."},{status:401});
  }
  const body=JSON.parse(raw) as Record<string,unknown>;
  const eventId=String(body.eventId||crypto.randomUUID()).slice(0,120);
  const eventType=String(body.event||"").slice(0,120);
  const companyId=String(body.companyId||"").slice(0,120);
  await init();
  const inserted=await getRuntimeDb().prepare(`INSERT INTO bling_webhook_events(event_id,event_type,company_id,payload)
   VALUES(?,?,?,?)
   ON CONFLICT(event_id) DO NOTHING`)
   .bind(eventId,eventType,companyId,JSON.stringify(body).slice(0,50000)).run();
  // Duplicate delivery (Bling retries) — the event was already processed the first time.
  if(inserted.meta.changes===0)return Response.json({ok:true,duplicate:true},{status:200});

  const result=await processEvent(eventType,body);
  await getRuntimeDb().prepare("UPDATE bling_webhook_events SET status=?,error=?,processed_at=CURRENT_TIMESTAMP WHERE event_id=?").bind(result.status,result.error,eventId).run();
  if(result.status==="erro")await logAudit({user:"Bling (webhook)",action:"webhook.error",target:eventType,detail:result.error});
  return Response.json({ok:true},{status:200});
 }catch{
  // O Bling exige resposta rápida; corpo inválido não deve gerar repetição infinita.
  return Response.json({ok:true,ignored:true},{status:200});
 }
}

export async function GET(){
 return Response.json({ok:true,service:"Bling webhooks"});
}
