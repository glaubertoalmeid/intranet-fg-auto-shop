import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {logAudit} from "../../../../lib/audit";
import {getSupabase} from "../../../../lib/supabase";

const text=(v:unknown)=>String(v??"").trim();
const num=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const user=await requirePermission("compras");
  const {id}=await params,b=await request.json() as Record<string,unknown>;
  const name=text(b.name);if(!name)return NextResponse.json({error:"Informe o nome do fornecedor."},{status:400});
  const {error}=await getSupabase().from("suppliers").update({
   name,contact:text(b.contact),phone:text(b.phone),whatsapp:text(b.whatsapp),email:text(b.email),brands:text(b.brands),
   lead_time_days:num(b.leadTimeDays),payment_terms:text(b.paymentTerms),min_order_value:num(b.minOrderValue),
   freight:text(b.freight),notes:text(b.notes),updated_at:new Date().toISOString(),
  }).eq("id",Number(id));
  if(error)throw new Error(error.message);
  await logAudit({user:user.name,action:"supplier.update",target:name});
  return NextResponse.json({ok:true});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível salvar."},{status:500})}
}

export async function DELETE(_:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const user=await requirePermission("compras");
  const {id}=await params,supabase=getSupabase();
  const {data:row}=await supabase.from("suppliers").select("name").eq("id",Number(id)).maybeSingle();
  const {count:linked}=await supabase.from("purchase_orders").select("id",{count:"exact",head:true}).eq("supplier_id",Number(id));
  if(linked&&linked>0)return NextResponse.json({error:"Este fornecedor tem pedidos de compra vinculados e não pode ser excluído."},{status:400});
  const {error}=await supabase.from("suppliers").delete().eq("id",Number(id));
  if(error)throw new Error(error.message);
  await supabase.from("products").update({supplier_id:null}).eq("supplier_id",Number(id));
  await logAudit({user:user.name,action:"supplier.delete",target:row?.name||`#${id}`});
  return NextResponse.json({ok:true});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível excluir."},{status:500})}
}
