import {getRuntimeBucket,getRuntimeDb} from "../db/runtime";
import {blingApi} from "./bling";
import {shopeeRequest} from "./shopee";
import {getAiKey} from "./ai-secret";
import {appendJobLog,setJobStatus,type PublishJob} from "./publish-jobs";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const list=(v:unknown)=>Array.isArray(v)?v:[];
const num=(v:unknown)=>Number(v)||0;
const text=(v:unknown)=>String(v??"").trim();

// Confirmado com dado ao vivo (ver app/api/marketplaces/bling/loja-link-test): existem 3
// registros "Shopee" no canais-venda do Bling, só este id realmente recebe pedidos —
// cruzado com o CNPJ do intermediador (35.635.824/0001-12 = SHPS Tecnologia = Shopee)
// de uma venda Shopee real. Nunca assumir outro loja.id "Shopee" sem essa checagem.
const SHOPEE_BLING_LOJA_ID="205386488";

export class Budget{spent=0;constructor(private cap:number){}get ok(){return this.spent<this.cap}use(){this.spent++}}

type Listing={
 id:number;sku:string;product_name:string;status:string;sale_price:number;shopee_price:number;cost:number;packaging_cost:number;extra_cost:number;
 shopee_title:string;title:string;shopee_description:string;description:string;weight:number;width:number;length:number;height:number;
 image_keys:string;brand:string;stock_quantity:number;shopee_category_id:string;shopee_logistic_id:string;bling_product_id:string;
 shopee_item_id:string;shopee_publish_status:string;shopee_error:string;shopee_bling_link_status:string;
};

async function getListing(id:number){
 return getRuntimeDb().prepare("SELECT * FROM listings WHERE id=?").bind(id).first<Listing>();
}
async function saveListingResult(id:number,fields:Record<string,unknown>){
 const sets=Object.keys(fields).map(k=>`${k}=?`).join(",");
 await getRuntimeDb().prepare(`UPDATE listings SET ${sets},updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(...Object.values(fields),id).run();
}

/** Confere o estado REAL do item na Shopee — nunca trata "a chamada não deu erro" como
 *  "está publicado" (item 8 do pedido). */
async function fetchRealShopeeStatus(itemId:string):Promise<string|null>{
 try{
  const result=await shopeeRequest("/api/v2/product/get_item_base_info",{query:{item_id_list:itemId}});
  const item=list(record(result.response).item_list).map(record)[0];
  return item?text(item.item_status):null;
 }catch{return null}
}

export type ShopeeSkuIndex=Map<string,{itemId:string;status:string}>;

/** Antes de publicar QUALQUER coisa, indexa por SKU todo o catálogo já existente na
 *  Shopee — não só o que a nossa própria fila já publicou. Sem isso, um produto cadastrado
 *  direto na Shopee (fora da intranet) seria duplicado, porque nosso listings.shopee_item_id
 *  ficaria vazio mesmo com o anúncio já ao vivo. Construído 1x por lote de processamento
 *  (não por job) e compartilha o mesmo orçamento de sub-requisições do lote inteiro. */
export async function buildShopeeSkuIndex(budget:Budget):Promise<ShopeeSkuIndex>{
 const index:ShopeeSkuIndex=new Map();
 const itemIds:string[]=[];
 let offset=0;
 while(budget.ok){
  budget.use();
  const result=await shopeeRequest("/api/v2/product/get_item_list",{query:{offset,page_size:100,item_status:"NORMAL"}}).catch(()=>null);
  if(!result)break;
  const resp=record(result.response),items=list(resp.item).map(record);
  for(const item of items){const id=text(item.item_id);if(id)itemIds.push(id)}
  if(!resp.has_next_page||!items.length)break;
  offset+=items.length;
 }
 for(let i=0;i<itemIds.length&&budget.ok;i+=50){
  budget.use();
  const batch=itemIds.slice(i,i+50);
  const result=await shopeeRequest("/api/v2/product/get_item_base_info",{query:{item_id_list:batch.join(",")}}).catch(()=>null);
  if(!result)continue;
  for(const item of list(record(result.response).item_list).map(record)){
   const sku=text(item.item_sku);
   if(sku)index.set(sku,{itemId:text(item.item_id),status:text(item.item_status)});
  }
 }
 return index;
}

type ShopeeFaixa={min:number;max:number;comissao:number;fixa:number};
type PricingConfig={margem:number;imposto:number;tacos:number;shopee_faixas:ShopeeFaixa[]};

async function getPricingConfig():Promise<PricingConfig|null>{
 const row=await getRuntimeDb().prepare("SELECT data FROM pricing_settings WHERE id=1").first<{data:string}>();
 if(!row)return null;
 try{
  const parsed=JSON.parse(row.data) as Partial<PricingConfig>;
  if(!Array.isArray(parsed.shopee_faixas)||!parsed.shopee_faixas.length)return null;
  return {margem:num(parsed.margem),imposto:num(parsed.imposto),tacos:num(parsed.tacos),shopee_faixas:parsed.shopee_faixas};
 }catch{return null}
}

/** Preço mínimo real pro canal Shopee — usa a MESMA calculadora da tela "Configuração de
 *  preços" (faixas reais de comissão + tarifa fixa da Shopee por faixa de preço, convergindo
 *  o preço), em vez de estimar por média histórica. Na Shopee o frete é por conta do
 *  comprador (confirmado pelo usuário) — cubagem/peso do produto não entra nessa conta;
 *  isso é diferente do Mercado Livre, onde o frete vem embutido no preço e depende do peso
 *  cobrado (peso real vs. peso cúbico) — a calculadora já trata os dois canais de formas
 *  distintas, e é ela que deve ser reaproveitada aqui, não uma tabela nova. */
async function computeMinPrice(fixedCost:number):Promise<{min:number|null;reason:string}>{
 if(fixedCost<=0)return {min:null,reason:"Custo do produto ausente."};
 const config=await getPricingConfig();
 if(!config)return {min:null,reason:'Faixas de comissão da Shopee não configuradas em "Configuração de preços".'};
 const {margem,imposto,tacos,shopee_faixas}=config;
 let price=fixedCost/(1-.14-imposto-tacos-margem);
 if(!Number.isFinite(price)||price<=0)return {min:null,reason:"Imposto + TACoS + margem-alvo somam 100% ou mais — não existe preço viável nesse canal hoje."};
 for(let i=0;i<30;i++){
  const band=shopee_faixas.find(f=>price>=f.min&&price<=f.max)||shopee_faixas[shopee_faixas.length-1];
  const denom=1-num(band.comissao)-imposto-tacos-margem;
  if(denom<=0)return {min:null,reason:"Comissão da faixa de preço + imposto + TACoS + margem-alvo somam 100% ou mais — não existe preço viável nesse canal hoje."};
  price=(fixedCost+num(band.fixa))/denom;
 }
 return {min:Math.ceil(price*100)/100,reason:""};
}

/** Busca no Bling os componentes de um kit (nome real de cada item) — usado só pra dar
 *  contexto real à geração de título/descrição, nunca pra inventar especificação. */
async function fetchKitComponentNames(blingProductId:string,budget:Budget):Promise<string[]>{
 if(!budget.ok)return [];
 budget.use();
 try{
  const full=record((await blingApi(`/produtos/${blingProductId}`)).data);
  const componentes=list(record(full.estrutura).componentes).map(record);
  const names:string[]=[];
  for(const comp of componentes){
   const compId=text(record(comp.produto).id);if(!compId||!budget.ok)continue;
   budget.use();
   try{const compData=record((await blingApi(`/produtos/${compId}`)).data);if(compData.nome)names.push(text(compData.nome))}catch{/* segue sem esse componente */}
  }
  return names;
 }catch{return []}
}

/** Resolve categoria e forma de envio da Shopee automaticamente usando os recursos
 *  OFICIAIS deles (category_recommend + get_channel_list) — item 3 do pedido: "validar
 *  categorias com os recursos oficiais", não pedir pro usuário escolher uma por uma no
 *  modo automático. Fica registrado no log do job (não é uma escolha silenciosa). */
async function resolveCategoryAndLogistic(itemName:string,jobId:number,budget:Budget):Promise<{categoryId:string;logisticId:string}|null>{
 if(!budget.ok)return null;
 try{
  budget.use();
  const recommendation=await shopeeRequest("/api/v2/product/category_recommend",{query:{item_name:itemName.slice(0,120)}}).catch(()=>null);
  const recResponse=record(recommendation?.response);
  // category_id vem como LISTA de ids recomendados (o mais relevante primeiro) — nunca
  // stringificar a lista inteira (viraria "102569,102574,102571" e a Shopee rejeitaria).
  let categoryId=text(list(recResponse.category_id)[0]??list(recResponse.category_list).map(record)[0]?.category_id);
  if(!categoryId){
   if(!budget.ok)return null;
   budget.use();
   const categories=await shopeeRequest("/api/v2/product/get_category",{query:{language:"pt-BR"}});
   const leaf=list(record(categories.response).category_list).map(record).find(c=>!c.has_children);
   categoryId=text(leaf?.category_id);
  }
  if(!categoryId)return null;

  if(!budget.ok)return null;
  budget.use();
  const logistics=await shopeeRequest("/api/v2/logistics/get_channel_list");
  const channel=list(record(logistics.response).logistics_channel_list).map(record).find(c=>c.enabled!==false);
  const logisticId=text(channel?.logistics_channel_id??channel?.logistic_id);
  if(!logisticId)return null;

  await appendJobLog(jobId,"resolvendo_categoria",`Categoria ${categoryId} e forma de envio ${logisticId} resolvidas automaticamente via recomendação oficial da Shopee (item_name: "${itemName}").`);
  return {categoryId,logisticId};
 }catch(error){await appendJobLog(jobId,"resolvendo_categoria",`Falha ao resolver categoria/envio: ${error instanceof Error?error.message:"erro desconhecido"}`);return null}
}

/** Gera título e descrição a partir só de dado real (nome do produto, marca, componentes
 *  do kit) — a IA nunca recebe permissão de inventar composição/benefício não evidenciado
 *  (item 2 do pedido). Sem IA configurada, retorna null e vira pendência normal. */
async function generateCopy(listing:Listing,componentNames:string[],jobId:number):Promise<{title:string;description:string}|null>{
 const apiKey=((globalThis as typeof globalThis&{__OPENAI_API_KEY__?:string}).__OPENAI_API_KEY__||"").trim()||await getAiKey().catch(()=>"");
 if(!apiKey){await appendJobLog(jobId,"gerando_texto","Sem chave de IA configurada — título/descrição ficam como pendência manual.");return null}
 const facts=[`Nome do produto: ${listing.product_name}`,listing.brand?`Marca: ${listing.brand}`:"",listing.sku?`SKU: ${listing.sku}`:"",componentNames.length?`Este produto é um KIT composto por: ${componentNames.join(", ")}.`:""].filter(Boolean).join("\n");
 const prompt=`Você escreve anúncios de e-commerce pra uma distribuidora de produtos automotivos (FG Auto Shop) que vende na Shopee.
Use SOMENTE os fatos abaixo. NUNCA invente composição química, diluição, certificação, compatibilidade de veículo ou benefício que não esteja explicitamente nos fatos — se não houver informação suficiente pra alguma seção, omita a seção em vez de inventar.

FATOS CONHECIDOS:
${facts}

Gere um título objetivo (até 120 caracteres, sem emojis) e uma descrição pronta pra Shopee (até 3000 caracteres) com seções em CAIXA ALTA quando aplicável (DESTAQUES, CONTEÚDO DO KIT — se for kit, listando os itens reais — e uma chamada final).`;
 try{
  const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"content-type":"application/json"},body:JSON.stringify({model:"gpt-5.6",reasoning:{effort:"low"},store:false,input:[{role:"user",content:[{type:"input_text",text:prompt}]}],text:{format:{type:"json_schema",name:"shopee_copy",strict:true,schema:{type:"object",additionalProperties:false,properties:{title:{type:"string"},description:{type:"string"}},required:["title","description"]}}},max_output_tokens:1500})});
  const raw=await response.text();let data:AnyRecord={};if(raw){try{data=JSON.parse(raw)}catch{data={}}}
  if(!response.ok)throw new Error(text(record(data.error).message)||`OpenAI recusou (erro ${response.status}).`);
  const outputText=text(data.output_text)||text(list(data.output).map(record).flatMap(x=>list(x.content).map(record)).find(x=>x.type==="output_text")?.text);
  if(!outputText)throw new Error("A IA não retornou texto.");
  const copy=JSON.parse(outputText) as {title:string;description:string};
  await appendJobLog(jobId,"gerando_texto",`Título e descrição gerados a partir de dado real (${componentNames.length?`${componentNames.length} componente(s) do kit`:"nome/marca do produto"}).`);
  return copy;
 }catch(error){await appendJobLog(jobId,"gerando_texto",`Falha ao gerar texto: ${error instanceof Error?error.message:"erro desconhecido"}`);return null}
}

/** Preço real do canal Shopee, lido do vínculo já registrado no Bling (/produtos/lojas,
 *  loja SHOPEE_BLING_LOJA_ID) — NUNCA usa listing.sale_price como substituto: esse campo
 *  vem do preço genérico do produto no Bling, que na prática é o preço praticado na loja
 *  física/PDV (confirmado pelo usuário ao vivo), não o preço do canal Shopee. Comparar a
 *  margem Shopee contra o preço da loja física gera pendência falsa ou, pior, pode gravar
 *  o preço errado no vínculo do Bling. */
async function resolveShopeePrice(blingProductId:string,budget:Budget):Promise<number|null>{
 if(!blingProductId||!budget.ok)return null;
 budget.use();
 try{
  const rows=list((await blingApi(`/produtos/lojas?idProduto=${blingProductId}`)).data).map(record);
  const match=rows.find(r=>text(record(r.loja).id)===SHOPEE_BLING_LOJA_ID);
  const price=num(match?.preco);
  return price>0?price:null;
 }catch{return null}
}

/** Valida os dados obrigatórios sem inventar nada (item 2/3/5 do pedido) — cada item da
 *  lista é uma pendência específica, nunca um "erro genérico". */
/** Custo real do cadastro do Bling (precoCusto do produto ou do fornecedor) — usado quando o
 *  anúncio foi criado sem custo, pra não travar o cálculo de preço/margem por um campo que o
 *  Bling já tem. */
async function resolveBlingCost(blingProductId:string,budget:Budget):Promise<number>{
 if(!blingProductId||!budget.ok)return 0;
 budget.use();
 try{
  const detail=record((await blingApi(`/produtos/${blingProductId}`)).data);
  return num(detail.precoCusto)||num(record(detail.fornecedor).precoCusto);
 }catch{return 0}
}

async function validateListing(listing:Listing):Promise<string[]>{
 const missing:string[]=[];
 const title=listing.shopee_title||listing.title;
 const description=listing.shopee_description||listing.description;
 const price=listing.shopee_price;
 const images=(()=>{try{return JSON.parse(listing.image_keys||"[]")}catch{return []}})() as string[];
 if(!title)missing.push("título (Shopee ou geral)");
 if(!description)missing.push("descrição (Shopee ou geral)");
 if(!listing.sku)missing.push("SKU");
 if(!listing.brand)missing.push('marca (use "Sem marca" se o produto realmente não tiver)');
 if(!price)missing.push('preço do canal Shopee (não cadastrado — nunca uso o preço da loja física/PDV como substituto; cadastre o vínculo com preço no Bling ou defina o preço da Shopee no anúncio)');
 if(!listing.weight)missing.push("peso");
 if(!listing.width||!listing.length||!listing.height)missing.push("dimensões da embalagem de envio");
 if(!images.length)missing.push("pelo menos 1 imagem");
 if(!listing.shopee_category_id)missing.push("categoria Shopee (selecione e salve antes de rodar o agente)");
 if(!listing.shopee_logistic_id)missing.push("forma de envio Shopee (selecione e salve antes de rodar o agente)");
 if(!listing.bling_product_id)missing.push("vínculo com o produto do Bling (bling_product_id ausente neste anúncio)");
 if(price){
  const cost=num(listing.cost)+num(listing.packaging_cost)+num(listing.extra_cost);
  if(cost>0){
   const {min,reason}=await computeMinPrice(cost);
   if(min===null)missing.push(`margem: ${reason}`);
   else if(price<min)missing.push(`preço R$${price.toFixed(2)} abaixo do mínimo calculado R$${min.toFixed(2)} (custo+embalagem ÷ margem configurada)`);
  }else{
   missing.push("custo do produto (necessário pra calcular a margem mínima)");
  }
 }
 return missing;
}

async function uploadImages(imageKeys:string[],budget:Budget):Promise<string[]>{
 const bucket=getRuntimeBucket(),ids:string[]=[];
 for(const key of imageKeys.slice(0,8)){
  if(!budget.ok)break;
  budget.use();
  const object=await bucket.get(key);if(!object)continue;
  const bytes=await object.arrayBuffer(),form=new FormData(),type=object.httpMetadata?.contentType||"image/jpeg";
  form.append("image",new File([bytes],key,{type}));
  const uploaded=await shopeeRequest("/api/v2/media_space/upload_image",{method:"POST",body:form});
  const imageId=text(record(record(uploaded.response).image_info).image_id||record(uploaded.response).image_id);
  if(imageId)ids.push(imageId);
 }
 return ids;
}

/** Cria (se preciso) e confirma o vínculo produto↔loja no Bling — /produtos/lojas aceita
 *  POST (confirmado ao vivo), mas só marca sucesso depois de reler e achar a linha (item
 *  12 do pedido: nunca considerar só o sucesso da requisição). */
async function linkToBling(jobId:number,listing:Listing,itemId:string,price:number):Promise<{ok:boolean;error?:string}>{
 try{
  const existing=await blingApi(`/produtos/lojas?idProduto=${listing.bling_product_id}`);
  const already=list(existing.data).map(record).find(row=>text(record(row.loja).id)===SHOPEE_BLING_LOJA_ID);
  if(already&&text(already.codigo)===itemId){
   await appendJobLog(jobId,"vinculo_bling","Vínculo já existia no Bling e bate com o item publicado — nada a fazer.");
   return {ok:true};
  }
  await blingApi("/produtos/lojas",{method:"POST",body:JSON.stringify({
   produto:{id:Number(listing.bling_product_id)},loja:{id:Number(SHOPEE_BLING_LOJA_ID)},codigo:itemId,preco:price,precoPromocional:price,
  })});
  const confirm=await blingApi(`/produtos/lojas?idProduto=${listing.bling_product_id}`);
  const linked=list(confirm.data).map(record).find(row=>text(record(row.loja).id)===SHOPEE_BLING_LOJA_ID&&text(row.codigo)===itemId);
  if(!linked)return {ok:false,error:"O Bling aceitou a requisição, mas o vínculo não aparece ao reconsultar /produtos/lojas — não confirmado."};
  await appendJobLog(jobId,"vinculo_bling",`Vínculo confirmado no Bling (loja ${SHOPEE_BLING_LOJA_ID}, código ${itemId}).`);
  return {ok:true};
 }catch(error){return {ok:false,error:error instanceof Error?error.message:"Falha desconhecida ao vincular no Bling."}}
}

/** Núcleo do agente — chamado tanto pela rota manual quanto pelo cron (worker/index.ts).
 *  Processa UM job por vez; idempotente (sempre confere estado real antes de agir de novo,
 *  então rodar duas vezes sobre o mesmo job nunca duplica nada — item 8 do pedido).
 *  `skuIndex` é o catálogo Shopee inteiro indexado por SKU (ver buildShopeeSkuIndex) —
 *  pega até anúncio criado fora da intranet, não só o que a própria fila publicou. */
export async function processPublishJob(job:PublishJob,skuIndex:ShopeeSkuIndex){
 if(job.channel!=="shopee")return;
 if(!["queued","link_pending"].includes(job.status))return;

 let listing=await getListing(job.listing_id);
 if(!listing){await setJobStatus(job.id,"failed",{error:"Anúncio não encontrado (pode ter sido excluído)."});return}

 // Retomar SÓ a etapa de vínculo, sem publicar de novo.
 if(job.status==="link_pending"){
  await setJobStatus(job.id,"processing",{step:"vinculo_bling"});
  const price=listing.shopee_price||await resolveShopeePrice(listing.bling_product_id,new Budget(1))||0;
  if(!price){await setJobStatus(job.id,"link_pending",{error:"Sem preço do canal Shopee (nem no anúncio, nem no vínculo do Bling) — não crio o vínculo sem preço real."});return}
  const linked=await linkToBling(job.id,listing,listing.shopee_item_id,price);
  if(linked.ok){await setJobStatus(job.id,"published",{error:""})}
  else{await setJobStatus(job.id,"link_pending",{error:linked.error||"Vínculo não confirmado."})}
  return;
 }

 await setJobStatus(job.id,"processing",{step:"conferindo_duplicidade"});

 // Dedup real, em duas camadas: (1) o que a PRÓPRIA fila já publicou antes (shopee_item_id
 // salvo), confirmando o status ao vivo; (2) o catálogo INTEIRO da Shopee por SKU, pro
 // caso de o anúncio já existir por fora da intranet (ex.: cadastrado direto no painel da
 // Shopee) — sem isso, duplicaria um anúncio que o dono nem sabia que o agente não via.
 const bySkuMatch=listing.sku?skuIndex.get(listing.sku):undefined;
 if(listing.shopee_item_id){
  const realStatus=await fetchRealShopeeStatus(listing.shopee_item_id);
  if(realStatus){
   await appendJobLog(job.id,"conferindo_duplicidade",`Já existe item ${listing.shopee_item_id} na Shopee com status real "${realStatus}" — não republica.`);
   const dedupPrice=listing.shopee_price||await resolveShopeePrice(listing.bling_product_id,new Budget(1))||0;
   if(!dedupPrice){await setJobStatus(job.id,"link_pending",{external_item_id:listing.shopee_item_id,error:"Item já existe na Shopee, mas não há preço do canal Shopee cadastrado (nem no anúncio, nem no vínculo do Bling) pra confirmar o vínculo."});return}
   const linked=await linkToBling(job.id,listing,listing.shopee_item_id,dedupPrice);
   await setJobStatus(job.id,linked.ok?"published":"link_pending",{external_item_id:listing.shopee_item_id,error:linked.ok?"":(linked.error||"")});
   return;
  }
  await appendJobLog(job.id,"conferindo_duplicidade","Item salvo localmente não foi confirmado na Shopee (excluído lá?) — segue conferindo por SKU antes de decidir.");
 }
 if(bySkuMatch){
  await appendJobLog(job.id,"conferindo_duplicidade",`SKU "${listing.sku}" já existe no catálogo Shopee como item ${bySkuMatch.itemId} (status "${bySkuMatch.status}") — provavelmente cadastrado fora da intranet. Não publicando de novo; só ajustando o vínculo com o Bling.`);
  await saveListingResult(listing.id,{status:"publicado",shopee_item_id:bySkuMatch.itemId,shopee_publish_status:bySkuMatch.status,shopee_error:""});
  const skuMatchPrice=listing.shopee_price||await resolveShopeePrice(listing.bling_product_id,new Budget(1))||0;
  if(!skuMatchPrice){await setJobStatus(job.id,"link_pending",{external_item_id:bySkuMatch.itemId,error:"Item já existe na Shopee, mas não há preço do canal Shopee cadastrado (nem no anúncio, nem no vínculo do Bling) pra confirmar o vínculo."});return}
  const linked=await linkToBling(job.id,listing,bySkuMatch.itemId,skuMatchPrice);
  await setJobStatus(job.id,linked.ok?"published":"link_pending",{external_item_id:bySkuMatch.itemId,error:linked.ok?"":(linked.error||"")});
  return;
 }

 // Completa automaticamente o que dá pra resolver com recurso oficial/dado real — o usuário
 // não deve escolher categoria nem escrever título/descrição um por um (correção direta do
 // pedido do usuário: "Título e descrição isso não é pra mim fazer" / "categoria... se for
 // pra mim ir atrás não compensa"). Só vira pendência manual o que realmente não dá pra
 // resolver sem inventar (ex.: sem chave de IA, ou a Shopee não recomendou categoria).
 await setJobStatus(job.id,"processing",{step:"completando_dados"});
 const resolveBudget=new Budget(15);
 const resolvedFields:Record<string,unknown>={};
 if(!num(listing.cost)){
  const blingCost=await resolveBlingCost(listing.bling_product_id,resolveBudget);
  if(blingCost>0){
   resolvedFields.cost=blingCost;
   listing={...listing,cost:blingCost};
   await appendJobLog(job.id,"resolvendo_custo",`Anúncio sem custo — lido do cadastro do Bling: R$${blingCost.toFixed(2)}.`);
  }
 }
 if(!listing.shopee_price){
  const realPrice=await resolveShopeePrice(listing.bling_product_id,resolveBudget);
  if(realPrice){
   resolvedFields.shopee_price=realPrice;
   await appendJobLog(job.id,"resolvendo_preco",`Preço do canal Shopee lido do vínculo já registrado no Bling: R$${realPrice.toFixed(2)}.`);
  }else{
   // Sem vínculo com preço no Bling: calcula pelo custo real (nunca pelo preço da loja física)
   // com a mesma calculadora da "Configuração de preços" — o preço que cumpre a margem-alvo.
   const cost=num(listing.cost)+num(listing.packaging_cost)+num(listing.extra_cost);
   const {min,reason}=await computeMinPrice(cost);
   if(min){
    resolvedFields.shopee_price=min;
    await appendJobLog(job.id,"resolvendo_preco",`Sem preço Shopee no Bling — calculado pelo custo (R$${cost.toFixed(2)}) na calculadora de Configuração de preços, margem-alvo: R$${min.toFixed(2)}. Revise antes de publicar.`);
   }else{
    await appendJobLog(job.id,"resolvendo_preco",`Sem preço Shopee no Bling e não foi possível calcular: ${reason}`);
   }
  }
 }
 if(!listing.shopee_category_id||!listing.shopee_logistic_id){
  const resolved=await resolveCategoryAndLogistic(listing.product_name,job.id,resolveBudget);
  if(resolved){
   if(!listing.shopee_category_id)resolvedFields.shopee_category_id=resolved.categoryId;
   if(!listing.shopee_logistic_id)resolvedFields.shopee_logistic_id=resolved.logisticId;
  }
 }
 const missingTitle=!(listing.shopee_title||listing.title),missingDescription=!(listing.shopee_description||listing.description);
 if(missingTitle||missingDescription){
  const componentNames=listing.bling_product_id?await fetchKitComponentNames(listing.bling_product_id,resolveBudget):[];
  const copy=await generateCopy(listing,componentNames,job.id);
  if(copy){
   if(missingTitle)resolvedFields.shopee_title=copy.title;
   if(missingDescription)resolvedFields.shopee_description=copy.description;
  }
 }
 if(Object.keys(resolvedFields).length){
  await saveListingResult(listing.id,resolvedFields);
  listing={...listing,...resolvedFields};
 }

 await setJobStatus(job.id,"processing",{step:"validando_dados"});
 const missing=await validateListing(listing);
 if(missing.length){
  await appendJobLog(job.id,"validando_dados",`Pendências: ${missing.join(" | ")}`);
  await setJobStatus(job.id,"needs_review",{missing:JSON.stringify(missing)});
  return;
 }

 if(job.mode==="prepare"){
  await appendJobLog(job.id,"validando_dados","Todos os dados obrigatórios presentes — pronto para publicar (modo preparar, não publica sozinho).");
  await setJobStatus(job.id,"ready_for_review",{missing:"[]"});
  return;
 }

 // mode === "auto" a partir daqui
 try{
  const budget=new Budget(30);
  await setJobStatus(job.id,"processing",{step:"enviando_imagens"});
  const images=JSON.parse(listing.image_keys||"[]") as string[];
  const imageIds=await uploadImages(images,budget);
  if(!imageIds.length)throw new Error("A Shopee não aceitou nenhuma das imagens.");

  await setJobStatus(job.id,"processing",{step:"publicando"});
  const price=listing.shopee_price,stock=Math.max(1,Math.floor(listing.stock_quantity||1));
  const payload={
   item_name:(listing.shopee_title||listing.title).slice(0,120),
   description:(listing.shopee_description||listing.description).slice(0,3000),
   item_sku:listing.sku.slice(0,100),
   category_id:Number(listing.shopee_category_id),
   brand:{brand_id:0,original_brand_name:listing.brand||"Sem marca"},
   original_price:price,normal_stock:stock,seller_stock:[{stock}],
   weight:listing.weight,
   dimension:{package_length:listing.length,package_width:listing.width,package_height:listing.height},
   logistic_info:[{logistic_id:Number(listing.shopee_logistic_id),enabled:true}],
   image:{image_id_list:imageIds},item_status:"NORMAL",condition:"NEW",
  };
  const created=await shopeeRequest("/api/v2/product/add_item",{method:"POST",body:JSON.stringify(payload)});
  const itemId=text(record(created.response).item_id);
  if(!itemId)throw new Error("A Shopee não retornou o código do produto publicado.");

  await setJobStatus(job.id,"processing",{step:"confirmando_status_real"});
  const realStatus=await fetchRealShopeeStatus(itemId);
  if(!realStatus)throw new Error(`Item ${itemId} foi criado mas não foi possível confirmar o status real dele na Shopee — não marcando como publicado.`);
  await appendJobLog(job.id,"confirmando_status_real",`Status real confirmado na Shopee: ${realStatus}.`);

  await saveListingResult(listing.id,{status:"publicado",shopee_item_id:itemId,shopee_publish_status:realStatus,shopee_error:""});

  await setJobStatus(job.id,"processing",{step:"vinculo_bling",external_item_id:itemId,price_used:price});
  const linked=await linkToBling(job.id,listing,itemId,price);
  if(linked.ok){
   await saveListingResult(listing.id,{shopee_bling_link_status:"vinculado"});
   await setJobStatus(job.id,"published",{external_item_id:itemId,error:""});
  }else{
   await saveListingResult(listing.id,{shopee_bling_link_status:"pendente"});
   await setJobStatus(job.id,"link_pending",{external_item_id:itemId,error:linked.error||"Vínculo com o Bling não confirmado."});
  }
 }catch(error){
  const message=error instanceof Error?error.message:"Falha desconhecida ao publicar.";
  await appendJobLog(job.id,"erro",message);
  await setJobStatus(job.id,"failed",{error:message});
 }
}

/** Processa até `limit` jobs pendentes numa invocação — usado pelo cron e pelo botão
 *  manual "Executar agente". Um job por vez, sequencial (não paralelo), pra não estourar
 *  o teto de sub-requisições do Worker. O índice de SKU da Shopee é montado 1x e
 *  compartilhado entre todos os jobs do lote (custa ~9 chamadas pra 262 itens — caro
 *  demais pra repetir por job). Limit reduzido pra 2 porque o índice já consome boa
 *  parte do orçamento de sub-requisições da invocação. */
export async function processPendingPublishJobs(limit=2){
 const db=getRuntimeDb();
 const rows=await db.prepare("SELECT * FROM publish_jobs WHERE status IN ('queued','link_pending') ORDER BY id ASC LIMIT ?").bind(limit).all<PublishJob>();
 const jobs=rows.results||[];
 if(!jobs.length)return 0;
 const needsIndex=jobs.some(j=>j.status==="queued");
 const skuIndex=needsIndex?await buildShopeeSkuIndex(new Budget(20)):new Map();
 let processed=0;
 for(const job of jobs){
  await processPublishJob(job,skuIndex);
  processed++;
 }
 return processed;
}
