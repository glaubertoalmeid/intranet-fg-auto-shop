import {getRuntimeDb} from '../../db/runtime';
import {phone,validPhone,inspectEvent,businessHours,schedule,wascriptPhone} from './core.mjs';

type Config = {WATIDY_TEST_PHONE?:string;WATIDY_WEBHOOK_SECRET?:string;WATIDY_API_TOKEN?:string;WATIDY_TEST_SEND_ENABLED?:string;WATIDY_PHONE_PATH?:string;WATIDY_IGNORE_BUSINESS_HOURS?:string};
export function config():Config { return (globalThis as typeof globalThis & {__WATIDY__?:Config}).__WATIDY__ || {}; }
export function testPhone() { const p=phone(config().WATIDY_TEST_PHONE); if(!validPhone(p)) throw new Error('Configure um número de teste autorizado, com 55 + DDD + número.'); return p; }
export async function init() {
 const db=getRuntimeDb();
 await db.prepare(`CREATE TABLE IF NOT EXISTS watidy_pilot_jobs(id TEXT PRIMARY KEY,step INTEGER NOT NULL,due TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL)` ).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS watidy_pilot_events(id TEXT PRIMARY KEY,received_at TEXT NOT NULL,classification TEXT NOT NULL,fields TEXT NOT NULL)` ).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS watidy_pilot_state(id INTEGER PRIMARY KEY CHECK(id=1),paused INTEGER NOT NULL DEFAULT 1,reason TEXT NOT NULL DEFAULT 'Não iniciado')`).run();
 await db.prepare(`INSERT OR IGNORE INTO watidy_pilot_state(id) VALUES(1)`).run();
}
export async function pause(reason:string) {
 await init(); const db=getRuntimeDb();
 await db.batch([
  db.prepare(`UPDATE watidy_pilot_state SET paused=1,reason=? WHERE id=1`).bind(reason),
  db.prepare(`UPDATE watidy_pilot_jobs SET status='cancelled' WHERE status='pending'`)
 ]);
}
export async function receive(payload:unknown) {
 await init();
 const kind=inspectEvent(payload,config().WATIDY_PHONE_PATH,testPhone());
 // Store structure only. No names, message text, phone values or secrets.
 const fields:string[]=[];
 function walk(v:unknown,prefix='',depth=0){if(depth>4||!v||typeof v!=='object')return;for(const [k,x] of Object.entries(v).slice(0,40)){const p=prefix?`${prefix}.${k}`:k; fields.push(`${p}:${Array.isArray(x)?'array':typeof x}`);walk(x,p,depth+1);}}
 walk(payload);
 if(kind!=='ignore') await pause(kind==='test-contact'?'Atividade no contato de teste: revisar antes de retomar':'Evento ambíguo: mapear campos antes de retomar');
 await getRuntimeDb().prepare(`INSERT INTO watidy_pilot_events VALUES(?,?,?,?)`).bind(crypto.randomUUID(),new Date().toISOString(),kind,JSON.stringify(fields)).run();
 return kind;
}
export async function enroll(accelerated:boolean) {
 testPhone();await init();const db=getRuntimeDb();
 const existing=await db.prepare(`SELECT id FROM watidy_pilot_jobs WHERE status='sending' LIMIT 1`).first();
 if(existing)throw new Error('Há um envio em andamento; aguarde antes de reiniciar.');
 const now=new Date();const rows=schedule(now);
 await db.batch([
  db.prepare(`UPDATE watidy_pilot_jobs SET status='cancelled' WHERE status='pending'`),
  db.prepare(`UPDATE watidy_pilot_state SET paused=0,reason='Piloto iniciado manualmente' WHERE id=1`),
  ...rows.map(r=>db.prepare(`INSERT INTO watidy_pilot_jobs VALUES(?,?,?,?,?,?)`).bind(crypto.randomUUID(),r.step,accelerated?new Date(now.getTime()+r.step*120000).toISOString():r.due,r.message,'pending',now.toISOString()))
 ]);
}
export async function tick() {
 await init();const db=getRuntimeDb(),cfg=config(),number=testPhone();
 // O piloto hoje só envia para o número de teste autorizado (nenhum lead real ainda passa por
 // aqui), então a trava de horário não protege ninguém durante os testes. WATIDY_IGNORE_BUSINESS_HOURS
 // deixa testar fora do horário; remover/zerar essa flag antes de ligar o envio pra leads reais.
 if(cfg.WATIDY_IGNORE_BUSINESS_HOURS!=='true' && !businessHours())return {blocked:'Fora do horário comercial de Fortaleza.'};
 const job=await db.prepare(`SELECT * FROM watidy_pilot_jobs WHERE status='pending' AND due<=? AND EXISTS(SELECT 1 FROM watidy_pilot_state WHERE id=1 AND paused=0) ORDER BY due LIMIT 1`).bind(new Date().toISOString()).first<{id:string;message:string}>();
 if(!job)return {blocked:'Sem envio vencido ou piloto pausado.'};
 if(cfg.WATIDY_TEST_SEND_ENABLED!=='true')return {dryRun:true,message:job.message};
 if(!cfg.WATIDY_API_TOKEN)throw new Error('Token da API não configurado no servidor.');
 const claimed=await db.prepare(`UPDATE watidy_pilot_jobs SET status='sending' WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM watidy_pilot_state WHERE id=1 AND paused=0)`).bind(job.id).run();
 if(!claimed.meta.changes)return {blocked:'Fila alterada; envio interrompido.'};
 // One attempt only: timeout/uncertain results never retry automatically.
 try {
  const state=await db.prepare(`SELECT paused FROM watidy_pilot_state WHERE id=1`).first<{paused:number}>();
  if(state?.paused){await db.prepare(`UPDATE watidy_pilot_jobs SET status='cancelled' WHERE id=?`).bind(job.id).run();return {blocked:'Piloto pausado.'};}
  // GET com phone/message na query, não POST com corpo JSON: confirmado em teste real que
  // o POST retorna "sucesso" sem entregar boa parte das vezes (bug de conexão do lado do
  // wascript, isolado em 2026-10-15 — ver lib/watidy/pilot.ts commit history); o GET entregou
  // de fato. Mantemos o mesmo endpoint /enviar-texto, só muda método e onde vai o payload.
  const sendUrl=new URL(`https://api-whatsapp.wascript.com.br/api/enviar-texto/${encodeURIComponent(cfg.WATIDY_API_TOKEN)}`);
  sendUrl.searchParams.set('phone',wascriptPhone(number));
  sendUrl.searchParams.set('message',job.message);
  const response=await fetch(sendUrl,{method:'GET',signal:AbortSignal.timeout(15000)});
  const bodyText=await response.text();
  let result:{success?:boolean}={};
  try{result=JSON.parse(bodyText);}catch{}
  if(!response.ok||result.success!==true){
   // Diagnostic only: logs wascript's own HTTP status/response text (never the token) so a
   // send failure is debuggable from the pilot panel instead of a bare "uncertain".
   await db.prepare(`INSERT INTO watidy_pilot_events VALUES(?,?,?,?)`).bind(crypto.randomUUID(),new Date().toISOString(),'send-error',JSON.stringify([`http:${response.status}`,`body:${bodyText.slice(0,300)}`])).run();
   throw new Error('Envio não confirmado.');
  }
  await db.prepare(`UPDATE watidy_pilot_jobs SET status='sent' WHERE id=?`).bind(job.id).run();
  return {sent:true};
 } catch (e) {
  if(!(e instanceof Error && e.message==='Envio não confirmado.')){
   // fetch/timeout/network-level failure — never reached a response to log above.
   await db.prepare(`INSERT INTO watidy_pilot_events VALUES(?,?,?,?)`).bind(crypto.randomUUID(),new Date().toISOString(),'send-error',JSON.stringify([`exception:${e instanceof Error?e.message:String(e)}`])).run();
  }
  await db.prepare(`UPDATE watidy_pilot_jobs SET status='uncertain' WHERE id=?`).bind(job.id).run();
  await pause('Envio incerto: conferir WhatsApp; não reenviar automaticamente.');
  return {blocked:'Envio incerto; piloto pausado para revisão.'};
 }
}
