import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {buildPurchaseAnalysis,sortAnalysisRows,type PurchaseAnalysisSort,type PurchasingProduct,type PurchasingSale} from "../../../../lib/purchasing";
import {fetchAllRows,getSupabase} from "../../../../lib/supabase";

const isDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v);
const SORTS:PurchaseAnalysisSort[]=["total_sales","monthly_average","stock_asc","suggested_quantity","estimated_cost","brand","category"];

/** Tela de Análise de Compras (pedido à parte do Radar/Necessidade de compra já existentes
 *  nesta tela — ver lib/purchasing.ts). Período por datas explícitas (igual à tela de CMV),
 *  com marca/categoria como filtros; canal de venda não filtra a lista, só aparece quebrado
 *  por produto (ver "ANÁLISE POR CANAL DE VENDA" no pedido original). */
export async function GET(request:Request){
 try{
  await requirePermission("compras");
  const url=new URL(request.url);
  const fromParam=url.searchParams.get("from")||"",toParam=url.searchParams.get("to")||"";
  const brand=url.searchParams.get("brand")||"",category=url.searchParams.get("category")||"";
  const sortParam=url.searchParams.get("sort")||"";
  const sort=SORTS.includes(sortParam as PurchaseAnalysisSort)?sortParam as PurchaseAnalysisSort:"total_sales";

  const now=new Date();
  const to=isDate(toParam)?toParam:now.toISOString().slice(0,10);
  const from=isDate(fromParam)?fromParam:new Date(now.getTime()-29*86400000).toISOString().slice(0,10);
  const periodDays=Math.max(1,Math.round((new Date(`${to}T00:00:00Z`).getTime()-new Date(`${from}T00:00:00Z`).getTime())/86400000)+1);

  const supabase=getSupabase();
  const [products,sales]=await Promise.all([
   fetchAllRows<PurchasingProduct>((from_,to_)=>supabase.from("products")
    .select("bling_product_id,sku,name,brand,category,cost,stock_physical,format,status,kit_components")
    .in("format",["S","E"]).range(from_,to_)),
   fetchAllRows<PurchasingSale>((from_,to_)=>supabase.from("cmv_sales")
    .select("product_id,quantity,channel").eq("cancelled",false).gte("sale_date",from).lte("sale_date",to).range(from_,to_)),
  ]);

  let rows=buildPurchaseAnalysis({products,sales,periodDays});
  if(brand)rows=rows.filter(r=>r.brand===brand);
  if(category)rows=rows.filter(r=>r.category===category);
  rows=sortAnalysisRows(rows,sort);

  const summary={
   totalProducts:rows.length,
   withSuggestion:rows.filter(r=>r.suggestedQuantity>0).length,
   suggestedUnits:rows.reduce((sum,r)=>sum+r.suggestedQuantity,0),
   estimatedTotalCost:rows.reduce((sum,r)=>sum+(r.estimatedCost||0),0),
   withoutNeed:rows.filter(r=>r.suggestedQuantity<=0).length,
  };

  const brands=[...new Set(products.filter(p=>p.format==="S").map(p=>p.brand).filter(Boolean))].sort();
  const categories=[...new Set(products.filter(p=>p.format==="S").map(p=>p.category).filter(Boolean))].sort();

  return NextResponse.json({rows,summary,filters:{brands,categories},from,to,periodDays,sort});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível calcular a análise de compras."},{status:500})}
}
