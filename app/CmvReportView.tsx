"use client";
import {ClipboardEvent,FormEvent,useEffect,useState} from "react";

type Status={configured:boolean;connected:boolean;clientId:string;companyId:string;lastError:string;callbackUrl:string;webhookUrl:string};
type Product={product_id:string;sku:string;product_name:string;quantity:number;revenue:number;cmv:number;profit:number;margin:number;markup:number;costEstimated:boolean};
type Item={sale_id:string;item_id:string;channel_order_ref:string;sale_date:string;channel:string;product_name:string;sku:string;quantity:number;revenue:number;cost:number;commission:number;freight:number;discount:number;tax:number;netPayout:number;result:number;margin:number;marginStatus:"critical"|"warning"|"good";feesPending:boolean};
type OrdersTotals={revenue:number;commission:number;freight_cost:number;other_fees:number;tax:number;netPayout:number;result:number;orderCount:number;ticketMedio:number;margin:number};
type Filters={channels:string[];brands:string[];categories:string[];sellers:string[]};
type Report={products:Product[];items:Item[];totals:{revenue:number;cmv:number;profit:number;margin:number};ordersTotals:OrdersTotals;filters:Filters};
type MarginConfig={channel:string;tax_rate:number;margin_min:number;margin_ideal:number;active:boolean};
const money=(v:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v);
const pct=(v:number)=>`${(v||0).toFixed(1).replace(".",",")}%`;

// Ícone ilustrativo por canal — cor+sigla em vez da logo real de cada marketplace
// (mais simples de manter e sem depender de asset de terceiros).
function channelBadge(channel:string){
 const c=(channel||"").toLowerCase();
 if(c.includes("shopee"))return {bg:"#ee4d2d",fg:"#fff",icon:"🛍",label:"Shopee"};
 if(c.includes("mercado"))return {bg:"#fff159",fg:"#2d3277",icon:"Ⓜ",label:"Mercado Livre"};
 if(c.includes("loja")||c.includes("pdv"))return {bg:"#0d213b",fg:"#fff",icon:"🏬",label:channel||"Loja física"};
 return {bg:"#8290a3",fg:"#fff",icon:"•",label:channel||"—"};
}
function ChannelTag({channel}:{channel:string}){
 const b=channelBadge(channel);
 return <span className="channel-tag"><span className="channel-tag-icon" style={{background:b.bg,color:b.fg}}>{b.icon}</span>{b.label}</span>;
}

export default function CmvReportView({isMaster}:{isMaster:boolean}){
 const today=new Date().toISOString().slice(0,10),monthAgo=new Date(Date.now()-31*86400000).toISOString().slice(0,10);
 const [status,setStatus]=useState<Status|null>(null),[settings,setSettings]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[report,setReport]=useState<Report|null>(null);
 const [from,setFrom]=useState(monthAgo),[to,setTo]=useState(today),[channel,setChannel]=useState(""),[brand,setBrand]=useState(""),[category,setCategory]=useState(""),[seller,setSeller]=useState(""),[product,setProduct]=useState(""),[orderRef,setOrderRef]=useState("");
 const [view,setView]=useState<"produtos"|"pedidos">("pedidos");
 const [margins,setMargins]=useState<MarginConfig[]>([]),[marginsOpen,setMarginsOpen]=useState(false),[marginBusy,setMarginBusy]=useState(false),[marginError,setMarginError]=useState("");

 async function loadStatus(){const s=await fetch("/api/marketplaces/bling/settings");if(s.ok)setStatus(await s.json())}
 async function loadReport(overrides:Partial<{channel:string;brand:string;category:string;seller:string;product:string;orderRef:string}>={}){
  const merged={channel,brand,category,seller,product,orderRef,...overrides};
  const params=new URLSearchParams({from,to});
  if(merged.channel)params.set("channel",merged.channel);
  if(merged.brand)params.set("brand",merged.brand);
  if(merged.category)params.set("category",merged.category);
  if(merged.seller)params.set("seller",merged.seller);
  if(merged.product)params.set("product",merged.product);
  if(merged.orderRef)params.set("orderRef",merged.orderRef);
  const r=await fetch(`/api/marketplaces/bling/cmv?${params}`);if(r.ok)setReport(await r.json());
 }
 async function loadMargins(){const r=await fetch("/api/marketplaces/bling/cmv-margin-config");if(r.ok)setMargins((await r.json()).configs||[])}
 useEffect(()=>{loadStatus();loadReport();loadMargins()},[]); // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{loadReport()},[channel,brand,category,seller]); // eslint-disable-line react-hooks/exhaustive-deps

 // "Colar rápido": cola um número de pedido ou SKU no campo e a busca já dispara,
 // sem precisar sair do campo (Tab/blur) pra aplicar o filtro.
 function pasteOrderRef(e:ClipboardEvent<HTMLInputElement>){const v=e.clipboardData.getData("text").trim();e.preventDefault();setOrderRef(v);loadReport({orderRef:v})}
 function pasteProduct(e:ClipboardEvent<HTMLInputElement>){const v=e.clipboardData.getData("text").trim();e.preventDefault();setProduct(v);loadReport({product:v})}

 async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError("");const f=new FormData(e.currentTarget),r=await fetch("/api/marketplaces/bling/settings",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({clientId:f.get("clientId"),clientSecret:f.get("clientSecret")})}),d=await r.json();setBusy(false);if(!r.ok){setError(d.error||"Não foi possível salvar.");return}setSettings(false);await loadStatus()}
 function connect(){location.href="/api/marketplaces/bling/authorize"}
 /** Cada chamada só processa até um teto de sub-requisições (limite do Cloudflare
  *  Workers) — pra sincronizar um período histórico longo sem exigir dezenas de
  *  cliques manuais, repete a chamada sozinho enquanto vier truncated:true. */
 async function sync(){
  setBusy(true);setError("");setNotice("Consultando vendas, itens e custos no Bling…");
  try{
   let totalNewSales=0,totalItems=0,truncated=true,rounds=0;
   const failed:{saleId:string;error:string}[]=[];
   while(truncated&&rounds<25){
    rounds++;
    const r=await fetch("/api/marketplaces/bling/cmv",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({from,to})});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||"Não foi possível sincronizar.");
    totalNewSales+=d.newSales;totalItems+=d.items;if(d.failed?.length)failed.push(...d.failed);
    truncated=Boolean(d.truncated);
    setNotice(`Sincronizando… ${totalNewSales} venda(s) importadas até agora${truncated?" · continuando…":""}`);
   }
   await loadReport();
   setNotice(`${totalNewSales} venda(s) e ${totalItems} item(ns) sincronizados.${failed.length?` ${failed.length} pedido(s) não puderam ser importados (veja o log de auditoria).`:""}`);
  }catch(e){setNotice("");setError(e instanceof Error?e.message:"Não foi possível sincronizar as vendas.")}
  finally{setBusy(false)}
 }
 /** O Bling não forma comissão/frete pra pedidos Shopee (confirmado com dado real —
  *  vem zerado); essa sincronização complementa direto na API da Shopee, casando pelo
  *  número do pedido. Roda depois do sync principal, que é quem grava o channel_order_ref. */
 async function syncShopeeFees(){
  setBusy(true);setError("");setNotice("Buscando comissão e frete dos pedidos Shopee…");
  try{
   let updated=0,truncated=true,rounds=0;
   const failed:{orderSn:string;error:string}[]=[];
   while(truncated&&rounds<25){
    rounds++;
    const r=await fetch("/api/marketplaces/shopee/cmv-fees",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({from,to})});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||"Não foi possível sincronizar as taxas da Shopee.");
    updated+=d.updated;if(d.failed?.length)failed.push(...d.failed);
    truncated=Boolean(d.truncated);
    if(!d.pending){truncated=false;break}
    setNotice(`Atualizando pedidos Shopee… ${updated} concluído(s) até agora${truncated?" · continuando…":""}`);
   }
   await loadReport();
   setNotice(`${updated} pedido(s) Shopee atualizados com taxa e frete.${failed.length?` ${failed.length} não puderam ser atualizados.`:""}`);
  }catch(e){setNotice("");setError(e instanceof Error?e.message:"Não foi possível sincronizar as taxas da Shopee.")}
  finally{setBusy(false)}
 }
 /** O Bling não reflete cancelamento feito do lado do Mercado Livre (mesmo problema já
  *  confirmado com a Shopee) — verifica o status real direto na API do ML. Roda sozinho
  *  a cada 15 min via cron, mas também dá pra forçar aqui. */
 async function checkMlStatus(){
  setBusy(true);setError("");setNotice("Verificando status dos pedidos no Mercado Livre…");
  try{
   let checked=0,cancelled=0,truncated=true,rounds=0;
   const failed:{orderId:string;error:string}[]=[];
   while(truncated&&rounds<25){
    rounds++;
    const r=await fetch("/api/marketplaces/mercado-livre/status-check",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({from,to})});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||"Não foi possível verificar os pedidos do Mercado Livre.");
    checked+=d.checked;cancelled+=d.cancelled;if(d.failed?.length)failed.push(...d.failed);
    truncated=Boolean(d.truncated);
    if(!d.pending){truncated=false;break}
    setNotice(`Verificando pedidos do Mercado Livre… ${checked} concluído(s) até agora${truncated?" · continuando…":""}`);
   }
   await loadReport();
   setNotice(`${checked} pedido(s) verificados.${cancelled?` ${cancelled} estavam cancelados no Mercado Livre e foram excluídos do relatório.`:""}${failed.length?` ${failed.length} não puderam ser verificados.`:""}`);
  }catch(e){setNotice("");setError(e instanceof Error?e.message:"Não foi possível verificar os pedidos do Mercado Livre.")}
  finally{setBusy(false)}
 }
 /** Vendas sincronizadas antes de existirem as colunas de comissão/frete ficaram com esses
  *  campos zerados pra sempre (o sync normal só processa venda nova, nunca revisita quem já
  *  está no banco) — esta rotina varre e completa quem ainda está com channel_order_ref vazio. */
 async function backfillFees(){
  setBusy(true);setError("");setNotice("Completando comissão e frete de pedidos antigos…");
  try{
   let updated=0,truncated=true,rounds=0;
   const failed:{saleId:string;error:string}[]=[];
   while(truncated&&rounds<25){
    rounds++;
    const r=await fetch("/api/marketplaces/bling/cmv-fees-backfill",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({from,to})});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||"Não foi possível completar as taxas antigas.");
    updated+=d.updated;if(d.failed?.length)failed.push(...d.failed);
    truncated=Boolean(d.truncated);
    if(!d.pending){truncated=false;break}
    setNotice(`Completando pedidos antigos… ${updated} concluído(s) até agora${truncated?" · continuando…":""}`);
   }
   await loadReport();
   setNotice(`${updated} pedido(s) antigos completados com comissão/frete.${failed.length?` ${failed.length} não puderam ser completados.`:""}`);
  }catch(e){setNotice("");setError(e instanceof Error?e.message:"Não foi possível completar as taxas antigas.")}
  finally{setBusy(false)}
 }
 /** Kits (formato "E" no Bling) não guardam custo no próprio registro — é a soma dos
  *  componentes da estrutura (confirmado com dado real: KIT440736 tem precoCusto 0 e 5
  *  componentes). Vendas já sincronizadas antes desse ajuste ficaram com custo 0 pra
  *  sempre; esta rotina recalcula por produto e atualiza todas as vendas daquele item. */
 async function backfillCost(){
  setBusy(true);setError("");setNotice("Recalculando custo de kits e produtos zerados…");
  try{
   let updated=0,truncated=true,rounds=0;
   const failed:{productId:string;error:string}[]=[];
   while(truncated&&rounds<25){
    rounds++;
    const r=await fetch("/api/marketplaces/bling/cmv-cost-backfill",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({from,to})});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||"Não foi possível recalcular os custos.");
    updated+=d.updated;if(d.failed?.length)failed.push(...d.failed);
    truncated=Boolean(d.truncated);
    if(!d.pending){truncated=false;break}
    setNotice(`Recalculando custos… ${updated} produto(s) concluído(s) até agora${truncated?" · continuando…":""}`);
   }
   await loadReport();
   setNotice(`${updated} produto(s) com custo recalculado.${failed.length?` ${failed.length} não puderam ser recalculados.`:""}`);
  }catch(e){setNotice("");setError(e instanceof Error?e.message:"Não foi possível recalcular os custos.")}
  finally{setBusy(false)}
 }
 async function applyPeriod(){await loadReport()}
 async function exportExcel(){
  const XLSX=await import("xlsx");
  const rows=products.map(p=>({"Produto":p.product_name,"SKU":p.sku,"Quantidade":p.quantity,"Faturamento":p.revenue,"CMV":p.cmv,"Lucro bruto":p.profit,"Margem %":Number(p.margin.toFixed(1)),"Markup":p.markup?Number(p.markup.toFixed(2)):"",'Custo estimado':p.costEstimated?"Sim":"Não"}));
  const sheet=XLSX.utils.json_to_sheet(rows),book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,sheet,"CMV");
  XLSX.writeFile(book,`cmv-${from}_a_${to}.xlsx`);
 }
 async function saveMargin(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  // Captura o form ANTES do primeiro await — o SyntheticEvent do React pode zerar
  // e.currentTarget assim que o handler devolve o controle, então usá-lo depois de um
  // await (pra dar .reset()) lança "Cannot read properties of null" e aborta a função
  // no meio, antes de chegar no loadMargins() — foi por isso que a lista parecia não
  // atualizar após salvar (o dado ia pro banco certinho, só a tela não recarregava).
  const form=e.currentTarget;
  setMarginBusy(true);setMarginError("");
  const f=new FormData(form);
  const r=await fetch("/api/marketplaces/bling/cmv-margin-config",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({channel:f.get("channel"),taxRate:Number(f.get("taxRate")),marginMin:Number(f.get("marginMin")),marginIdeal:Number(f.get("marginIdeal")),active:true})});
  const d=await r.json();setMarginBusy(false);
  if(!r.ok){setMarginError(d.error||"Não foi possível salvar.");return}
  form.reset();await loadMargins();await loadReport();
 }
 async function deleteMargin(ch:string){
  if(!confirm(`Remover a configuração de margem do canal "${ch}"?`))return;
  await fetch(`/api/marketplaces/bling/cmv-margin-config?channel=${encodeURIComponent(ch)}`,{method:"DELETE"});
  await loadMargins();await loadReport();
 }

 const totals=report?.totals||{revenue:0,cmv:0,profit:0,margin:0},products=report?.products||[],filters=report?.filters||{channels:[],brands:[],categories:[],sellers:[]};
 const items=report?.items||[],ordersTotals=report?.ordersTotals||{revenue:0,commission:0,freight_cost:0,other_fees:0,tax:0,netPayout:0,result:0,orderCount:0,ticketMedio:0,margin:0};
 const pendingShopee=items.some(o=>o.feesPending);
 return <div className="cmv-area"><header className="cmv-head"><div><p className="eyebrow">GESTÃO DE RENTABILIDADE</p><h1>CMV e margem</h1><p>Vendas, custos, comissão, frete e resultado líquido por item, integrados ao Bling e às APIs de marketplace.</p></div><div className="head-actions">{isMaster&&<button className="secondary" onClick={()=>setSettings(true)}>⚙ Configurar Bling</button>}{isMaster&&<button className="secondary" onClick={()=>setMarginsOpen(true)}>% Margem de contribuição</button>}<button className="secondary" disabled={busy} onClick={backfillCost} title="Recalcula o custo de kits e produtos que ficaram zerados (soma dos componentes)">{busy?"…":"↻ Custos de kits"}</button><button className="secondary" disabled={busy} onClick={backfillFees} title="Completa comissão/frete dos pedidos que foram sincronizados antes dessas colunas existirem">{busy?"…":"↻ Taxas antigas"}</button><button className="secondary" disabled={busy} onClick={syncShopeeFees} title="Completa comissão/frete dos pedidos Shopee direto na API deles (o Bling não forma esse dado pra Shopee) e detecta cancelamento">{busy?"…":"↻ Taxas Shopee"}</button><button className="secondary" disabled={busy} onClick={checkMlStatus} title="Confere status real no Mercado Livre — o Bling não reflete cancelamento feito do lado do ML">{busy?"…":"↻ Status Mercado Livre"}</button><button className="primary" disabled={!status?.configured||busy} onClick={status?.connected?sync:connect}>{status?.connected?(busy?"Sincronizando…":"↻ Sincronizar vendas"):"Conectar ao Bling"}</button></div></header>
 <section className={status?.connected?"bling-banner connected":"bling-banner"}><span>{status?.connected?"✓":"B"}</span><div><strong>{status?.connected?"Bling conectado":"Conecte o Bling para gerar o relatório"}</strong><p>{status?.connected?"A integração está autorizada. A próxima sincronização importará vendas, produtos e custos.":"Use o aplicativo Bling com acesso de leitura a Produtos e Pedidos de venda."}</p></div>{status?.connected&&<small>Conexão ativa</small>}</section>
 {error&&<div className="form-error cmv-error">{error}</div>}{notice&&<div className="connection-success cmv-error"><strong>{busy?"↻ ":"✓ "}{notice}</strong></div>}
 <section className="cmv-filters panel">
  <label>Período<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
  <label>até<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
  <label>Canal<select value={channel} onChange={e=>setChannel(e.target.value)}><option value="">Todos os canais</option>{filters.channels.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
  <label>Produto ou SKU<input placeholder="Cole ou digite" value={product} onChange={e=>setProduct(e.target.value)} onPaste={pasteProduct} onBlur={()=>loadReport()}/></label>
  <label>Pedido (cole o número)<input placeholder="Cole o nº do pedido" value={orderRef} onChange={e=>setOrderRef(e.target.value)} onPaste={pasteOrderRef} onBlur={()=>loadReport()}/></label>
  <label>Marca<select value={brand} onChange={e=>setBrand(e.target.value)}><option value="">Todas as marcas</option>{filters.brands.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
  <label>Categoria<select value={category} onChange={e=>setCategory(e.target.value)}><option value="">Todas as categorias</option>{filters.categories.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
  <label>Vendedor<select value={seller} onChange={e=>setSeller(e.target.value)}><option value="">Todos os vendedores</option>{filters.sellers.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
  <button className="secondary" onClick={applyPeriod}>Aplicar período</button>
 </section>
 <div className="purchasing-tabs"><button className={view==="pedidos"?"tab active":"tab"} onClick={()=>setView("pedidos")}>Análise de pedidos</button><button className={view==="produtos"?"tab active":"tab"} onClick={()=>setView("produtos")}>Por produto</button></div>

 {view==="pedidos"?<>
  <section className="cmv-kpis">{[["FATURAMENTO TOTAL",ordersTotals.revenue,"money"],["TOTAL DE PEDIDOS",ordersTotals.orderCount,"int"],["TICKET MÉDIO",ordersTotals.ticketMedio,"money"],["REPASSE LÍQUIDO",ordersTotals.netPayout,"money"],["RESULTADO",ordersTotals.result,"money"],["MARGEM",ordersTotals.margin,"pct"]].map(([label,value,kind])=><article className="panel" key={String(label)}><span>{label}</span><strong>{kind==="pct"?pct(Number(value)):kind==="int"?Number(value):money(Number(value))}</strong></article>)}</section>
  {pendingShopee&&<div className="form-error cmv-error">Há itens Shopee sem comissão/frete ainda — clique em "↻ Taxas Shopee" para completar (o Bling não traz esse dado pra Shopee, só pro Mercado Livre).</div>}
  <section className="panel cmv-table"><div className="table-head"><strong>Comissão, frete, imposto e repasse por item vendido</strong><span> · Shopee, Mercado Livre e Loja física</span></div><div className="cmv-columns items-columns"><span>Produto / SKU</span><span>Pedido</span><span>Canal</span><span>Qtd.</span><span>Total</span><span>Custo</span><span>Comissão</span><span>Frete</span><span>Desconto</span><span>Imposto</span><span>Repasse</span><span>Resultado</span></div>{items.length?<div>{items.map(o=><div className="cmv-columns items-columns dark-cells" key={`${o.sale_id}-${o.item_id}`}><span><strong>{o.product_name}</strong><small>{o.sku||"Sem SKU"}</small></span><span><strong>{o.channel_order_ref&&o.channel_order_ref!=="-"?o.channel_order_ref:o.sale_id}</strong><small>{o.sale_date}</small></span><span><ChannelTag channel={o.channel}/>{o.feesPending&&<small className="cmv-pending"> · taxa pendente</small>}</span><span>{o.quantity}</span><span>{money(o.revenue)}</span><span>{money(o.cost)}</span><span>{money(o.commission)}</span><span>{money(o.freight)}</span><span>{money(o.discount)}</span><span>{money(o.tax)}</span><span>{money(o.netPayout)}</span><span><strong>{money(o.result)}</strong><small className={`margin-pill ${o.marginStatus}`}>{pct(o.margin)}</small></span></div>)}</div>:<div className="cmv-empty"><span>▥</span><strong>{status?.connected?"Pronto para a primeira sincronização":"Nenhuma venda carregada"}</strong><p>{status?.connected?"Clique em Sincronizar vendas para importar os dados do Bling.":"Configure e autorize o Bling para calcular CMV e margem."}</p></div>}</section>
 </>:<>
  <section className="cmv-kpis">{[["FATURAMENTO LÍQUIDO",totals.revenue],["CMV",totals.cmv],["LUCRO BRUTO",totals.profit],["MARGEM",totals.margin]].map(([label,value],i)=><article className="panel" key={String(label)}><span>{label}</span><strong>{i===3?pct(Number(value)):money(Number(value))}</strong><small>{i===0?"vendas − descontos − devoluções":i===1?"quantidade × custo histórico":i===2?"faturamento líquido − CMV":"lucro bruto ÷ faturamento líquido"}</small></article>)}</section>
  <section className="panel cmv-table"><div className="table-head"><div><strong>Rentabilidade por produto</strong><span> · custo histórico priorizado</span></div><button className="secondary" disabled={!products.length} onClick={exportExcel}>⇩ Exportar Excel</button></div><div className="cmv-columns"><span>Produto / SKU</span><span>Qtd.</span><span>Faturamento</span><span>CMV</span><span>Lucro bruto</span><span>Margem</span><span>Markup</span></div>{products.length?<div>{products.map(p=><div className="cmv-columns dark-cells" key={`${p.product_id}-${p.sku}`}><span><strong>{p.product_name}</strong><small>{p.sku||"Sem SKU"}{p.costEstimated?" · custo atual/estimado":""}</small></span><span>{p.quantity}</span><span>{money(p.revenue)}</span><span>{money(p.cmv)}</span><span>{money(p.profit)}</span><span>{p.margin.toFixed(1).replace(".",",")}%</span><span>{p.markup?p.markup.toFixed(2).replace(".",","):"—"}</span></div>)}</div>:<div className="cmv-empty"><span>▥</span><strong>{status?.connected?"Pronto para a primeira sincronização":"Nenhuma venda carregada"}</strong><p>{status?.connected?"Clique em Sincronizar vendas para importar os dados do Bling.":"Configure e autorize o Bling para calcular CMV e margem."}</p></div>}</section>
 </>}
 <div className="cost-note"><strong>Como o custo será tratado</strong><p>O relatório usará primeiro o custo registrado na época da venda. Quando ele não existir, usará o custo atual do produto como estimativa e exibirá um alerta na linha.</p></div>
 {settings&&<div className="modal-wrap"><div className="modal"><div className="modal-head"><h2>Configurar aplicativo Bling</h2><button onClick={()=>setSettings(false)}>×</button></div><div className="import-note"><strong>URL de redirecionamento</strong><code>{status?.callbackUrl||`${location.origin}/api/marketplaces/bling/callback`}</code><p>Cadastre esta URL exatamente igual no aplicativo criado no Bling.</p></div><form onSubmit={save}><label>Client ID<input name="clientId" required autoComplete="off" defaultValue={status?.clientId||""}/></label><label>Client Secret<input name="clientSecret" type="password" required autoComplete="new-password"/></label>{error&&<div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary" onClick={()=>setSettings(false)}>Cancelar</button><button className="primary" disabled={busy}>{busy?"Salvando…":"Salvar com segurança"}</button></div></form></div></div>}
 {marginsOpen&&<div className="modal-wrap" onMouseDown={e=>{if(e.target===e.currentTarget)setMarginsOpen(false)}}><div className="modal margin-modal"><div className="modal-head"><h2>Margem de contribuição por canal</h2><button onClick={()=>setMarginsOpen(false)}>×</button></div>
  <div className="import-note"><strong>Por que configurar o imposto aqui</strong><p>Nem o Bling nem as APIs da Shopee/Mercado Livre trazem a alíquota de imposto da venda — defina abaixo o % que sai do faturamento em cada canal, além da margem mínima (alerta vermelho) e ideal (verde) usadas para colorir o resultado por item.</p></div>
  <form onSubmit={saveMargin} className="margin-form">
   <label>Canal<select name="channel" required><option value="">Selecione…</option><option value="geral">Regra geral (todos)</option>{filters.channels.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
   <label>Imposto %<input name="taxRate" type="number" step="0.01" min="0" placeholder="ex: 6"/></label>
   <label>Margem mínima %<input name="marginMin" type="number" step="0.01" placeholder="ex: 10"/></label>
   <label>Margem ideal %<input name="marginIdeal" type="number" step="0.01" placeholder="ex: 20"/></label>
   {marginError&&<div className="form-error">{marginError}</div>}
   <button className="primary" disabled={marginBusy}>{marginBusy?"Salvando…":"Salvar"}</button>
  </form>
  <div className="margin-list">{margins.length?margins.map(m=><div className="margin-row" key={m.channel}><span><strong>{m.channel==="geral"?"Regra geral":m.channel}</strong></span><span>Imposto {m.tax_rate}%</span><span>Mínima {m.margin_min}%</span><span>Ideal {m.margin_ideal}%</span><button className="secondary" onClick={()=>deleteMargin(m.channel)}>Remover</button></div>):<p className="import-note">Nenhum canal configurado ainda — o imposto ficará 0% até você adicionar.</p>}</div>
  <div className="modal-actions"><button className="secondary" onClick={()=>setMarginsOpen(false)}>Fechar</button></div>
 </div></div>}
 </div>
}
