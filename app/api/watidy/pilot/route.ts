import {currentUser} from '../../../../lib/auth';
import {getRuntimeDb} from '../../../../db/runtime';
import {init,enroll,pause,tick,config} from '../../../../lib/watidy/pilot';
async function authorize(){const u=await currentUser();if(!u)throw new Response('Não autenticado',{status:401});if(u.role!=='master')throw new Response('Somente administrador no piloto',{status:403});}
export async function GET(){try{await authorize();await init();const db=getRuntimeDb();return Response.json({mode:config().WATIDY_TEST_SEND_ENABLED==='true'?'teste com envio restrito':'simulação sem envio',state:await db.prepare('SELECT * FROM watidy_pilot_state WHERE id=1').first(),jobs:(await db.prepare('SELECT * FROM watidy_pilot_jobs ORDER BY created_at DESC,step LIMIT 50').all()).results,events:(await db.prepare('SELECT * FROM watidy_pilot_events ORDER BY received_at DESC LIMIT 20').all()).results});}catch(e){return e instanceof Response?e:Response.json({error:'Não foi possível consultar piloto'},{status:500});}}
export async function POST(request:Request){try{
 await authorize();if(request.headers.get('origin')!==new URL(request.url).origin)return new Response(null,{status:403});
 const body=await request.json() as {action?:string;accelerated?:boolean};
 if(body.action==='enroll')await enroll(body.accelerated===true);
 else if(body.action==='pause')await pause('Pausa manual');
 else if(body.action==='tick')return Response.json(await tick());
 else return Response.json({error:'Ação inválida'},{status:400});
 return Response.json({ok:true});
 }catch(e){return e instanceof Response?e:Response.json({error:e instanceof Error?e.message:'Falha no piloto'},{status:400});}}
