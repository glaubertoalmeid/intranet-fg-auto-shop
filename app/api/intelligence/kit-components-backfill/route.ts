import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {blingApi} from "../../../../lib/bling";
import {logAudit} from "../../../../lib/audit";
import {fetchAllRows,getSupabase} from "../../../../lib/supabase";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const list=(v:unknown)=>Array.isArray(v)?v:[];
const num=(v:unknown)=>Number(v)||0;
const text=(v:unknown)=>String(v??"").trim();
class Budget{spent=0;constructor(private cap:number){}get ok(){return this.spent<this.cap}use(){this.spent++}}

/** Etapa 6 precisa saber quais produtos são kits e do que eles são feitos, pra saber se
 *  o kit está "pronto pra vender" (todos os componentes em estoque) ou bloqueado. A lista
 *  em massa do Bling só traz o campo "formato"; a composição (estrutura.componentes) só
 *  vem no detalhe por produto — por isso esse backfill à parte, igual o de custo de kit. */
export async function POST(request:Request){
 try{
  const user=await requirePermission("compras");
  const body=await request.json().catch(()=>({})) as {};
  void body;
  // Mesmo cap conservador do backfill de custo de kit: a listagem inicial de pendentes
  // (fetchAllRows) já gasta chamadas fora deste orçamento, e estourou o teto real de 50
  // sub-requisições com cap 30 — reduzido pra dar margem.
  const budget=new Budget(18);
  const supabase=getSupabase();

  const pendingRows=await fetchAllRows<{bling_product_id:string}>((from_,to_)=>
   supabase.from("products").select("bling_product_id").eq("format","E").eq("kit_components","[]").eq("status","ativo").range(from_,to_)
  );
  const ids=pendingRows.map(r=>r.bling_product_id);

  let updated=0;const failed:{productId:string;error:string}[]=[];
  for(const id of ids){
   if(!budget.ok)break;
   budget.use();
   try{
    const full=record((await blingApi(`/produtos/${id}`)).data);
    const componentes=list(record(full.estrutura).componentes).map(record).map(c=>({productId:text(record(c.produto).id),quantity:num(c.quantidade)})).filter(c=>c.productId);
    const {error}=await supabase.from("products").update({kit_components:componentes}).eq("bling_product_id",id);
    if(error)throw new Error(error.message);
    updated++;
   }catch(error){failed.push({productId:id,error:error instanceof Error?error.message:"erro desconhecido"})}
  }

  const remaining=ids.length-updated-failed.length;
  await logAudit({user:user.name,action:"intelligence.kit_components_backfill",target:`${ids.length} kit(s) pendentes`,detail:`${updated} atualizados${remaining>0?` · ${remaining} restando`:""}`});
  return NextResponse.json({ok:true,pending:ids.length,updated,truncated:remaining>0,remaining,failed});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível buscar a composição dos kits."},{status:500})}
}
