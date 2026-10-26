import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../lib/auth";
import {getSupabase} from "../../../../../lib/supabase";
import {blingApi} from "../../../../../lib/bling";
import {Budget,channelsLookup} from "../../../marketplaces/bling/cmv/route";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const list=(v:unknown)=>Array.isArray(v)?v:[];
const num=(v:unknown)=>Number(v)||0;
const text=(v:unknown)=>String(v??"").trim();

/** Etapa 5 — "comparativo por produto e lista de diferenças que podem influenciar a
 *  compra". Compara nosso preço por canal (Bling /produtos/lojas, mesma fonte da Etapa 3)
 *  contra a captura mais recente de cada concorrente cadastrado pra aquele produto. */
export async function GET(request:Request){
 try{
  await requirePermission("relatorios_cmv");
  const productId=new URL(request.url).searchParams.get("productId")||"";
  if(!productId)return NextResponse.json({error:"Informe productId."},{status:400});
  const supabase=getSupabase();

  const {data:product}=await supabase.from("products").select("name,cost").eq("bling_product_id",productId).maybeSingle();
  if(!product)return NextResponse.json({error:`Produto ${productId} não encontrado.`},{status:404});

  let ourPrices:{channel:string;price:number}[]=[];
  try{
   const budget=new Budget(20);
   const [lojasResp,channels]=await Promise.all([blingApi(`/produtos/lojas?idProduto=${productId}`),channelsLookup(budget)]);
   ourPrices=list(lojasResp.data).map(record).map(row=>({channel:channels.get(text(record(row.loja).id))||"desconhecido",price:num(row.precoPromocional)||num(row.preco)})).filter(p=>p.price>0);
  }catch{/* segue sem preço nosso — fica sinalizado abaixo */}

  const {data:allCaptures}=await supabase.from("competitor_listings").select("*").eq("bling_product_id",productId).order("captured_at",{ascending:false});
  // Última captura de cada concorrente (por nome+marketplace) — histórico completo fica
  // disponível em GET /api/intelligence/competitors, aqui é só o comparativo atual.
  const latestByCompetitor=new Map<string,AnyRecord>();
  for(const row of allCaptures||[]){
   const key=`${row.competitor_name}|${row.marketplace}`;
   if(!latestByCompetitor.has(key))latestByCompetitor.set(key,row);
  }

  const comparisons=[...latestByCompetitor.values()].map(comp=>{
   const ourMatch=ourPrices.find(p=>p.channel.toLowerCase().includes(text(comp.marketplace).toLowerCase())||text(comp.marketplace).toLowerCase().includes(p.channel.toLowerCase()));
   const diffs:string[]=[];
   if(!ourMatch)diffs.push("Sem preço nosso cadastrado nesse canal para comparar.");
   if(comp.price===null)diffs.push("Preço do concorrente indisponível na última captura.");
   if(ourMatch&&comp.price!==null){
    const diffPct=(ourMatch.price-num(comp.price))/num(comp.price)*100;
    diffs.push(diffPct>0?`Nosso preço é ${diffPct.toFixed(0)}% mais caro.`:diffPct<0?`Nosso preço é ${Math.abs(diffPct).toFixed(0)}% mais barato.`:"Mesmo preço.");
   }
   if(comp.shipping_cost===null)diffs.push("Frete do concorrente indisponível.");
   if(comp.rating===null)diffs.push("Avaliação do concorrente indisponível.");
   const ageDays=(Date.now()-new Date(comp.captured_at).getTime())/86400000;
   if(ageDays>30)diffs.push(`Captura com ${Math.floor(ageDays)} dias — pode estar desatualizada, considere recapturar.`);
   return {
    competitorName:comp.competitor_name,marketplace:comp.marketplace,title:comp.title,
    theirPrice:comp.price,theirShipping:comp.shipping_cost,theirShippingDays:comp.shipping_days,
    theirRating:comp.rating,theirRatingCount:comp.rating_count,theirKit:comp.kit_components||null,
    sourceUrl:comp.source_url,capturedAt:comp.captured_at,
    ourPrice:ourMatch?.price??null,ourChannel:ourMatch?.channel??null,
    diffs,
   };
  });

  return NextResponse.json({productId,productName:product.name,ourPrices,comparisons,competitorsTracked:latestByCompetitor.size});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível comparar concorrentes."},{status:500})}
}
