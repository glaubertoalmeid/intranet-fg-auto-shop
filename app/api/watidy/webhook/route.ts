import {config,receive} from '../../../../lib/watidy/pilot';
import {recordInboundWebhookEvent,logWebhookFailure} from '../../../../lib/leads';

// Confirmado em produção em 2026-10-19: mensagens com mídia (foto/áudio/vídeo) chegam com o
// arquivo em base64 embutido no payload, até ~17MB vistos até agora — bem além de uma foto de
// perfil comum. 25MB dá folga sobre isso sem chegar perto do teto de corpo de requisição do
// Workers. Não usamos o conteúdo de mídia em si (só telefone/nome/texto), então não há ganho
// em guardar isso — só em não deixar o evento inteiro falhar por causa do tamanho.
const MAX_BODY_BYTES=25*1024*1024;

// O wascript manda um preflight OPTIONS antes do POST de verdade (confirmado nos logs do
// Cloudflare em 2026-10-19 — toda tentativa real aparecia como OPTIONS, nunca chegava a virar
// POST). Sem um handler pra OPTIONS, o framework derrubava a requisição antes do nosso código
// rodar — por isso nenhum erro nunca aparecia nos nossos logs, mesmo com a rota blindada.
export async function OPTIONS(){
 return new Response(null,{status:204,headers:{
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type',
  'Access-Control-Max-Age':'86400',
 }});
}

export async function POST(request:Request){
 // Blindagem total: nada aqui pode escapar sem resposta — um 500 sem corpo não dava pra
 // depurar (não temos `wrangler tail` disponível neste ambiente), então qualquer exceção
 // imprevista cai no catch de fora e fica registrada pra inspeção pelo painel.
 try {
  const secret=config().WATIDY_WEBHOOK_SECRET;
  if(!secret||secret.length<32||new URL(request.url).searchParams.get('key')!==secret)return Response.json({error:'Não autorizado'},{status:401});
  const text=await request.text();
  if(new TextEncoder().encode(text).length>MAX_BODY_BYTES){
   await logWebhookFailure('payload-too-large',`${text.length} chars`);
   return new Response(null,{status:413});
  }
  let payload:unknown;try{payload=JSON.parse(text);}catch{await logWebhookFailure('invalid-json',text.slice(0,300));return Response.json({error:'JSON inválido'},{status:400});}
  let classification:string;
  try {classification=await receive(payload);}catch(e){await logWebhookFailure('pilot-receive',e instanceof Error?e.message:String(e));return Response.json({error:'Piloto indisponível; verificar configuração.'},{status:503});}
  // Alimenta a tela de Atendimentos e Leads em paralelo, sem tocar fila/pausa/estágio do
  // piloto Watidy acima (que já rodou e retornou normalmente, mude o que mudar aqui).
  try {await recordInboundWebhookEvent(payload);}catch(e){await logWebhookFailure('leads-record',e instanceof Error?e.message:String(e));}
  return Response.json({ok:true,classification});
 } catch (e) {
  await logWebhookFailure('uncaught',e instanceof Error?`${e.name}: ${e.message}`:String(e));
  return Response.json({error:'Falha inesperada ao processar o evento.'},{status:200});
 }
}
