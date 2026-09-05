import {NextResponse} from "next/server";
import {requirePermission} from "../../../lib/auth";
import {getRuntimeDb} from "../../../db/runtime";
import {initPurchasing,PURCHASE_STATUSES} from "../../../lib/purchasing";
import {logAudit} from "../../../lib/audit";

const num=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;

export async function GET(){
 try{
  await requirePermission("compras");await initPurchasing();
  const rows=(await getRuntimeDb().prepare(`SELECT purchase_orders.*,suppliers.name supplier_name,
    (SELECT COUNT(*) FROM purchase_order_items WHERE order_id=purchase_orders.id) itemCount,
    (SELECT COALESCE(SUM(quantity*unit_cost),0) FROM purchase_order_items WHERE order_id=purchase_orders.id) totalCost
   FROM purchase_orders LEFT JOIN suppliers ON suppliers.id=purchase_orders.supplier_id ORDER BY purchase_orders.id DESC`).all()).results||[];
  return NextResponse.json(rows);
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível carregar os pedidos."},{status:500})}
}

export async function POST(request:Request){
 try{
  const user=await requirePermission("compras");await initPurchasing();
  const b=await request.json() as {supplierId?:number;items?:{productId:number;quantity:number;unitCost:number}[];notes?:string};
  const supplierId=num(b.supplierId),items=Array.isArray(b.items)?b.items:[];
  if(!supplierId)return NextResponse.json({error:"Selecione o fornecedor."},{status:400});
  if(!items.length)return NextResponse.json({error:"Adicione ao menos um item ao pedido."},{status:400});
  const db=getRuntimeDb();
  const order=await db.prepare("INSERT INTO purchase_orders(supplier_id,status,notes,created_by,created_at,updated_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
   .bind(supplierId,PURCHASE_STATUSES[0],String(b.notes||"").trim(),user.name).run();
  const orderId=order.meta.last_row_id;
  for(const item of items){
   if(!item.productId||num(item.quantity)<=0)continue;
   await db.prepare("INSERT INTO purchase_order_items(order_id,product_id,quantity,unit_cost) VALUES(?,?,?,?)").bind(orderId,item.productId,num(item.quantity),num(item.unitCost)).run();
  }
  await logAudit({user:user.name,action:"purchase_order.create",target:`#${orderId}`,detail:`${items.length} item(ns)`});
  return NextResponse.json({ok:true,id:orderId},{status:201});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível criar o pedido."},{status:500})}
}
