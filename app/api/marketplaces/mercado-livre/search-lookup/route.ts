import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../lib/auth";
import {mercadoLivreFetch} from "../../../../../lib/mercado-livre";

/** Investigação pontual: a API pública de busca do ML (/sites/MLB/search) dá 403 sem
 *  autenticação de app. Testando se funciona autenticada com nosso próprio token — se sim,
 *  dá pra automatizar coleta de concorrente sem depender de scraping de página nem de
 *  login manual (é a mesma busca que alimenta o site deles). */
export async function GET(request:Request){
 try{
  await requirePermission("relatorios_cmv");
  const q=new URL(request.url).searchParams.get("q")||"";
  if(!q)return NextResponse.json({error:"Informe q."},{status:400});
  const resp=await mercadoLivreFetch(`/sites/MLB/search?q=${encodeURIComponent(q)}`);
  const body=await resp.json().catch(()=>null);
  return NextResponse.json({status:resp.status,body});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível consultar a busca do ML."},{status:500})}
}
