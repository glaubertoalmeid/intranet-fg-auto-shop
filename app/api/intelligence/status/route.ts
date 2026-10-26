import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {getRuntimeDb} from "../../../../db/runtime";
import {fetchAllRows,getSupabase} from "../../../../lib/supabase";

/** Etapa 2 do módulo de Inteligência Comercial — "base unificada, com data da última
 *  atualização e aviso quando faltarem dados". Não junta os dados aqui (isso já acontece
 *  em cmv_sales/products); só reporta o que está completo, o que falta e há quanto tempo
 *  cada fonte foi sincronizada pela última vez, pra equipe saber se pode confiar no número. */
export async function GET(){
 try{
  await requirePermission("relatorios_cmv");
  const supabase=getSupabase();

  const [salesRows,marginConfigs,settingsRows,productsRows] = await Promise.all([
   fetchAllRows<{channel:string;cost_estimated:boolean;cancelled:boolean;commission:number;status_checked:boolean;product_id:string}>((from_,to_)=>
    supabase.from("cmv_sales").select("channel,cost_estimated,cancelled,commission,status_checked,product_id").gte("sale_date",new Date(Date.now()-31*86400000).toISOString().slice(0,10)).range(from_,to_)
   ),
   supabase.from("cmv_margin_config").select("channel,active").then(r=>r.data||[]),
   supabase.from("product_settings").select("bling_product_id").then(r=>r.data||[]),
   supabase.from("products").select("bling_product_id,cost",{count:"exact",head:false}).eq("status","ativo").then(r=>r.data||[]),
  ]);

  const activeSales=salesRows.filter(r=>!r.cancelled);
  const channelsInPeriod=[...new Set(activeSales.map(r=>r.channel).filter(Boolean))];
  const channelsWithMargin=new Set(marginConfigs.filter(m=>m.active).map(m=>m.channel));
  const channelsMissingMargin=channelsInPeriod.filter(c=>!channelsWithMargin.has(c)&&!channelsWithMargin.has("geral"));

  const shopeePending=activeSales.filter(r=>/shopee/i.test(r.channel)&&r.commission===0).length;
  const mlUnchecked=activeSales.filter(r=>/mercado/i.test(r.channel)&&!r.status_checked).length;
  const costEstimated=activeSales.filter(r=>r.cost_estimated).length;

  const productsWithSettings=new Set(settingsRows.map(s=>s.bling_product_id));
  const activeProducts=productsRows.length;
  const productsMissingPackaging=activeProducts?activeProducts-productsRows.filter(p=>productsWithSettings.has(p.bling_product_id)).length:0;
  const productsMissingCost=productsRows.filter(p=>!Number(p.cost)).length;

  // Últimas execuções por fonte, direto do log de auditoria (inclui as automáticas do cron).
  const auditDb=getRuntimeDb();
  const lastRun=async(action:string)=>{
   const row=await auditDb.prepare("SELECT created_at,detail FROM audit_log WHERE action=? ORDER BY id DESC LIMIT 1").bind(action).first<{created_at:string;detail:string}>();
   return row?{at:row.created_at,detail:row.detail}:null;
  };
  const [blingSync,shopeeFees,mlStatus]=await Promise.all([lastRun("cmv.sync"),lastRun("cmv.shopee_fees_sync"),lastRun("cmv.ml_status_check")]);

  return NextResponse.json({
   generatedAt:new Date().toISOString(),
   period:"últimos 31 dias",
   lastSync:{blingSync,shopeeFees,mlStatus},
   warnings:{
    channelsMissingMarginConfig:channelsMissingMargin,
    shopeeOrdersPendingFee:shopeePending,
    mlOrdersUnverifiedStatus:mlUnchecked,
    salesWithEstimatedCost:costEstimated,
    activeProductsMissingCost:productsMissingCost,
    activeProductsMissingPackagingConfig:productsMissingPackaging,
   },
   totals:{activeSalesInPeriod:activeSales.length,activeProducts},
  });
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível gerar o status da base unificada."},{status:500})}
}
