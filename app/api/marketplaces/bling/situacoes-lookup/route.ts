import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../lib/auth";
import {blingApi} from "../../../../../lib/bling";

/** Investigação pontual: IDs de situação são configuráveis por conta no Bling (não são
 *  universais), então não dá pra assumir que id=9 significa "Cancelado" só porque parece.
 *  Busca os módulos e as situações reais de Pedidos de Venda desta conta. */
export async function GET(){
 try{
  await requirePermission("relatorios_cmv");
  const modules=await blingApi("/situacoes/modulos");
  const list=Array.isArray(modules.data)?modules.data:[];
  const vendas=list.find((m)=>{const rec=m as Record<string,unknown>;return String(rec.descricao||rec.nome||"").toLowerCase().includes("venda")})as Record<string,unknown>|undefined;
  if(!vendas)return NextResponse.json({modules:list});
  const situations=await blingApi(`/situacoes/modulos/${vendas.id}`);
  return NextResponse.json({modules:list,vendasModuleId:vendas.id,situations:situations.data});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível consultar as situações."},{status:500})}
}
