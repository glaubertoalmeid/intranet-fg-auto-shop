import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../lib/auth";
import {shopeeRequest} from "../../../../../lib/shopee";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const list=(v:unknown)=>Array.isArray(v)?v:[];

/** Investigação pontual: busca os pedidos mais recentes da loja Shopee e o detalhe de
 *  repasse (escrow) de cada um pra descobrir onde comissão/frete moram na API da própria
 *  Shopee (não confiar no que o Bling repassa — ver order-lookup do Bling). */
export async function GET(request:Request){
 try{
  await requirePermission("relatorios_cmv");
  const url=new URL(request.url);
  const limit=Number(url.searchParams.get("limit")||"5");
  const single=url.searchParams.get("orderSn")||"";
  let orderSns:string[];
  if(single){
   orderSns=[single];
  }else{
   const timeTo=Math.floor(Date.now()/1000),timeFrom=timeTo-15*86400;
   const listResult=await shopeeRequest("/api/v2/order/get_order_list",{query:{
    time_range_field:"create_time",time_from:timeFrom,time_to:timeTo,page_size:limit,order_status:"COMPLETED",
   }}) as AnyRecord;
   orderSns=list(record(listResult.response).order_list).map(o=>String(record(o).order_sn)).filter(Boolean);
  }
  if(!orderSns.length)return NextResponse.json({ok:true,count:0,orders:[],note:"Nenhum pedido COMPLETED nos últimos 15 dias."});

  const escrows=await Promise.all(orderSns.map(async sn=>{
   const r=await shopeeRequest("/api/v2/payment/get_escrow_detail",{query:{order_sn:sn}}).catch(e=>({error:String(e)})) as AnyRecord;
   const detail=await shopeeRequest("/api/v2/order/get_order_detail",{query:{order_sn_list:sn,response_optional_fields:"order_status"}}).catch(e=>({error:String(e)})) as AnyRecord;
   const orderStatus=list(record(detail.response).order_list).map(record)[0]?.order_status??detail.error??null;
   return {orderSn:sn,orderStatus,income:record(r.response).order_income||r.error||r};
  }));

  return NextResponse.json({ok:true,count:orderSns.length,orders:escrows});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível consultar a Shopee."},{status:500})}
}
