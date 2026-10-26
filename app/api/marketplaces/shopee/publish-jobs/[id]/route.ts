import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../../lib/auth";
import {getRuntimeDb} from "../../../../../../db/runtime";
import {logAudit} from "../../../../../../lib/audit";
import {Budget,buildShopeeSkuIndex,processPublishJob} from "../../../../../../lib/shopee-publish";
import type {PublishJob} from "../../../../../../lib/publish-jobs";

/** Ações pontuais por job (item 9 do pedido: "corrigir pendências, repetir só etapas com
 *  erro"). "retry_link" NUNCA republica — só reprocessa o vínculo com o Bling, mesmo
 *  princípio do item 8 (uma falha parcial não deve repetir o que já deu certo). */
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const user=await requirePermission("anuncios");
  const {id}=await params;
  const jobId=Number(id);
  const body=await request.json().catch(()=>({})) as {action?:string};
  const db=getRuntimeDb();
  const job=await db.prepare("SELECT * FROM publish_jobs WHERE id=?").bind(jobId).first<PublishJob>();
  if(!job)return NextResponse.json({error:"Job não encontrado."},{status:404});

  if(body.action==="cancel"){
   if(job.status!=="queued")return NextResponse.json({error:"Só dá pra cancelar itens que ainda não começaram a processar."},{status:400});
   await db.prepare("UPDATE publish_jobs SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(jobId).run();
   await logAudit({user:user.name,action:"agent.publish_job_cancel",target:String(jobId)});
   return NextResponse.json({ok:true});
  }
  if(body.action==="retry_link"){
   if(job.status!=="link_pending")return NextResponse.json({error:"Essa ação só vale pra itens com vínculo pendente."},{status:400});
   await processPublishJob(job,new Map()); // link_pending não passa pela checagem de duplicidade — índice vazio nunca é lido
   return NextResponse.json({ok:true});
  }
  if(body.action==="retry"){
   if(!["failed","needs_review"].includes(job.status))return NextResponse.json({error:"Só dá pra repetir itens com falha ou pendência."},{status:400});
   await db.prepare("UPDATE publish_jobs SET status='queued',error='',missing='[]',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(jobId).run();
   const fresh=await db.prepare("SELECT * FROM publish_jobs WHERE id=?").bind(jobId).first<PublishJob>();
   if(fresh){const skuIndex=await buildShopeeSkuIndex(new Budget(20));await processPublishJob(fresh,skuIndex)}
   await logAudit({user:user.name,action:"agent.publish_job_retry",target:String(jobId)});
   return NextResponse.json({ok:true});
  }
  return NextResponse.json({error:"Ação desconhecida."},{status:400});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível executar a ação."},{status:500})}
}
