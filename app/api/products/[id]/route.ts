import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {getRuntimeDb} from "../../../../db/runtime";
import {initProducts,computeAlerts} from "../../../../lib/products";
import {logAudit} from "../../../../lib/audit";

const num=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;

export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
 try{
  await requirePermission("produtos");await initProducts();
  const {id}=await params;
  const product=await getRuntimeDb().prepare("SELECT * FROM products WHERE id=?").bind(Number(id)).first<Record<string,unknown>>();
  if(!product)return NextResponse.json({error:"Produto não encontrado."},{status:404});

  const blingId=String(product.bling_product_id||"");
  const hasCmv=await getRuntimeDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cmv_sales'").first();
  const sales=hasCmv?await getRuntimeDb().prepare(`SELECT
    SUM(CASE WHEN sale_date>=date('now','-30 day') THEN quantity ELSE 0 END) qty30,
    SUM(CASE WHEN sale_date>=date('now','-60 day') THEN quantity ELSE 0 END) qty60,
    SUM(CASE WHEN sale_date>=date('now','-90 day') THEN quantity ELSE 0 END) qty90,
    SUM(CASE WHEN sale_date>=date('now','-30 day') THEN revenue ELSE 0 END) revenue30
   FROM cmv_sales WHERE product_id=?`).bind(blingId).first<Record<string,number>>():null;

  const listings=(await getRuntimeDb().prepare("SELECT id,platform,status,sale_price,ml_permalink,ml_publish_status,shopee_item_id,shopee_publish_status FROM listings WHERE bling_product_id=?").bind(blingId).all<Record<string,unknown>>().catch(()=>({results:[]}))).results||[];

  const alerts=computeAlerts({stock_physical:num(product.stock_physical),min_stock:num(product.min_stock),max_stock:num(product.max_stock),last_sale_at:String(product.last_sale_at||"")});
  const avgDaily=(num(sales?.qty30)||0)/30;
  const daysOfCoverage=avgDaily>0?num(product.stock_physical)/avgDaily:null;
  const needsPurchase=alerts.includes("zerado")||alerts.includes("abaixo_minimo");

  return NextResponse.json({product,sales:sales||{qty30:0,qty60:0,qty90:0,revenue30:0},listings,alerts,daysOfCoverage,needsPurchase});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível carregar o produto."},{status:500})}
}

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const user=await requirePermission("produtos");await initProducts();
  const {id}=await params;
  const body=await request.json() as {minStock?:number;maxStock?:number;location?:string;subcategory?:string;supplierId?:number|null};
  const before=await getRuntimeDb().prepare("SELECT name,min_stock,max_stock,location FROM products WHERE id=?").bind(Number(id)).first<Record<string,unknown>>();
  if(!before)return NextResponse.json({error:"Produto não encontrado."},{status:404});
  await getRuntimeDb().prepare("UPDATE products SET min_stock=?,max_stock=?,location=?,subcategory=?,supplier_id=?,updated_by=? WHERE id=?")
   .bind(num(body.minStock),num(body.maxStock),String(body.location||"").trim(),String(body.subcategory||"").trim(),body.supplierId||null,user.name,Number(id)).run();
  await logAudit({user:user.name,action:"products.update_local",target:String(before.name||`#${id}`),detail:`min ${before.min_stock}→${num(body.minStock)} · max ${before.max_stock}→${num(body.maxStock)}`});
  return NextResponse.json({ok:true});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível salvar."},{status:500})}
}
