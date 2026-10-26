import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../lib/auth";
import {logAudit} from "../../../../../lib/audit";
import {shopeeRequest} from "../../../../../lib/shopee";
import {fetchAllRows,getSupabase} from "../../../../../lib/supabase";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const list=(v:unknown)=>Array.isArray(v)?v:[];
const num=(v:unknown)=>Number(v)||0;
const text=(v:unknown)=>String(v??"").trim();
const isDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v);

// O Bling não forma taxas.taxaComissao/custoFrete pra pedidos Shopee (vêm zerados —
// confirmado testando pedido real). Esta rota completa esses pedidos direto na API da
// Shopee, casando pelo numeroLoja do Bling (= order_sn da Shopee), gravado em
// cmv_sales.channel_order_ref no sync principal do CMV.
class Budget{spent=0;constructor(private cap:number){}get ok(){return this.spent<this.cap}use(){this.spent++}}

/** Núcleo reutilizável — chamado tanto pela rota POST (clique manual) quanto pelo cron
 *  agendado em worker/index.ts (sincronização automática, sem sessão de usuário). */
export async function syncShopeeFees(from:string,to:string){
 const budget=new Budget(38);
 const supabase=getSupabase();

 const pendingRows=await fetchAllRows<{sale_id:string;channel_order_ref:string}>((from_,to_)=>
  supabase.from("cmv_sales").select("sale_id,channel_order_ref").ilike("channel","%shopee%").eq("commission",0).eq("cancelled",false).gte("sale_date",from).lte("sale_date",to).range(from_,to_)
 );
 const bySaleId=new Map<string,string>();
 for(const row of pendingRows)if(row.channel_order_ref)bySaleId.set(row.sale_id,row.channel_order_ref);
 const pending=[...bySaleId.entries()];

 let updated=0,cancelled=0;const failed:{orderSn:string;error:string}[]=[];
 for(const [saleId,orderSn] of pending){
  if(!budget.ok)break;
  budget.use();
  try{
   const escrow=await shopeeRequest("/api/v2/payment/get_escrow_detail",{query:{order_sn:orderSn}});
   const income=record(record(escrow.response).order_income);
   const commission=num(income.commission_fee),freightCost=num(income.actual_shipping_fee),otherFees=num(income.service_fee)+num(income.seller_transaction_fee);
   // O Bling não reflete cancelamento/devolução feito do lado da Shopee (confirmado com
   // pedido real: Bling mostrava "Atendido" pra um pedido que a Shopee já tinha marcado
   // CANCELLED) — a própria Shopee é a fonte confiável de status pra esses pedidos.
   budget.use();
   const detail=await shopeeRequest("/api/v2/order/get_order_detail",{query:{order_sn_list:orderSn,response_optional_fields:"order_status"}}).catch(()=>null);
   const orderStatus=detail?text(list(record(detail.response).order_list).map(record)[0]?.order_status):"";
   const isCancelled=orderStatus==="CANCELLED";
   const {error}=await supabase.from("cmv_sales").update({commission,freight_cost:freightCost,other_fees:otherFees,cancelled:isCancelled}).eq("sale_id",saleId);
   budget.use();
   if(error)throw new Error(error.message);
   updated++;if(isCancelled)cancelled++;
  }catch(error){failed.push({orderSn,error:error instanceof Error?error.message:"erro desconhecido"})}
 }

 const remaining=pending.length-updated-failed.length;
 return {pending:pending.length,updated,cancelled,truncated:remaining>0,remaining,failed};
}

export async function POST(request:Request){
 try{
  const user=await requirePermission("relatorios_cmv");
  const body=await request.json().catch(()=>({})) as {from?:string;to?:string};
  const now=new Date(),to=isDate(body.to||"")?body.to!:now.toISOString().slice(0,10),fallback=new Date(now.getTime()-31*86400000).toISOString().slice(0,10),from=isDate(body.from||"")?body.from!:fallback;

  const result=await syncShopeeFees(from,to);
  await logAudit({user:user.name,action:"cmv.shopee_fees_sync",target:`${from}..${to}`,detail:`${result.updated} pedido(s) atualizados${result.cancelled?` · ${result.cancelled} cancelado(s) na Shopee (excluído do relatório)`:""}${result.remaining>0?` · ${result.remaining} restando`:""}${result.failed.length?` · falhou: ${result.failed.map(f=>`${f.orderSn} (${f.error})`).join(", ")}`:""}`});
  return NextResponse.json({ok:true,...result});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível sincronizar as taxas da Shopee."},{status:500})}
}
