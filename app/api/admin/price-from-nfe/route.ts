import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {blingApi} from "../../../../lib/bling";
import {logAudit} from "../../../../lib/audit";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const list=(v:unknown)=>Array.isArray(v)?v:[];
const num=(v:unknown)=>Number(v)||0;
const text=(v:unknown)=>String(v??"").trim();
const money=(v:number)=>Math.round(v*100)/100;

// Mesmo padrão ler → alterar → regravar de update-bling-product-cost (o Bling não tem PATCH parcial).
async function setProductPrice(blingProductId:string,price:number){
 const detail=record((await blingApi(`/produtos/${blingProductId}`)).data);
 const estoque=record(detail.estoque);
 const fornecedor=record(detail.fornecedor);
 const payload:AnyRecord={
  nome:detail.nome,codigo:detail.codigo,preco:price,tipo:detail.tipo,situacao:detail.situacao,formato:detail.formato,
  descricaoCurta:detail.descricaoCurta,dataValidade:detail.dataValidade,unidade:detail.unidade,
  pesoLiquido:detail.pesoLiquido,pesoBruto:detail.pesoBruto,volumes:detail.volumes,itensPorCaixa:detail.itensPorCaixa,
  gtin:detail.gtin,gtinEmbalagem:detail.gtinEmbalagem,tipoProducao:detail.tipoProducao,condicao:detail.condicao,
  freteGratis:detail.freteGratis,marca:detail.marca,descricaoComplementar:detail.descricaoComplementar,
  linkExterno:detail.linkExterno,observacoes:detail.observacoes,categoria:detail.categoria,
  estoque:Object.keys(estoque).length?{minimo:estoque.minimo,maximo:estoque.maximo,crossdocking:estoque.crossdocking,localizacao:estoque.localizacao}:undefined,
  actionEstoque:detail.actionEstoque,dimensoes:detail.dimensoes,tributacao:detail.tributacao,linhaProduto:detail.linhaProduto,
  estrutura:detail.estrutura,camposCustomizados:detail.camposCustomizados,
  fornecedor:Object.keys(fornecedor).length?fornecedor:undefined,
  variacoes:Array.isArray(detail.variacoes)?detail.variacoes:[],
 };
 await blingApi(`/produtos/${blingProductId}`,{method:"PUT",body:JSON.stringify(payload)});
 return text(detail.codigo);
}

/** Preço do produto na loja (vínculo) — atualiza se já vinculado, cria se não. */
async function setStorePrice(blingProductId:string,sku:string,lojaId:string,price:number):Promise<"updated"|"created"> {
 const links=list((await blingApi(`/produtos/lojas?idProduto=${blingProductId}&idLoja=${lojaId}`)).data).map(record);
 const existing=links.find(l=>text(record(l.loja).id)===lojaId)||null;
 if(existing){
  await blingApi(`/produtos/lojas/${text(existing.id)}`,{method:"PUT",body:JSON.stringify({
   codigo:text(existing.codigo)||sku,preco:price,precoPromocional:num(existing.precoPromocional),
   produto:{id:Number(blingProductId)},loja:{id:Number(lojaId)},
  })});
  return "updated";
 }
 await blingApi("/produtos/lojas",{method:"POST",body:JSON.stringify({
  codigo:sku,preco:price,precoPromocional:0,produto:{id:Number(blingProductId)},loja:{id:Number(lojaId)},
 })});
 return "created";
}

/** Precificação a partir de uma NF-e de entrada. Master-only, escreve no Bling real.
 *  action "preview": só leitura — devolve os itens crus da nota, os produtos casados por SKU e as lojas
 *  (pra conferir o custo antes de gravar). action "apply": grava preço de venda = custo × (1+markup)
 *  em cada produto e, se lojaId vier, o mesmo valor no vínculo da loja (ex.: Loja PDV).
 *  Cada produto custa ~4 sub-requisições (teto de 50 por invocação) → no máximo 10 por chamada. */
export async function POST(request:Request){
 try{
  const user=await requirePermission("produtos");
  if(user.role!=="master")return NextResponse.json({error:"Só o usuário Master pode alterar preço no Bling."},{status:403});
  const body=await request.json().catch(()=>({})) as {action?:string;numero?:string;nome?:string;desde?:string;skus?:string[];markup?:number;lojaId?:string;lojaIds?:string[];dryRun?:boolean;items?:{blingProductId:string;sku:string;cost:number;price?:number}[]};

  if(body.action==="preview"){
   const numero=text(body.numero);
   if(!numero)return NextResponse.json({error:"Informe o número da NF-e."},{status:400});
   let found:AnyRecord[]=[];
   try{found=list((await blingApi(`/nfe?tipo=0&numero=${encodeURIComponent(numero)}`)).data).map(record)}
   catch(error){return NextResponse.json({error:`Busca da NF-e ${numero} falhou no Bling: ${error instanceof Error?error.message:"erro"}`,stage:"busca"},{status:502})}
   const nfe=found[0];
   if(!nfe)return NextResponse.json({error:`NF-e ${numero} não encontrada.`},{status:404});
   // Cada passo isolado: um endpoint que falhe vira erro no relatório, não derruba a leitura toda.
   const errors:string[]=[];
   const step=async<T,>(label:string,fn:()=>Promise<T>,fallback:T):Promise<T>=>{try{return await fn()}catch(error){errors.push(`${label}: ${error instanceof Error?error.message:"erro"}`);return fallback}};
   const detail=await step("detalhe da NF-e",async()=>record((await blingApi(`/nfe/${text(nfe.id)}`)).data),{} as AnyRecord);
   const itens=list(detail.itens).map(record);
   const skus=[...new Set(itens.map(i=>text(i.codigo)).filter(Boolean))].slice(0,100);
   const products=skus.length?await step("produtos por SKU",async()=>list((await blingApi(`/produtos?${skus.map(s=>`codigos[]=${encodeURIComponent(s)}`).join("&")}&limite=100`)).data).map(record),[] as AnyRecord[]):[];
   const lojas=await step("canais de venda",async()=>list((await blingApi("/canais-venda")).data).map(record).map(l=>({id:text(l.id),descricao:text(l.descricao),tipo:text(l.tipo)})),[] as {id:string;descricao:string;tipo:string}[]);
   const matched=products.map(p=>({id:text(p.id),codigo:text(p.codigo),nome:text(p.nome),preco:num(p.preco),precoCusto:num(p.precoCusto)}));
   return NextResponse.json({ok:true,errors,nfe:{id:text(nfe.id),numero:text(nfe.numero),detailKeys:Object.keys(detail),valorNota:detail.valorNota,frete:detail.frete??detail.valorFrete,seguro:detail.seguro,outras:detail.outrasDespesas,desconto:detail.desconto},itemKeys:Object.keys(itens[0]||{}),itens,matched,lojas});
  }

  if(body.action==="supplier-notes"){
   // Só leitura: NF-es de entrada de um fornecedor (por trecho do nome) + produtos casados por SKU de cada item.
   const nome=text(body.nome).toLowerCase();
   if(nome.length<3)return NextResponse.json({error:"Informe o nome (ou parte) do fornecedor."},{status:400});
   const desde=/^\d{4}-\d{2}-\d{2}$/.test(text(body.desde))?text(body.desde):"2025-01-01";
   const hoje=new Date().toISOString().slice(0,10);
   const notes:AnyRecord[]=[];
   for(let pagina=1;pagina<=5;pagina++){
    const rows=list((await blingApi(`/nfe?tipo=0&dataEmissaoInicial=${desde}%2000:00:00&dataEmissaoFinal=${hoje}%2023:59:59&limite=100&pagina=${pagina}`)).data).map(record);
    notes.push(...rows.filter(n=>text(record(n.contato).nome).toLowerCase().includes(nome)));
    if(rows.length<100)break;
   }
   const errors:string[]=[];
   const result:{id:string;numero:string;data:string;valor:number;itens:{codigo:string;descricao:string;quantidade:number;valor:number}[]}[]=[];
   for(const n of notes.slice(0,6)){
    try{
     const d=record((await blingApi(`/nfe/${text(n.id)}`)).data);
     result.push({id:text(n.id),numero:text(n.numero),data:text(n.dataEmissao),valor:num(n.valorNota),itens:list(d.itens).map(record).map(i=>({codigo:text(i.codigo),descricao:text(i.descricao),quantidade:num(i.quantidade),valor:num(i.valor)}))});
    }catch(error){errors.push(`NF ${text(n.numero)}: ${error instanceof Error?error.message:"erro"}`)}
   }
   const skus=[...new Set(result.flatMap(r=>r.itens.map(i=>i.codigo)).filter(Boolean))].slice(0,100);
   let products:AnyRecord[]=[];
   if(skus.length){try{products=list((await blingApi(`/produtos?${skus.map(s=>`codigos[]=${encodeURIComponent(s)}`).join("&")}&limite=100`)).data).map(record)}catch(error){errors.push(`produtos por SKU: ${error instanceof Error?error.message:"erro"}`)}}
   return NextResponse.json({ok:true,errors,totalNotas:notes.length,notas:result,produtos:products.map(p=>({id:text(p.id),codigo:text(p.codigo),nome:text(p.nome)}))});
  }

  if(body.action==="store-prices"){
   // Ajusta o preço JÁ VINCULADO do produto em cada loja informada (ex.: Loja PDV, Nuvemshop). Não cria vínculo
   // (criar poderia publicar o produto na loja) e não mexe no preço base. dryRun só lê e mostra o antes/depois.
   const lojaIds=list(body.lojaIds).map(text).filter(Boolean).slice(0,3);
   const items=Array.isArray(body.items)?body.items:[];
   if(!lojaIds.length||!items.length)return NextResponse.json({error:"Informe lojaIds e items."},{status:400});
   if(items.length*lojaIds.length>20)return NextResponse.json({error:"Máximo de 20 alterações (produto × loja) por chamada (limite de sub-requisições do Worker)."},{status:400});
   const rows:{sku:string;price:number;stores:Record<string,{status:string;before?:number;error?:string}>}[]=[];
   for(const item of items){
    const id=text(item.blingProductId),sku=text(item.sku),price=Math.round(num(item.price)*100)/100;
    const row:{sku:string;price:number;stores:Record<string,{status:string;before?:number;error?:string}>}={sku,price,stores:{}};
    if(!id||!sku||price<=0){for(const l of lojaIds)row.stores[l]={status:"erro",error:"dados incompletos"};rows.push(row);continue}
    for(const lojaId of lojaIds){
     try{
      const links=list((await blingApi(`/produtos/lojas?idProduto=${id}&idLoja=${lojaId}`)).data).map(record);
      const existing=links.find(l=>text(record(l.loja).id)===lojaId);
      if(!existing){row.stores[lojaId]={status:"nao_vinculado"};continue}
      const before=num(existing.preco);
      if(Math.abs(before-price)<0.005){row.stores[lojaId]={status:"ja_igual",before};continue}
      if(body.dryRun){row.stores[lojaId]={status:"vai_atualizar",before};continue}
      await blingApi(`/produtos/lojas/${text(existing.id)}`,{method:"PUT",body:JSON.stringify({codigo:text(existing.codigo)||sku,preco:price,precoPromocional:num(existing.precoPromocional),produto:{id:Number(id)},loja:{id:Number(lojaId)}})});
      row.stores[lojaId]={status:"atualizado",before};
     }catch(error){row.stores[lojaId]={status:"erro",error:error instanceof Error?error.message:"erro"}}
    }
    rows.push(row);
   }
   if(!body.dryRun)await logAudit({user:user.name,action:"products.store_prices",detail:`${rows.length} produto(s) × lojas ${lojaIds.join(",")}: ${rows.flatMap(r=>Object.values(r.stores)).filter(s=>s.status==="atualizado").length} atualizado(s)`});
   return NextResponse.json({ok:true,dryRun:!!body.dryRun,rows});
  }

  if(body.action==="apply"){
   const markup=Number(body.markup);
   const items=Array.isArray(body.items)?body.items:[];
   if(!(markup>0&&markup<10))return NextResponse.json({error:"Markup inválido (use fração, ex.: 0.5 para 50%)."},{status:400});
   if(!items.length)return NextResponse.json({error:"Informe os produtos."},{status:400});
   if(items.length>10)return NextResponse.json({error:"Máximo de 10 produtos por chamada (limite de sub-requisições do Worker)."},{status:400});
   const lojaId=text(body.lojaId);
   const done:{sku:string;cost:number;price:number;store?:string}[]=[],failed:{sku:string;error:string}[]=[];
   for(const item of items){
    const id=text(item.blingProductId),sku=text(item.sku),cost=num(item.cost);
    if(!id||!sku||cost<=0){failed.push({sku,error:"Dados incompletos (id, sku ou custo)."});continue}
    const price=money(cost*(1+markup));
    try{
     const code=await setProductPrice(id,price);
     if(code!==sku){failed.push({sku,error:`SKU do produto no Bling é ${code} — preço já gravado, confira.`});continue}
     const row:{sku:string;cost:number;price:number;store?:string}={sku,cost,price};
     if(lojaId){try{row.store=await setStorePrice(id,sku,lojaId,price)}catch(error){row.store=`falhou: ${error instanceof Error?error.message:"erro"}`}}
     done.push(row);
    }catch(error){failed.push({sku,error:error instanceof Error?error.message:"erro desconhecido"})}
   }
   await logAudit({user:user.name,action:"products.price_from_nfe",detail:`markup ${(markup*100).toFixed(0)}%: ${done.length} precificado(s)${failed.length?` · falhou: ${failed.map(f=>`${f.sku} (${f.error})`).join(", ")}`:""}`});
   return NextResponse.json({ok:true,done,failed});
  }

  return NextResponse.json({error:"Use action \"preview\" ou \"apply\"."},{status:400});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível precificar pela NF-e."},{status:500})}
}
