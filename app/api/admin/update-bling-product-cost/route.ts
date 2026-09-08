import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {blingApi} from "../../../../lib/bling";
import {logAudit} from "../../../../lib/audit";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const text=(v:unknown)=>String(v??"").trim();

// A API do Bling não tem PATCH parcial pra produto — o PUT espera o registro inteiro de
// volta (nome/tipo/situacao/formato/variacoes são obrigatórios). Por isso é sempre
// ler → alterar só o campo pedido → regravar tudo, preservando o resto exatamente como
// veio, pra não arriscar apagar outro dado do cadastro.
async function updateCost(blingProductId:string,newCost:number){
 const detail=record((await blingApi(`/produtos/${blingProductId}`)).data);
 const fornecedor=record(detail.fornecedor);
 const estoque=record(detail.estoque);
 const payload:AnyRecord={
  nome:detail.nome,codigo:detail.codigo,preco:detail.preco,tipo:detail.tipo,situacao:detail.situacao,formato:detail.formato,
  descricaoCurta:detail.descricaoCurta,dataValidade:detail.dataValidade,unidade:detail.unidade,
  pesoLiquido:detail.pesoLiquido,pesoBruto:detail.pesoBruto,volumes:detail.volumes,itensPorCaixa:detail.itensPorCaixa,
  gtin:detail.gtin,gtinEmbalagem:detail.gtinEmbalagem,tipoProducao:detail.tipoProducao,condicao:detail.condicao,
  freteGratis:detail.freteGratis,marca:detail.marca,descricaoComplementar:detail.descricaoComplementar,
  linkExterno:detail.linkExterno,observacoes:detail.observacoes,categoria:detail.categoria,
  estoque:Object.keys(estoque).length?{minimo:estoque.minimo,maximo:estoque.maximo,crossdocking:estoque.crossdocking,localizacao:estoque.localizacao}:undefined,
  actionEstoque:detail.actionEstoque,dimensoes:detail.dimensoes,tributacao:detail.tributacao,linhaProduto:detail.linhaProduto,
  estrutura:detail.estrutura,camposCustomizados:detail.camposCustomizados,
  fornecedor:{...fornecedor,precoCusto:newCost},
  variacoes:Array.isArray(detail.variacoes)?detail.variacoes:[],
 };
 await blingApi(`/produtos/${blingProductId}`,{method:"PUT",body:JSON.stringify(payload)});
}

/** Corrige o custo de um ou mais produtos direto no Bling (a fonte de verdade) — não só
 *  no espelho do Supabase, que seria sobrescrito no próximo sync. Master-only por
 *  escrever no ERP real. */
export async function POST(request:Request){
 try{
  const user=await requirePermission("produtos");
  if(user.role!=="master")return NextResponse.json({error:"Só o usuário Master pode corrigir cadastro no Bling."},{status:403});

  const body=await request.json().catch(()=>({})) as {items?:{blingProductId:string;cost:number}[]};
  const items=Array.isArray(body.items)?body.items:[];
  if(!items.length)return NextResponse.json({error:"Informe ao menos um produto para corrigir."},{status:400});

  const updated:string[]=[],failed:{blingProductId:string;error:string}[]=[];
  for(const item of items){
   const blingProductId=text(item.blingProductId);if(!blingProductId)continue;
   try{
    await updateCost(blingProductId,Number(item.cost)||0);
    updated.push(blingProductId);
   }catch(error){
    failed.push({blingProductId,error:error instanceof Error?error.message:"erro desconhecido"});
   }
  }

  await logAudit({user:user.name,action:"products.update_bling_cost",detail:`${updated.length} atualizado(s)${failed.length?` · falhou: ${failed.map(f=>`${f.blingProductId} (${f.error})`).join(", ")}`:""}`});
  return NextResponse.json({ok:true,updated:updated.length,failed});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível corrigir o custo no Bling."},{status:500})}
}
