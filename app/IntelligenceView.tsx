"use client";
import {FormEvent,useEffect,useMemo,useState} from "react";

type Product={id:number;bling_product_id:string;sku:string;name:string;brand:string;stock_physical:number;cost:number};
type StatusResp={generatedAt:string;lastSync:Record<string,{at:string;detail:string}|null>;warnings:Record<string,number|string[]>;totals:{activeSalesInPeriod:number;activeProducts:number}};
type Opportunity={type:string;productId:string;sku:string;name:string;evidence:string;cost:number;stock:number;potential:"alto"|"médio"|"baixo";effort:"baixo"|"médio"|"alto";isFact:boolean};
type Diagnostic={productId:string;productName:string;sku:string;fatos:string[];hipoteses:string[];faltam:string[]};
type Pricing={productId:string;productName:string;channel:string;inputs:Record<string,number>;priceMin:number|null;priceIdeal:number|null;currentChannelPrice:number|null;blingDefaultPrice:number;complete:boolean;incomplete:string[]};
type CompetitorListing={id:number;competitor_name:string;marketplace:string;title:string;price:number|null;shipping_cost:number|null;shipping_days:number|null;rating:number|null;source_url:string;captured_at:string};
type ActionItem={id:number;title:string;problem:string;evidence:string;action:string;indicator:string;priority:string;status:string;responsible:string;created_at:string};

const money=(v:number|null)=>v===null?"—":new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v);
const opportunityLabel:Record<string,string>={cotacao_fornecedor:"Zerado que vende",oferta_parado:"Parado com estoque",lacuna_canal:"Possível lacuna de anúncio",kit_pronto:"Kit pronto",kit_bloqueado:"Kit bloqueado"};

const TABS=[
 {id:"visao_geral",label:"Visão geral"},
 {id:"anuncios",label:"Meus anúncios"},
 {id:"concorrentes",label:"Concorrentes"},
 {id:"oportunidades",label:"Oportunidades"},
 {id:"precos_margens",label:"Preços e margens"},
 {id:"estoque_compras",label:"Estoque e compras"},
 {id:"plano_acao",label:"Plano de ação"},
 {id:"assistente",label:"Assistente IA"},
] as const;
type TabId=typeof TABS[number]["id"];

function useProducts(){
 const [products,setProducts]=useState<Product[]>([]);
 useEffect(()=>{fetch("/api/products").then(r=>r.ok?r.json():null).then(d=>{if(d?.products)setProducts(d.products)})},[]);
 return products;
}

function ProductPicker({products,value,onChange}:{products:Product[];value:string;onChange:(id:string)=>void}){
 const [query,setQuery]=useState("");
 const matches=useMemo(()=>{
  if(!query.trim())return[];
  const q=query.toLowerCase();
  return products.filter(p=>p.name.toLowerCase().includes(q)||p.sku.toLowerCase().includes(q)).slice(0,10);
 },[query,products]);
 const selected=products.find(p=>p.bling_product_id===value);
 return <div className="intel-picker">
  <input placeholder="Buscar produto por nome ou SKU…" value={query} onChange={e=>setQuery(e.target.value)}/>
  {matches.length>0&&<div className="intel-picker-list">{matches.map(p=><button type="button" key={p.bling_product_id} onClick={()=>{onChange(p.bling_product_id);setQuery("")}}><strong>{p.name}</strong><small>{p.sku||"sem SKU"}</small></button>)}</div>}
  {selected&&<div className="intel-picker-selected"><strong>{selected.name}</strong><small>{selected.sku} · estoque {selected.stock_physical} · custo {money(selected.cost)}</small></div>}
 </div>;
}

export default function IntelligenceView(){
 const [tab,setTab]=useState<TabId>("visao_geral");
 return <div className="intel-area">
  <header className="cmv-head"><div><p className="eyebrow">INTELIGÊNCIA COMERCIAL</p><h1>O que está travando as vendas, onde estão as oportunidades</h1><p>Diagnóstico, margem, concorrência e plano de ação — tudo calculado a partir do Bling, Shopee e Mercado Livre.</p></div></header>
  <div className="purchasing-tabs intel-tabs">{TABS.map(t=><button key={t.id} className={tab===t.id?"tab active":"tab"} onClick={()=>setTab(t.id)}>{t.label}</button>)}</div>
  {tab==="visao_geral"&&<VisaoGeral/>}
  {tab==="anuncios"&&<Anuncios/>}
  {tab==="concorrentes"&&<Concorrentes/>}
  {tab==="oportunidades"&&<Oportunidades/>}
  {tab==="precos_margens"&&<PrecosMargens/>}
  {tab==="estoque_compras"&&<EstoqueCompras/>}
  {tab==="plano_acao"&&<PlanoAcao/>}
  {tab==="assistente"&&<Assistente/>}
 </div>;
}

function VisaoGeral(){
 const [status,setStatus]=useState<StatusResp|null>(null);
 const [top,setTop]=useState<Opportunity[]>([]);
 useEffect(()=>{
  fetch("/api/intelligence/status").then(r=>r.ok?r.json():null).then(setStatus);
  fetch("/api/intelligence/opportunities").then(r=>r.ok?r.json():null).then(d=>setTop((d?.opportunities||[]).filter((o:Opportunity)=>o.potential==="alto").slice(0,8)));
 },[]);
 if(!status)return <div className="loading">Carregando…</div>;
 const w=status.warnings;
 return <>
  <section className="cmv-kpis">
   <article className="panel"><span>VENDAS ATIVAS (31 DIAS)</span><strong>{status.totals.activeSalesInPeriod}</strong></article>
   <article className="panel"><span>PRODUTOS ATIVOS</span><strong>{status.totals.activeProducts}</strong></article>
   <article className="panel"><span>CUSTO ESTIMADO (NÃO REAL)</span><strong>{w.salesWithEstimatedCost as number}</strong><small>de {status.totals.activeSalesInPeriod} vendas</small></article>
   <article className="panel"><span>PRODUTOS SEM CUSTO</span><strong>{w.activeProductsMissingCost as number}</strong></article>
  </section>
  <section className="panel cmv-table"><div className="table-head"><strong>Última sincronização por fonte</strong></div>
   <div className="intel-sync-grid">
    {Object.entries(status.lastSync).map(([key,val])=><div className="intel-sync-item" key={key}><strong>{key==="blingSync"?"Vendas (Bling)":key==="shopeeFees"?"Taxas Shopee":"Status Mercado Livre"}</strong>{val?<span>{val.at} · {val.detail}</span>:<span className="cmv-pending">nunca rodou</span>}</div>)}
   </div>
  </section>
  <section className="panel cmv-table"><div className="table-head"><strong>Alertas de alto potencial</strong><span> · fila completa na aba Oportunidades</span></div>
   {top.length?<div>{top.map((o,i)=><div className="intel-alert-row" key={i}><span className="intel-badge">{opportunityLabel[o.type]}</span><div><strong>{o.name}</strong><small>{o.evidence}</small></div></div>)}</div>:<div className="cmv-empty small"><p>Nenhum alerta de alto potencial no momento.</p></div>}
  </section>
 </>;
}

function Anuncios(){
 const products=useProducts();
 const [productId,setProductId]=useState("");
 const [diagnostic,setDiagnostic]=useState<Diagnostic|null>(null);
 const [busy,setBusy]=useState(false);
 async function diagnose(id:string){
  setProductId(id);setBusy(true);setDiagnostic(null);
  const r=await fetch(`/api/intelligence/diagnostics?productId=${id}`);
  if(r.ok)setDiagnostic(await r.json());
  setBusy(false);
 }
 return <section className="panel intel-panel">
  <div className="table-head"><strong>Diagnóstico por anúncio</strong><span> · escolha um produto</span></div>
  <div className="intel-body">
   <ProductPicker products={products} value={productId} onChange={diagnose}/>
   {busy&&<div className="loading">Analisando…</div>}
   {diagnostic&&<div className="intel-diagnostic">
    <h3>{diagnostic.productName} <small>{diagnostic.sku}</small></h3>
    <div className="intel-diag-col"><strong>Fatos</strong>{diagnostic.fatos.map((f,i)=><p key={i}>{f}</p>)}</div>
    <div className="intel-diag-col"><strong>Hipóteses</strong>{diagnostic.hipoteses.length?diagnostic.hipoteses.map((f,i)=><p key={i}>{f}</p>):<p className="muted">Nenhuma hipótese de risco identificada.</p>}</div>
    <div className="intel-diag-col"><strong>Falta saber</strong>{diagnostic.faltam.map((f,i)=><p key={i}>{f}</p>)}</div>
   </div>}
  </div>
 </section>;
}

function Concorrentes(){
 const products=useProducts();
 const [productId,setProductId]=useState("");
 const [listings,setListings]=useState<CompetitorListing[]>([]);
 const [compare,setCompare]=useState<{ourPrices:{channel:string;price:number}[];comparisons:Record<string,unknown>[]}|null>(null);
 const [formOpen,setFormOpen]=useState(false);
 const [error,setError]=useState("");
 async function load(id:string){
  setProductId(id);
  const [l,c]=await Promise.all([fetch(`/api/intelligence/competitors?productId=${id}`).then(r=>r.ok?r.json():null),fetch(`/api/intelligence/competitors/compare?productId=${id}`).then(r=>r.ok?r.json():null)]);
  setListings(l?.listings||[]);setCompare(c);
 }
 async function save(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget;setError("");
  const f=new FormData(form);
  const r=await fetch("/api/intelligence/competitors",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
   blingProductId:productId,competitorName:f.get("competitorName"),marketplace:f.get("marketplace"),title:f.get("title"),
   price:f.get("price")||null,shippingCost:f.get("shippingCost")||null,shippingDays:f.get("shippingDays")||null,
   rating:f.get("rating")||null,ratingCount:f.get("ratingCount")||null,kitComponents:f.get("kitComponents"),sourceUrl:f.get("sourceUrl"),notes:f.get("notes"),
  })});
  const d=await r.json();
  if(!r.ok){setError(d.error||"Não foi possível salvar.");return}
  form.reset();setFormOpen(false);await load(productId);
 }
 return <section className="panel intel-panel">
  <div className="table-head"><strong>Concorrentes</strong><span> · captura assistida (leia o aviso da Etapa 5)</span></div>
  <div className="intel-body">
   <ProductPicker products={products} value={productId} onChange={load}/>
   {productId&&<>
    <button className="secondary" onClick={()=>setFormOpen(v=>!v)}>{formOpen?"Cancelar":"+ Registrar captura de concorrente"}</button>
    {formOpen&&<form onSubmit={save} className="intel-competitor-form">
     <input name="competitorName" required placeholder="Nome do concorrente/loja"/>
     <select name="marketplace" required><option value="">Canal…</option><option value="Mercado Livre">Mercado Livre</option><option value="Shopee">Shopee</option><option value="Outro">Outro</option></select>
     <input name="title" placeholder="Título do anúncio"/>
     <input name="price" type="number" step="0.01" placeholder="Preço (R$)"/>
     <input name="shippingCost" type="number" step="0.01" placeholder="Frete (R$)"/>
     <input name="shippingDays" type="number" placeholder="Prazo (dias)"/>
     <input name="rating" type="number" step="0.1" placeholder="Avaliação (0-5)"/>
     <input name="ratingCount" type="number" placeholder="Qtd. avaliações"/>
     <input name="kitComponents" placeholder="Composição do kit (se houver)"/>
     <input name="sourceUrl" placeholder="Link do anúncio"/>
     <input name="notes" placeholder="Observações"/>
     {error&&<div className="form-error">{error}</div>}
     <button className="primary">Salvar captura</button>
    </form>}
    {compare&&<div className="intel-our-prices">{compare.ourPrices.map((p,i)=><span key={i} className="intel-badge">{p.channel}: {money(p.price)}</span>)}</div>}
    <div className="cmv-columns intel-competitor-columns"><span>Concorrente</span><span>Canal</span><span>Preço</span><span>Frete</span><span>Avaliação</span><span>Capturado em</span></div>
    {listings.length?listings.map(l=><div className="cmv-columns intel-competitor-columns dark-cells" key={l.id}><span>{l.competitor_name}{l.title&&<small>{l.title}</small>}</span><span>{l.marketplace}</span><span>{money(l.price)}</span><span>{money(l.shipping_cost)}{l.shipping_days?` · ${l.shipping_days}d`:""}</span><span>{l.rating??"—"}</span><span>{new Date(l.captured_at).toLocaleDateString("pt-BR")}</span></div>):<div className="cmv-empty small"><p>Nenhuma captura registrada pra esse produto ainda.</p></div>}
   </>}
  </div>
 </section>;
}

function Oportunidades(){
 const [data,setData]=useState<{total:number;byType:Record<string,number>;opportunities:Opportunity[]}|null>(null);
 const [filter,setFilter]=useState("");
 const [notice,setNotice]=useState("");
 useEffect(()=>{fetch("/api/intelligence/opportunities").then(r=>r.ok?r.json():null).then(setData)},[]);
 async function createAction(o:Opportunity){
  const r=await fetch("/api/intelligence/action-plan",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
   title:`${opportunityLabel[o.type]}: ${o.name}`,problem:opportunityLabel[o.type],evidence:o.evidence,
   action:"",indicator:"",blingProductId:o.productId,opportunityType:o.type,
  })});
  setNotice(r.ok?"Adicionado ao plano de ação.":"Não foi possível adicionar.");
  setTimeout(()=>setNotice(""),3000);
 }
 if(!data)return <div className="loading">Carregando…</div>;
 const list=filter?data.opportunities.filter(o=>o.type===filter):data.opportunities;
 return <section className="panel intel-panel">
  <div className="table-head"><strong>Fila de oportunidades</strong><span> · {data.total} no total</span></div>
  <div className="intel-body">
   <div className="intel-filter-chips">
    <button className={filter===""?"tab active":"tab"} onClick={()=>setFilter("")}>Todas ({data.total})</button>
    {Object.entries(data.byType).map(([type,count])=><button key={type} className={filter===type?"tab active":"tab"} onClick={()=>setFilter(type)}>{opportunityLabel[type]} ({count})</button>)}
   </div>
   {notice&&<div className="connection-success cmv-error"><strong>✓ {notice}</strong></div>}
   <div className="cmv-columns intel-opp-columns"><span>Produto</span><span>Tipo</span><span>Evidência</span><span>Potencial</span><span>Esforço</span><span/></div>
   {list.slice(0,100).map((o,i)=><div className="cmv-columns intel-opp-columns dark-cells" key={i}><span><strong>{o.name}</strong><small>{o.sku}</small></span><span className="intel-badge">{opportunityLabel[o.type]}{!o.isFact&&<small> (hipótese)</small>}</span><span>{o.evidence}</span><span>{o.potential}</span><span>{o.effort}</span><span><button className="secondary" onClick={()=>createAction(o)}>+ Plano</button></span></div>)}
  </div>
 </section>;
}

function PrecosMargens(){
 const products=useProducts();
 const [productId,setProductId]=useState(""),[channel,setChannel]=useState("Mercado Livre");
 const [pricing,setPricing]=useState<Pricing|null>(null),[busy,setBusy]=useState(false);
 async function calc(id:string,ch:string){
  if(!id)return;
  setBusy(true);
  const r=await fetch(`/api/intelligence/pricing?productId=${id}&channel=${encodeURIComponent(ch)}`);
  setPricing(r.ok?await r.json():null);setBusy(false);
 }
 return <section className="panel intel-panel">
  <div className="table-head"><strong>Preço mínimo e ideal</strong><span> · comissão/frete = média real observada no canal (90 dias)</span></div>
  <div className="intel-body">
   <ProductPicker products={products} value={productId} onChange={id=>{setProductId(id);calc(id,channel)}}/>
   <select value={channel} onChange={e=>{setChannel(e.target.value);calc(productId,e.target.value)}}><option>Mercado Livre</option><option>Shopee - Via APP Bling 14/04/2025 12:49:59</option><option>Loja PDV</option></select>
   {busy&&<div className="loading">Calculando…</div>}
   {pricing&&<div className="intel-pricing-result">
    <div className="cmv-kpis">
     <article className="panel"><span>PREÇO ATUAL NO CANAL</span><strong>{money(pricing.currentChannelPrice)}</strong></article>
     <article className="panel"><span>PREÇO MÍNIMO</span><strong>{money(pricing.priceMin)}</strong></article>
     <article className="panel"><span>PREÇO IDEAL</span><strong>{money(pricing.priceIdeal)}</strong></article>
    </div>
    <div className="intel-inputs-grid">
     <span>Custo: {money(pricing.inputs.cost)}</span>
     <span>Embalagem: {money(pricing.inputs.packaging)}</span>
     <span>Comissão observada: {pricing.inputs.commissionRatePct.toFixed(1)}%</span>
     <span>Frete observado: {pricing.inputs.freightRatePct.toFixed(1)}%</span>
     <span>Imposto configurado: {pricing.inputs.taxRatePct.toFixed(1)}%</span>
     <span>Amostra: {pricing.inputs.observedSalesCount} venda(s)</span>
    </div>
    {!pricing.complete&&<div className="form-error">{pricing.incomplete.map((t,i)=><p key={i}>{t}</p>)}</div>}
   </div>}
  </div>
 </section>;
}

function EstoqueCompras(){
 const [data,setData]=useState<{suggestions:Record<string,unknown>[];zerados:Record<string,unknown>[];summary:Record<string,number>}|null>(null);
 useEffect(()=>{fetch("/api/purchasing/suggestions").then(r=>r.ok?r.json():null).then(setData)},[]);
 if(!data)return <div className="loading">Carregando…</div>;
 return <section className="panel intel-panel">
  <div className="table-head"><strong>Estoque e compras</strong><span> · considera vendas de todos os canais, incluindo loja física</span></div>
  <div className="intel-body">
   <section className="cmv-kpis">
    <article className="panel"><span>VALOR A REPOR</span><strong>{money(data.summary.valorARepor)}</strong></article>
    <article className="panel"><span>ITENS ABAIXO DA RÉGUA</span><strong>{data.summary.itensAbaixoDaRegua}</strong></article>
    <article className="panel"><span>ZERADOS QUE VENDEM</span><strong>{data.summary.zeradosQueVendem}</strong></article>
   </section>
   <p className="muted">Lista completa e ajustes finos continuam na aba <strong>Compras</strong> do menu principal — aqui é só o resumo pra decisão rápida.</p>
  </div>
 </section>;
}

function PlanoAcao(){
 const [items,setItems]=useState<ActionItem[]>([]);
 async function load(){const r=await fetch("/api/intelligence/action-plan");if(r.ok)setItems((await r.json()).items||[])}
 useEffect(()=>{load()},[]);
 async function updateStatus(id:number,status:string){await fetch("/api/intelligence/action-plan",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id,status})});await load()}
 return <section className="panel intel-panel">
  <div className="table-head"><strong>Plano de ação</strong><span> · {items.length} item(ns)</span></div>
  <div className="intel-body">
   {items.length?items.map(item=><div className="intel-action-card" key={item.id}>
    <div><strong>{item.title}</strong><small>{item.priority} · criado {new Date(item.created_at).toLocaleDateString("pt-BR")}</small></div>
    {item.evidence&&<p>{item.evidence}</p>}
    <div className="intel-action-footer">
     <select value={item.status} onChange={e=>updateStatus(item.id,e.target.value)}>
      <option value="pendente">Pendente</option><option value="em_andamento">Em andamento</option><option value="concluido">Concluído</option>
     </select>
     <span>{item.responsible||"sem responsável"}</span>
    </div>
   </div>):<div className="cmv-empty small"><p>Nenhuma ação ainda — adicione pela aba Oportunidades.</p></div>}
  </div>
 </section>;
}

function Assistente(){
 const [question,setQuestion]=useState("");
 const [history,setHistory]=useState<{question:string;answer:string}[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 async function ask(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!question.trim())return;
  setBusy(true);setError("");
  const q=question;setQuestion("");
  const r=await fetch("/api/intelligence/ask",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({question:q})});
  const d=await r.json();
  if(!r.ok){setError(d.error||"Não foi possível responder.");setBusy(false);return}
  setHistory(h=>[...h,{question:q,answer:d.answer}]);setBusy(false);
 }
 return <section className="panel intel-panel">
  <div className="table-head"><strong>Assistente IA</strong><span> · responde só com dado real dos últimos 30 dias</span></div>
  <div className="intel-body">
   <div className="intel-chat">
    {history.map((h,i)=><div key={i} className="intel-chat-turn"><p className="intel-chat-q">{h.question}</p><p className="intel-chat-a">{h.answer}</p></div>)}
    {!history.length&&<p className="muted">Pergunte, por exemplo: &quot;qual canal deu mais lucro nos últimos 30 dias?&quot;</p>}
   </div>
   {error&&<div className="form-error">{error}</div>}
   <form onSubmit={ask} className="intel-chat-form">
    <input value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Pergunte sobre a operação…" disabled={busy}/>
    <button className="primary" disabled={busy}>{busy?"Pensando…":"Perguntar"}</button>
   </form>
  </div>
 </section>;
}
