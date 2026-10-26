import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../lib/auth";
import {shopeeRequest} from "../../../../../lib/shopee";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const list=(v:unknown)=>Array.isArray(v)?v:[];

/** Investigação pontual: a Shopee expõe visitas/curtidas por item pro escopo que já temos
 *  autorizado, ou precisa de permissão de Ads separada (mesmo padrão já visto com Pedidos
 *  do ML)? Pega um item real do catálogo e testa. */
export async function GET(){
 try{
  await requirePermission("relatorios_cmv");

  const itemsResp=await shopeeRequest("/api/v2/product/get_item_list",{query:{offset:0,page_size:5,item_status:"NORMAL"}});
  const itemIds=list(record(itemsResp.response).item).map(i=>record(i).item_id).filter(Boolean);
  if(!itemIds.length)return NextResponse.json({error:"Nenhum item encontrado no catálogo Shopee.",itemsResp});

  const baseInfo=await shopeeRequest("/api/v2/product/get_item_base_info",{query:{item_id_list:itemIds.join(",")}}).catch(e=>({error:String(e)}));

  // Confere se a conta tem acesso à API de Ads (visitas/desempenho de anúncio costuma
  // ficar atrás desse escopo separado, não do escopo básico de produto/pedido).
  const adsResp=await shopeeRequest("/api/v2/ads/get_recommended_keyword_list",{query:{item_id:itemIds[0]}}).catch(e=>({error:String(e)}));

  return NextResponse.json({itemIds,baseInfoSample:record(record(baseInfo).response).item_list||baseInfo,ads:adsResp});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível consultar métricas da Shopee."},{status:500})}
}
