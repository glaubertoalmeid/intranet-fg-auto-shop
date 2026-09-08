import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {suggestPurchaseQuantity} from "../../../../lib/purchasing";
import {fetchAllRows,getSupabase} from "../../../../lib/supabase";

type ProductRow={id:number;bling_product_id:string;sku:string;name:string;brand:string;category:string;cost:number;stock_physical:number;min_stock:number;supplier_id:number|null;status:string};
type Row=ProductRow&{lead_time_days:number|null;qty30:number};
const isDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v);

// Período usado pra calcular a venda média/dia. Aceita datas explícitas (from/to, igual
// à tela de CMV) pra medir uma janela precisa; sem elas, cai num padrão de 30 dias.
export async function GET(request:Request){
 try{
  await requirePermission("compras");
  const url=new URL(request.url);
  const fromParam=url.searchParams.get("from")||"",toParam=url.searchParams.get("to")||"";
  const now=new Date();
  const to=isDate(toParam)?toParam:now.toISOString().slice(0,10);
  const from=isDate(fromParam)?fromParam:new Date(now.getTime()-29*86400000).toISOString().slice(0,10);
  const days=Math.max(1,Math.round((new Date(`${to}T00:00:00Z`).getTime()-new Date(`${from}T00:00:00Z`).getTime())/86400000)+1);

  const supabase=getSupabase();
  const [products,{data:suppliers,error:suppliersError},cmvRows]=await Promise.all([
   fetchAllRows<ProductRow>((from_,to_)=>supabase.from("products").select("id,bling_product_id,sku,name,brand,category,cost,stock_physical,min_stock,supplier_id,status").eq("status","ativo").range(from_,to_)),
   supabase.from("suppliers").select("id,lead_time_days"),
   fetchAllRows<{product_id:string;quantity:number}>((from_,to_)=>supabase.from("cmv_sales").select("product_id,quantity").gte("sale_date",from).lte("sale_date",to).range(from_,to_)),
  ]);
  if(suppliersError)throw new Error(suppliersError.message);

  const leadTimeBySupplier=new Map((suppliers||[]).map(s=>[s.id,s.lead_time_days]));
  const qty30ByProduct=new Map<string,number>();
  for(const row of cmvRows)qty30ByProduct.set(row.product_id,(qty30ByProduct.get(row.product_id)||0)+(Number(row.quantity)||0));

  const rows:Row[]=products.map(p=>({...p,lead_time_days:p.supplier_id?leadTimeBySupplier.get(p.supplier_id)??null:null,qty30:qty30ByProduct.get(p.bling_product_id)||0}));

  const suggestions=rows.map(r=>{
   const avgDailySales=r.qty30/days;
   const leadTimeDays=r.lead_time_days??7; // sem fornecedor vinculado, assume 7 dias como padrão conservador
   const suggestedQuantity=suggestPurchaseQuantity({stockPhysical:r.stock_physical,avgDailySales,leadTimeDays,minStock:r.min_stock});
   return {...r,avgDailySales:Number(avgDailySales.toFixed(2)),suggestedQuantity,estimatedCost:suggestedQuantity*r.cost};
  }).filter(r=>r.suggestedQuantity>0);

  // Radar de reposição: painel de KPIs pra decisão rápida, além da lista detalhada
  // acima. "Zerado que vende" é mais urgente que a régua padrão — estoque zero com
  // venda recente, tenha ou não mínimo configurado.
  const zerados=rows.filter(r=>r.stock_physical<=0&&r.qty30>0)
   .map(r=>({id:r.id,sku:r.sku,name:r.name,brand:r.brand,category:r.category,qty30:r.qty30,cost:r.cost}))
   .sort((a,b)=>b.qty30-a.qty30);
  const summary={
   valorARepor:suggestions.reduce((sum,s)=>sum+s.estimatedCost,0),
   itensAbaixoDaRegua:suggestions.length,
   zeradosQueVendem:zerados.length,
  };

  return NextResponse.json({suggestions,summary,zerados,from,to,days});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível calcular a necessidade de compra."},{status:500})}
}
