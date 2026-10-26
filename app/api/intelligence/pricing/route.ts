import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {fetchAllRows,getSupabase} from "../../../../lib/supabase";
import {blingApi} from "../../../../lib/bling";
import {Budget,channelsLookup} from "../../marketplaces/bling/cmv/route";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const list=(v:unknown)=>Array.isArray(v)?v:[];
const num=(v:unknown)=>Number(v)||0;
const text=(v:unknown)=>String(v??"").trim();

/** Etapa 3 — calcula preço mínimo e preço para margem ideal, por produto e canal.
 *  Comissão/frete/outras despesas não são configurados à mão: são a MÉDIA OBSERVADA
 *  nas vendas reais dos últimos 90 dias daquele canal (% sobre o faturamento) — dado real
 *  em vez de suposição, consistente com o resto do módulo de CMV. Se não houver histórico
 *  suficiente, o cálculo é sinalizado como incompleto em vez de assumir taxa zero.
 *  O preço "atual" vem de /produtos/lojas (preço por loja/canal do Bling), NÃO do
 *  produtos.sale_price único — confirmado com dado real que um mesmo produto tem preço
 *  diferente registrado em cada canal (ex.: R$119 no ML, R$104 na Shopee, R$89,90 na loja). */
export async function GET(request:Request){
 try{
  await requirePermission("relatorios_cmv");
  const url=new URL(request.url);
  const productId=url.searchParams.get("productId")||"";
  const channel=url.searchParams.get("channel")||"";
  if(!productId||!channel)return NextResponse.json({error:"Informe productId e channel."},{status:400});

  const supabase=getSupabase();
  const incomplete:string[]=[];

  const {data:product}=await supabase.from("products").select("bling_product_id,product_name:name,cost,sale_price").eq("bling_product_id",productId).maybeSingle();
  if(!product)return NextResponse.json({error:`Produto ${productId} não encontrado.`},{status:404});
  const cost=num(product.cost);
  if(cost<=0)incomplete.push("Produto sem custo cadastrado no Bling — preço mínimo não pode ser calculado.");

  const {data:settings}=await supabase.from("product_settings").select("packaging_cost,extra_cost").eq("bling_product_id",productId).maybeSingle();
  const packaging=num(settings?.packaging_cost),extra=num(settings?.extra_cost);
  if(!settings)incomplete.push("Sem embalagem/despesa extra configurada — assumindo R$0 (pode estar subestimando o custo).");

  const {data:marginRow}=await supabase.from("cmv_margin_config").select("tax_rate,margin_min,margin_ideal").eq("channel",channel).maybeSingle();
  const {data:generalRow}=marginRow?{data:null}:await supabase.from("cmv_margin_config").select("tax_rate,margin_min,margin_ideal").eq("channel","geral").maybeSingle();
  const cfg=marginRow||generalRow;
  if(!cfg)incomplete.push(`Canal "${channel}" sem imposto/margem configurados (Rentabilidade e CMV → % Margem de contribuição).`);
  const taxRate=num(cfg?.tax_rate)/100,marginMin=num(cfg?.margin_min)/100,marginIdeal=num(cfg?.margin_ideal)/100;

  // Taxa de comissão/frete observada de verdade no canal — não é por produto (produto
  // novo não tem histórico próprio), é a média do canal nos últimos 90 dias.
  const from=new Date(Date.now()-90*86400000).toISOString().slice(0,10);
  const channelSales=await fetchAllRows<{revenue:number;commission:number;freight_cost:number;other_fees:number}>((from_,to_)=>
   supabase.from("cmv_sales").select("revenue,commission,freight_cost,other_fees").eq("channel",channel).eq("cancelled",false).gte("sale_date",from).range(from_,to_)
  );
  const totalRevenue=channelSales.reduce((s,r)=>s+num(r.revenue),0);
  let commissionRate=0,freightRate=0,otherFeesRate=0;
  if(totalRevenue>0){
   commissionRate=channelSales.reduce((s,r)=>s+num(r.commission),0)/totalRevenue;
   freightRate=channelSales.reduce((s,r)=>s+num(r.freight_cost),0)/totalRevenue;
   otherFeesRate=channelSales.reduce((s,r)=>s+num(r.other_fees),0)/totalRevenue;
  }else{
   incomplete.push(`Sem histórico de vendas do canal "${channel}" nos últimos 90 dias — comissão/frete assumidos como 0% (provavelmente subestimado).`);
  }

  // Preço real vigente nesse canal — /produtos/lojas devolve um preço por loja do Bling;
  // resolve o nome de cada loja via /canais-venda (mesmo lookup usado no sync do CMV).
  let currentChannelPrice:number|null=null;
  try{
   const budget=new Budget(20);
   const [lojasResp,channels]=await Promise.all([blingApi(`/produtos/lojas?idProduto=${productId}`),channelsLookup(budget)]);
   const lojaRows=list(lojasResp.data).map(record);
   const match=lojaRows.find(row=>channels.get(text(record(row.loja).id))===channel);
   if(match)currentChannelPrice=num(match.precoPromocional)||num(match.preco);
   else if(lojaRows.length)incomplete.push(`Produto tem preço cadastrado em outra(s) loja(s) do Bling, mas nenhuma corresponde ao canal "${channel}" — confira o vínculo de canal de venda.`);
  }catch{incomplete.push("Não foi possível consultar o preço por loja no Bling agora.")}

  const fixedCost=cost+packaging+extra;
  const computePrice=(marginPct:number)=>{
   const denom=1-commissionRate-freightRate-otherFeesRate-taxRate-marginPct;
   if(denom<=0)return null;
   return fixedCost/denom;
  };
  const priceMin=computePrice(marginMin);
  const priceIdeal=computePrice(marginIdeal);
  if(priceMin===null||priceIdeal===null)incomplete.push("Comissão+frete+imposto+margem somam 100% ou mais da venda — não existe preço que cubra esses custos nesse canal com a margem configurada.");

  return NextResponse.json({
   productId,productName:product.product_name,channel,
   inputs:{cost,packaging,extra,taxRatePct:taxRate*100,marginMinPct:marginMin*100,marginIdealPct:marginIdeal*100,commissionRatePct:commissionRate*100,freightRatePct:freightRate*100,otherFeesRatePct:otherFeesRate*100,observedSalesCount:channelSales.length},
   priceMin,priceIdeal,currentChannelPrice,blingDefaultPrice:num(product.sale_price),
   complete:incomplete.length===0,incomplete,
  });
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível calcular o preço."},{status:500})}
}
