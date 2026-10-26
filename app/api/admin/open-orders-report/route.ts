import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {blingApi} from "../../../../lib/bling";
import {logAudit} from "../../../../lib/audit";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const list=(v:unknown)=>Array.isArray(v)?v:[];
const num=(v:unknown)=>Number(v)||0;
const text=(v:unknown)=>String(v??"").trim();

/** Levanta pedidos de venda "Em aberto" (situacao.valor===0) num período, com os itens de cada
 *  um, e permite cancelar pedidos específicos. action "list"/"items"/"resolve" são só leitura
 *  (permissão relatorios_cmv); action "cancel" escreve no Bling real e exige Master.
 *  action "list": uma página da listagem resumida (1 chamada ao Bling), filtrando por situação
 *  Em aberto no cliente, já que o Bling não filtra por status na query de lista.
 *  action "items": itens de até 20 pedidos (1 chamada ao Bling por pedido).
 *  action "resolve": acha o id interno + situação atual de até 20 pedidos pelo número exibido.
 *  action "cancel": cancela até 20 pedidos, reconferindo que cada um ainda está Em aberto e que
 *  o id corresponde ao número esperado antes de agir. */
export async function POST(request:Request){
 try{
  const user=await requirePermission("relatorios_cmv");
  const body=await request.json().catch(()=>({})) as {action?:string;dataInicial?:string;dataFinal?:string;pagina?:number;orderIds?:string[];numeros?:string[];items?:{id:string;numero:string}[];situacaoId?:string};
  const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

  if(body.action==="list"){
   const dataInicial=text(body.dataInicial),dataFinal=text(body.dataFinal),pagina=Number(body.pagina)||1;
   if(!/^\d{4}-\d{2}-\d{2}$/.test(dataInicial)||!/^\d{4}-\d{2}-\d{2}$/.test(dataFinal))return NextResponse.json({error:"Informe dataInicial e dataFinal no formato AAAA-MM-DD."},{status:400});
   const result=await blingApi(`/pedidos/vendas?dataInicial=${dataInicial}&dataFinal=${dataFinal}&pagina=${pagina}&limite=100`);
   const rows=list(result.data).map(record);
   const abertos=rows.filter(r=>num(record(r.situacao).valor)===0).map(r=>({id:text(r.id),numero:text(r.numero),data:text(r.data),cliente:text(record(r.contato).nome),total:num(r.total)}));
   return NextResponse.json({ok:true,pagina,totalNaPagina:rows.length,abertosNaPagina:abertos.length,orders:abertos,temMais:rows.length===100});
  }

  if(body.action==="items"){
   const ids=list(body.orderIds).map(text).filter(Boolean).slice(0,20);
   if(!ids.length)return NextResponse.json({error:"Informe orderIds."},{status:400});
   const out:{id:string;numero:string;data:string;cliente:string;total:number;itens:{codigo:string;descricao:string;quantidade:number}[]}[]=[];
   const errors:string[]=[];
   for(const id of ids){
    try{
     const d=record((await blingApi(`/pedidos/vendas/${id}`)).data);
     out.push({id,numero:text(d.numero),data:text(d.data),cliente:text(record(d.contato).nome),total:num(d.total),itens:list(d.itens).map(record).map(i=>({codigo:text(i.codigo),descricao:text(i.descricao),quantidade:num(i.quantidade)}))});
    }catch(error){errors.push(`pedido ${id}: ${error instanceof Error?error.message:"erro"}`)}
    await sleep(120); // gentil com o limite de taxa do Bling — vamos fazer ~1400 chamadas ao todo
   }
   return NextResponse.json({ok:true,orders:out,errors});
  }

  if(body.action==="resolve"){
   // Acha o id interno + situação atual de cada pedido pelo número exibido (o Bling só filtra
   // por id na maioria das rotas). 1 chamada ao Bling por número.
   const numeros=list(body.numeros).map(text).filter(Boolean).slice(0,20);
   if(!numeros.length)return NextResponse.json({error:"Informe numeros."},{status:400});
   const out:{numero:string;id:string;situacaoValor:number|null;situacaoId:string;cliente:string;data:string}[]=[];
   const errors:string[]=[];
   for(const numero of numeros){
    try{
     const rows=list((await blingApi(`/pedidos/vendas?numero=${encodeURIComponent(numero)}&limite=10`)).data).map(record);
     const found=rows.find(r=>text(r.numero)===numero);
     if(!found){errors.push(`pedido ${numero}: não encontrado`);continue}
     const sit=record(found.situacao);
     out.push({numero,id:text(found.id),situacaoValor:sit.valor===undefined?null:num(sit.valor),situacaoId:text(sit.id),cliente:text(record(found.contato).nome),data:text(found.data)});
    }catch(error){errors.push(`pedido ${numero}: ${error instanceof Error?error.message:"erro"}`)}
    await sleep(120);
   }
   return NextResponse.json({ok:true,orders:out,errors});
  }

  if(body.action==="cancel"){
   if(user.role!=="master")return NextResponse.json({error:"Só o usuário Master pode cancelar pedidos no Bling."},{status:403});
   // Cancela cada pedido só depois de reconferir, na hora, que ele ainda está "Em aberto"
   // (valor===0) — evita cancelar algo que mudou de status entre a leitura e a ação.
   const items=list(body.items).filter((x):x is {id:string;numero:string}=>!!x&&typeof x==="object").slice(0,20);
   const situacaoId=text(body.situacaoId);
   if(!items.length||!situacaoId)return NextResponse.json({error:"Informe items e situacaoId."},{status:400});
   const cancelled:string[]=[],skipped:{numero:string;motivo:string}[]=[];
   for(const item of items){
    const id=text(item.id),numero=text(item.numero);
    if(!id){skipped.push({numero,motivo:"sem id"});continue}
    try{
     const d=record((await blingApi(`/pedidos/vendas/${id}`)).data);
     if(text(d.numero)!==numero){skipped.push({numero,motivo:`id ${id} corresponde ao pedido ${text(d.numero)}, não ${numero} — não cancelei`});continue}
     if(num(record(d.situacao).valor)!==0){skipped.push({numero,motivo:`não está mais Em aberto (valor ${num(record(d.situacao).valor)})`});continue}
     await blingApi(`/pedidos/vendas/${id}/situacoes/${situacaoId}`,{method:"PATCH"});
     cancelled.push(numero);
    }catch(error){skipped.push({numero,motivo:error instanceof Error?error.message:"erro"})}
    await sleep(150);
   }
   await logAudit({user:user.name,action:"orders.bulk_cancel",detail:`${cancelled.length} pedido(s) cancelado(s): ${cancelled.join(", ")||"nenhum"}${skipped.length?` · pulados: ${skipped.map(s=>`${s.numero} (${s.motivo})`).join("; ")}`:""}`});
   return NextResponse.json({ok:true,cancelled,skipped});
  }

  return NextResponse.json({error:"Use action \"list\", \"items\", \"resolve\" ou \"cancel\"."},{status:400});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível consultar os pedidos."},{status:500})}
}
