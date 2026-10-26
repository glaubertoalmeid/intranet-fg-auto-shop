"use client";
import {useEffect,useMemo,useState} from "react";

type Suggestion={id:number;sku:string;name:string;brand:string;category:string;cost:number;stock_physical:number;min_stock:number;avgDailySales:number;suggestedQuantity:number;estimatedCost:number};
type ZeradoItem={id:number;sku:string;name:string;brand:string;category:string;qty30:number;cost:number};
type ItemLookupResult={id:number;blingProductId:string;sku:string;name:string;brand:string;category:string;status:string;format:string;isKit:boolean;stock:number;minStock:number;qty:number;avgDailySales:number;leadTimeDays:number;suggestedQuantity:number;estimatedCost:number;emRadar:boolean;emNecessidade:boolean;reason:string};

const money=(v:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v||0);
const SEM_CATEGORIA="sem_categoria";

type PurchasingTab="radar"|"necessidade"|"analise";
export default function PurchasingView(){
 const [tab,setTab]=useState<PurchasingTab>("radar");
 return <div className="cmv-area purchasing-area">
  <header className="cmv-head"><div><p className="eyebrow">COMPRAS</p><h1>O que preciso comprar</h1><p>Radar de reposição e sugestão de compra calculada a partir das vendas.</p></div></header>
  <ItemSearchPanel/>
  <div className="purchasing-tabs">
   <button className={tab==="radar"?"tab active":"tab"} onClick={()=>setTab("radar")}>Radar de reposição</button>
   <button className={tab==="necessidade"?"tab active":"tab"} onClick={()=>setTab("necessidade")}>Necessidade de compra</button>
   <button className={tab==="analise"?"tab active":"tab"} onClick={()=>setTab("analise")}>Análise de compras</button>
  </div>
  {tab==="radar"&&<RadarTab onOpenNecessidade={()=>setTab("necessidade")}/>}
  {tab==="necessidade"&&<SuggestionsTab/>}
  {tab==="analise"&&<AnalysisTab/>}
 </div>;
}

/** Busca pontual, independente da aba selecionada — pra responder "cadê o item X?"
 *  quando ele não aparece no Radar nem na Necessidade (ex. estoque ainda cobre o
 *  prazo do fornecedor, ou é um kit/composição, que por regra não entra nessas duas
 *  listas — ver app/api/purchasing/item-lookup/route.ts). */
function ItemSearchPanel(){
 const [query,setQuery]=useState("");
 const [items,setItems]=useState<ItemLookupResult[]>([]);
 const [loading,setLoading]=useState(false);
 const [searched,setSearched]=useState(false);

 useEffect(()=>{
  const q=query.trim();
  if(q.length<2){setItems([]);setSearched(false);setLoading(false);return}
  setLoading(true);
  const handle=setTimeout(()=>{
   fetch(`/api/purchasing/item-lookup?q=${encodeURIComponent(q)}`)
    .then(r=>r.ok?r.json():null)
    .then(d=>{setItems(d?.items||[]);setSearched(true)})
    .finally(()=>setLoading(false));
  },350);
  return ()=>clearTimeout(handle);
 },[query]);

 return <section className="panel item-search">
  <div className="item-search-head">
   <strong>Buscar item</strong>
   <input type="text" placeholder="SKU, código Bling ou nome do produto…" value={query} onChange={e=>setQuery(e.target.value)}/>
  </div>
  {loading?<div className="item-search-status">Buscando…</div>:null}
  {!loading&&searched&&!items.length?<div className="item-search-status">Nenhum produto encontrado para &quot;{query}&quot;.</div>:null}
  {!loading&&items.length?<div className="item-search-results">{items.map(i=><ItemSearchCard key={i.id} item={i}/>)}</div>:null}
 </section>;
}

function ItemSearchCard({item}:{item:ItemLookupResult}){
 const statusLabel=item.isKit?"Kit/composição":item.emRadar?"No radar":item.emNecessidade?"Na necessidade":"Sem pendência";
 const statusClass=item.isKit?"status-kit":item.emRadar?"status-radar":item.emNecessidade?"status-necessidade":"status-ok";
 return <article className="item-search-card">
  <header>
   <div><strong>{item.name}</strong><span className="item-search-sku">{item.sku||"Sem SKU"}</span></div>
   <span className={`chip status-chip ${statusClass}`}>{statusLabel}</span>
  </header>
  <div className="item-search-stats">
   <span>Estoque<strong>{item.stock}</strong></span>
   <span>Mínimo<strong>{item.minStock}</strong></span>
   <span>Vendas no período<strong>{item.qty}</strong></span>
   <span>Média/dia<strong>{item.avgDailySales}</strong></span>
   <span>Prazo considerado<strong>{item.leadTimeDays}d</strong></span>
   <span>Qtd. sugerida<strong>{item.suggestedQuantity}</strong></span>
   <span>Custo estimado<strong>{money(item.estimatedCost)}</strong></span>
  </div>
  <p className="item-search-reason">{item.reason}</p>
 </article>;
}

/** Painel de decisão rápida: o tamanho do problema em 3 números e os itens mais
 *  urgentes — zerados com venda recente, que não podem esperar o ciclo normal de
 *  reposição. Fixo em 30 dias (é um retrato do "agora"); pra ajustar o período da
 *  média usada no cálculo de sugestão, isso fica na aba Necessidade de compra. */
function RadarTab({onOpenNecessidade}:{onOpenNecessidade:()=>void}){
 const [suggestions,setSuggestions] = useState<Suggestion[]>([]);
 const [zerados,setZerados] = useState<ZeradoItem[]>([]);
 const [loading,setLoading] = useState(true);
 const [categoryFilter,setCategoryFilter] = useState("");
 useEffect(()=>{
  fetch("/api/purchasing/suggestions").then(r=>r.ok?r.json():null).then(d=>{if(d){setSuggestions(d.suggestions);setZerados(d.zerados)}}).finally(()=>setLoading(false));
 },[]);

 const categoryOptions=useMemo(()=>{
  const set=new Set<string>();
  for(const s of suggestions)set.add(s.category?s.category:SEM_CATEGORIA);
  for(const z of zerados)set.add(z.category?z.category:SEM_CATEGORIA);
  return [...set];
 },[suggestions,zerados]);
 const matchesCategory=(category:string)=>!categoryFilter||(categoryFilter===SEM_CATEGORIA?!category:category===categoryFilter);
 const filteredSuggestions=useMemo(()=>suggestions.filter(s=>matchesCategory(s.category)),[suggestions,categoryFilter]); // eslint-disable-line react-hooks/exhaustive-deps
 const filteredZerados=useMemo(()=>zerados.filter(z=>matchesCategory(z.category)).sort((a,b)=>b.qty30-a.qty30),[zerados,categoryFilter]); // eslint-disable-line react-hooks/exhaustive-deps

 const summary={
  valorARepor:filteredSuggestions.reduce((sum,s)=>sum+s.estimatedCost,0),
  itensAbaixoDaRegua:filteredSuggestions.length,
  zeradosQueVendem:filteredZerados.length,
 };

 if(loading)return <div className="loading">Calculando…</div>;
 return <div className="radar-area">
  <section className="cmv-filters panel">
   <label>Categoria<select value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}><option value="">Todas as categorias</option>{categoryOptions.map(c=><option key={c} value={c}>{c===SEM_CATEGORIA?"Sem categoria":c}</option>)}</select></label>
  </section>
  <section className="cmv-kpis">
   <article className="panel"><span>VALOR A REPOR</span><strong>{money(summary.valorARepor)}</strong><small>soma das sugestões × custo</small></article>
   <article className="panel alert-warning-card"><span>ITENS ABAIXO DA RÉGUA</span><strong>{summary.itensAbaixoDaRegua}</strong><small>estoque abaixo do mínimo + venda média × prazo do fornecedor</small></article>
   <article className="panel alert-critical-card"><span>ZERADOS QUE VENDEM</span><strong>{summary.zeradosQueVendem}</strong><small>estoque zero, giro sem saldo — prioridade</small></article>
  </section>
  <section className="panel large">
   <div className="table-head"><div><strong>Zerados que vendem</strong><span> · estoque zero com venda nos últimos 30 dias, ordenado pelo mais urgente</span></div><button className="secondary" onClick={onOpenNecessidade}>Ver necessidade completa →</button></div>
   {filteredZerados.length?<div className="cmv-columns radar-columns">
    <span>Produto</span><span>SKU</span><span>Vendas 30d</span><span>Custo</span><span>Categoria</span>
   </div>:null}
   {filteredZerados.length?<div>{filteredZerados.map(z=><div className="cmv-columns radar-columns" key={z.id}><span><strong>{z.name}</strong></span><span>{z.sku||"Sem SKU"}</span><span>{z.qty30}</span><span>{money(z.cost)}</span><span>{z.category||"—"}</span></div>)}</div>
   :<div className="cmv-empty"><span>✓</span><strong>Nenhum produto zerado com venda recente</strong><p>Tudo o que vende tem estoque no momento (com esse filtro).</p></div>}
  </section>
 </div>;
}

/** Lista de planejamento: o que comprar, calculado pela venda média no período
 *  escolhido (datas explícitas, igual à tela de CMV) × prazo de entrega (7 dias padrão
 *  pra produto sem fornecedor vinculado) comparado ao estoque mínimo cadastrado.
 *  Puramente informativa — sem pedido de compra formal, a compra em si é feita fora
 *  do app. */
function SuggestionsTab(){
 const today=new Date().toISOString().slice(0,10),monthAgo=new Date(Date.now()-29*86400000).toISOString().slice(0,10);
 const [from,setFrom]=useState(monthAgo),[to,setTo]=useState(today);
 const [suggestions,setSuggestions]=useState<Suggestion[]>([]),[loading,setLoading]=useState(true);
 async function load(){setLoading(true);const r=await fetch(`/api/purchasing/suggestions?from=${from}&to=${to}`);if(r.ok)setSuggestions((await r.json()).suggestions);setLoading(false)}
 useEffect(()=>{load()},[]); // eslint-disable-line react-hooks/exhaustive-deps
 const totalCost=suggestions.reduce((sum,s)=>sum+s.estimatedCost,0);
 return <div className="suggestion-groups">
  <section className="cmv-filters panel">
   <label>Calcular venda média de<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
   <label>até<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
   <button className="secondary" onClick={load}>Aplicar período</button>
  </section>
  {loading?<div className="loading">Calculando…</div>:!suggestions.length?<div className="cmv-empty"><span>▥</span><strong>Nenhuma necessidade de compra no momento</strong><p>Todos os produtos estão com estoque acima do mínimo projetado (ou não há vendas registradas nesse período).</p></div>:
  <section className="panel suggestion-group">
   <div className="table-head"><div><strong>{suggestions.length} produto(s)</strong><span> · estimado {money(totalCost)}</span></div></div>
   <div className="cmv-columns suggestion-columns"><span>Produto</span><span>SKU</span><span>Estoque</span><span>Venda média/dia</span><span>Qtd. sugerida</span><span>Custo estimado</span></div>
   {suggestions.map(i=><div className="cmv-columns suggestion-columns" key={i.id}><span><strong>{i.name}</strong></span><span>{i.sku||"Sem SKU"}</span><span>{i.stock_physical}</span><span>{i.avgDailySales}</span><span><strong>{i.suggestedQuantity}</strong></span><span>{money(i.estimatedCost)}</span></div>)}
  </section>}
 </div>;
}

type ChannelKey="loja_fisica"|"mercado_livre"|"shopee"|"site"|"outros";
const CHANNEL_LABELS:Record<ChannelKey,string>={loja_fisica:"Loja física",mercado_livre:"Mercado Livre",shopee:"Shopee",site:"Site",outros:"Outros"};
type AnalysisRow={blingProductId:string;sku:string;name:string;brand:string;category:string;stock:number;directSales:number;kitSales:number;totalSales:number;salesByChannel:Record<ChannelKey,number>;topChannel:ChannelKey|null;monthlyAverage:number;lastPurchasePrice:number|null;suggestedQuantity:number;estimatedCost:number|null};
type AnalysisSort="total_sales"|"monthly_average"|"stock_asc"|"suggested_quantity"|"estimated_cost"|"brand"|"category";
const SORT_LABELS:Record<AnalysisSort,string>={total_sales:"Maior venda total",monthly_average:"Maior média mensal",stock_asc:"Menor estoque",suggested_quantity:"Maior compra sugerida",estimated_cost:"Maior custo estimado",brand:"Marca",category:"Categoria"};
const int=(v:number)=>v.toLocaleString("pt-BR");
const PERIOD_SHORTCUTS=[["7 dias",7],["15 dias",15],["30 dias",30],["60 dias",60],["90 dias",90]] as const;
const isoDate=(d:Date)=>d.toISOString().slice(0,10);

/** Tela de análise de compras pedida à parte: consolida venda direta + venda explodida de
 *  kits/composições (lib/purchasing.ts's buildPurchaseAnalysis, já roda no servidor) por
 *  produto simples, com venda por canal, média mensal e sugestão simples (média − estoque).
 *  Filtro de canal deliberadamente ausente aqui — o pedido original pede só período/marca/
 *  categoria como filtros principais, com o canal aparecendo quebrado por produto. */
function AnalysisTab(){
 const today=new Date(),monthAgo=new Date(Date.now()-29*86400000);
 const [from,setFrom]=useState(isoDate(monthAgo)),[to,setTo]=useState(isoDate(today));
 const [brand,setBrand]=useState(""),[category,setCategory]=useState("");
 const [sort,setSort]=useState<AnalysisSort>("total_sales");
 const [rows,setRows]=useState<AnalysisRow[]>([]);
 const [summary,setSummary]=useState({totalProducts:0,withSuggestion:0,suggestedUnits:0,estimatedTotalCost:0,withoutNeed:0});
 const [filterOptions,setFilterOptions]=useState<{brands:string[];categories:string[]}>({brands:[],categories:[]});
 const [loading,setLoading]=useState(true);

 async function load(){
  setLoading(true);
  const params=new URLSearchParams({from,to,sort});
  if(brand)params.set("brand",brand);
  if(category)params.set("category",category);
  const r=await fetch(`/api/purchasing/analysis?${params}`);
  if(r.ok){const d=await r.json();setRows(d.rows);setSummary(d.summary);setFilterOptions(d.filters)}
  setLoading(false);
 }
 useEffect(()=>{load()},[]); // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{if(!loading)load()},[sort]); // eslint-disable-line react-hooks/exhaustive-deps

 function applyShortcut(days:number){
  const end=new Date();
  const start=new Date(Date.now()-(days-1)*86400000);
  setFrom(isoDate(start));setTo(isoDate(end));
 }

 const cards=useMemo(()=>[
  ["PRODUTOS ANALISADOS",int(summary.totalProducts),"produtos simples no período"],
  ["COM COMPRA SUGERIDA",int(summary.withSuggestion),"precisam de reposição"],
  ["UNIDADES SUGERIDAS",int(summary.suggestedUnits),"soma de todas as sugestões"],
  ["CUSTO TOTAL ESTIMADO",money(summary.estimatedTotalCost),"sugestão × último preço"],
  ["SEM NECESSIDADE",int(summary.withoutNeed),"estoque cobre a média"],
 ] as const,[summary]);

 return <div className="analysis-area">
  <section className="cmv-filters panel analysis-filters">
   <label>Data inicial<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
   <label>Data final<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
   <label>Marca<select value={brand} onChange={e=>setBrand(e.target.value)}><option value="">Todas as marcas</option>{filterOptions.brands.map(b=><option key={b} value={b}>{b}</option>)}</select></label>
   <label>Categoria<select value={category} onChange={e=>setCategory(e.target.value)}><option value="">Todas as categorias</option>{filterOptions.categories.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
   <label>Ordenar por<select value={sort} onChange={e=>setSort(e.target.value as AnalysisSort)}>{(Object.entries(SORT_LABELS) as [AnalysisSort,string][]).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
   <button className="secondary" onClick={load}>Aplicar</button>
  </section>
  <div className="period-shortcuts">{PERIOD_SHORTCUTS.map(([label,days])=><button key={days} type="button" className="chip" onClick={()=>applyShortcut(days)}>{label}</button>)}</div>

  <section className="cmv-kpis analysis-kpis">{cards.map(([label,value,hint])=><article className="panel" key={label}><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>)}</section>

  {loading?<div className="loading">Calculando…</div>:
  <section className="panel cmv-table">
   <div className="table-head"><strong>{rows.length} produto(s) simples</strong><span> · venda direta + venda em kits, {from} a {to}</span></div>
   {rows.length?<>
    <div className="cmv-columns analysis-columns">
     <span>Produto</span><span>SKU</span><span>Marca</span><span>Categoria</span><span>Estoque</span><span>Venda direta</span><span>Venda em kits</span><span>Venda total</span><span>Loja física</span><span>Mercado Livre</span><span>Shopee</span><span>Site</span><span>Canal top</span><span>Média/mês</span><span>Último preço</span><span>Compra sugerida</span><span>Custo estimado</span>
    </div>
    <div>{rows.map(r=><div className="cmv-columns analysis-columns dark-cells" key={r.blingProductId}>
     <span><strong>{r.name}</strong></span>
     <span>{r.sku||"Sem SKU"}</span>
     <span>{r.brand||"—"}</span>
     <span>{r.category||"—"}</span>
     <span>{int(r.stock)}</span>
     <span>{int(r.directSales)}</span>
     <span>{int(r.kitSales)}</span>
     <span><strong>{int(r.totalSales)}</strong></span>
     <span>{int(r.salesByChannel.loja_fisica)}</span>
     <span>{int(r.salesByChannel.mercado_livre)}</span>
     <span>{int(r.salesByChannel.shopee)}</span>
     <span>{int(r.salesByChannel.site)}</span>
     <span>{r.topChannel?CHANNEL_LABELS[r.topChannel]:"—"}</span>
     <span>{r.monthlyAverage.toLocaleString("pt-BR",{maximumFractionDigits:2})}</span>
     <span>{r.lastPurchasePrice!==null?money(r.lastPurchasePrice):"Sem informação"}</span>
     <span><strong>{int(r.suggestedQuantity)}</strong></span>
     <span>{r.estimatedCost!==null?money(r.estimatedCost):"—"}</span>
    </div>)}</div>
   </>:<div className="cmv-empty"><span>▥</span><strong>Nenhum produto simples encontrado</strong><p>Ajuste o período ou os filtros de marca/categoria.</p></div>}
  </section>}
 </div>;
}
