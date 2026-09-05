import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {getRuntimeDb} from "../../../../db/runtime";
import {initSuppliers} from "../../../../lib/suppliers";
import {logAudit} from "../../../../lib/audit";

const text=(v:unknown)=>String(v??"").trim();
const num=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const user=await requirePermission("compras");await initSuppliers();
  const {id}=await params,b=await request.json() as Record<string,unknown>;
  const name=text(b.name);if(!name)return NextResponse.json({error:"Informe o nome do fornecedor."},{status:400});
  await getRuntimeDb().prepare(`UPDATE suppliers SET name=?,contact=?,phone=?,whatsapp=?,email=?,brands=?,lead_time_days=?,payment_terms=?,min_order_value=?,freight=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
   .bind(name,text(b.contact),text(b.phone),text(b.whatsapp),text(b.email),text(b.brands),num(b.leadTimeDays),text(b.paymentTerms),num(b.minOrderValue),text(b.freight),text(b.notes),Number(id)).run();
  await logAudit({user:user.name,action:"supplier.update",target:name});
  return NextResponse.json({ok:true});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível salvar."},{status:500})}
}

export async function DELETE(_:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const user=await requirePermission("compras");await initSuppliers();
  const {id}=await params;
  const row=await getRuntimeDb().prepare("SELECT name FROM suppliers WHERE id=?").bind(Number(id)).first<{name:string}>();
  const linked=await getRuntimeDb().prepare("SELECT COUNT(*) c FROM purchase_orders WHERE supplier_id=?").bind(Number(id)).first<{c:number}>();
  if(linked&&linked.c>0)return NextResponse.json({error:"Este fornecedor tem pedidos de compra vinculados e não pode ser excluído."},{status:400});
  await getRuntimeDb().prepare("DELETE FROM suppliers WHERE id=?").bind(Number(id)).run();
  await getRuntimeDb().prepare("UPDATE products SET supplier_id=NULL WHERE supplier_id=?").bind(Number(id)).run();
  await logAudit({user:user.name,action:"supplier.delete",target:row?.name||`#${id}`});
  return NextResponse.json({ok:true});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível excluir."},{status:500})}
}
