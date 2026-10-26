import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../lib/auth";
import {blingApi} from "../../../../../lib/bling";
import {logAudit} from "../../../../../lib/audit";
import {fetchAllRows,getSupabase} from "../../../../../lib/supabase";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const num=(v:unknown)=>Number(v)||0;
const text=(v:unknown)=>String(v??"").trim();

class Budget{spent=0;constructor(private cap:number){}get ok(){return this.spent<this.cap}use(){this.spent++}}

/** Vendas sincronizadas ANTES da coluna commission/freight_cost/channel_order_ref existir
 *  ficaram com esses campos zerados/vazios pra sempre — o sync normal só processa vendas
 *  novas (pula quem já tem sale_id gravado), então não backfilla sozinho. Esta rota varre
 *  quem ainda está com channel_order_ref='' e completa direto do detalhe do pedido no Bling. */
export async function POST(request:Request){
 try{
  const user=await requirePermission("relatorios_cmv");
  const body=await request.json().catch(()=>({})) as {from?:string;to?:string};
  const budget=new Budget(38);
  const supabase=getSupabase();

  const pendingRows=await fetchAllRows<{sale_id:string}>((from_,to_)=>{
   let query=supabase.from("cmv_sales").select("sale_id").eq("channel_order_ref","").range(from_,to_);
   if(body.from)query=query.gte("sale_date",body.from);
   if(body.to)query=query.lte("sale_date",body.to);
   return query;
  });
  const saleIds=[...new Set(pendingRows.map(r=>r.sale_id))];

  let updated=0;const failed:{saleId:string;error:string}[]=[];
  for(const saleId of saleIds){
   if(!budget.ok)break;
   budget.use();
   try{
    const detail=record((await blingApi(`/pedidos/vendas/${saleId}`)).data);
    const taxas=record(detail.taxas),commission=num(taxas.taxaComissao),freightCost=num(taxas.custoFrete),otherFees=num(record(detail.desconto).valor)+num(detail.outrasDespesas),channelOrderRef=text(detail.numeroLoja)||"-";
    const {error}=await supabase.from("cmv_sales").update({commission,freight_cost:freightCost,other_fees:otherFees,channel_order_ref:channelOrderRef}).eq("sale_id",saleId);
    budget.use();
    if(error)throw new Error(error.message);
    updated++;
   }catch(error){failed.push({saleId,error:error instanceof Error?error.message:"erro desconhecido"})}
  }

  const remaining=saleIds.length-updated-failed.length;
  await logAudit({user:user.name,action:"cmv.fees_backfill",target:`${saleIds.length} pedido(s) pendentes`,detail:`${updated} atualizados${remaining>0?` · ${remaining} restando`:""}${failed.length?` · falhou: ${failed.map(f=>`#${f.saleId} (${f.error})`).join(", ")}`:""}`});
  return NextResponse.json({ok:true,pending:saleIds.length,updated,truncated:remaining>0,remaining,failed});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível completar as taxas antigas."},{status:500})}
}
