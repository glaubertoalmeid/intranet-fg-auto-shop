import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {fetchAllRows,getSupabase} from "../../../../lib/supabase";

const num=(v:unknown)=>Number(v)||0;
const days=(iso:string)=>iso?(Date.now()-new Date(iso).getTime())/86400000:Infinity;

type SaleRow={sale_id:string;product_id:string;sku:string;product_name:string;channel:string;sale_date:string;quantity:number;revenue:number;cost:number;commission:number;freight_cost:number;other_fees:number;cancelled:boolean};

/** Etapa 4 — diagnóstico por produto/anúncio. Sem dado de visita (Shopee não expõe;
 *  Mercado Livre ainda não testado — ver Etapa 1), então "pouca exposição" e "visitas sem
 *  venda" ficam como informação faltante, não como suposição. O resto usa dado real:
 *  resultado por venda, comparação de período, tempo parado e cancelamento — sempre
 *  comparando o próprio histórico do produto, nunca uma taxa de conversão genérica. */
export async function GET(request:Request){
 try{
  await requirePermission("relatorios_cmv");
  const productId=new URL(request.url).searchParams.get("productId")||"";
  if(!productId)return NextResponse.json({error:"Informe productId."},{status:400});

  const supabase=getSupabase();
  const {data:product}=await supabase.from("products").select("bling_product_id,name,sku,stock_physical,cost").eq("bling_product_id",productId).maybeSingle();
  if(!product)return NextResponse.json({error:`Produto ${productId} não encontrado.`},{status:404});

  const since180=new Date(Date.now()-180*86400000).toISOString().slice(0,10);
  const allSales=await fetchAllRows<SaleRow>((from_,to_)=>
   supabase.from("cmv_sales").select("sale_id,product_id,sku,product_name,channel,sale_date,quantity,revenue,cost,commission,freight_cost,other_fees,cancelled").eq("product_id",productId).gte("sale_date",since180).range(from_,to_)
  );

  const fatos:string[]=[],hipoteses:string[]=[],faltam:string[]=[];

  // Produto parado — calculado direto das vendas já buscadas (não do products.last_sale_at,
  // que só atualiza numa sincronização completa de catálogo e pode ficar desatualizado
  // mesmo com vendas recentes reais em cmv_sales — confirmado testando produto real).
  const lastSaleDate=allSales.filter(s=>!s.cancelled).map(s=>s.sale_date).sort().at(-1)||"";
  const lastSaleDays=days(lastSaleDate);
  if(lastSaleDays===Infinity)fatos.push("Nenhuma venda registrada nos últimos 180 dias.");
  else if(lastSaleDays>=30)fatos.push(`${Math.floor(lastSaleDays)} dias sem vender (última venda em ${lastSaleDate}).`);
  else fatos.push(`Última venda há ${Math.floor(lastSaleDays)} dia(s) (${lastSaleDate}).`);
  if(lastSaleDays>=30&&num(product.stock_physical)>0)hipoteses.push("Tem estoque disponível mas não vende — pode ser preço, posição no anúncio, concorrência ou falta de exposição.");

  // Queda de vendas: compara os últimos 30 dias com os 30 dias anteriores
  const activeSales=allSales.filter(s=>!s.cancelled);
  const today=Date.now(),d30=today-30*86400000,d60=today-60*86400000;
  const inWindow=(s:SaleRow,start:number,end:number)=>{const t=new Date(s.sale_date).getTime();return t>=start&&t<end};
  const recent=activeSales.filter(s=>inWindow(s,d30,today)),previous=activeSales.filter(s=>inWindow(s,d60,d30));
  const recentRevenue=recent.reduce((a,s)=>a+num(s.revenue),0),previousRevenue=previous.reduce((a,s)=>a+num(s.revenue),0);
  if(previousRevenue>0){
   const change=(recentRevenue-previousRevenue)/previousRevenue*100;
   fatos.push(`Faturamento: R$${recentRevenue.toFixed(2)} nos últimos 30 dias vs. R$${previousRevenue.toFixed(2)} nos 30 dias anteriores (${change>=0?"+":""}${change.toFixed(0)}%).`);
   if(change<=-30)hipoteses.push("Queda relevante de vendas — pode ser estoque, preço, alteração no anúncio ou concorrência (ver Etapa 5/6, ainda não implementada).");
  }else if(recentRevenue>0){
   fatos.push(`Faturamento apareceu nos últimos 30 dias (R$${recentRevenue.toFixed(2)}) sem histórico comparável no período anterior.`);
  }

  // Resultado por venda (usa a mesma config de margem já criada na Etapa 3)
  const byChannel=new Map<string,SaleRow[]>();
  for(const s of activeSales){const arr=byChannel.get(s.channel)||[];arr.push(s);byChannel.set(s.channel,arr)}
  const {data:marginConfigs}=await supabase.from("cmv_margin_config").select("channel,tax_rate,margin_min");
  const marginByChannel=new Map((marginConfigs||[]).map(m=>[m.channel,m]));
  for(const [channel,rows] of byChannel){
   const revenue=rows.reduce((a,s)=>a+num(s.revenue),0),cost=rows.reduce((a,s)=>a+num(s.quantity)*num(s.cost),0);
   const commission=rows.reduce((a,s)=>a+num(s.commission),0),freight=rows.reduce((a,s)=>a+num(s.freight_cost),0),other=rows.reduce((a,s)=>a+num(s.other_fees),0);
   const cfg=marginByChannel.get(channel)||marginByChannel.get("geral");
   const tax=revenue*(num(cfg?.tax_rate)/100);
   const result=revenue-cost-commission-freight-other-tax,margin=revenue?result/revenue*100:0;
   fatos.push(`${channel}: margem média de ${margin.toFixed(1)}% em ${rows.length} venda(s) nos últimos 180 dias.`);
   if(cfg&&margin<num(cfg.margin_min))hipoteses.push(`${channel}: margem abaixo do mínimo configurado (${num(cfg.margin_min)}%) — revisar preço ou custos nesse canal.`);
   else if(!cfg)faltam.push(`${channel}: sem margem mínima configurada pra comparar (Rentabilidade e CMV → % Margem de contribuição).`);
  }

  // Cancelamentos
  const cancelledCount=allSales.filter(s=>s.cancelled).length;
  if(allSales.length){
   const rate=cancelledCount/allSales.length*100;
   if(cancelledCount>0)fatos.push(`${cancelledCount} de ${allSales.length} pedido(s) (${rate.toFixed(0)}%) foram cancelados/devolvidos nos últimos 180 dias.`);
   if(rate>=15)hipoteses.push("Taxa de cancelamento alta — pode indicar problema de anúncio (descrição/foto não corresponde), logística ou item com defeito recorrente.");
  }
  faltam.push("Motivo do cancelamento não é fornecido pela API da Shopee/Mercado Livre de forma estruturada — não dá pra saber a causa, só a taxa.");

  // O que falta de verdade (bloqueado na Etapa 1)
  faltam.push("Visitas/exposição do anúncio: Shopee não expõe isso por API pra vendedores comuns; Mercado Livre ainda não testado (token pendente de reconexão).");
  faltam.push("Sem visitas, não dá pra saber se pouca venda é falta de exposição ou anúncio que não converte — essa distinção fica em aberto até termos essa fonte.");

  return NextResponse.json({
   productId,productName:product.name,sku:product.sku,
   fatos,hipoteses,faltam,
   periodo:"últimos 180 dias (onde aplicável)",
  });
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível gerar o diagnóstico."},{status:500})}
}
