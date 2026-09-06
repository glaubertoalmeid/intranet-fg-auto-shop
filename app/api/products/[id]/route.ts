import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {getRuntimeDb} from "../../../../db/runtime";
import {computeAlerts} from "../../../../lib/products";
import {logAudit} from "../../../../lib/audit";
import {getSupabase} from "../../../../lib/supabase";

const num=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;

export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
 try{
  await requirePermission("produtos");
  const {id}=await params;
  const {data:product,error}=await getSupabase().from("products").select("*").eq("id",Number(id)).maybeSingle();
  if(error)throw new Error(error.message);
  if(!product)return NextResponse.json({error:"Produto não encontrado."},{status:404});

  const blingId=String(product.bling_product_id||"");
  const {data:salesRows}=await getSupabase().from("cmv_sales").select("quantity,revenue,sale_date").eq("product_id",blingId);
  const day30=Date.now()-30*86400000,day60=Date.now()-60*86400000,day90=Date.now()-90*86400000;
  const sales=(salesRows||[]).reduce((a,r:{quantity:number;revenue:number;sale_date:string})=>{
   const t=new Date(r.sale_date).getTime(),qty=Number(r.quantity)||0,rev=Number(r.revenue)||0;
   if(t>=day30){a.qty30+=qty;a.revenue30+=rev}
   if(t>=day60)a.qty60+=qty;
   if(t>=day90)a.qty90+=qty;
   return a;
  },{qty30:0,qty60:0,qty90:0,revenue30:0});

  const listings=(await getRuntimeDb().prepare("SELECT id,platform,status,sale_price,ml_permalink,ml_publish_status,shopee_item_id,shopee_publish_status FROM listings WHERE bling_product_id=?").bind(blingId).all<Record<string,unknown>>().catch(()=>({results:[]}))).results||[];

  const alerts=computeAlerts({stock_physical:num(product.stock_physical),min_stock:num(product.min_stock),max_stock:num(product.max_stock),last_sale_at:String(product.last_sale_at||"")});
  const avgDaily=sales.qty30/30;
  const daysOfCoverage=avgDaily>0?num(product.stock_physical)/avgDaily:null;
  const needsPurchase=alerts.includes("zerado")||alerts.includes("abaixo_minimo");

  return NextResponse.json({product,sales,listings,alerts,daysOfCoverage,needsPurchase});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível carregar o produto."},{status:500})}
}

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const user=await requirePermission("produtos");
  const {id}=await params;
  const body=await request.json() as {minStock?:number;maxStock?:number;location?:string;subcategory?:string;supplierId?:number|null};
  const supabase=getSupabase();
  const {data:before}=await supabase.from("products").select("name,min_stock,max_stock,location").eq("id",Number(id)).maybeSingle();
  if(!before)return NextResponse.json({error:"Produto não encontrado."},{status:404});
  const {error}=await supabase.from("products").update({
   min_stock:num(body.minStock),max_stock:num(body.maxStock),location:String(body.location||"").trim(),
   subcategory:String(body.subcategory||"").trim(),supplier_id:body.supplierId||null,updated_by:user.name,
  }).eq("id",Number(id));
  if(error)throw new Error(error.message);
  await logAudit({user:user.name,action:"products.update_local",target:String(before.name||`#${id}`),detail:`min ${before.min_stock}→${num(body.minStock)} · max ${before.max_stock}→${num(body.maxStock)}`});
  return NextResponse.json({ok:true});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível salvar."},{status:500})}
}
