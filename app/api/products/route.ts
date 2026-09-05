import {NextResponse} from "next/server";
import {requirePermission} from "../../../lib/auth";
import {getRuntimeDb} from "../../../db/runtime";
import {initProducts,syncAllProducts,computeAlerts,classifyAbc} from "../../../lib/products";
import {logAudit} from "../../../lib/audit";

type Row={id:number;bling_product_id:string;sku:string;name:string;brand:string;category:string;supplier:string;cost:number;sale_price:number;stock_physical:number;min_stock:number;max_stock:number;location:string;status:string;last_sale_at:string;qty30:number;qty60:number;qty90:number;revenue90:number};
const text=(v:unknown)=>String(v??"").trim();

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

  const hasCmv=await getRuntimeDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cmv_sales'").first();
  const salesJoin=hasCmv?`
   LEFT JOIN (SELECT product_id,SUM(CASE WHEN sale_date>=date('now','-30 day') THEN quantity ELSE 0 END) qty30,SUM(CASE WHEN sale_date>=date('now','-60 day') THEN quantity ELSE 0 END) qty60,SUM(CASE WHEN sale_date>=date('now','-90 day') THEN quantity ELSE 0 END) qty90,SUM(CASE WHEN sale_date>=date('now','-90 day') THEN revenue ELSE 0 END) revenue90 FROM cmv_sales GROUP BY product_id) s ON s.product_id=products.bling_product_id`:"";

  const rows=(await getRuntimeDb().prepare(`SELECT products.id,products.bling_product_id,products.sku,products.name,products.brand,products.category,products.supplier,products.cost,products.sale_price,products.stock_physical,products.min_stock,products.max_stock,products.location,products.status,products.last_sale_at,COALESCE(s.qty30,0) qty30,COALESCE(s.qty60,0) qty60,COALESCE(s.qty90,0) qty90,COALESCE(s.revenue90,0) revenue90 FROM products ${salesJoin} ${clause} ORDER BY products.name`).bind(...binds).all<Row>()).results||[];

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
