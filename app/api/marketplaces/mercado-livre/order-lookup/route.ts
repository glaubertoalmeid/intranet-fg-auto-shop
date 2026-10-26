import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../lib/auth";
import {getMercadoLivreConfig,mercadoLivreFetch} from "../../../../../lib/mercado-livre";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const list=(v:unknown)=>Array.isArray(v)?v:[];

/** Investigação pontual: busca os pedidos mais recentes do vendedor no Mercado Livre e
 *  devolve os campos crus de pagamento/frete pra descobrir onde a comissão/frete moram
 *  na API do próprio ML (não confiar no que o Bling repassa — ver order-lookup do Bling). */
export async function GET(request:Request){
 try{
  await requirePermission("relatorios_cmv");
  const config=await getMercadoLivreConfig();
  if(!config.mlUserId)return NextResponse.json({error:"Mercado Livre não conectado."},{status:400});
  const limit=new URL(request.url).searchParams.get("limit")||"5";

  const searchUrl=`/orders/search?seller=${config.mlUserId}&sort=date_desc&limit=${limit}`;
  const searchResponse=await mercadoLivreFetch(searchUrl);
  const search=await searchResponse.json() as AnyRecord;
  if(!searchResponse.ok)return NextResponse.json({error:"ML search falhou",status:searchResponse.status,raw:search},{status:500});
  const orders=list(search.results).map(record);
  if(!orders.length)return NextResponse.json({ok:true,count:0,orders:[],rawPaging:search.paging,searchUrl});

  const details=await Promise.all(orders.map(async o=>{
   const orderId=String(o.id);
   const shippingId=String(record(o.shipping).id||"");
   const [shipping,full]=await Promise.all([
    shippingId?mercadoLivreFetch(`/shipments/${shippingId}`).then(r=>r.json()).catch(()=>null):Promise.resolve(null),
    mercadoLivreFetch(`/orders/${orderId}`).then(r=>r.json()).catch(()=>null),
   ]);
   return {
    orderId,
    dateCreated:o.date_created,
    totalAmount:o.total_amount,
    payments:list(o.payments).map(record),
    fullPayments:list(record(full).payments).map(record),
    orderItems:list(record(full).order_items).map(record).map(i=>({saleFee:record(i).sale_fee,fullUnitPrice:record(i).full_unit_price,unitPrice:record(i).unit_price,quantity:record(i).quantity})),
    shippingListCost:shipping?record(shipping).list_cost:null,
   };
  }));

  return NextResponse.json({ok:true,count:orders.length,orders:details});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível consultar o Mercado Livre."},{status:500})}
}
