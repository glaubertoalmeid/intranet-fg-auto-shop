import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {suggestPurchaseQuantity} from "../../../../lib/purchasing";
import {fetchAllRows,getSupabase} from "../../../../lib/supabase";

type ProductRow={id:number;bling_product_id:string;sku:string;name:string;brand:string;category:string;cost:number;stock_physical:number;min_stock:number;supplier_id:number|null;status:string};
type Row=ProductRow&{supplier_name:string|null;lead_time_days:number|null;qty30:number};

export async function GET(){
 try{
  await requirePermission("compras");
  const supabase=getSupabase();
  const [products,{data:suppliers,error:suppliersError},cmvRows]=await Promise.all([
   fetchAllRows<ProductRow>((from_,to_)=>supabase.from("products").select("id,bling_product_id,sku,name,brand,category,cost,stock_physical,min_stock,supplier_id,status").eq("status","ativo").range(from_,to_)),
   supabase.from("suppliers").select("id,name,lead_time_days"),
   fetchAllRows<{product_id:string;quantity:number}>((from_,to_)=>supabase.from("cmv_sales").select("product_id,quantity").gte("sale_date",new Date(Date.now()-30*86400000).toISOString().slice(0,10)).range(from_,to_)),
  ]);
  if(suppliersError)throw new Error(suppliersError.message);

  const supplierById=new Map((suppliers||[]).map(s=>[s.id,s]));
  const qty30ByProduct=new Map<string,number>();
  for(const row of cmvRows)qty30ByProduct.set(row.product_id,(qty30ByProduct.get(row.product_id)||0)+(Number(row.quantity)||0));

  const rows:Row[]=products.map(p=>{
   const supplier=p.supplier_id?supplierById.get(p.supplier_id):null;
   return {...p,supplier_name:supplier?.name||null,lead_time_days:supplier?.lead_time_days??null,qty30:qty30ByProduct.get(p.bling_product_id)||0};
  });

  const suggestions=rows.map(r=>{
   const avgDailySales=r.qty30/30;
   const leadTimeDays=r.lead_time_days??7; // sem fornecedor vinculado, assume 7 dias como padrão conservador
   const suggestedQuantity=suggestPurchaseQuantity({stockPhysical:r.stock_physical,avgDailySales,leadTimeDays,minStock:r.min_stock});
   return {...r,avgDailySales:Number(avgDailySales.toFixed(2)),suggestedQuantity,estimatedCost:suggestedQuantity*r.cost};
  }).filter(r=>r.suggestedQuantity>0);

  const bySupplier=new Map<string,{supplierId:number|null;supplierName:string;items:typeof suggestions;totalCost:number}>();
  for(const s of suggestions){
   const key=s.supplier_id?String(s.supplier_id):"sem_fornecedor";
   if(!bySupplier.has(key))bySupplier.set(key,{supplierId:s.supplier_id,supplierName:s.supplier_name||"Sem fornecedor vinculado",items:[],totalCost:0});
   const group=bySupplier.get(key)!;group.items.push(s);group.totalCost+=s.estimatedCost;
  }

  // Radar de reposição: painel de KPIs pra decisão rápida, além da lista detalhada por
  // fornecedor acima. "Zerado que vende" é mais urgente que a régua padrão — estoque
  // zero com venda recente, tenha ou não mínimo configurado.
  const zerados=rows.filter(r=>r.stock_physical<=0&&r.qty30>0)
   .map(r=>({id:r.id,sku:r.sku,name:r.name,brand:r.brand,category:r.category,qty30:r.qty30,cost:r.cost,supplierId:r.supplier_id,supplierName:r.supplier_id?supplierById.get(r.supplier_id)?.name||null:null}))
   .sort((a,b)=>b.qty30-a.qty30);
  const summary={
   valorARepor:suggestions.reduce((sum,s)=>sum+s.estimatedCost,0),
   itensAbaixoDaRegua:suggestions.length,
   zeradosQueVendem:zerados.length,
  };

  return NextResponse.json({suggestions,groups:[...bySupplier.values()],summary,zerados});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível calcular a necessidade de compra."},{status:500})}
}
