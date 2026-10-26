import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../lib/auth";
import {blingApi} from "../../../../../lib/bling";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const list=(v:unknown)=>Array.isArray(v)?v:[];
const text=(v:unknown)=>String(v??"").trim();

/** Investigação pontual: produtos "com variação" no Bling parecem não trazer custo no
 *  registro pai — precisamos ver a estrutura real (variacoes[], estoque virtual) antes de
 *  ajustar costLookup em cmv/route.ts. Devolve o produto cru + cada variação crua. */
export async function GET(request:Request){
 try{
  await requirePermission("relatorios_cmv");
  const sku=text(new URL(request.url).searchParams.get("sku"));
  const id=text(new URL(request.url).searchParams.get("id"));
  if(!sku&&!id)return NextResponse.json({error:"Informe o SKU ou o id."},{status:400});

  let productId=id;
  if(!productId){
   const search=await blingApi(`/produtos?codigo=${encodeURIComponent(sku)}`);
   const found=list(search.data).map(record).find(p=>text(p.codigo)===sku)||list(search.data).map(record)[0];
   if(!found)return NextResponse.json({error:`SKU ${sku} não encontrado.`},{status:404});
   productId=text(found.id);
  }

  const full=record((await blingApi(`/produtos/${productId}`)).data);
  const variations=list(full.variacoes).map(record);
  const variationDetails=await Promise.all(variations.map(async v=>{
   const vid=text(v.id);
   if(!vid)return v;
   return record((await blingApi(`/produtos/${vid}`)).data);
  }));
  const lojas=await blingApi(`/produtos/lojas?idProduto=${productId}`).then(r=>list(r.data).map(record)).catch(error=>({error:error instanceof Error?error.message:String(error)}));

  return NextResponse.json({ok:true,parentFull:full,variationsFull:variationDetails,lojas});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível consultar o produto."},{status:500})}
}
