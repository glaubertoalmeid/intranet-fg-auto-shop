import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../lib/auth";
import {logAudit} from "../../../../../lib/audit";
import {getSupabase} from "../../../../../lib/supabase";

const num=(v:unknown)=>Number(v)||0;
const text=(v:unknown)=>String(v??"").trim();

/** Parâmetros de margem de contribuição por canal — "imposto" não existe em nenhum campo
 *  do Bling nem das APIs de marketplace (confirmado testando pedidos reais), então é o
 *  usuário quem define a alíquota aqui; o cálculo do item usa esse % sobre o faturamento. */
export async function GET(){
 try{
  await requirePermission("relatorios_cmv");
  const {data,error}=await getSupabase().from("cmv_margin_config").select("*").order("channel");
  if(error)throw new Error(error.message);
  return NextResponse.json({configs:data||[]});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível carregar a configuração."},{status:500})}
}

export async function PUT(request:Request){
 try{
  const user=await requirePermission("relatorios_cmv");
  const body=await request.json().catch(()=>({})) as {channel?:string;taxRate?:number;marginMin?:number;marginIdeal?:number;active?:boolean};
  const channel=text(body.channel);
  if(!channel)return NextResponse.json({error:"Informe o canal."},{status:400});
  const row={channel,tax_rate:num(body.taxRate),margin_min:num(body.marginMin),margin_ideal:num(body.marginIdeal),active:body.active!==false,updated_by:user.name,updated_at:new Date().toISOString()};
  const {error}=await getSupabase().from("cmv_margin_config").upsert(row,{onConflict:"channel"});
  if(error)throw new Error(error.message);
  await logAudit({user:user.name,action:"cmv.margin_config_save",target:channel,detail:`imposto ${row.tax_rate}% · mínima ${row.margin_min}% · ideal ${row.margin_ideal}%`});
  return NextResponse.json({ok:true});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível salvar."},{status:500})}
}

export async function DELETE(request:Request){
 try{
  const user=await requirePermission("relatorios_cmv");
  const channel=text(new URL(request.url).searchParams.get("channel"));
  if(!channel)return NextResponse.json({error:"Informe o canal."},{status:400});
  const {error}=await getSupabase().from("cmv_margin_config").delete().eq("channel",channel);
  if(error)throw new Error(error.message);
  await logAudit({user:user.name,action:"cmv.margin_config_delete",target:channel});
  return NextResponse.json({ok:true});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível remover."},{status:500})}
}
