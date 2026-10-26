import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {blingApi} from "../../../../lib/bling";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const list=(v:unknown)=>Array.isArray(v)?v:[];
const text=(v:unknown)=>String(v??"").trim();
const num=(v:unknown)=>Number(v)||0;

/** Diagnóstico de pedidos com itens "Produto não encontrado no sistema" (aviso que o Bling
 *  mostra ao abrir um pedido cujo item perdeu o vínculo interno com o produto do catálogo —
 *  confirmado comparando o pedido 2269 nº10337 (produto.id real, >0) com o pedido 2095
 *  (produto.id=0 nos dois itens, exatamente o pedido da captura de tela que motivou isso).
 *  Buscar por código isolado NÃO reproduz o aviso — o SKU pode existir no catálogo sob outro
 *  produto enquanto o vínculo antigo do pedido continua quebrado. action "checkItems": até 15
 *  pedidos por chamada (1 sub-requisição cada, teto de 50/invocação do Worker). */
export async function POST(request:Request){
 try{
  await requirePermission("relatorios_cmv");
  const body=await request.json().catch(()=>({})) as {action?:string;orders?:{id:string;numero:string}[]};
  const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

  if(body.action==="checkItems"){
   const orders=list(body.orders).filter((o):o is {id:string;numero:string}=>!!o&&typeof o==="object").slice(0,15);
   if(!orders.length)return NextResponse.json({error:"Informe orders (até 15 por chamada)."},{status:400});
   const results:{numero:string;itensQuebrados:{codigo:string;descricao:string}[]}[]=[];
   const errors:string[]=[];
   for(const order of orders){
    try{
     const detail=record((await blingApi(`/pedidos/vendas/${order.id}`)).data);
     const itens=list(detail.itens).map(record);
     const quebrados=itens.filter(i=>num(record(i.produto).id)===0).map(i=>({codigo:text(i.codigo),descricao:text(i.descricao)}));
     if(quebrados.length)results.push({numero:order.numero,itensQuebrados:quebrados});
    }catch(error){errors.push(`${order.numero}: ${error instanceof Error?error.message:"erro"}`)}
    await sleep(150);
   }
   return NextResponse.json({ok:true,results,errors});
  }

  return NextResponse.json({error:"Use action \"checkItems\"."},{status:400});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível consultar o Bling."},{status:500})}
}
