import {NextResponse} from "next/server";
import {requirePermission} from "../../../lib/auth";
import {getRuntimeDb} from "../../../db/runtime";
import {initSuppliers} from "../../../lib/suppliers";
import {initPurchasing} from "../../../lib/purchasing";
import {logAudit} from "../../../lib/audit";

const text=(v:unknown)=>String(v??"").trim();
const num=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;

export async function GET(){
 try{
  await requirePermission("compras");await initSuppliers();await initPurchasing();
  const rows=(await getRuntimeDb().prepare(`SELECT suppliers.*,
    (SELECT COUNT(*) FROM purchase_orders WHERE purchase_orders.supplier_id=suppliers.id AND status<>'cancelado') orderCount,
    (SELECT COUNT(*) FROM products WHERE products.supplier_id=suppliers.id) productCount
   FROM suppliers ORDER BY name`).all()).results||[];
  return NextResponse.json(rows);
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível carregar os fornecedores."},{status:500})}
}

export async function POST(request:Request){
 try{
  const user=await requirePermission("compras");await initSuppliers();
  const b=await request.json() as Record<string,unknown>;
  const name=text(b.name);if(!name)return NextResponse.json({error:"Informe o nome do fornecedor."},{status:400});
  const r=await getRuntimeDb().prepare(`INSERT INTO suppliers(name,contact,phone,whatsapp,email,brands,lead_time_days,payment_terms,min_order_value,freight,notes,created_by,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
   .bind(name,text(b.contact),text(b.phone),text(b.whatsapp),text(b.email),text(b.brands),num(b.leadTimeDays),text(b.paymentTerms),num(b.minOrderValue),text(b.freight),text(b.notes),user.name).run();
  await logAudit({user:user.name,action:"supplier.create",target:name});
  return NextResponse.json({ok:true,id:r.meta.last_row_id},{status:201});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível salvar o fornecedor."},{status:500})}
}
