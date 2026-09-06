import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {PURCHASE_STATUSES} from "../../../../lib/purchasing";
import {logAudit} from "../../../../lib/audit";
import {getSupabase} from "../../../../lib/supabase";

const num=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;

export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
 try{
  await requirePermission("compras");
  const {id}=await params,supabase=getSupabase();
  const {data:order,error:orderError}=await supabase.from("purchase_orders").select("*").eq("id",Number(id)).maybeSingle();
  if(orderError)throw new Error(orderError.message);
  if(!order)return NextResponse.json({error:"Pedido não encontrado."},{status:404});
  const {data:supplier}=await supabase.from("suppliers").select("name,lead_time_days,payment_terms").eq("id",order.supplier_id).maybeSingle();

  const {data:itemRows,error:itemsError}=await supabase.from("purchase_order_items").select("*").eq("order_id",Number(id));
  if(itemsError)throw new Error(itemsError.message);
  const productIds=[...new Set((itemRows||[]).map(i=>i.product_id))];
  const {data:products}=productIds.length?await supabase.from("products").select("id,name,sku").in("id",productIds):{data:[]};
  const productById=new Map((products||[]).map(p=>[p.id,p]));
  const items=(itemRows||[]).map(item=>({...item,product_name:productById.get(item.product_id)?.name||"",sku:productById.get(item.product_id)?.sku||""}));

  return NextResponse.json({order:{...order,supplier_name:supplier?.name||"",lead_time_days:supplier?.lead_time_days??null,payment_terms:supplier?.payment_terms||""},items});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível carregar o pedido."},{status:500})}
}

/** status: avança o fluxo (elaboração → enviado → confirmado → em transporte → recebido parcial/completo → cancelado).
 *  items: quando presente, atualiza received_quantity de cada item (conferência de mercadoria). */
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const user=await requirePermission("compras");
  const {id}=await params,b=await request.json() as {status?:string;items?:{itemId:number;receivedQuantity:number}[];notes?:string};
  const supabase=getSupabase();
  const {data:before}=await supabase.from("purchase_orders").select("status").eq("id",Number(id)).maybeSingle();
  if(!before)return NextResponse.json({error:"Pedido não encontrado."},{status:404});

  if(b.status){
   if(!(PURCHASE_STATUSES as readonly string[]).includes(b.status))return NextResponse.json({error:"Status inválido."},{status:400});
   const patch:Record<string,unknown>={status:b.status,updated_at:new Date().toISOString()};
   if(b.status==="enviado")patch.sent_at=new Date().toISOString();
   if(b.status==="recebido_completo"||b.status==="recebido_parcial")patch.received_at=new Date().toISOString();
   const {error}=await supabase.from("purchase_orders").update(patch).eq("id",Number(id));
   if(error)throw new Error(error.message);
   await logAudit({user:user.name,action:"purchase_order.status",target:`#${id}`,detail:`${before.status} → ${b.status}`});
  }
  if(typeof b.notes==="string")await supabase.from("purchase_orders").update({notes:b.notes.trim(),updated_at:new Date().toISOString()}).eq("id",Number(id));
  if(Array.isArray(b.items)){
   for(const item of b.items){
    if(!item.itemId)continue;
    await supabase.from("purchase_order_items").update({received_quantity:num(item.receivedQuantity)}).eq("id",item.itemId).eq("order_id",Number(id));
   }
   await logAudit({user:user.name,action:"purchase_order.receive",target:`#${id}`,detail:`${b.items.length} item(ns) conferidos`});
  }
  return NextResponse.json({ok:true});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível atualizar o pedido."},{status:500})}
}
