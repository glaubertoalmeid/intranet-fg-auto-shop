import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
const sql=new DatabaseSync(':memory:');
function statement(query,values=[]){return {bind(...v){return statement(query,v);},async run(){const r=sql.prepare(query).run(...values);return {meta:{changes:Number(r.changes)}};},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};}};}
globalThis.__PILOT_TEST_DB__={prepare:statement,async batch(items){sql.exec('BEGIN');try{const r=[];for(const item of items)r.push(await item.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
let source=readFileSync(new URL('../lib/watidy/pilot.ts',import.meta.url),'utf8');
source=source.replace("import {getRuntimeDb} from '../../db/runtime';",'const getRuntimeDb=()=>globalThis.__PILOT_TEST_DB__;').replace("'./core.mjs'",JSON.stringify(new URL('../lib/watidy/core.mjs',import.meta.url).href));
const pilot=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
test('fila persistente: resposta cancela, eventos repetidos não reativam, outro contato ignorado',async()=>{
 globalThis.__WATIDY__={WATIDY_TEST_PHONE:'5585999999999',WATIDY_PHONE_PATH:'data.phone'};
 await pilot.enroll(false);
 assert.equal(sql.prepare("SELECT count(*) n FROM watidy_pilot_jobs WHERE status='pending'").get().n,5);
 await pilot.receive({data:{phone:'5585888888888'}});
 assert.equal(sql.prepare('SELECT paused FROM watidy_pilot_state').get().paused,0);
 await pilot.receive({data:{phone:'5585999999999',message:'private'}});
 await pilot.receive({data:{phone:'5585999999999',message:'private'}});
 assert.equal(sql.prepare("SELECT count(*) n FROM watidy_pilot_jobs WHERE status='pending'").get().n,0);
 assert.equal(sql.prepare('SELECT paused FROM watidy_pilot_state').get().paused,1);
 const events=JSON.stringify(sql.prepare('SELECT * FROM watidy_pilot_events').all());
 assert.ok(!events.includes('private'));assert.ok(!events.includes('5585999999999'));
 await pilot.enroll(true);await pilot.receive({unknown:1});
 assert.equal(sql.prepare('SELECT paused FROM watidy_pilot_state').get().paused,1);
 let calls=0;const original=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw new Error('unexpected');};
 try{await pilot.tick();assert.equal(calls,0);}finally{globalThis.fetch=original;}
});
test('simulação não envia; envio restrito usa número fixo e falha não repete',async()=>{
 const RealDate=globalThis.Date,original=globalThis.fetch;let calls=0;
 globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:['2026-10-15T12:00:00Z']));}static now(){return new RealDate('2026-10-15T12:00:00Z').getTime();}};
 try{
  await pilot.enroll(false);sql.prepare("UPDATE watidy_pilot_jobs SET due='2026-10-14T12:00:00Z' WHERE status='pending'").run();
  // wascriptPhone() despacha sem o 9º dígito (gotcha da API real do wascript) — o número
  // "canônico" com 9 continua em WATIDY_TEST_PHONE/testPhone() pra bater com webhooks.
  // GET com query string, não POST com corpo (o POST confirmou "sucesso" sem entregar de
  // verdade em teste real; o GET entregou — ver lib/watidy/pilot.ts).
  globalThis.fetch=async(url,options)=>{calls++;assert.equal(options?.method,'GET');assert.equal(new URL(url).searchParams.get('phone'),'558599999999');return Response.json({success:true});};
  assert.equal((await pilot.tick()).dryRun,true);assert.equal(calls,0);
  globalThis.__WATIDY__.WATIDY_TEST_SEND_ENABLED='true';globalThis.__WATIDY__.WATIDY_API_TOKEN='fake-test-token';
  assert.equal((await pilot.tick()).sent,true);assert.equal(calls,1);
  globalThis.fetch=async()=>{calls++;throw new Error('timeout');};
  await pilot.tick();await pilot.tick();assert.equal(calls,2);
  assert.equal(sql.prepare("SELECT count(*) n FROM watidy_pilot_jobs WHERE status='uncertain'").get().n,1);
  assert.equal(sql.prepare('SELECT paused FROM watidy_pilot_state').get().paused,1);
 }finally{globalThis.Date=RealDate;globalThis.fetch=original;}
});
