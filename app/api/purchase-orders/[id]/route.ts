import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {getRuntimeDb} from "../../../../db/runtime";
import {initPurchasing,PURCHASE_STATUSES} from "../../../../lib/purchasing";
import {logAudit} from "../../../../lib/audit";

const num=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;

export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
 try{
  await requirePermission("compras");await initPurchasing();
  const {id}=await params;
  const order=await getRuntimeDb().prepare("SELECT purchase_orders.*,suppliers.name supplier_name,suppliers.lead_time_days,suppliers.payment_terms FROM purchase_orders LEFT JOIN suppliers ON suppliers.id=purchase_orders.supplier_id WHERE purchase_orders.id=?").bind(Number(id)).first();
  if(!order)return NextResponse.json({error:"Pedido não encontrado."},{status:404});
  const items=(await getRuntimeDb().prepare("SELECT purchase_order_items.*,products.name product_name,products.sku FROM purchase_order_items JOIN products ON products.id=purchase_order_items.product_id WHERE order_id=?").bind(Number(id)).all()).results||[];
  return NextResponse.json({order,items});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível carregar o pedido."},{status:500})}
}

/** status: avança o fluxo (elaboração → enviado → confirmado → em transporte → recebido parcial/completo → cancelado).
 *  items: quando presente, atualiza received_quantity de cada item (conferência de mercadoria). */
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const user=await requirePermission("compras");await initPurchasing();
  const {id}=await params,b=await request.json() as {status?:string;items?:{itemId:number;receivedQuantity:number}[];notes?:string};
  const db=getRuntimeDb();
  const before=await db.prepare("SELECT status FROM purchase_orders WHERE id=?").bind(Number(id)).first<{status:string}>();
  if(!before)return NextResponse.json({error:"Pedido não encontrado."},{status:404});

  if(b.status){
   if(!(PURCHASE_STATUSES as readonly string[]).includes(b.status))return NextResponse.json({error:"Status inválido."},{status:400});
   const sentAt=b.status==="enviado"?", sent_at=CURRENT_TIMESTAMP":"";
   const receivedAt=(b.status==="recebido_completo"||b.status==="recebido_parcial")?", received_at=CURRENT_TIMESTAMP":"";
   await db.prepare(`UPDATE purchase_orders SET status=?,updated_at=CURRENT_TIMESTAMP${sentAt}${receivedAt} WHERE id=?`).bind(b.status,Number(id)).run();
   await logAudit({user:user.name,action:"purchase_order.status",target:`#${id}`,detail:`${before.status} → ${b.status}`});
  }
  if(typeof b.notes==="string")await db.prepare("UPDATE purchase_orders SET notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(b.notes.trim(),Number(id)).run();
  if(Array.isArray(b.items)){
   for(const item of b.items){
    if(!item.itemId)continue;
    await db.prepare("UPDATE purchase_order_items SET received_quantity=? WHERE id=? AND order_id=?").bind(num(item.receivedQuantity),item.itemId,Number(id)).run();
   }
   await logAudit({user:user.name,action:"purchase_order.receive",target:`#${id}`,detail:`${b.items.length} item(ns) conferidos`});
  }
  return NextResponse.json({ok:true});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível atualizar o pedido."},{status:500})}
}
