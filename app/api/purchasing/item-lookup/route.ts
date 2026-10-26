import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {suggestPurchaseQuantity} from "../../../../lib/purchasing";
import {getSupabase} from "../../../../lib/supabase";

type ProductRow={id:number;bling_product_id:string;sku:string;name:string;brand:string;category:string;cost:number;stock_physical:number;min_stock:number;supplier_id:number|null;status:string;format:string};
const isDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v);
const LIMIT=15;

/** Busca pontual de um item pro módulo de Compras — responde "por que esse item não
 *  está no Radar/Necessidade?" junto do resultado, reaproveitando a mesma fórmula
 *  (suggestPurchaseQuantity, lib/purchasing.ts) das duas telas pra nunca divergir do
 *  que elas mostram. Sem essa busca, um item fora da régua (ex. estoque ainda cobre o
 *  prazo do fornecedor) simplesmente não aparece em lugar nenhum e parece "sumido". */
export async function GET(request:Request){
 try{
  await requirePermission("compras");
  const url=new URL(request.url);
  const q=(url.searchParams.get("q")||"").trim();
  if(q.length<2)return NextResponse.json({items:[]});
  const fromParam=url.searchParams.get("from")||"",toParam=url.searchParams.get("to")||"";
  const now=new Date();
  const to=isDate(toParam)?toParam:now.toISOString().slice(0,10);
  const from=isDate(fromParam)?fromParam:new Date(now.getTime()-29*86400000).toISOString().slice(0,10);
  const days=Math.max(1,Math.round((new Date(`${to}T00:00:00Z`).getTime()-new Date(`${from}T00:00:00Z`).getTime())/86400000)+1);

  const supabase=getSupabase();
  const escaped=q.replace(/[%,]/g,"");
  const {data:products,error}=await supabase.from("products")
   .select("id,bling_product_id,sku,name,brand,category,cost,stock_physical,min_stock,supplier_id,status,format")
   .or(`name.ilike.%${escaped}%,sku.ilike.%${escaped}%,bling_product_id.ilike.%${escaped}%`)
   .limit(LIMIT);
  if(error)throw new Error(error.message);
  if(!products?.length)return NextResponse.json({items:[],from,to,days});

  const ids=(products as ProductRow[]).map(p=>p.bling_product_id);
  const [{data:suppliers,error:suppliersError},{data:salesRows,error:salesError}]=await Promise.all([
   supabase.from("suppliers").select("id,lead_time_days"),
   supabase.from("cmv_sales").select("product_id,quantity").eq("cancelled",false).in("product_id",ids).gte("sale_date",from).lte("sale_date",to),
  ]);
  if(suppliersError)throw new Error(suppliersError.message);
  if(salesError)throw new Error(salesError.message);

  const leadTimeBySupplier=new Map((suppliers||[]).map(s=>[s.id,s.lead_time_days]));
  const qty30ByProduct=new Map<string,number>();
  for(const row of salesRows||[])qty30ByProduct.set(row.product_id,(qty30ByProduct.get(row.product_id)||0)+(Number(row.quantity)||0));

  const items=(products as ProductRow[]).map(p=>{
   const qty30=qty30ByProduct.get(p.bling_product_id)||0;
   const avgDailySales=qty30/days;
   const leadTimeDays=p.supplier_id?leadTimeBySupplier.get(p.supplier_id)??7:7; // sem fornecedor vinculado, mesmo padrão conservador da tela de Necessidade
   const isKit=p.format==="E";
   const suggestedQuantity=isKit?0:suggestPurchaseQuantity({stockPhysical:p.stock_physical,avgDailySales,leadTimeDays,minStock:p.min_stock});
   const estimatedCost=Math.round(suggestedQuantity*p.cost*100)/100;
   const emRadar=!isKit&&p.stock_physical<=0&&qty30>0;
   const emNecessidade=!isKit&&suggestedQuantity>0;

   let reason:string;
   if(p.status!=="ativo")reason="Produto inativo no catálogo — não entra em nenhuma das listas.";
   else if(isKit)reason="Kit/composição — por regra do módulo, kits não aparecem no Radar nem na Necessidade de compra (só entram explodidos por componente na Análise de compras).";
   else if(emRadar)reason="Está no Radar de reposição: estoque zerado com venda nos últimos 30 dias.";
   else if(emNecessidade)reason="Está na Necessidade de compra: estoque não cobre a venda média projetada para o prazo de entrega.";
   else reason=`Não aparece em nenhuma lista: o estoque atual (${p.stock_physical}) cobre a venda projetada para o prazo de entrega considerado (${leadTimeDays} dia${leadTimeDays===1?"":"s"}${p.supplier_id?"":", padrão sem fornecedor vinculado"}).`;

   return {
    id:p.id,blingProductId:p.bling_product_id,sku:p.sku,name:p.name,brand:p.brand,category:p.category,
    status:p.status,format:p.format,isKit,
    stock:p.stock_physical,minStock:p.min_stock,
    qty:qty30,avgDailySales:Number(avgDailySales.toFixed(2)),leadTimeDays,
    suggestedQuantity,estimatedCost,
    emRadar,emNecessidade,reason,
   };
  });

  return NextResponse.json({items,from,to,days});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível buscar o item."},{status:500})}
}
