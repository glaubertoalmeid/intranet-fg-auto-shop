import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {getRuntimeDb} from "../../../../db/runtime";
import {getSupabase} from "../../../../lib/supabase";
import {logAudit} from "../../../../lib/audit";

type AnyRow=Record<string,unknown>;

/** Lê uma tabela do D1 só se ela existir — evita quebrar em ambientes onde Produtos/Compras
 *  (Etapa 1/3) nunca chegaram a ser usados e as tabelas nunca foram criadas. */
async function readD1Table(name:string):Promise<AnyRow[]>{
 const db=getRuntimeDb();
 const exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(name).first();
 if(!exists)return [];
 return (await db.prepare(`SELECT * FROM ${name}`).all<AnyRow>()).results||[];
}

/** Migração única de D1 → Supabase para products/suppliers/purchase_orders/purchase_order_items
 *  (Etapa 3 — Compras). Rode uma vez, logo após publicar esta versão, antes de sincronizar o
 *  Bling ou cadastrar qualquer fornecedor/pedido novo. Recusa rodar se o Supabase já tiver
 *  fornecedores ou produtos, para não duplicar em caso de execução repetida. */
export async function POST(){
 try{
  const user=await requirePermission("compras");
  if(user.role!=="master")return NextResponse.json({error:"Só o usuário Master pode rodar essa migração."},{status:403});

  const supabase=getSupabase();
  const [{count:existingSuppliers},{count:existingProducts}]=await Promise.all([
   supabase.from("suppliers").select("id",{count:"exact",head:true}),
   supabase.from("products").select("id",{count:"exact",head:true}),
  ]);
  if((existingSuppliers||0)>0||(existingProducts||0)>0){
   return NextResponse.json({error:"O Supabase já tem fornecedores ou produtos — a migração só roda uma vez, sobre uma base vazia, para não duplicar dados."},{status:409});
  }

  const [d1Suppliers,d1Products,d1Orders,d1Items]=await Promise.all([
   readD1Table("suppliers"),readD1Table("products"),readD1Table("purchase_orders"),readD1Table("purchase_order_items"),
  ]);

  const supplierIdMap=new Map<number,number>();
  if(d1Suppliers.length){
   const payload=d1Suppliers.map(s=>({name:String(s.name||""),contact:String(s.contact||""),phone:String(s.phone||""),whatsapp:String(s.whatsapp||""),email:String(s.email||""),brands:String(s.brands||""),lead_time_days:Number(s.lead_time_days)||0,payment_terms:String(s.payment_terms||""),min_order_value:Number(s.min_order_value)||0,freight:String(s.freight||""),notes:String(s.notes||""),created_by:String(s.created_by||"")}));
   const {data,error}=await supabase.from("suppliers").insert(payload).select("id");
   if(error)throw new Error(`fornecedores: ${error.message}`);
   d1Suppliers.forEach((s,i)=>supplierIdMap.set(Number(s.id),data![i].id));
  }

  const productIdMap=new Map<number,number>();
  if(d1Products.length){
   const payload=d1Products.map(p=>({bling_product_id:String(p.bling_product_id||""),sku:String(p.sku||""),gtin:String(p.gtin||""),name:String(p.name||""),brand:String(p.brand||""),category:String(p.category||""),subcategory:String(p.subcategory||""),supplier:String(p.supplier||""),supplier_id:p.supplier_id?supplierIdMap.get(Number(p.supplier_id))??null:null,cost:Number(p.cost)||0,sale_price:Number(p.sale_price)||0,weight:Number(p.weight)||0,width:Number(p.width)||0,height:Number(p.height)||0,length:Number(p.length)||0,stock_physical:Number(p.stock_physical)||0,stock_reserved:Number(p.stock_reserved)||0,min_stock:Number(p.min_stock)||0,max_stock:Number(p.max_stock)||0,location:String(p.location||""),status:String(p.status||"ativo"),last_sale_at:String(p.last_sale_at||""),synced_at:String(p.synced_at||""),updated_by:String(p.updated_by||"")}));
   const {data,error}=await supabase.from("products").insert(payload).select("id");
   if(error)throw new Error(`produtos: ${error.message}`);
   d1Products.forEach((p,i)=>productIdMap.set(Number(p.id),data![i].id));
  }

  const orderIdMap=new Map<number,number>();
  let skippedOrders=0;
  for(const o of d1Orders){
   const supplierId=supplierIdMap.get(Number(o.supplier_id));
   if(!supplierId){skippedOrders++;continue}
   const {data,error}=await supabase.from("purchase_orders").insert({
    supplier_id:supplierId,status:String(o.status||"elaboracao"),notes:String(o.notes||""),created_by:String(o.created_by||""),
    created_at:o.created_at?new Date(String(o.created_at)).toISOString():undefined,
    sent_at:o.sent_at?new Date(String(o.sent_at)).toISOString():null,
    received_at:o.received_at?new Date(String(o.received_at)).toISOString():null,
   }).select("id").single();
   if(error)throw new Error(`pedido #${o.id}: ${error.message}`);
   orderIdMap.set(Number(o.id),data.id);
  }

  let migratedItems=0,skippedItems=0;
  const itemsPayload=d1Items.map(item=>{
   const orderId=orderIdMap.get(Number(item.order_id)),productId=productIdMap.get(Number(item.product_id));
   if(!orderId||!productId){skippedItems++;return null}
   migratedItems++;
   return {order_id:orderId,product_id:productId,quantity:Number(item.quantity)||0,unit_cost:Number(item.unit_cost)||0,received_quantity:Number(item.received_quantity)||0};
  }).filter((x):x is NonNullable<typeof x>=>x!==null);
  if(itemsPayload.length){
   const {error}=await supabase.from("purchase_order_items").insert(itemsPayload);
   if(error)throw new Error(`itens de pedido: ${error.message}`);
  }

  const result={suppliers:d1Suppliers.length,products:d1Products.length,orders:orderIdMap.size,ordersSkipped:skippedOrders,items:migratedItems,itemsSkipped:skippedItems};
  await logAudit({user:user.name,action:"admin.migrate_compras",detail:JSON.stringify(result)});
  return NextResponse.json({ok:true,...result});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Falha na migração."},{status:500})}
}
