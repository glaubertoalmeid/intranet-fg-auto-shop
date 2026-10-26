import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../lib/auth";
import {blingApi} from "../../../../../lib/bling";

/** Investigação pontual: o usuário confirmou que o Bling tem 4 preços por canal
 *  (tabelas de preço) pro mesmo produto, mas /produtos/{id} só devolve um "preco" único.
 *  A lib de terceiros clonada não modela esse recurso — testando os caminhos prováveis
 *  direto na API real em vez de adivinhar pela doc. */
export async function GET(request:Request){
 try{
  await requirePermission("relatorios_cmv");
  const productId=new URL(request.url).searchParams.get("productId")||"";
  const candidates=[
   `/produtos/lojas/${productId}`,
   `/produtos/${productId}/lojas`,
   `/produtos/lojas?idProduto=${productId}`,
   `/produtos/${productId}/precos`,
   `/produtos/${productId}/tabelaspreco`,
   `/produtos/${productId}/tabelasprecos`,
  ];
  const results:Record<string,unknown>={};
  for(const path of candidates){
   try{results[path]=await blingApi(path)}
   catch(error){results[path]={error:error instanceof Error?error.message:"erro"}}
  }
  return NextResponse.json(results);
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível investigar tabelas de preço."},{status:500})}
}
