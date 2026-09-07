import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {blingApi} from "../../../../lib/bling";
import {logAudit} from "../../../../lib/audit";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const list=(v:unknown)=>Array.isArray(v)?v:[];
const text=(v:unknown)=>String(v??"").trim();

// Mesmo cuidado do sync de CMV: toda chamada ao Bling soma pro teto de sub-requisições
// do Worker (50 no plano gratuito da Cloudflare).
const SUBREQUEST_BUDGET=38;

/** Lançamento de "Balanço" (operacao:"B") registra a quantidade informada como o saldo
 *  final do produto naquele depósito — é a forma correta de corrigir estoque (contagem),
 *  diferente de "Entrada"/"Saída" que somam ou subtraem. */
async function findDefaultDeposit(){
 const result=await blingApi("/depositos?pagina=1&limite=100");
 const rows=list(result.data).map(record);
 const deposit=rows.find(r=>r.padrao===true)||rows[0];
 if(!deposit)throw new Error("Nenhum depósito encontrado no Bling.");
 return text(deposit.id);
}

/** Ajusta o saldo de estoque de vários produtos no Bling de uma vez — usado pra corrigir
 *  no Bling (a fonte de verdade) o mesmo ajuste já feito no espelho do Supabase, já que
 *  o Bling sobrescreve o Supabase a cada sincronização. Master-only por ser uma escrita
 *  em massa no ERP real. */
export async function POST(request:Request){
 try{
  const user=await requirePermission("produtos");
  if(user.role!=="master")return NextResponse.json({error:"Só o usuário Master pode ajustar estoque no Bling."},{status:403});

  const body=await request.json().catch(()=>({})) as {items?:{blingProductId:string;quantity:number}[];observacoes?:string};
  const items=Array.isArray(body.items)?body.items:[];
  if(!items.length)return NextResponse.json({error:"Informe ao menos um produto para ajustar."},{status:400});
  const observacoes=text(body.observacoes)||"Ajuste automático — estoque negativo corrigido";

  let spent=0;
  const depositId=await findDefaultDeposit();spent++;

  const adjusted:string[]=[],failed:{blingProductId:string;error:string}[]=[];
  for(const item of items){
   if(spent>=SUBREQUEST_BUDGET)break;
   const blingProductId=text(item.blingProductId);if(!blingProductId)continue;
   spent++;
   try{
    await blingApi("/estoques",{method:"POST",body:JSON.stringify({
     produto:{id:Number(blingProductId)},deposito:{id:Number(depositId)},operacao:"B",
     quantidade:Number(item.quantity)||0,observacoes,
    })});
    adjusted.push(blingProductId);
   }catch(error){
    failed.push({blingProductId,error:error instanceof Error?error.message:"erro desconhecido"});
   }
  }

  const remaining=items.length-adjusted.length-failed.length;
  await logAudit({user:user.name,action:"products.adjust_bling_stock",detail:`${adjusted.length} ajustado(s)${failed.length?` · falhou: ${failed.map(f=>`${f.blingProductId} (${f.error})`).join(", ")}`:""}${remaining>0?` · ${remaining} restando`:""}`});
  return NextResponse.json({ok:true,adjusted:adjusted.length,failed,truncated:remaining>0,remaining});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível ajustar o estoque no Bling."},{status:500})}
}
