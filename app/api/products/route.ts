import {NextResponse} from "next/server";
import {requirePermission} from "../../../lib/auth";
import {getRuntimeDb} from "../../../db/runtime";
import {initProducts,syncAllProducts,computeAlerts,classifyAbc} from "../../../lib/products";
import {logAudit} from "../../../lib/audit";
import {fetchAllRows,getSupabase} from "../../../lib/supabase";

type Row={id:number;bling_product_id:string;sku:string;name:string;brand:string;category:string;supplier:string;cost:number;sale_price:number;stock_physical:number;min_stock:number;max_stock:number;location:string;status:string;last_sale_at:string;qty30:number;qty60:number;qty90:number;revenue90:number};
const text=(v:unknown)=>String(v??"").trim();

/** cmv_sales agora vive no Supabase (Etapa 2), não mais no D1 — busca as vendas dos últimos 90
 *  dias e agrega qty30/60/90 e revenue90 por bling_product_id em memória. */
async function salesAggregatesByProduct(){
 const since=new Date(Date.now()-90*86400000).toISOString().slice(0,10);
 const rows=await fetchAllRows<{product_id:string;quantity:number;revenue:number;sale_date:string}>((from_,to_)=>
  getSupabase().from("cmv_sales").select("product_id,quantity,revenue,sale_date").gte("sale_date",since).range(from_,to_)
 ).catch(()=>[] as {product_id:string;quantity:number;revenue:number;sale_date:string}[]);
 const day30=Date.now()-30*86400000,day60=Date.now()-60*86400000;
 const byProduct=new Map<string,{qty30:number;qty60:number;qty90:number;revenue90:number}>();
 for(const row of rows){
  if(!row.product_id)continue;
  const agg=byProduct.get(row.product_id)||{qty30:0,qty60:0,qty90:0,revenue90:0};
  const saleTime=new Date(row.sale_date).getTime(),quantity=Number(row.quantity)||0,revenue=Number(row.revenue)||0;
  if(saleTime>=day30)agg.qty30+=quantity;
  if(saleTime>=day60)agg.qty60+=quantity;
  agg.qty90+=quantity;agg.revenue90+=revenue;
  byProduct.set(row.product_id,agg);
 }
 return byProduct;
}

export async function GET(request:Request){
 try{
  await requirePermission("produtos");
  await initProducts();
  const url=new URL(request.url);
  const q=text(url.searchParams.get("q")),brand=text(url.searchParams.get("brand")),category=text(url.searchParams.get("category")),alert=text(url.searchParams.get("alert"));

  const where:string[]=[],binds:unknown[]=[];
  if(q){where.push("(products.name LIKE ? OR products.sku LIKE ? OR products.gtin LIKE ?)");binds.push(`%${q}%`,`%${q}%`,`%${q}%`)}
  if(brand){where.push("products.brand=?");binds.push(brand)}
  if(category){where.push("products.category=?");binds.push(category)}
  const clause=where.length?`WHERE ${where.join(" AND ")}`:"";

  const salesByProduct=await salesAggregatesByProduct();
  const baseRows=(await getRuntimeDb().prepare(`SELECT products.id,products.bling_product_id,products.sku,products.name,products.brand,products.category,products.supplier,products.cost,products.sale_price,products.stock_physical,products.min_stock,products.max_stock,products.location,products.status,products.last_sale_at FROM products ${clause} ORDER BY products.name`).bind(...binds).all<Omit<Row,"qty30"|"qty60"|"qty90"|"revenue90">>()).results||[];
  const rows:Row[]=baseRows.map(r=>{const s=salesByProduct.get(r.bling_product_id);return{...r,qty30:s?.qty30??0,qty60:s?.qty60??0,qty90:s?.qty90??0,revenue90:s?.revenue90??0}});

  const withAbc=classifyAbc<Row&{revenue:number}>(rows.map((r:Row)=>({...r,revenue:r.revenue90})));
  const withAlerts=withAbc.map((r:Row&{revenue:number;abcClass:"A"|"B"|"C"})=>({...r,alerts:computeAlerts({stock_physical:r.stock_physical,min_stock:r.min_stock,max_stock:r.max_stock,last_sale_at:r.last_sale_at})}));
  const filtered=alert?withAlerts.filter(r=>r.alerts.includes(alert as never)):withAlerts;

  const brands=[...new Set(rows.map((r:Row)=>r.brand).filter(Boolean))].sort();
  const categories=[...new Set(rows.map((r:Row)=>r.category).filter(Boolean))].sort();
  const summary={
   total:rows.length,
   zerado:withAlerts.filter(r=>r.alerts.includes("zerado")).length,
   abaixoMinimo:withAlerts.filter(r=>r.alerts.includes("abaixo_minimo")).length,
   parado90:withAlerts.filter(r=>r.alerts.includes("parado_90")).length,
   estoqueValorCusto:rows.reduce((sum:number,r:Row)=>sum+r.stock_physical*r.cost,0),
  };

  return NextResponse.json({products:filtered,filters:{brands,categories},summary});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível carregar os produtos."},{status:500})}
}

export async function POST(){
 try{
  const user=await requirePermission("produtos");
  const result=await syncAllProducts();
  await logAudit({user:user.name,action:"products.sync",detail:`${result.imported} produto(s)`});
  return NextResponse.json({ok:true,...result});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível sincronizar os produtos."},{status:500})}
}
