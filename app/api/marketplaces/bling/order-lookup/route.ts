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
  const url=new URL(request.url);
  const numero=text(url.searchParams.get("numero"));
  const directSaleId=text(url.searchParams.get("saleId"));
  if(!numero&&!directSaleId)return NextResponse.json({error:"Informe o número do pedido ou o saleId."},{status:400});

  let saleId=directSaleId,found:AnyRecord={};
  if(!saleId){
   let page=1;
   while(page<=10){
    const result=await blingApi(`/pedidos/vendas?pagina=${page}&limite=100&numero=${numero}`);
    const batch=list(result.data).map(record);
    const match=batch.find(o=>text(o.numero)===numero)||null;
    if(match){found=match;break}
    if(batch.length<100)break;
    page++;
   }
   if(!found.id)return NextResponse.json({error:`Pedido nº ${numero} não encontrado no Bling.`},{status:404});
   saleId=text(found.id);
  }
  const items=await syncSingleSale(saleId,found);

  // Campos candidatos a taxa/frete/comissão de marketplace — investigação pontual
  // (não gravados no CMV ainda). Devolve crus pra conferir o que o Bling realmente
  // preenche neste pedido, já que a interface TS de terceiros nem sempre bate com
  // o dado real da conta (mesmo problema já visto com loja/vendedor e marca/categoria).
  const detail=record((await blingApi(`/pedidos/vendas/${saleId}`)).data);
  const fees={
   situacao:detail.situacao??null,
   transporte:detail.transporte??null,
   outrasDespesas:detail.outrasDespesas??null,
   desconto:detail.desconto??null,
   intermediador:detail.intermediador??null,
   taxas:detail.taxas??null,
   loja:detail.loja??null,
   numeroLoja:detail.numeroLoja??null,
   numeroPedidoCompra:detail.numeroPedidoCompra??null,
   itensComissao:list(detail.itens).map(record).map(i=>({descricao:text(i.descricao),comissao:i.comissao??null})),
  };

  return NextResponse.json({ok:true,saleId,numero,items,fees});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível consultar o pedido."},{status:500})}
}
