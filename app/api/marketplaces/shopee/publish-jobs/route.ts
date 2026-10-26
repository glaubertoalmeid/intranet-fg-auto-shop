import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../lib/auth";
import {getRuntimeDb} from "../../../../../db/runtime";
import {initPublishJobs} from "../../../../../lib/publish-jobs";
import {processPendingPublishJobs} from "../../../../../lib/shopee-publish";
import {logAudit} from "../../../../../lib/audit";

const num=(v:unknown)=>Number(v)||0;

export async function GET(){
 try{
  await requirePermission("anuncios");
  await initPublishJobs();
  const rows=await getRuntimeDb().prepare("SELECT j.*,l.product_name,l.sku FROM publish_jobs j LEFT JOIN listings l ON l.id=j.listing_id ORDER BY j.id DESC LIMIT 200").all();
  return NextResponse.json({jobs:rows.results||[]});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível carregar a fila."},{status:500})}
}

/** Cria os jobs da fila (item 1/7 do pedido: lote + modo) e já processa uma leva na hora
 *  (não precisa esperar o cron de 15 em 15 min pra ver o primeiro resultado) — o resto
 *  continua no servidor mesmo se o usuário sair da tela. */
export async function POST(request:Request){
 try{
  const user=await requirePermission("anuncios");
  await initPublishJobs();
  const body=await request.json().catch(()=>({})) as {listingIds?:number[];mode?:"prepare"|"auto"};
  const listingIds=(Array.isArray(body.listingIds)?body.listingIds:[]).map(num).filter(Boolean);
  const mode=body.mode==="auto"?"auto":"prepare";
  if(!listingIds.length)return NextResponse.json({error:"Selecione pelo menos um anúncio."},{status:400});

  const db=getRuntimeDb();
  const created:number[]=[];
  for(const listingId of listingIds){
   const active=await db.prepare("SELECT id FROM publish_jobs WHERE listing_id=? AND channel='shopee' AND status IN ('queued','processing','needs_review','ready_for_review','link_pending') ORDER BY id DESC LIMIT 1").bind(listingId).first<{id:number}>();
   if(active)continue; // já tem job ativo pra esse anúncio — não duplica a fila
   const listing=await db.prepare("SELECT bling_product_id FROM listings WHERE id=?").bind(listingId).first<{bling_product_id:string}>();
   const result=await db.prepare("INSERT INTO publish_jobs(listing_id,channel,mode,status,bling_product_id,created_by) VALUES(?,?,?,?,?,?)").bind(listingId,"shopee",mode,"queued",listing?.bling_product_id||"",user.name).run();
   if(result.meta.last_row_id)created.push(Number(result.meta.last_row_id));
  }
  await logAudit({user:user.name,action:"agent.publish_jobs_create",target:`${created.length} job(s)`,detail:`modo ${mode} · shopee`});

  const processed=await processPendingPublishJobs(Math.min(created.length,3));
  return NextResponse.json({ok:true,created:created.length,processedNow:processed});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível iniciar o agente."},{status:500})}
}
