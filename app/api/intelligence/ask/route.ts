import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {getAiKey} from "../../../../lib/ai-secret";
import {fetchAllRows,getSupabase} from "../../../../lib/supabase";

const envApiKey=()=>((globalThis as typeof globalThis&{__OPENAI_API_KEY__?:string}).__OPENAI_API_KEY__||"").trim();
const num=(v:unknown)=>Number(v)||0;

/** Etapa 8 — Assistente IA. "Os cálculos serão feitos por fórmulas; a IA fica responsável
 *  por interpretar, explicar e propor ações" — por isso a IA nunca recebe permissão pra
 *  inventar número: só o que já foi calculado de verdade (oportunidades, status da base,
 *  totais de venda) vai no contexto, e o prompt proíbe explicitamente extrapolar além disso. */
export async function POST(request:Request){
 try{
  await requirePermission("relatorios_cmv");
  const apiKey=envApiKey()||await getAiKey();
  if(!apiKey)return NextResponse.json({error:"A automação de IA ainda não está conectada. O Master precisa configurar a chave da OpenAI (Catálogo de Anúncios → Configurar IA)."},{status:503});

  const body=await request.json().catch(()=>({})) as {question?:string};
  const question=String(body.question||"").trim();
  if(!question)return NextResponse.json({error:"Digite uma pergunta."},{status:400});

  const supabase=getSupabase();
  const since30=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  const [sales,marginConfigs]=await Promise.all([
   fetchAllRows<{revenue:number;cost:number;quantity:number;channel:string;cancelled:boolean}>((from_,to_)=>
    supabase.from("cmv_sales").select("revenue,cost,quantity,channel,cancelled").gte("sale_date",since30).range(from_,to_)
   ),
   supabase.from("cmv_margin_config").select("channel,tax_rate,margin_min,margin_ideal").then(r=>r.data||[]),
  ]);
  const active=sales.filter(s=>!s.cancelled);
  const revenue=active.reduce((a,s)=>a+num(s.revenue),0),cmv=active.reduce((a,s)=>a+num(s.quantity)*num(s.cost),0);
  const byChannel=new Map<string,number>();
  for(const s of active)byChannel.set(s.channel,(byChannel.get(s.channel)||0)+num(s.revenue));

  const context={
   periodo:"últimos 30 dias",
   faturamento:Number(revenue.toFixed(2)),cmv:Number(cmv.toFixed(2)),
   pedidosCancelados:sales.length-active.length,
   faturamentoPorCanal:Object.fromEntries(byChannel),
   configuracaoMargemPorCanal:marginConfigs,
  };

  const prompt=`Você é um analista de operação de e-commerce respondendo à equipe da FG Auto Shop (distribuidora de produtos automotivos).
Responda em português, direto ao ponto, usando SOMENTE os dados fornecidos abaixo em JSON. NUNCA invente números que não estejam nos dados. Se a pergunta pedir algo que não está nos dados fornecidos, diga claramente que essa informação não está disponível ainda, em vez de estimar ou supor.

DADOS (últimos 30 dias, calculados pelo sistema — não pela IA):
${JSON.stringify(context,null,1)}

PERGUNTA DA EQUIPE: ${question}`;

  const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"content-type":"application/json"},body:JSON.stringify({model:"gpt-5.6",reasoning:{effort:"low"},store:false,input:[{role:"user",content:[{type:"input_text",text:prompt}]}],max_output_tokens:1200})});
  const raw=await response.text();let data:Record<string,unknown>={};
  if(raw){try{data=JSON.parse(raw)}catch{data={}}}
  if(!response.ok)throw new Error((data as {error?:{message?:string}}).error?.message||`A OpenAI recusou a resposta (erro ${response.status}).`);
  const outputText=(data as {output_text?:string}).output_text||(data as {output?:{content?:{type:string;text?:string}[]}[]}).output?.flatMap(x=>x.content||[]).find(x=>x.type==="output_text")?.text;
  if(!outputText)throw new Error("A IA não retornou uma resposta.");

  return NextResponse.json({answer:outputText,context});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível responder agora."},{status:502})}
}
