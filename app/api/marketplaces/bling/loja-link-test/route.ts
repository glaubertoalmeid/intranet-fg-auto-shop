import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../lib/auth";
import {blingApi} from "../../../../../lib/bling";
import {getSupabase} from "../../../../../lib/supabase";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const list=(v:unknown)=>Array.isArray(v)?v:[];

/** Confirma de vez (com dado ao vivo, não memória) qual loja.id do Bling é a Shopee —
 *  pega uma venda Shopee real e recente do cmv_sales, busca o pedido completo no Bling e
 *  cruza loja.id com o intermediador (CNPJ) e com a lista de canais-venda. Também sonda se
 *  POST /produtos/lojas aceita criar vínculo (erro de validação = aceita; 404/405 = não). */
export async function GET(){
 try{
  await requirePermission("anuncios");
  const {data:shopeeSale}=await getSupabase().from("cmv_sales").select("sale_id").ilike("channel","%shopee%").order("sale_date",{ascending:false}).limit(1).maybeSingle();
  if(!shopeeSale)return NextResponse.json({error:"Nenhuma venda Shopee encontrada em cmv_sales."},{status:404});

  const [channels,order,probe]=await Promise.all([
   blingApi("/canais-venda?pagina=1&limite=100"),
   blingApi(`/pedidos/vendas/${shopeeSale.sale_id}`),
   blingApi("/produtos/lojas",{method:"POST",body:JSON.stringify({produto:{id:0},loja:{id:0},codigo:"",preco:0})}).catch(error=>({error:error instanceof Error?error.message:String(error)})),
  ]);
  const channelRows=list(channels.data).map(record).map(c=>({id:c.id,descricao:c.descricao}));
  const orderData=record(order.data);
  return NextResponse.json({saleId:shopeeSale.sale_id,channels:channelRows,orderLojaId:record(orderData.loja).id,orderIntermediador:record(orderData.intermediador),postProbe:probe});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível investigar."},{status:500})}
}
