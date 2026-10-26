import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {logAudit} from "../../../../lib/audit";
import {getSupabase} from "../../../../lib/supabase";

const text=(v:unknown)=>String(v??"").trim();
const numOrNull=(v:unknown)=>v===undefined||v===null||v===""?null:Number(v);

/** Etapa 5 — cadastro de concorrentes/anúncios de referência. Cada linha é uma "foto" do
 *  anúncio concorrente num momento (captured_at) — não sobrescreve a anterior, então dá
 *  pra ver histórico/alteração ao longo do tempo (útil pra Etapa 6). Campo vazio/null =
 *  "indisponível" de propósito, nunca vira 0 — conforme pedido explicitamente no plano. */
export async function GET(request:Request){
 try{
  await requirePermission("relatorios_cmv");
  const productId=new URL(request.url).searchParams.get("productId")||"";
  if(!productId)return NextResponse.json({error:"Informe productId."},{status:400});
  const {data,error}=await getSupabase().from("competitor_listings").select("*").eq("bling_product_id",productId).order("captured_at",{ascending:false});
  if(error)throw new Error(error.message);
  return NextResponse.json({listings:data||[]});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível carregar os concorrentes."},{status:500})}
}

export async function POST(request:Request){
 try{
  const user=await requirePermission("relatorios_cmv");
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  const bling_product_id=text(body.blingProductId);
  if(!bling_product_id)return NextResponse.json({error:"Informe o produto (blingProductId)."},{status:400});
  const row={
   bling_product_id,
   competitor_name:text(body.competitorName),
   marketplace:text(body.marketplace),
   title:text(body.title),
   brand:text(body.brand),
   model:text(body.model),
   price:numOrNull(body.price),
   shipping_cost:numOrNull(body.shippingCost),
   shipping_days:numOrNull(body.shippingDays),
   kit_components:text(body.kitComponents),
   photos_count:numOrNull(body.photosCount),
   rating:numOrNull(body.rating),
   rating_count:numOrNull(body.ratingCount),
   sales_count:numOrNull(body.salesCount),
   source_url:text(body.sourceUrl),
   notes:text(body.notes),
   captured_by:user.name,
  };
  const {error,data}=await getSupabase().from("competitor_listings").insert(row).select("id").single();
  if(error)throw new Error(error.message);
  await logAudit({user:user.name,action:"intelligence.competitor_capture",target:bling_product_id,detail:`${row.competitor_name||"concorrente"} · ${row.marketplace} · ${row.price!==null?`R$${row.price}`:"preço indisponível"}`});
  return NextResponse.json({ok:true,id:data.id},{status:201});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível salvar o concorrente."},{status:500})}
}
