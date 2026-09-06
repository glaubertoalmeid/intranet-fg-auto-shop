import {NextResponse} from "next/server";
import {requirePermission} from "../../../lib/auth";
import {PURCHASE_STATUSES} from "../../../lib/purchasing";
import {logAudit} from "../../../lib/audit";
import {getSupabase} from "../../../lib/supabase";

const num=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;

export async function GET(){
 try{
  await requirePermission("compras");
  const supabase=getSupabase();
  const [{data:orders,error:ordersError},{data:suppliers,error:suppliersError},{data:items,error:itemsError}]=await Promise.all([
   supabase.from("purchase_orders").select("*").order("id",{ascending:false}),
   supabase.from("suppliers").select("id,name"),
   supabase.from("purchase_order_items").select("order_id,quantity,unit_cost"),
  ]);
  if(ordersError)throw new Error(ordersError.message);
  if(suppliersError)throw new Error(suppliersError.message);
  if(itemsError)throw new Error(itemsError.message);

  const supplierName=new Map((suppliers||[]).map(s=>[s.id,s.name]));
  const itemCount=new Map<number,number>(),totalCost=new Map<number,number>();
  for(const item of items||[]){
   itemCount.set(item.order_id,(itemCount.get(item.order_id)||0)+1);
   totalCost.set(item.order_id,(totalCost.get(item.order_id)||0)+Number(item.quantity)*Number(item.unit_cost));
  }

  const rows=(orders||[]).map(o=>({...o,supplier_name:supplierName.get(o.supplier_id)||"",itemCount:itemCount.get(o.id)||0,totalCost:totalCost.get(o.id)||0}));
  return NextResponse.json(rows);
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível carregar os pedidos."},{status:500})}
}

export async function POST(request:Request){
 try{
  const user=await requirePermission("compras");
  const b=await request.json() as {supplierId?:number;items?:{productId:number;quantity:number;unitCost:number}[];notes?:string};
  const supplierId=num(b.supplierId),items=Array.isArray(b.items)?b.items:[];
  if(!supplierId)return NextResponse.json({error:"Selecione o fornecedor."},{status:400});
  if(!items.length)return NextResponse.json({error:"Adicione ao menos um item ao pedido."},{status:400});
  const supabase=getSupabase();
  const {data:order,error:orderError}=await supabase.from("purchase_orders").insert({
   supplier_id:supplierId,status:PURCHASE_STATUSES[0],notes:String(b.notes||"").trim(),created_by:user.name,
  }).select("id").single();
  if(orderError)throw new Error(orderError.message);
  const orderId=order.id;
  const validItems=items.filter(item=>item.productId&&num(item.quantity)>0).map(item=>({order_id:orderId,product_id:item.productId,quantity:num(item.quantity),unit_cost:num(item.unitCost)}));
  if(validItems.length){
   const {error:itemsError}=await supabase.from("purchase_order_items").insert(validItems);
   if(itemsError)throw new Error(itemsError.message);
  }
  await logAudit({user:user.name,action:"purchase_order.create",target:`#${orderId}`,detail:`${items.length} item(ns)`});
  return NextResponse.json({ok:true,id:orderId},{status:201});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível criar o pedido."},{status:500})}
}
