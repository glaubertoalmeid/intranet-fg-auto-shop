import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {logAudit} from "../../../../lib/audit";
import {getSupabase} from "../../../../lib/supabase";

const text=(v:unknown)=>String(v??"").trim();

/** Etapa 8 — Plano de ação. Cada linha tem problema/evidência/ação/indicador, conforme
 *  pedido explicitamente no plano ("Cada recomendação terá: problema identificado,
 *  evidência, ação proposta, prioridade e indicador para acompanhar"). Pode nascer de uma
 *  oportunidade da Etapa 6 (bling_product_id/opportunity_type preenchidos) ou ser criada
 *  solta pela equipe. */
export async function GET(){
 try{
  await requirePermission("relatorios_cmv");
  const {data,error}=await getSupabase().from("action_plan").select("*").order("created_at",{ascending:false});
  if(error)throw new Error(error.message);
  return NextResponse.json({items:data||[]});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível carregar o plano de ação."},{status:500})}
}

export async function POST(request:Request){
 try{
  const user=await requirePermission("relatorios_cmv");
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  const title=text(body.title);
  if(!title)return NextResponse.json({error:"Informe o título."},{status:400});
  const row={
   title,problem:text(body.problem),evidence:text(body.evidence),action:text(body.action),indicator:text(body.indicator),
   priority:["alta","média","baixa"].includes(text(body.priority))?text(body.priority):"média",
   status:"pendente",responsible:text(body.responsible),
   bling_product_id:text(body.blingProductId),opportunity_type:text(body.opportunityType),
   created_by:user.name,
  };
  const {data,error}=await getSupabase().from("action_plan").insert(row).select("id").single();
  if(error)throw new Error(error.message);
  await logAudit({user:user.name,action:"intelligence.action_plan_create",target:title,detail:row.responsible?`responsável: ${row.responsible}`:""});
  return NextResponse.json({ok:true,id:data.id},{status:201});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível criar a ação."},{status:500})}
}

export async function PATCH(request:Request){
 try{
  const user=await requirePermission("relatorios_cmv");
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  const id=Number(body.id);
  if(!id)return NextResponse.json({error:"Informe o id."},{status:400});
  const updates:Record<string,unknown>={updated_at:new Date().toISOString()};
  if(body.status!==undefined&&["pendente","em_andamento","concluido"].includes(text(body.status)))updates.status=text(body.status);
  if(body.responsible!==undefined)updates.responsible=text(body.responsible);
  if(body.priority!==undefined&&["alta","média","baixa"].includes(text(body.priority)))updates.priority=text(body.priority);
  const {error}=await getSupabase().from("action_plan").update(updates).eq("id",id);
  if(error)throw new Error(error.message);
  await logAudit({user:user.name,action:"intelligence.action_plan_update",target:String(id),detail:JSON.stringify(updates)});
  return NextResponse.json({ok:true});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível atualizar a ação."},{status:500})}
}
