import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../lib/auth";
import {blingApi} from "../../../../../lib/bling";
import {logAudit} from "../../../../../lib/audit";
import {fetchAllRows,getSupabase} from "../../../../../lib/supabase";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const list=(v:unknown)=>Array.isArray(v)?v:[];
const num=(v:unknown)=>Number(v)||0;
const text=(v:unknown)=>String(v??"").trim();
const isDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v);
// marca/categoria do Bling às vezes vêm como string direto, às vezes como {descricao}.
// Nunca cair pro objeto cru — text(objeto) vira o literal "[object Object]" no banco.
const label=(v:unknown)=>typeof v==="string"?v.trim():text(record(v).descricao);

type CmvSaleRow={sale_id:string;item_id:string;product_id:string;sku:string;product_name:string;quantity:number;revenue:number;cost:number;cost_estimated:boolean;sale_date:string;channel:string;seller:string;brand:string;category:string;customer_name:string};
type CostInfo={cost:number;brand:string;category:string};

// O Workers tem um teto de sub-requisições por execução (50 no plano gratuito da
// Cloudflare) — cada chamada ao Bling ou ao Supabase conta (D1 via binding não conta,
// mas todo fetch externo conta). O teto anterior só era checado antes de começar cada
// *venda* — um pedido com muitos itens sem custo registrado podia sozinho estourar o
// limite no meio do processamento. Agora toda chamada de rede passa por budget.use()
// e o código nunca faz uma chamada sem antes checar budget.ok.
class Budget{
 spent=0;
 constructor(private cap:number){}
 get ok(){return this.spent<this.cap}
 use(){this.spent++}
}

async function costLookup(productId:string,cache:Map<string,CostInfo>,budget:Budget):Promise<CostInfo>{
 const cached=cache.get(productId);if(cached)return cached;
 const info:CostInfo={cost:0,brand:"",category:""};
 if(budget.ok){
  budget.use();
  try{
   const p=record((await blingApi(`/produtos/${productId}`)).data);
   info.cost=num(p.precoCusto||p.custo||record(p.fornecedor).precoCusto);
   info.brand=label(p.marca);
   info.category=label(p.categoria);
  }catch{/* mantém custo zerado e sinaliza estimativa */}
 }
 cache.set(productId,info);
 return info;
}

/** loja/vendedor no pedido só trazem {id} — o nome vem de endpoints à parte
 *  (/canais-venda e /vendedores). Busca cada um uma única vez por execução e cacheia. */
async function nameLookup(endpoint:string,extractName:(row:AnyRecord)=>string,budget:Budget):Promise<Map<string,string>>{
 const map=new Map<string,string>();
 let page=1;
 while(page<=10&&budget.ok){
  budget.use();
  const result=await blingApi(`/${endpoint}?pagina=${page}&limite=100`);
  const rows=list(result.data).map(record);
  for(const row of rows){const id=text(row.id);const name=extractName(row);if(id&&name)map.set(id,name)}
  if(rows.length<100)break;
  page++;
 }
 return map;
}
const channelsLookup=(budget:Budget)=>nameLookup("canais-venda",row=>text(row.descricao),budget);
const sellersLookup=(budget:Budget)=>nameLookup("vendedores",row=>text(record(row.contato).nome),budget);

async function saleRows(saleId:string,summary:AnyRecord,cache:Map<string,CostInfo>,channels:Map<string,string>,sellers:Map<string,string>,budget:Budget):Promise<CmvSaleRow[]>{
 if(!budget.ok)throw new Error("Sem orçamento de sub-requisições sobrando nesta execução.");
 budget.use();
 const detail=record((await blingApi(`/pedidos/vendas/${saleId}`)).data),items=list(detail.itens).map(record);
 const saleDate=text(detail.data||summary.data).slice(0,10);
 const channelId=text(record(detail.loja).id||record(summary.loja).id),sellerId=text(record(detail.vendedor).id||record(summary.vendedor).id);
 const channel=channels.get(channelId)||"",seller=sellers.get(sellerId)||"",customerName=text(record(detail.contato).nome||record(summary.contato).nome);
 const rows:CmvSaleRow[]=[];
 for(let index=0;index<items.length;index++){
  const item=items[index],product=record(item.produto),productId=text(product.id),quantity=num(item.quantidade),unitPrice=num(item.valor||item.preco||item.valorUnitario),discount=num(item.desconto),revenue=Math.max(0,quantity*unitPrice-discount);
  let cost=num(item.valorCusto||item.custo);let brand="",category="";const estimated=cost<=0;
  if(productId&&estimated){const info=await costLookup(productId,cache,budget);cost=info.cost;brand=info.brand;category=info.category}
  rows.push({sale_id:saleId,item_id:text(item.id||index),product_id:productId,sku:text(item.codigo||product.codigo),product_name:text(item.descricao||product.nome),quantity,revenue,cost,cost_estimated:estimated,sale_date:saleDate,channel,seller,brand,category,customer_name:customerName});
 }
 return rows;
}

/** Pulls sales for a date range, skips ones already imported (fica barato reprocessar o
 *  período: cada clique em "Sincronizar" avança nas vendas novas até o teto de
 *  sub-requisições, sem reimportar o que já está no Supabase), e grava tudo num único
 *  upsert em lote. Um pedido que falhe (erro do Bling, dado inesperado) não derruba os
 *  outros já processados na mesma execução — antes um erro no meio do loop perdia o lote
 *  inteiro, porque a exceção interrompia antes do upsert final. */
export async function syncSalesRange(from:string,to:string){
 // Cap conservador (bem abaixo do teto real de 50) porque toda chamada — listagem,
 // checagem de já-sincronizado, canais, vendedores, detalhe de cada venda, custo de
 // cada item novo, e o upsert final — soma pro mesmo orçamento desta execução.
 const budget=new Budget(38);
 let page=1;const sales:AnyRecord[]=[];let listTruncated=false;
 while(page<=10){
  if(!budget.ok){listTruncated=true;break}
  budget.use();
  const result=await blingApi(`/pedidos/vendas?pagina=${page}&limite=100&dataInicial=${from}&dataFinal=${to}`),batch=list(result.data).map(record);
  sales.push(...batch);
  if(batch.length<100)break;
  page++;
 }

 const supabase=getSupabase();
 const alreadySynced=new Set<string>();
 if(sales.length&&budget.ok){
  budget.use();
  const existing=await fetchAllRows<{sale_id:string}>((from_,to_)=>supabase.from("cmv_sales").select("sale_id").gte("sale_date",from).lte("sale_date",to).range(from_,to_));
  for(const row of existing)alreadySynced.add(row.sale_id);
 }
 const pending=sales.filter(s=>!alreadySynced.has(text(s.id)));

 const [channels,sellers]=await Promise.all([channelsLookup(budget),sellersLookup(budget)]);
 const cache=new Map<string,CostInfo>();
 const allRows:CmvSaleRow[]=[];
 const failed:{saleId:string;error:string}[]=[];
 let processed=0;
 for(const summary of pending){
  if(!budget.ok)break;
  const saleId=text(summary.id);if(!saleId)continue;
  try{
   allRows.push(...await saleRows(saleId,summary,cache,channels,sellers,budget));
   processed++;
  }catch(error){
   failed.push({saleId,error:error instanceof Error?error.message:"erro desconhecido"});
  }
 }

 if(allRows.length){
  const {error}=await supabase.from("cmv_sales").upsert(allRows,{onConflict:"sale_id,item_id"});
  if(error)throw new Error(error.message);
 }
 const remaining=pending.length-processed-failed.length;
 return {sales:sales.length,newSales:processed,alreadySynced:alreadySynced.size,items:allRows.length,truncated:listTruncated||remaining>0,remaining,failed};
}

/** Um único pedido — usado pelo webhook do Bling pra manter o CMV em dia em tempo real
 *  a cada venda nova, sem depender do sync manual por período. */
export async function syncSingleSale(saleId:string,summary:AnyRecord={}){
 const budget=new Budget(38);
 const [channels,sellers]=await Promise.all([channelsLookup(budget),sellersLookup(budget)]);
 const cache=new Map<string,CostInfo>();
 const rows=await saleRows(saleId,summary,cache,channels,sellers,budget);
 if(!rows.length)return 0;
 const {error}=await getSupabase().from("cmv_sales").upsert(rows,{onConflict:"sale_id,item_id"});
 if(error)throw new Error(error.message);
 return rows.length;
}

export async function POST(request:Request){
 try{
  const user=await requirePermission("relatorios_cmv");
  const body=await request.json().catch(()=>({})) as {from?:string;to?:string};
  const now=new Date(),to=isDate(body.to||"")?body.to!:now.toISOString().slice(0,10),fallback=new Date(now.getTime()-31*86400000).toISOString().slice(0,10),from=isDate(body.from||"")?body.from!:fallback;
  const result=await syncSalesRange(from,to);
  await logAudit({user:user.name,action:"cmv.sync",target:`${from}..${to}`,detail:`${result.newSales} venda(s) nova(s), ${result.items} item(ns)${result.truncated?` · ${result.remaining} venda(s) restando, clique em Sincronizar de novo`:""}${result.failed.length?` · falhou: ${result.failed.map(f=>`#${f.saleId} (${f.error})`).join(", ")}`:""}`});
  return NextResponse.json({ok:true,...result,from,to});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível sincronizar as vendas."},{status:500})}
}

export async function GET(request:Request){
 try{
  await requirePermission("relatorios_cmv");
  const url=new URL(request.url);
  const from=url.searchParams.get("from")||"",to=url.searchParams.get("to")||"";
  const channel=url.searchParams.get("channel")||"",brand=url.searchParams.get("brand")||"",category=url.searchParams.get("category")||"",seller=url.searchParams.get("seller")||"",product=url.searchParams.get("product")||"";

  const supabase=getSupabase();
  const rows=await fetchAllRows<CmvSaleRow>((from_,to_)=>{
   let query=supabase.from("cmv_sales").select("product_id,sku,product_name,quantity,revenue,cost,cost_estimated").range(from_,to_);
   if(isDate(from))query=query.gte("sale_date",from);
   if(isDate(to))query=query.lte("sale_date",to);
   if(channel)query=query.eq("channel",channel);
   if(brand)query=query.eq("brand",brand);
   if(category)query=query.eq("category",category);
   if(seller)query=query.eq("seller",seller);
   if(product)query=query.or(`product_name.ilike.%${product}%,sku.ilike.%${product}%`);
   return query;
  });

  const byProduct=new Map<string,{product_id:string;sku:string;product_name:string;quantity:number;revenue:number;cmv:number;cost_estimated:boolean}>();
  for(const row of rows){
   const key=`${row.product_id} ${row.sku} ${row.product_name}`;
   const agg=byProduct.get(key)||{product_id:row.product_id,sku:row.sku,product_name:row.product_name,quantity:0,revenue:0,cmv:0,cost_estimated:false};
   agg.quantity+=num(row.quantity);agg.revenue+=num(row.revenue);agg.cmv+=num(row.quantity)*num(row.cost);
   if(row.cost_estimated)agg.cost_estimated=true;
   byProduct.set(key,agg);
  }
  const products=[...byProduct.values()].map(p=>{const profit=p.revenue-p.cmv;return{...p,profit,margin:p.revenue?profit/p.revenue*100:0,markup:p.cmv?p.revenue/p.cmv:0,costEstimated:p.cost_estimated}}).sort((a,b)=>b.revenue-a.revenue);
  const totals=products.reduce((a,p)=>({revenue:a.revenue+p.revenue,cmv:a.cmv+p.cmv,profit:a.profit+p.profit}),{revenue:0,cmv:0,profit:0});

  // Filter option lists reflect only the period, so choosing one filter never empties the others.
  const periodRows=await fetchAllRows<{channel:string;brand:string;category:string;seller:string}>((from_,to_)=>{
   let query=supabase.from("cmv_sales").select("channel,brand,category,seller").range(from_,to_);
   if(isDate(from))query=query.gte("sale_date",from);
   if(isDate(to))query=query.lte("sale_date",to);
   return query;
  });
  const distinct=(col:"channel"|"brand"|"category"|"seller")=>[...new Set(periodRows.map(r=>r[col]).filter(Boolean))].sort();

  return NextResponse.json({products,totals:{...totals,margin:totals.revenue?totals.profit/totals.revenue*100:0},filters:{channels:distinct("channel"),brands:distinct("brand"),categories:distinct("category"),sellers:distinct("seller")}});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível carregar o relatório."},{status:500})}
}
