import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {blingApi} from "../../../../lib/bling";
import {logAudit} from "../../../../lib/audit";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const text=(v:unknown)=>String(v??"").trim();

// Mesmo padrão ler → alterar → regravar de update-bling-product-cost (o Bling não tem PATCH
// parcial). Só grava se a marca atual estiver vazia e se o código (SKU) do produto no Bling
// bater com o esperado — protege contra ID trocado e contra sobrescrever marca já preenchida.
async function setBrand(blingProductId:string,sku:string,brand:string):Promise<"updated"|"skipped_has_brand"|"sku_mismatch"|"unchanged"> {
 const detail=record((await blingApi(`/produtos/${blingProductId}`)).data);
 if(text(detail.codigo)!==sku)return "sku_mismatch";
 const current=record(detail.marca);
 const currentBrand=text(typeof detail.marca==="string"?detail.marca:current.descricao);
 if(currentBrand===brand)return "unchanged";
 if(currentBrand)return "skipped_has_brand";
 const fornecedor=record(detail.fornecedor);
 const estoque=record(detail.estoque);
 const payload:AnyRecord={
  nome:detail.nome,codigo:detail.codigo,preco:detail.preco,tipo:detail.tipo,situacao:detail.situacao,formato:detail.formato,
  descricaoCurta:detail.descricaoCurta,dataValidade:detail.dataValidade,unidade:detail.unidade,
  pesoLiquido:detail.pesoLiquido,pesoBruto:detail.pesoBruto,volumes:detail.volumes,itensPorCaixa:detail.itensPorCaixa,
  gtin:detail.gtin,gtinEmbalagem:detail.gtinEmbalagem,tipoProducao:detail.tipoProducao,condicao:detail.condicao,
  freteGratis:detail.freteGratis,marca:brand,descricaoComplementar:detail.descricaoComplementar,
  linkExterno:detail.linkExterno,observacoes:detail.observacoes,categoria:detail.categoria,
  estoque:Object.keys(estoque).length?{minimo:estoque.minimo,maximo:estoque.maximo,crossdocking:estoque.crossdocking,localizacao:estoque.localizacao}:undefined,
  actionEstoque:detail.actionEstoque,dimensoes:detail.dimensoes,tributacao:detail.tributacao,linhaProduto:detail.linhaProduto,
  estrutura:detail.estrutura,camposCustomizados:detail.camposCustomizados,
  fornecedor:Object.keys(fornecedor).length?fornecedor:undefined,
  variacoes:Array.isArray(detail.variacoes)?detail.variacoes:[],
 };
 await blingApi(`/produtos/${blingProductId}`,{method:"PUT",body:JSON.stringify(payload)});
 return "updated";
}

/** Preenche a marca de produtos direto no Bling (fonte de verdade — só no Supabase seria
 *  sobrescrito no próximo sync). Cada produto custa 2 sub-requisições (GET + PUT), então o
 *  chamador manda em lotes de até 20 por chamada (teto de 50 por invocação do Worker). */
export async function POST(request:Request){
 try{
  const user=await requirePermission("produtos");
  if(user.role!=="master")return NextResponse.json({error:"Só o usuário Master pode corrigir cadastro no Bling."},{status:403});

  const body=await request.json().catch(()=>({})) as {brand?:string;items?:{blingProductId:string;sku:string}[]};
  const brand=text(body.brand);
  const items=Array.isArray(body.items)?body.items:[];
  if(!brand)return NextResponse.json({error:"Informe a marca."},{status:400});
  if(!items.length)return NextResponse.json({error:"Informe ao menos um produto."},{status:400});
  if(items.length>20)return NextResponse.json({error:"Máximo de 20 produtos por chamada (limite de sub-requisições do Worker)."},{status:400});

  const result:Record<string,string[]>={updated:[],unchanged:[],skipped_has_brand:[],sku_mismatch:[]};
  const failed:{sku:string;error:string}[]=[];
  for(const item of items){
   const blingProductId=text(item.blingProductId),sku=text(item.sku);
   if(!blingProductId||!sku)continue;
   try{result[await setBrand(blingProductId,sku,brand)].push(sku)}
   catch(error){failed.push({sku,error:error instanceof Error?error.message:"erro desconhecido"})}
  }

  await logAudit({user:user.name,action:"products.set_bling_brand",detail:`${brand}: ${result.updated.length} atualizado(s), ${result.unchanged.length} já estavam, ${result.skipped_has_brand.length} com outra marca (pulados), ${result.sku_mismatch.length} SKU divergente${failed.length?` · falhou: ${failed.map(f=>`${f.sku} (${f.error})`).join(", ")}`:""}`});
  return NextResponse.json({ok:true,...result,failed});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível atualizar a marca no Bling."},{status:500})}
}
