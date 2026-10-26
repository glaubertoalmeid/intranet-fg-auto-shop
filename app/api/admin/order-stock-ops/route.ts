import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {blingApi} from "../../../../lib/bling";
import {logAudit} from "../../../../lib/audit";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const list=(v:unknown)=>Array.isArray(v)?v:[];
const num=(v:unknown)=>Number(v)||0;
const text=(v:unknown)=>String(v??"").trim();

async function findProduct(sku:string){
 const rows=list((await blingApi(`/produtos?codigos[]=${encodeURIComponent(sku)}&limite=5`)).data).map(record);
 const p=rows.find(r=>text(r.codigo)===sku);
 return p?{id:text(p.id),codigo:text(p.codigo),nome:text(p.nome)}:null;
}

/** Cancelar pedidos que seguram reserva de um produto e zerar o saldo dele. Master-only, escreve no Bling real.
 *  preview: só leitura (produto, depósitos, saldo/reservado, pedidos com data/cliente/situação/itens e as situações de Vendas).
 *  cancel: muda a situação dos pedidos informados — só se estiverem "Em aberto" e contiverem o SKU.
 *  zero: balanço 0 no depósito informado — só se não restar reserva. */
export async function POST(request:Request){
 try{
  const user=await requirePermission("produtos");
  if(user.role!=="master")return NextResponse.json({error:"Só o usuário Master pode alterar pedidos e estoque no Bling."},{status:403});
  const body=await request.json().catch(()=>({})) as {action?:string;sku?:string;numeros?:string[];orderIds?:string[];situacaoId?:string;depositoId?:string};
  const sku=text(body.sku);
  if(!sku)return NextResponse.json({error:"Informe o SKU."},{status:400});
  const product=await findProduct(sku);
  if(!product)return NextResponse.json({error:`Produto ${sku} não encontrado no Bling.`},{status:404});

  const errors:string[]=[];
  const step=async<T,>(label:string,fn:()=>Promise<T>,fallback:T):Promise<T>=>{try{return await fn()}catch(error){errors.push(`${label}: ${error instanceof Error?error.message:"erro"}`);return fallback}};

  const getOrder=async(id:string)=>{
   const d=record((await blingApi(`/pedidos/vendas/${id}`)).data);
   const itens=list(d.itens).map(record);
   const item=itens.find(i=>text(i.codigo)===sku);
   return {id,numero:text(d.numero),numeroLoja:text(d.numeroLoja),data:text(d.data),situacao:record(d.situacao),cliente:text(record(d.contato).nome),total:num(d.total),temSku:!!item,qtdSku:num(item?.quantidade),loja:text(record(d.loja).id)};
  };

  if(body.action==="preview"){
   const depositos=await step("depósitos",async()=>list((await blingApi("/depositos")).data).map(record).map(d=>({id:text(d.id),descricao:text(d.descricao),situacao:text(d.situacao),padrao:d.padrao})),[] as AnyRecord[]);
   // A API devolve o saldo JÁ POR DEPÓSITO (escopado pelo id na URL) — não existe um array
   // "depositos" aninhado dentro da resposta pra quebrar depois; tem que chamar uma vez por
   // depósito. (Erro anterior: só chamava pro primeiro depósito e repetia o mesmo total pros
   // outros, fazendo parecer saldo "fantasma" quando na verdade o estoque só estava no outro depósito.)
   const saldos:AnyRecord[]=[];
   for(const dep of depositos.slice(0,6)){
    const rows=await step(`saldo em ${dep.descricao}`,async()=>list((await blingApi(`/estoques/saldos/${text(dep.id)}?idsProdutos[]=${product.id}`)).data).map(record),[] as AnyRecord[]);
    const s=rows.find(r=>text(record(r.produto).id)===product.id)||null;
    saldos.push({deposito:text(dep.descricao),depositoId:text(dep.id),fisico:num(s?.saldoFisicoTotal),virtual:num(s?.saldoVirtualTotal)});
   }
   const pedidos:unknown[]=[];
   for(const n of list(body.numeros).map(text).filter(Boolean).slice(0,6)){
    const found=await step(`pedido ${n}`,async()=>list((await blingApi(`/pedidos/vendas?numero=${encodeURIComponent(n)}`)).data).map(record),[] as AnyRecord[]);
    if(!found.length){pedidos.push({numero:n,naoEncontrado:true});continue}
    for(const f of found.slice(0,3))pedidos.push(await step<AnyRecord>(`detalhe do pedido ${n}`,()=>getOrder(text(f.id)),{numero:n,erro:true}));
   }
   const modulos=await step("módulos de situação",async()=>list((await blingApi("/situacoes/modulos")).data).map(record),[] as AnyRecord[]);
   const vendas=modulos.find(m=>text(m.nome||m.descricao).toLowerCase().includes("venda"));
   const situacoes=vendas?await step("situações de vendas",async()=>list((await blingApi(`/situacoes/modulos/${text(vendas.id)}`)).data).map(record).map(s=>({id:text(s.id),nome:text(s.nome),idHerdado:text(s.idHerdado)})),[] as AnyRecord[]):[];
   return NextResponse.json({ok:true,errors,product,depositos,saldos,pedidos,situacoes});
  }

  if(body.action==="cancel"){
   const ids=list(body.orderIds).map(text).filter(Boolean).slice(0,10),situacaoId=text(body.situacaoId);
   if(!ids.length||!situacaoId)return NextResponse.json({error:"Informe orderIds e situacaoId."},{status:400});
   const cancelled:string[]=[],skipped:{id:string;motivo:string}[]=[];
   for(const id of ids){
    try{
     const o=await getOrder(id);
     if(!o.temSku){skipped.push({id,motivo:`pedido ${o.numero} não contém o SKU ${sku}`});continue}
     // No Bling v3 o campo `valor` da situação é numérico: 0 = Em aberto, 1 = Atendido, 2 = Cancelado...
     if(o.situacao.valor!==0){skipped.push({id,motivo:`pedido ${o.numero} não está Em aberto (situação valor ${text(o.situacao.valor)})`});continue}
     await blingApi(`/pedidos/vendas/${id}/situacoes/${situacaoId}`,{method:"PATCH"});
     cancelled.push(o.numero);
    }catch(error){skipped.push({id,motivo:error instanceof Error?error.message:"erro"})}
   }
   await logAudit({user:user.name,action:"orders.cancel_for_stock",detail:`SKU ${sku}: cancelados ${cancelled.join(", ")||"nenhum"}${skipped.length?` · pulados: ${skipped.map(s=>`${s.id} (${s.motivo})`).join("; ")}`:""}`});
   return NextResponse.json({ok:true,cancelled,skipped});
  }

  if(body.action==="zero"){
   const depositoId=text(body.depositoId);
   if(!depositoId)return NextResponse.json({error:"Informe depositoId."},{status:400});
   const rows=list((await blingApi(`/estoques/saldos/${depositoId}?idsProdutos[]=${product.id}`)).data).map(record);
   const s=rows.find(r=>text(record(r.produto).id)===product.id);
   const fisico=num(s?.saldoFisicoTotal),reservado=num(s?.saldoFisicoTotal)-num(s?.saldoVirtualTotal);
   if(reservado>0)return NextResponse.json({error:`Ainda há ${reservado} unidade(s) reservada(s) — cancele os pedidos antes de zerar.`,fisico,reservado},{status:409});
   if(fisico===0)return NextResponse.json({ok:true,mensagem:"Saldo já está zerado.",fisico});
   await blingApi("/estoques",{method:"POST",body:JSON.stringify({produto:{id:Number(product.id)},deposito:{id:Number(depositoId)},operacao:"B",quantidade:0,preco:0,custo:0,observacoes:"Zerado a pedido (baixa total do SKU)"})});
   await logAudit({user:user.name,action:"stock.zero",detail:`SKU ${sku}: saldo ${fisico} → 0 (depósito ${depositoId})`});
   return NextResponse.json({ok:true,anterior:fisico,atual:0});
  }

  return NextResponse.json({error:"Use action preview, cancel ou zero."},{status:400});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível concluir a operação."},{status:500})}
}
