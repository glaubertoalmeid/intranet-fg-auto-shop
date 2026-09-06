import {NextResponse} from "next/server";
import {requirePermission} from "../../../lib/auth";
import {logAudit} from "../../../lib/audit";
import {getSupabase} from "../../../lib/supabase";

const text=(v:unknown)=>String(v??"").trim();
const num=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;

export async function GET(){
 try{
  await requirePermission("compras");
  const supabase=getSupabase();
  const [{data:suppliers,error:suppliersError},{data:orders,error:ordersError},{data:products,error:productsError}]=await Promise.all([
   supabase.from("suppliers").select("*").order("name"),
   supabase.from("purchase_orders").select("supplier_id,status").neq("status","cancelado"),
   supabase.from("products").select("supplier_id"),
  ]);
  if(suppliersError)throw new Error(suppliersError.message);
  if(ordersError)throw new Error(ordersError.message);
  if(productsError)throw new Error(productsError.message);

  const orderCount=new Map<number,number>(),productCount=new Map<number,number>();
  for(const o of orders||[])orderCount.set(o.supplier_id,(orderCount.get(o.supplier_id)||0)+1);
  for(const p of products||[])if(p.supplier_id)productCount.set(p.supplier_id,(productCount.get(p.supplier_id)||0)+1);

  const rows=(suppliers||[]).map(s=>({...s,orderCount:orderCount.get(s.id)||0,productCount:productCount.get(s.id)||0}));
  return NextResponse.json(rows);
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível carregar os fornecedores."},{status:500})}
}

export async function POST(request:Request){
 try{
  const user=await requirePermission("compras");
  const b=await request.json() as Record<string,unknown>;
  const name=text(b.name);if(!name)return NextResponse.json({error:"Informe o nome do fornecedor."},{status:400});
  const {data,error}=await getSupabase().from("suppliers").insert({
   name,contact:text(b.contact),phone:text(b.phone),whatsapp:text(b.whatsapp),email:text(b.email),brands:text(b.brands),
   lead_time_days:num(b.leadTimeDays),payment_terms:text(b.paymentTerms),min_order_value:num(b.minOrderValue),
   freight:text(b.freight),notes:text(b.notes),created_by:user.name,
  }).select("id").single();
  if(error)throw new Error(error.message);
  await logAudit({user:user.name,action:"supplier.create",target:name});
  return NextResponse.json({ok:true,id:data.id},{status:201});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível salvar o fornecedor."},{status:500})}
}
