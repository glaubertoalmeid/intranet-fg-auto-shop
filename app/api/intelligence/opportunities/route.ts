import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {fetchAllRows,getSupabase} from "../../../../lib/supabase";

type ProductRow={bling_product_id:string;sku:string;name:string;brand:string;category:string;cost:number;stock_physical:number;format:string;kit_components:{productId:string;quantity:number}[];status:string};
const num=(v:unknown)=>Number(v)||0;

/** Etapa 6 — fila de oportunidades, cruzando estoque (Bling) com histórico de venda
 *  (cmv_sales). "Evidência de demanda" é sempre dado real (venda passada), nunca
 *  suposição — e cada item deixa claro o que é fato observado vs. hipótese a confirmar. */
export async function GET(){
 try{
  await requirePermission("relatorios_cmv");
  const supabase=getSupabase();

  const [products,recentSales,channelSales]=await Promise.all([
   fetchAllRows<ProductRow>((from_,to_)=>supabase.from("products").select("bling_product_id,sku,name,brand,category,cost,stock_physical,format,kit_components,status").eq("status","ativo").range(from_,to_)),
   fetchAllRows<{product_id:string;quantity:number;sale_date:string}>((from_,to_)=>supabase.from("cmv_sales").select("product_id,quantity,sale_date").eq("cancelled",false).gte("sale_date",new Date(Date.now()-90*86400000).toISOString().slice(0,10)).range(from_,to_)),
   // Janela de 365 dias — precisa ser mais longa que a de qty90 pra "produto parado" não
   // confundir "nunca vendeu nos últimos 90 dias" (sem dado) com "não está parado" (bug já
   // visto: um produto sem NENHUMA venda no período consultado virava Infinity e ficava de
   // fora do alerta, quando devia ser o caso mais óbvio de produto parado).
   fetchAllRows<{product_id:string;channel:string;sale_date:string}>((from_,to_)=>supabase.from("cmv_sales").select("product_id,channel,sale_date").eq("cancelled",false).gte("sale_date",new Date(Date.now()-365*86400000).toISOString().slice(0,10)).range(from_,to_)),
  ]);

  const byProductId=new Map(products.map(p=>[p.bling_product_id,p]));
  const qty90=new Map<string,number>();
  for(const row of recentSales)qty90.set(row.product_id,(qty90.get(row.product_id)||0)+num(row.quantity));
  const channelsByProduct=new Map<string,Set<string>>(),lastSale=new Map<string,string>();
  for(const row of channelSales){
   const set=channelsByProduct.get(row.product_id)||new Set<string>();
   set.add(row.channel);channelsByProduct.set(row.product_id,set);
   const cur=lastSale.get(row.product_id);
   if(!cur||row.sale_date>cur)lastSale.set(row.product_id,row.sale_date);
  }
  const allChannelsSeen=new Set([...channelsByProduct.values()].flatMap(s=>[...s]));

  const opportunities:AnyOpportunity[]=[];
  type AnyOpportunity={type:string;productId:string;sku:string;name:string;evidence:string;cost:number;stock:number;potential:"alto"|"médio"|"baixo";effort:"baixo"|"médio"|"alto";isFact:boolean};

  for(const p of products){
   const sold90=qty90.get(p.bling_product_id)||0;
   const last=lastSale.get(p.bling_product_id);
   const daysSince=last?(Date.now()-new Date(last).getTime())/86400000:Infinity;

   // Zerado que vende — cotação com fornecedor
   if(p.stock_physical<=0&&sold90>0){
    opportunities.push({type:"cotacao_fornecedor",productId:p.bling_product_id,sku:p.sku,name:p.name,evidence:`Vendeu ${sold90} unidade(s) nos últimos 90 dias e está com estoque zero.`,cost:p.cost,stock:p.stock_physical,potential:"alto",effort:"baixo",isFact:true});
   }
   // Parado com estoque — candidato a oferta. Sem NENHUMA venda nos últimos 365 dias é o
   // caso mais óbvio (daysSince fica Infinity) — precisa aparecer, não ser descartado.
   if(p.stock_physical>0&&daysSince>=90&&p.cost>0){
    const evidence=daysSince===Infinity?`Nenhuma venda registrada nos últimos 365 dias, ${p.stock_physical} unidade(s) em estoque.`:`${Math.floor(daysSince)} dias sem vender, ${p.stock_physical} unidade(s) em estoque.`;
    opportunities.push({type:"oferta_parado",productId:p.bling_product_id,sku:p.sku,name:p.name,evidence,cost:p.cost,stock:p.stock_physical,potential:p.stock_physical>=10?"médio":"baixo",effort:"baixo",isFact:true});
   }
   // Possível lacuna de anúncio — HIPÓTESE, não fato (produto pode ter anúncio e nunca
   // ter vendido, ou pode não ter anúncio algum — não dá pra distinguir sem ver o anúncio)
   if(sold90>0&&allChannelsSeen.size>1){
    const soldChannels=channelsByProduct.get(p.bling_product_id)||new Set();
    const missingChannels=[...allChannelsSeen].filter(c=>!soldChannels.has(c));
    if(missingChannels.length&&soldChannels.size>0){
     opportunities.push({type:"lacuna_canal",productId:p.bling_product_id,sku:p.sku,name:p.name,evidence:`Vende em ${[...soldChannels].join(", ")} mas nunca vendeu em ${missingChannels.join(", ")} nos últimos 365 dias — pode não estar anunciado lá (não confirmado).`,cost:p.cost,stock:p.stock_physical,potential:"médio",effort:"médio",isFact:false});
    }
   }
   // Kit pronto vs. bloqueado
   if(p.format==="E"&&p.kit_components?.length){
    const missing=p.kit_components.filter(c=>{const comp=byProductId.get(c.productId);return !comp||comp.stock_physical<c.quantity});
    if(missing.length===0){
     opportunities.push({type:"kit_pronto",productId:p.bling_product_id,sku:p.sku,name:p.name,evidence:`Kit com todos os ${p.kit_components.length} componentes em estoque suficiente — pronto pra vender/anunciar.`,cost:p.cost,stock:p.stock_physical,potential:sold90>0?"alto":"médio",effort:"baixo",isFact:true});
    }else{
     const names=missing.map(c=>byProductId.get(c.productId)?.name||c.productId).slice(0,3).join(", ");
     opportunities.push({type:"kit_bloqueado",productId:p.bling_product_id,sku:p.sku,name:p.name,evidence:`Kit falta componente(s): ${names}${missing.length>3?` e mais ${missing.length-3}`:""}.`,cost:p.cost,stock:p.stock_physical,potential:"baixo",effort:"médio",isFact:true});
    }
   }
  }

  const order={alto:0,médio:1,baixo:2};
  opportunities.sort((a,b)=>order[a.potential]-order[b.potential]);

  const byType=Object.fromEntries(["cotacao_fornecedor","oferta_parado","lacuna_canal","kit_pronto","kit_bloqueado"].map(t=>[t,opportunities.filter(o=>o.type===t).length]));

  return NextResponse.json({total:opportunities.length,byType,opportunities:opportunities.slice(0,200)});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível calcular oportunidades."},{status:500})}
}
