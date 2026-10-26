import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../lib/auth";
import {logAudit} from "../../../../../lib/audit";
import {mercadoLivreFetch} from "../../../../../lib/mercado-livre";
import {fetchAllRows,getSupabase} from "../../../../../lib/supabase";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const text=(v:unknown)=>String(v??"").trim();
const isDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v);
class Budget{spent=0;constructor(private cap:number){}get ok(){return this.spent<this.cap}use(){this.spent++}}

/** O Bling não reflete cancelamento feito do lado do Mercado Livre — mesmo problema já
 *  confirmado com a Shopee (Bling mostrava "Atendido" pra um pedido já CANCELLED na
 *  Shopee). O próprio Mercado Livre é a fonte confiável de status; channel_order_ref
 *  (numeroLoja do Bling) já é o id do pedido no ML — confirmado com dado real. */
export async function checkMlStatus(from:string,to:string){
 const budget=new Budget(38);
 const supabase=getSupabase();

 // status_checked marca "já verificado uma vez" — sem isso, todo pedido válido (a
 // maioria) ficaria sendo checado de novo pra sempre, já que "cancelled=false" também é
 // o estado normal de quem nunca cancelou (não dá pra distinguir "nunca verificado" de
 // "verificado e está tudo bem" só pelo cancelled).
 const pendingRows=await fetchAllRows<{sale_id:string;channel_order_ref:string}>((from_,to_)=>
  supabase.from("cmv_sales").select("sale_id,channel_order_ref").ilike("channel","%mercado%").eq("status_checked",false).gte("sale_date",from).lte("sale_date",to).range(from_,to_)
 );
 const bySaleId=new Map<string,string>();
 for(const row of pendingRows)if(row.channel_order_ref)bySaleId.set(row.sale_id,row.channel_order_ref);
 const pending=[...bySaleId.entries()];

 let checked=0,cancelled=0;const failed:{orderId:string;error:string}[]=[];
 for(const [saleId,orderId] of pending){
  if(!budget.ok)break;
  budget.use();
  try{
   const order=record((await mercadoLivreFetch(`/orders/${orderId}`).then(r=>r.json())));
   const status=text(order.status);
   const isCancelled=status==="cancelled";
   budget.use();
   const {error}=await supabase.from("cmv_sales").update({cancelled:isCancelled,status_checked:true}).eq("sale_id",saleId);
   if(error)throw new Error(error.message);
   if(isCancelled)cancelled++;
   checked++;
  }catch(error){
   const message=error instanceof Error?error.message:"erro desconhecido";
   failed.push({orderId,error:message});
   // Token expirado/desconectado afeta TODAS as chamadas igualmente — continuar tentando
   // só desperdiça o orçamento de sub-requisições em erros repetidos e idênticos.
   if(message.includes("Mercado Livre não conectado")||message.includes("autorização do Mercado Livre expirou"))break;
  }
 }

 const remaining=pending.length-checked-failed.length;
 return {pending:pending.length,checked,cancelled,truncated:remaining>0,remaining,failed};
}

export async function POST(request:Request){
 try{
  const user=await requirePermission("relatorios_cmv");
  const body=await request.json().catch(()=>({})) as {from?:string;to?:string};
  const now=new Date(),to=isDate(body.to||"")?body.to!:now.toISOString().slice(0,10),fallback=new Date(now.getTime()-31*86400000).toISOString().slice(0,10),from=isDate(body.from||"")?body.from!:fallback;

  const result=await checkMlStatus(from,to);
  await logAudit({user:user.name,action:"cmv.ml_status_check",target:`${from}..${to}`,detail:`${result.checked} pedido(s) verificados${result.cancelled?` · ${result.cancelled} cancelado(s) no Mercado Livre (excluído do relatório)`:""}${result.remaining>0?` · ${result.remaining} restando`:""}`});
  return NextResponse.json({ok:true,...result});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível verificar os pedidos do Mercado Livre."},{status:500})}
}
