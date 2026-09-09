import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../lib/auth";
import {blingApi} from "../../../../../lib/bling";
import {syncSingleSale} from "../cmv/route";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const list=(v:unknown)=>Array.isArray(v)?v:[];
const text=(v:unknown)=>String(v??"").trim();

/** Acha um pedido pelo número (o que aparece no Bling, ex. 10009) — a lista de vendas só
 *  filtra por ID interno por padrão, então isso busca a página certa e confere o campo
 *  "numero" de cada resultado. Depois sincroniza esse pedido específico (upsert, idempotente)
 *  pra garantir que o CMV esteja com o dado mais recente antes de qualquer análise. */
export async function GET(request:Request){
 try{
  await requirePermission("relatorios_cmv");
  const numero=text(new URL(request.url).searchParams.get("numero"));
  if(!numero)return NextResponse.json({error:"Informe o número do pedido."},{status:400});

  let page=1,found:AnyRecord|null=null;
  while(page<=10&&!found){
   const result=await blingApi(`/pedidos/vendas?pagina=${page}&limite=100&numero=${numero}`);
   const batch=list(result.data).map(record);
   found=batch.find(o=>text(o.numero)===numero)||null;
   if(batch.length<100)break;
   page++;
  }
  if(!found)return NextResponse.json({error:`Pedido nº ${numero} não encontrado no Bling.`},{status:404});

  const saleId=text(found.id);
  const items=await syncSingleSale(saleId,found);
  return NextResponse.json({ok:true,saleId,numero,items});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível consultar o pedido."},{status:500})}
}
