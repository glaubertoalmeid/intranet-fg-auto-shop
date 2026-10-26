import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../lib/auth";
import {logAudit} from "../../../../../lib/audit";
import {fetchAllRows,getSupabase} from "../../../../../lib/supabase";
import {Budget,costLookup,type CostInfo} from "../cmv/route";

/** Kits (formato "E" no Bling) não guardam custo no próprio registro — o valor real é a
 *  soma dos componentes da estrutura (ver costLookup em cmv/route.ts). Vendas sincronizadas
 *  antes desse ajuste ficaram com custo 0 pra sempre, porque o sync normal não revisita
 *  quem já está no banco. Esta é uma correção de migração pontual (venda nova já calcula
 *  certo na hora) — só a rota manual usa, não entra no cron automático. */
export async function backfillCost(from?:string,to?:string){
 // Cap mais conservador que os outros backfills: um kit pode gastar 1 chamada pro
 // produto pai + 1 por componente (visto na prática: até 5), e a listagem inicial de
 // product_id pendentes (fetchAllRows) já gasta chamadas fora deste orçamento — margem
 // maior evita estourar o teto real de 50 sub-requisições do Worker.
 const budget=new Budget(20);
 const supabase=getSupabase();

 const pendingRows=await fetchAllRows<{product_id:string}>((from_,to_)=>{
  let query=supabase.from("cmv_sales").select("product_id").eq("cost",0).neq("product_id","").range(from_,to_);
  if(from)query=query.gte("sale_date",from);
  if(to)query=query.lte("sale_date",to);
  return query;
 });
 const productIds=[...new Set(pendingRows.map(r=>r.product_id))];

 const cache=new Map<string,CostInfo>();
 let updated=0;const failed:{productId:string;error:string}[]=[];
 for(const productId of productIds){
  if(!budget.ok)break;
  try{
   const info=await costLookup(productId,cache,budget);
   if(info.cost>0){
    const {error}=await supabase.from("cmv_sales").update({cost:info.cost,cost_estimated:true}).eq("product_id",productId).eq("cost",0);
    if(error)throw new Error(error.message);
    updated++;
   }
  }catch(error){failed.push({productId,error:error instanceof Error?error.message:"erro desconhecido"})}
 }

 const remaining=productIds.length-updated-failed.length;
 return {pending:productIds.length,updated,truncated:remaining>0,remaining,failed};
}

export async function POST(request:Request){
 try{
  const user=await requirePermission("relatorios_cmv");
  const body=await request.json().catch(()=>({})) as {from?:string;to?:string};
  const result=await backfillCost(body.from,body.to);
  await logAudit({user:user.name,action:"cmv.cost_backfill",target:`${result.pending} produto(s) pendentes`,detail:`${result.updated} atualizados${result.remaining>0?` · ${result.remaining} restando`:""}`});
  return NextResponse.json({ok:true,...result});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível recalcular os custos."},{status:500})}
}
