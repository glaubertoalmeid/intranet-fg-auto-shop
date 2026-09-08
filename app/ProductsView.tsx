"use client";
import {FormEvent,useEffect,useState} from "react";

type Alert="zerado"|"abaixo_minimo"|"excesso"|"parado_30"|"parado_60"|"parado_90";
type Product={id:number;bling_product_id:string;sku:string;name:string;brand:string;category:string;supplier:string;cost:number;sale_price:number;stock_physical:number;min_stock:number;max_stock:number;location:string;status:string;last_sale_at:string;qty30:number;qty60:number;qty90:number;revenue90:number;abcClass:"A"|"B"|"C";alerts:Alert[]};
type Summary={total:number;zerado:number;abaixoMinimo:number;parado90:number;estoqueValorCusto:number};
type ListResponse={products:Product[];filters:{brands:string[];categories:string[]};summary:Summary};
type Detail={product:Record<string,unknown>;sales:{qty30:number;qty60:number;qty90:number;revenue30:number};listings:{id:number;platform:string;status:string;sale_price:number;ml_permalink:string;ml_publish_status:string;shopee_item_id:string;shopee_publish_status:string}[];alerts:Alert[];daysOfCoverage:number|null;needsPurchase:boolean};

const money=(v:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v||0);
const alertLabels:Record<Alert,string>={zerado:"Estoque zerado",abaixo_minimo:"Abaixo do mínimo",excesso:"Excesso de estoque",parado_30:"30 dias sem venda",parado_60:"60 dias sem venda",parado_90:"90 dias sem venda"};
const alertClass:Record<Alert,string>={zerado:"alert-critical",abaixo_minimo:"alert-warning",excesso:"alert-info",parado_30:"alert-muted",parado_60:"alert-muted",parado_90:"alert-critical"};

export default function ProductsView({openProductId}:{openProductId?:number|null}={}){
 const [data,setData]=useState<ListResponse|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[error,setError]=useState("");
 const [q,setQ]=useState(""),[brand,setBrand]=useState(""),[category,setCategory]=useState(""),[alert,setAlertFilter]=useState("");
 const [detailId,setDetailId]=useState<number|null>(null),[detail,setDetail]=useState<Detail|null>(null);

 async function load(){
  setLoading(true);
  const params=new URLSearchParams();if(q)params.set("q",q);if(brand)params.set("brand",brand);if(category)params.set("category",category);if(alert)params.set("alert",alert);
  const r=await fetch(`/api/products?${params}`);if(r.ok)setData(await r.json());
  setLoading(false);
 }
 useEffect(()=>{load()},[]); // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{const t=setTimeout(load,300);return()=>clearTimeout(t)},[q,brand,category,alert]); // eslint-disable-line react-hooks/exhaustive-deps
 // Vindo da busca global (Ctrl+K): abre direto o produto clicado.
 useEffect(()=>{if(openProductId)openDetail(openProductId)},[openProductId]); // eslint-disable-line react-hooks/exhaustive-deps

 async function sync(){
  setBusy(true);setError("");setNotice("Consultando catálogo e estoque no Bling…");
  try{const r=await fetch("/api/products",{method:"POST"}),d=await r.json();if(!r.ok)throw new Error(d.error||"Não foi possível sincronizar.");await load();setNotice(`${d.imported} produto(s) sincronizados.`)}
  catch(e){setNotice("");setError(e instanceof Error?e.message:"Não foi possível sincronizar os produtos.")}
  finally{setBusy(false)}
 }

 async function openDetail(id:number){setDetailId(id);setDetail(null);const r=await fetch(`/api/products/${id}`);if(r.ok)setDetail(await r.json())}
 async function saveDetail(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!detailId)return;
  const f=new FormData(e.currentTarget);
  const r=await fetch(`/api/products/${detailId}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({minStock:Number(f.get("minStock")),maxStock:Number(f.get("maxStock")),location:f.get("location"),subcategory:f.get("subcategory")})});
  if(r.ok){await openDetail(detailId);await load()}
 }

 const products=data?.products||[],filters=data?.filters||{brands:[],categories:[]},summary=data?.summary||{total:0,zerado:0,abaixoMinimo:0,parado90:0,estoqueValorCusto:0};

 return <div className="cmv-area products-area">
  <header className="cmv-head"><div><p className="eyebrow">PRODUTOS E ESTOQUE</p><h1>Cadastro mestre e alertas</h1><p>Visão 360º de cada produto, sincronizada do Bling.</p></div><div className="head-actions"><button className="primary" disabled={busy} onClick={sync}>{busy?"Sincronizando…":"↻ Sincronizar com o Bling"}</button></div></header>
  {error&&<div className="form-error cmv-error">{error}</div>}{notice&&<div className="connection-success cmv-error"><strong>{busy?"↻ ":"✓ "}{notice}</strong></div>}

  <section className="cmv-kpis products-kpis">
   <article className="panel"><span>PRODUTOS CADASTRADOS</span><strong>{summary.total}</strong></article>
   <article className="panel alert-critical-card"><span>ESTOQUE ZERADO</span><strong>{summary.zerado}</strong></article>
   <article className="panel alert-warning-card"><span>ABAIXO DO MÍNIMO</span><strong>{summary.abaixoMinimo}</strong></article>
   <article className="panel alert-muted-card"><span>90+ DIAS SEM VENDA</span><strong>{summary.parado90}</strong></article>
   <article className="panel"><span>ESTOQUE A CUSTO</span><strong>{money(summary.estoqueValorCusto)}</strong></article>
  </section>

  <section className="cmv-filters panel products-filters">
   <label>Buscar<input placeholder="Nome, SKU ou GTIN" value={q} onChange={e=>setQ(e.target.value)}/></label>
   <label>Marca<select value={brand} onChange={e=>setBrand(e.target.value)}><option value="">Todas as marcas</option>{filters.brands.map(b=><option key={b} value={b}>{b}</option>)}</select></label>
   <label>Categoria<select value={category} onChange={e=>setCategory(e.target.value)}><option value="">Todas as categorias</option>{filters.categories.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
   <label>Alerta<select value={alert} onChange={e=>setAlertFilter(e.target.value)}><option value="">Todos</option>{Object.entries(alertLabels).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
  </section>

  <section className="panel cmv-table products-table">
   <div className="cmv-columns products-columns"><span>Produto / SKU</span><span>Marca</span><span>Estoque</span><span>Vendas 30d</span><span>Curva</span><span>Alertas</span></div>
   {loading?<div className="loading">Carregando…</div>:products.length?<div>{products.map(p=>
    <button className="cmv-columns products-columns product-row" key={p.id} onClick={()=>openDetail(p.id)}>
     <span><strong>{p.name}</strong><small>{p.sku||"Sem SKU"}</small></span>
     <span>{p.brand||"—"}</span>
     <span>{p.stock_physical}</span>
     <span>{p.qty30}</span>
     <span><em className={`abc-badge abc-${p.abcClass}`}>{p.abcClass}</em></span>
     <span className="alert-badges">{p.alerts.length?p.alerts.slice(0,2).map(a=><i className={alertClass[a]} key={a}>{alertLabels[a]}</i>):<i className="alert-ok">Sem alertas</i>}</span>
    </button>)}
   </div>:<div className="cmv-empty"><span>▥</span><strong>Nenhum produto cadastrado</strong><p>Clique em Sincronizar com o Bling para importar o catálogo.</p></div>}
  </section>

  {detailId&&<div className="modal-wrap" onClick={()=>setDetailId(null)}><div className="modal modal-wide" onClick={e=>e.stopPropagation()}>
   <div className="modal-head"><h2>Visão 360º do produto</h2><button onClick={()=>setDetailId(null)}>×</button></div>
   {!detail?<div className="loading">Carregando…</div>:<>
    <div className="product-detail-head">
     <div><strong>{String(detail.product.name)}</strong><span>{String(detail.product.sku||"Sem SKU")} · {String(detail.product.brand||"Sem marca")}</span></div>
     {detail.needsPurchase&&<span className="alert-critical">Necessidade de compra: SIM</span>}
    </div>
    <div className="product-detail-grid">
     <div><span>Estoque atual</span><strong>{String(detail.product.stock_physical)}</strong></div>
     <div><span>Custo</span><strong>{money(Number(detail.product.cost))}</strong></div>
     <div><span>Preço de venda</span><strong>{money(Number(detail.product.sale_price))}</strong></div>
     <div><span>Vendas 30 dias</span><strong>{detail.sales.qty30} un.</strong></div>
     <div><span>Vendas 90 dias</span><strong>{detail.sales.qty90} un.</strong></div>
     <div><span>Cobertura</span><strong>{detail.daysOfCoverage!=null?`${detail.daysOfCoverage.toFixed(0)} dias`:"—"}</strong></div>
    </div>
    {detail.alerts.length>0&&<div className="detail-alerts">{detail.alerts.map(a=><i className={alertClass[a]} key={a}>{alertLabels[a]}</i>)}</div>}
    {detail.listings.length>0&&<div className="detail-listings"><strong>Anúncios</strong>{detail.listings.map(l=><span key={l.id}>{l.platform==="ml"||l.platform==="ambos"?`Mercado Livre: ${l.ml_publish_status||"—"}`:""} {l.shopee_item_id?`· Shopee: ${l.shopee_publish_status||"—"}`:""}</span>)}</div>}
    <form onSubmit={saveDetail} className="product-edit-form">
     <label>Estoque mínimo<input name="minStock" type="number" step="1" defaultValue={String(detail.product.min_stock)}/></label>
     <label>Estoque máximo<input name="maxStock" type="number" step="1" defaultValue={String(detail.product.max_stock)}/></label>
     <label>Localização física<input name="location" defaultValue={String(detail.product.location||"")}/></label>
     <label>Subcategoria<input name="subcategory" defaultValue={String(detail.product.subcategory||"")}/></label>
     <button className="primary">Salvar</button>
    </form>
   </>}
  </div></div>}
 </div>;
}
