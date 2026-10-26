import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../lib/auth";
import {getMercadoLivreConfig,mercadoLivreFetch} from "../../../../../lib/mercado-livre";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const list=(v:unknown)=>Array.isArray(v)?v:[];

/** Investigação pontual: existe API de visitas do Mercado Livre (/visits/items) pro escopo
 *  que já temos autorizado, ou precisa de permissão extra (mesmo padrão já visto com
 *  Pedidos)? Pega um item_id de um pedido recente e testa direto. */
export async function GET(){
 try{
  await requirePermission("relatorios_cmv");
  const config=await getMercadoLivreConfig();
  if(!config.mlUserId)return NextResponse.json({error:"Mercado Livre não conectado."},{status:400});

  const search=await mercadoLivreFetch(`/orders/search?seller=${config.mlUserId}&sort=date_desc&limit=3`);
  const searchData=await search.json() as AnyRecord;
  const orders=list(searchData.results).map(record);
  const itemIds=[...new Set(orders.flatMap(o=>list(o.order_items).map(oi=>String(record(record(oi).item).id||""))).filter(Boolean))];
  if(!itemIds.length)return NextResponse.json({error:"Nenhum item_id encontrado nos pedidos recentes."},{status:404});

  const visitsResp=await mercadoLivreFetch(`/visits/items?ids=${itemIds.join(",")}`);
  const visitsBody=await visitsResp.json().catch(()=>null);

  // Também confere se a conta tem acesso ao "Product Ads" (publicidade)
  const adsResp=await mercadoLivreFetch(`/advertising/advertisers?product_id=PADS`).catch(()=>null);
  const adsBody=adsResp?await adsResp.json().catch(()=>null):null;

  return NextResponse.json({
   itemIds,
   visits:{status:visitsResp.status,body:visitsBody},
   ads:{status:adsResp?.status??null,body:adsBody},
  });
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível consultar métricas do Mercado Livre."},{status:500})}
}
