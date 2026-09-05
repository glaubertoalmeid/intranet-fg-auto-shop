import {NextResponse} from "next/server";
import {getRuntimeBucket} from "../../../../db/runtime";
import {requirePermission} from "../../../../lib/auth";
import {getAiKey} from "../../../../lib/ai-secret";

const safeKey=(value:unknown)=>String(value??"").trim();
const envApiKey=()=>((globalThis as typeof globalThis&{__OPENAI_API_KEY__?:string}).__OPENAI_API_KEY__||"").trim();
let currentApiKey="";
const base64=(bytes:Uint8Array)=>{let result="";for(let i=0;i<bytes.length;i+=0x8000)result+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(result)};
async function openAi(url:string,init:RequestInit){
 const response=await fetch(`https://api.openai.com/v1/${url}`,{...init,headers:{Authorization:`Bearer ${currentApiKey}`,...init.headers}});
 const raw=await response.text();let data:any={};
 if(raw){try{data=JSON.parse(raw)}catch{data={}}}
 if(!response.ok)throw new Error(data?.error?.message||`A OpenAI recusou a geração (erro ${response.status}). Verifique a chave, o saldo e os limites da API.`);
 if(!raw)throw new Error("A OpenAI retornou uma resposta vazia. Aguarde alguns instantes e tente novamente.");
 return data;
}

async function handlePost(req:Request){
 await requirePermission("anuncios");
 currentApiKey=envApiKey()||await getAiKey();
 if(!currentApiKey)return NextResponse.json({error:"A automação de IA ainda não está conectada. O Master precisa configurar a chave da OpenAI."},{status:503});
 const body=await req.json() as Record<string,unknown>;
 const productName=safeKey(body.productName),imageKey=safeKey(body.imageKey),sku=safeKey(body.sku);
 if(!productName||!/^anuncio-[a-f0-9-]+\.(jpg|png|webp)$/.test(imageKey))return NextResponse.json({error:"Informe o produto e envie uma foto válida."},{status:400});
 const bucket=getRuntimeBucket(),original=await bucket.get(imageKey);
 if(!original)return NextResponse.json({error:"A foto original não foi encontrada."},{status:404});
 const bytes=new Uint8Array(await new Response(original.body).arrayBuffer());
 const mime=imageKey.endsWith(".png")?"image/png":imageKey.endsWith(".webp")?"image/webp":"image/jpeg";
 const dataUrl=`data:${mime};base64,${base64(bytes)}`;
 const prompt=`Você é especialista brasileiro em anúncios de produtos automotivos. Analise a foto e crie conteúdo fiel, sem inventar especificações ilegíveis ou não confirmadas.
Produto cadastrado: ${productName}. SKU interno: ${sku||"não informado"}.
Crie títulos objetivos e pesquisáveis, sem emojis no título. A descrição deve estar pronta para copiar, sem links, com seções em caixa alta: DESCRIÇÃO, DESTAQUES E BENEFÍCIOS, INDICADO PARA, MODO DE USO, FICHA TÉCNICA e uma chamada final. Se alguma informação técnica não estiver confirmada na foto ou no nome, não invente.
Retorne versões distintas para Mercado Livre e Shopee.`;
 const text=await openAi("responses",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({model:"gpt-5.6",reasoning:{effort:"low"},store:false,input:[{role:"user",content:[{type:"input_text",text:prompt},{type:"input_image",image_url:dataUrl,detail:"high"}]}],text:{format:{type:"json_schema",name:"anuncio_ecommerce",strict:true,schema:{type:"object",additionalProperties:false,properties:{mlTitle:{type:"string"},shopeeTitle:{type:"string"},mlDescription:{type:"string"},shopeeDescription:{type:"string"}},required:["mlTitle","shopeeTitle","mlDescription","shopeeDescription"]}}},max_output_tokens:3500})});
 const outputText=text.output_text||text.output?.flatMap((x:any)=>x.content||[]).find((x:any)=>x.type==="output_text")?.text;
 if(!outputText)throw new Error("A IA não retornou os textos do anúncio.");
 const copy=JSON.parse(outputText);
 const imagePrompts=[
  "Imagem principal para marketplace: preserve com máxima fidelidade o produto, embalagem, rótulo, cores, proporções e tampa da foto original. Produto inteiro centralizado, fundo branco puro, iluminação de estúdio, sombra natural discreta, sem textos extras, sem selos, sem objetos e sem logotipos adicionados.",
  "Imagem secundária quadrada de e-commerce: preserve exatamente o produto da foto original. Produto em destaque sobre fundo profissional limpo em tons azul-marinho e cinza da FG Auto, composição premium, espaço visual equilibrado. Sem alterar rótulo, formato ou cores. Não adicionar textos.",
  "Imagem secundária quadrada mostrando o contexto de aplicação do produto automotivo de forma realista e segura, mantendo o frasco exatamente como na foto original. Cenário profissional de estética automotiva, produto em primeiro plano, sem inventar acessórios ou alterar o rótulo. Sem textos.",
  "Imagem secundária quadrada estilo catálogo premium: produto original perfeitamente preservado, fundo claro com elementos gráficos discretos que transmitam limpeza, desempenho e cuidado automotivo. Sem textos, selos ou informações técnicas inventadas.",
  "Imagem secundária quadrada em ângulo levemente diferente da foto principal, preservando rigorosamente frasco, tampa, rótulo, cores e proporções do produto original. Iluminação de estúdio, fundo branco ou cinza muito claro, sombra natural discreta e enquadramento que valorize a embalagem inteira. Sem textos, selos, acessórios ou informações inventadas."
 ];
 const generated=await Promise.all(imagePrompts.map(async(imagePrompt,index)=>{
  const form=new FormData();form.append("model","gpt-image-2");form.append("image",new Blob([bytes],{type:mime}),`produto.${imageKey.split(".").pop()}`);form.append("prompt",imagePrompt);form.append("size","2000x2000");form.append("quality",index===0?"high":"medium");form.append("output_format","jpeg");form.append("output_compression","92");
  const result=await openAi("images/edits",{method:"POST",body:form});const encoded=result.data?.[0]?.b64_json;if(!encoded)throw new Error("Uma das imagens não foi gerada.");
  const binary=Uint8Array.from(atob(encoded),(c:string)=>c.charCodeAt(0)),key=`anuncio-${crypto.randomUUID()}.jpg`;
  await bucket.put(key,new Blob([binary],{type:"image/jpeg"}).stream(),{httpMetadata:{contentType:"image/jpeg"},customMetadata:{generatedBy:"gpt-image-2",role:String(index+1)}});return key;
 }));
 return NextResponse.json({...copy,imageKeys:generated});
}

export async function POST(req:Request){
 try{return await handlePost(req)}catch(error){const message=error instanceof Error?error.message:"Não foi possível gerar o anúncio.";return NextResponse.json({error:message},{status:502})}
}
