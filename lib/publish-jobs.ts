import {getRuntimeDb} from "../db/runtime";

export type PublishJobStatus="queued"|"processing"|"needs_review"|"ready_for_review"|"published"|"link_pending"|"failed"|"cancelled";
export type PublishJob={
 id:number;listing_id:number;channel:string;mode:"prepare"|"auto";status:PublishJobStatus;step:string;
 missing:string;error:string;bling_product_id:string;bling_loja_id:string;external_item_id:string;external_url:string;
 price_used:number;log:string;created_by:string;created_at:string;updated_at:string;
};

/** Fila persistente de publicação (item 1 do pedido) — vive no D1 (bind direto, não conta
 *  no teto de sub-requisições do Worker) pra o processamento sobreviver mesmo se o usuário
 *  sair da tela: o cron (worker/index.ts) processa o que estiver "queued"/"link_pending"
 *  independente de alguém estar com a aba aberta. */
export async function initPublishJobs(){
 await getRuntimeDb().prepare(`CREATE TABLE IF NOT EXISTS publish_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  channel TEXT NOT NULL DEFAULT 'shopee',
  mode TEXT NOT NULL DEFAULT 'prepare',
  status TEXT NOT NULL DEFAULT 'queued',
  step TEXT NOT NULL DEFAULT '',
  missing TEXT NOT NULL DEFAULT '[]',
  error TEXT NOT NULL DEFAULT '',
  bling_product_id TEXT NOT NULL DEFAULT '',
  bling_loja_id TEXT NOT NULL DEFAULT '',
  external_item_id TEXT NOT NULL DEFAULT '',
  external_url TEXT NOT NULL DEFAULT '',
  price_used REAL NOT NULL DEFAULT 0,
  log TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 )`).run();
}

export async function appendJobLog(jobId:number,step:string,message:string){
 const db=getRuntimeDb();
 const row=await db.prepare("SELECT log FROM publish_jobs WHERE id=?").bind(jobId).first<{log:string}>();
 const log=row?JSON.parse(row.log||"[]"):[];
 log.push({at:new Date().toISOString(),step,message});
 await db.prepare("UPDATE publish_jobs SET log=?,step=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify(log.slice(-40)),step,jobId).run();
}

export async function setJobStatus(jobId:number,status:PublishJobStatus,fields:Partial<PublishJob>={}){
 const db=getRuntimeDb();
 const sets=["status=?","updated_at=CURRENT_TIMESTAMP"],values:unknown[]=[status];
 for(const [key,value] of Object.entries(fields)){sets.push(`${key}=?`);values.push(value)}
 values.push(jobId);
 await db.prepare(`UPDATE publish_jobs SET ${sets.join(",")} WHERE id=?`).bind(...values).run();
}
