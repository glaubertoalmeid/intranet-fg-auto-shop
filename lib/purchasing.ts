// purchase_orders / purchase_order_items vivem no Supabase (Etapa 3 — Compras), ver lib/supabase.ts.

export const PURCHASE_STATUSES=["elaboracao","enviado","confirmado","em_transporte","recebido_parcial","recebido_completo","cancelado"] as const;
export type PurchaseStatus=typeof PURCHASE_STATUSES[number];

/** Regra do documento (seção 7): estoque atual, venda média diária, prazo de entrega do
 *  fornecedor e estoque de segurança (o próprio mínimo cadastrado) definem a quantidade sugerida.
 *  suggested = ceil(avgDaily × leadTimeDays) + minStock − estoqueAtual, nunca negativo. */
export function suggestPurchaseQuantity(input:{stockPhysical:number;avgDailySales:number;leadTimeDays:number;minStock:number}){
 const coverageNeeded=input.avgDailySales*Math.max(0,input.leadTimeDays);
 const target=coverageNeeded+input.minStock;
 return Math.max(0,Math.ceil(target-input.stockPhysical));
}

// ───────────────────────── Análise de Compras (tela nova) ─────────────────────────
// Regra simples e deliberadamente separada de suggestPurchaseQuantity acima (que usa prazo
// de fornecedor + estoque mínimo — mantido pra o Radar/Necessidade de compra já existentes).
// Essa segunda regra é a pedida pro módulo de análise: só média mensal − estoque atual, sem
// prazo de entrega, estoque de segurança, mínimo de compra ou múltiplo de caixa (deixado pra
// uma iteração futura, ver lista de "arquitetura desejada" do pedido original).

export type AnalysisChannel="loja_fisica"|"mercado_livre"|"shopee"|"site"|"outros";
export const CHANNEL_LABELS:Record<AnalysisChannel,string>={loja_fisica:"Loja física",mercado_livre:"Mercado Livre",shopee:"Shopee",site:"Site",outros:"Outros"};

/** Nomes de loja do Bling (ver lib/bling.ts's canais-venda) mapeados pros 4 canais que o
 *  módulo mostra. Qualquer canal fora dessa lista (ex. Loja Amazon) cai em "outros" — ainda
 *  entra na venda total, só não aparece numa coluna própria (o pedido não citou Amazon). */
function classifyChannel(channelName:string):AnalysisChannel{
 const name=channelName.toLowerCase();
 if(name.includes("pdv"))return "loja_fisica";
 if(name.includes("mercado livre")||name.includes("mercadolivre")||name.includes("meli"))return "mercado_livre";
 if(name.includes("shopee"))return "shopee";
 if(name.includes("nuvemshop")||name.includes("nuvem shop")||name.includes("site"))return "site";
 return "outros";
}

export type PurchasingProduct={
 bling_product_id:string;sku:string;name:string;brand:string;category:string;
 cost:number;stock_physical:number;format:string;status:string;
 kit_components:{productId:string;quantity:number}[];
};
export type PurchasingSale={product_id:string;quantity:number;channel:string};

export type PurchaseAnalysisRow={
 blingProductId:string;sku:string;name:string;brand:string;category:string;
 stock:number;
 directSales:number;kitSales:number;totalSales:number;
 salesByChannel:Record<AnalysisChannel,number>;
 topChannel:AnalysisChannel|null;
 monthlyAverage:number;
 lastPurchasePrice:number|null;
 suggestedQuantity:number;
 estimatedCost:number|null;
};

function emptyChannelTotals():Record<AnalysisChannel,number>{
 return {loja_fisica:0,mercado_livre:0,shopee:0,site:0,outros:0};
}

/** Núcleo do módulo: recebe o catálogo (produtos simples + kits, já carregados do Supabase)
 *  e as vendas do período (já filtradas por data/cancelado), explode kit→componentes e devolve
 *  uma linha por produto simples. Função pura — sem fetch aqui — pra ficar fácil de testar e de
 *  estender (ex.: trocar a fórmula de compra sugerida sem mexer na consulta ao banco). */
export function buildPurchaseAnalysis(input:{products:PurchasingProduct[];sales:PurchasingSale[];periodDays:number}):PurchaseAnalysisRow[]{
 const {products,sales,periodDays}=input;
 const byId=new Map(products.map(p=>[p.bling_product_id,p]));
 const simples=products.filter(p=>p.format==="S"&&p.status==="ativo");

 const direct=new Map<string,number>();
 const viaKit=new Map<string,number>();
 const channelTotals=new Map<string,Record<AnalysisChannel,number>>();
 const addChannel=(productId:string,channel:AnalysisChannel,qty:number)=>{
  const totals=channelTotals.get(productId)||emptyChannelTotals();
  totals[channel]+=qty;
  channelTotals.set(productId,totals);
 };

 for(const sale of sales){
  const qty=Number(sale.quantity)||0;
  if(qty<=0)continue;
  const channel=classifyChannel(sale.channel||"");
  const product=byId.get(sale.product_id);
  if(product&&product.format==="S"){
   direct.set(sale.product_id,(direct.get(sale.product_id)||0)+qty);
   addChannel(sale.product_id,channel,qty);
   continue;
  }
  if(product&&product.format==="E"&&product.kit_components?.length){
   for(const component of product.kit_components){
    const compQty=qty*(Number(component.quantity)||0);
    if(compQty<=0)continue;
    // Só soma em produtos simples conhecidos — um componente que seja ele mesmo outro kit
    // (raro, não citado no pedido original) não é explodido recursivamente nesta primeira versão.
    const comp=byId.get(component.productId);
    if(!comp||comp.format!=="S")continue;
    viaKit.set(component.productId,(viaKit.get(component.productId)||0)+compQty);
    addChannel(component.productId,channel,compQty);
   }
  }
  // Vendas de produto não encontrado no catálogo local (ex. excluído do Bling) ou de
  // variação ("V") não entram no consumo de nenhum produto simples nesta primeira versão.
 }

 return simples.map(p=>{
  const directSales=direct.get(p.bling_product_id)||0;
  const kitSales=viaKit.get(p.bling_product_id)||0;
  const totalSales=directSales+kitSales;
  const salesByChannel=channelTotals.get(p.bling_product_id)||emptyChannelTotals();
  const topChannel=(Object.entries(salesByChannel) as [AnalysisChannel,number][])
   .filter(([,qty])=>qty>0).sort((a,b)=>b[1]-a[1])[0]?.[0]??null;
  const monthlyAverage=Math.round((totalSales/Math.max(1,periodDays))*30*100)/100;
  const stock=p.stock_physical;
  const suggestedQuantity=Math.max(0,Math.round(monthlyAverage-stock));
  const lastPurchasePrice=p.cost>0?p.cost:null;
  const estimatedCost=lastPurchasePrice!==null?Math.round(suggestedQuantity*lastPurchasePrice*100)/100:null;
  return {
   blingProductId:p.bling_product_id,sku:p.sku,name:p.name,brand:p.brand,category:p.category,
   stock,directSales,kitSales,totalSales,salesByChannel,topChannel,monthlyAverage,
   lastPurchasePrice,suggestedQuantity,estimatedCost,
  };
 });
}

export type PurchaseAnalysisSort="total_sales"|"monthly_average"|"stock_asc"|"suggested_quantity"|"estimated_cost"|"brand"|"category";
export function sortAnalysisRows(rows:PurchaseAnalysisRow[],sort:PurchaseAnalysisSort):PurchaseAnalysisRow[]{
 const sorted=[...rows];
 switch(sort){
  case "monthly_average":return sorted.sort((a,b)=>b.monthlyAverage-a.monthlyAverage);
  case "stock_asc":return sorted.sort((a,b)=>a.stock-b.stock);
  case "suggested_quantity":return sorted.sort((a,b)=>b.suggestedQuantity-a.suggestedQuantity);
  case "estimated_cost":return sorted.sort((a,b)=>(b.estimatedCost??-1)-(a.estimatedCost??-1));
  case "brand":return sorted.sort((a,b)=>a.brand.localeCompare(b.brand)||b.totalSales-a.totalSales);
  case "category":return sorted.sort((a,b)=>a.category.localeCompare(b.category)||b.totalSales-a.totalSales);
  case "total_sales":default:return sorted.sort((a,b)=>b.totalSales-a.totalSales);
 }
}
