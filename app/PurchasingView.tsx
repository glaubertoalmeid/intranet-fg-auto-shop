"use client";
import {useEffect,useMemo,useState} from "react";

type Suggestion={id:number;sku:string;name:string;brand:string;category:string;cost:number;stock_physical:number;min_stock:number;avgDailySales:number;suggestedQuantity:number;estimatedCost:number};
type ZeradoItem={id:number;sku:string;name:string;brand:string;category:string;qty30:number;cost:number};

const money=(v:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v||0);
const SEM_CATEGORIA="sem_categoria";

type PurchasingTab="radar"|"necessidade";
export default function PurchasingView(){
 const [tab,setTab]=useState<PurchasingTab>("radar");
 return <div className="cmv-area purchasing-area">
  <header className="cmv-head"><div><p className="eyebrow">COMPRAS</p><h1>O que preciso comprar</h1><p>Radar de reposição e sugestão de compra calculada a partir das vendas.</p></div></header>
  <div className="purchasing-tabs">
   <button className={tab==="radar"?"tab active":"tab"} onClick={()=>setTab("radar")}>Radar de reposição</button>
   <button className={tab==="necessidade"?"tab active":"tab"} onClick={()=>setTab("necessidade")}>Necessidade de compra</button>
  </div>
  {tab==="radar"&&<RadarTab onOpenNecessidade={()=>setTab("necessidade")}/>}
  {tab==="necessidade"&&<SuggestionsTab/>}
 </div>;
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
    <span>Produto / SKU</span><span>Vendas 30d</span><span>Custo</span><span>Categoria</span>
   </div>:null}
   {filteredZerados.length?<div>{filteredZerados.map(z=><div className="cmv-columns radar-columns" key={z.id}><span><strong>{z.name}</strong><small>{z.sku||"Sem SKU"}</small></span><span>{z.qty30}</span><span>{money(z.cost)}</span><span>{z.category||"—"}</span></div>)}</div>
   :<div className="cmv-empty"><span>✓</span><strong>Nenhum produto zerado com venda recente</strong><p>Tudo o que vende tem estoque no momento (com esse filtro).</p></div>}
  </section>
 </div>;
}

const PERIOD_OPTIONS=[{value:7,label:"7 dias"},{value:15,label:"15 dias"},{value:30,label:"30 dias"},{value:60,label:"60 dias"},{value:90,label:"90 dias"},{value:180,label:"180 dias"}];

/** Lista de planejamento: o que comprar, calculado pela venda média no período
 *  escolhido × prazo de entrega (7 dias padrão pra produto sem fornecedor vinculado)
 *  comparado ao estoque mínimo cadastrado. Puramente informativa — sem pedido de
 *  compra formal, a compra em si é feita fora do app. */
function SuggestionsTab(){
 const [suggestions,setSuggestions]=useState<Suggestion[]>([]),[loading,setLoading]=useState(true),[days,setDays]=useState(30);
 async function load(selectedDays:number){setLoading(true);const r=await fetch(`/api/purchasing/suggestions?days=${selectedDays}`);if(r.ok)setSuggestions((await r.json()).suggestions);setLoading(false)}
 useEffect(()=>{load(days)},[days]); // eslint-disable-line react-hooks/exhaustive-deps
 const totalCost=suggestions.reduce((sum,s)=>sum+s.estimatedCost,0);
 return <div className="suggestion-groups">
  <section className="cmv-filters panel">
   <label>Calcular venda média por<select value={days} onChange={e=>setDays(Number(e.target.value))}>{PERIOD_OPTIONS.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
  </section>
  {loading?<div className="loading">Calculando…</div>:!suggestions.length?<div className="cmv-empty"><span>▥</span><strong>Nenhuma necessidade de compra no momento</strong><p>Todos os produtos estão com estoque acima do mínimo projetado.</p></div>:
  <section className="panel suggestion-group">
   <div className="table-head"><div><strong>{suggestions.length} produto(s)</strong><span> · estimado {money(totalCost)}</span></div></div>
   <div className="cmv-columns suggestion-columns"><span>Produto / SKU</span><span>Estoque</span><span>Venda média/dia</span><span>Qtd. sugerida</span><span>Custo estimado</span></div>
   {suggestions.map(i=><div className="cmv-columns suggestion-columns" key={i.id}><span><strong>{i.name}</strong><small>{i.sku||"Sem SKU"}</small></span><span>{i.stock_physical}</span><span>{i.avgDailySales}</span><span><strong>{i.suggestedQuantity}</strong></span><span>{money(i.estimatedCost)}</span></div>)}
  </section>}
 </div>;
}
