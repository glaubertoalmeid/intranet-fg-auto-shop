import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {getRuntimeDb} from "../../../../db/runtime";
import {initSuppliers} from "../../../../lib/suppliers";
import {suggestPurchaseQuantity} from "../../../../lib/purchasing";

type Row={id:number;bling_product_id:string;sku:string;name:string;cost:number;stock_physical:number;min_stock:number;supplier_id:number|null;supplier_name:string|null;lead_time_days:number|null;qty30:number};

export async function GET(){
 try{
  await requirePermission("compras");await initSuppliers();
  const hasCmv=await getRuntimeDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cmv_sales'").first();
  const salesJoin=hasCmv?"LEFT JOIN (SELECT product_id,SUM(quantity) qty30 FROM cmv_sales WHERE sale_date>=date('now','-30 day') GROUP BY product_id) s ON s.product_id=products.bling_product_id":"";
  const rows=(await getRuntimeDb().prepare(`SELECT products.id,products.bling_product_id,products.sku,products.name,products.cost,products.stock_physical,products.min_stock,products.supplier_id,suppliers.name supplier_name,suppliers.lead_time_days,COALESCE(s.qty30,0) qty30
    FROM products LEFT JOIN suppliers ON suppliers.id=products.supplier_id ${salesJoin}
    WHERE products.status='ativo'`).all<Row>()).results||[];

  const suggestions=rows.map((r:Row)=>{
   const avgDailySales=r.qty30/30;
   const leadTimeDays=r.lead_time_days??7; // sem fornecedor vinculado, assume 7 dias como padrão conservador
   const suggestedQuantity=suggestPurchaseQuantity({stockPhysical:r.stock_physical,avgDailySales,leadTimeDays,minStock:r.min_stock});
   return {...r,avgDailySales:Number(avgDailySales.toFixed(2)),suggestedQuantity,estimatedCost:suggestedQuantity*r.cost};
  }).filter((r:{suggestedQuantity:number})=>r.suggestedQuantity>0);

  const bySupplier=new Map<string,{supplierId:number|null;supplierName:string;items:typeof suggestions;totalCost:number}>();
  for(const s of suggestions){
   const key=s.supplier_id?String(s.supplier_id):"sem_fornecedor";
   if(!bySupplier.has(key))bySupplier.set(key,{supplierId:s.supplier_id,supplierName:s.supplier_name||"Sem fornecedor vinculado",items:[],totalCost:0});
   const group=bySupplier.get(key)!;group.items.push(s);group.totalCost+=s.estimatedCost;
  }

  return NextResponse.json({suggestions,groups:[...bySupplier.values()]});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível calcular a necessidade de compra."},{status:500})}
}
