"use client";
import {FormEvent,useEffect,useState} from "react";

type Status={configured:boolean;connected:boolean;clientId:string;companyId:string;lastError:string;callbackUrl:string;webhookUrl:string};
type Product={product_id:string;sku:string;product_name:string;quantity:number;revenue:number;cmv:number;profit:number;margin:number;markup:number;costEstimated:boolean};
type Filters={channels:string[];brands:string[];categories:string[];sellers:string[]};
type Report={products:Product[];totals:{revenue:number;cmv:number;profit:number;margin:number};filters:Filters};
const money=(v:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v);

export default function CmvReportView({isMaster}:{isMaster:boolean}){
 const today=new Date().toISOString().slice(0,10),monthAgo=new Date(Date.now()-31*86400000).toISOString().slice(0,10);
 const [status,setStatus]=useState<Status|null>(null),[settings,setSettings]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[report,setReport]=useState<Report|null>(null);
 const [from,setFrom]=useState(monthAgo),[to,setTo]=useState(today),[channel,setChannel]=useState(""),[brand,setBrand]=useState(""),[category,setCategory]=useState(""),[seller,setSeller]=useState(""),[product,setProduct]=useState("");

 async function loadStatus(){const s=await fetch("/api/marketplaces/bling/settings");if(s.ok)setStatus(await s.json())}
 async function loadReport(){
  const params=new URLSearchParams({from,to});
  if(channel)params.set("channel",channel);if(brand)params.set("brand",brand);if(category)params.set("category",category);if(seller)params.set("seller",seller);if(product)params.set("product",product);
  const r=await fetch(`/api/marketplaces/bling/cmv?${params}`);if(r.ok)setReport(await r.json());
 }
 useEffect(()=>{loadStatus();loadReport()},[]); // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{loadReport()},[channel,brand,category,seller]); // eslint-disable-line react-hooks/exhaustive-deps

 async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError("");const f=new FormData(e.currentTarget),r=await fetch("/api/marketplaces/bling/settings",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({clientId:f.get("clientId"),clientSecret:f.get("clientSecret")})}),d=await r.json();setBusy(false);if(!r.ok){setError(d.error||"Não foi possível salvar.");return}setSettings(false);await loadStatus()}
 function connect(){location.href="/api/marketplaces/bling/authorize"}
 async function sync(){setBusy(true);setError("");setNotice("Consultando vendas, itens e custos no Bling…");try{const r=await fetch("/api/marketplaces/bling/cmv",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({from,to})}),d=await r.json();if(!r.ok)throw new Error(d.error||"Não foi possível sincronizar.");await loadReport();setNotice(`${d.sales} venda(s) e ${d.items} item(ns) sincronizados.`)}catch(e){setNotice("");setError(e instanceof Error?e.message:"Não foi possível sincronizar as vendas.")}finally{setBusy(false)}}
 async function applyPeriod(){await loadReport()}
 async function exportExcel(){
  const XLSX=await import("xlsx");
  const rows=products.map(p=>({"Produto":p.product_name,"SKU":p.sku,"Quantidade":p.quantity,"Faturamento":p.revenue,"CMV":p.cmv,"Lucro bruto":p.profit,"Margem %":Number(p.margin.toFixed(1)),"Markup":p.markup?Number(p.markup.toFixed(2)):"",'Custo estimado':p.costEstimated?"Sim":"Não"}));
  const sheet=XLSX.utils.json_to_sheet(rows),book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,sheet,"CMV");
  XLSX.writeFile(book,`cmv-${from}_a_${to}.xlsx`);
 }

 const totals=report?.totals||{revenue:0,cmv:0,profit:0,margin:0},products=report?.products||[],filters=report?.filters||{channels:[],brands:[],categories:[],sellers:[]};
 return <div className="cmv-area"><header className="cmv-head"><div><p className="eyebrow">GESTÃO DE RENTABILIDADE</p><h1>CMV e margem</h1><p>Vendas, custos e resultado por produto integrados ao Bling.</p></div><div className="head-actions">{isMaster&&<button className="secondary" onClick={()=>setSettings(true)}>⚙ Configurar Bling</button>}<button className="primary" disabled={!status?.configured||busy} onClick={status?.connected?sync:connect}>{status?.connected?(busy?"Sincronizando…":"↻ Sincronizar vendas"):"Conectar ao Bling"}</button></div></header>
 <section className={status?.connected?"bling-banner connected":"bling-banner"}><span>{status?.connected?"✓":"B"}</span><div><strong>{status?.connected?"Bling conectado":"Conecte o Bling para gerar o relatório"}</strong><p>{status?.connected?"A integração está autorizada. A próxima sincronização importará vendas, produtos e custos.":"Use o aplicativo Bling com acesso de leitura a Produtos e Pedidos de venda."}</p></div>{status?.connected&&<small>Conexão ativa</small>}</section>
 {error&&<div className="form-error cmv-error">{error}</div>}{notice&&<div className="connection-success cmv-error"><strong>{busy?"↻ ":"✓ "}{notice}</strong></div>}
 <section className="cmv-filters panel">
  <label>Período<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
  <label>até<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
  <label>Canal<select value={channel} onChange={e=>setChannel(e.target.value)}><option value="">Todos os canais</option>{filters.channels.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
  <label>Produto<input placeholder="Nome ou SKU" value={product} onChange={e=>setProduct(e.target.value)} onBlur={loadReport}/></label>
  <label>Marca<select value={brand} onChange={e=>setBrand(e.target.value)}><option value="">Todas as marcas</option>{filters.brands.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
  <label>Categoria<select value={category} onChange={e=>setCategory(e.target.value)}><option value="">Todas as categorias</option>{filters.categories.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
  <label>Vendedor<select value={seller} onChange={e=>setSeller(e.target.value)}><option value="">Todos os vendedores</option>{filters.sellers.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
  <button className="secondary" onClick={applyPeriod}>Aplicar período</button>
 </section>
 <section className="cmv-kpis">{[["FATURAMENTO LÍQUIDO",totals.revenue],["CMV",totals.cmv],["LUCRO BRUTO",totals.profit],["MARGEM",totals.margin]].map(([label,value],i)=><article className="panel" key={String(label)}><span>{label}</span><strong>{i===3?`${Number(value).toFixed(1).replace(".",",")}%`:money(Number(value))}</strong><small>{i===0?"vendas − descontos − devoluções":i===1?"quantidade × custo histórico":i===2?"faturamento líquido − CMV":"lucro bruto ÷ faturamento líquido"}</small></article>)}</section>
 <section className="panel cmv-table"><div className="table-head"><div><strong>Rentabilidade por produto</strong><span> · custo histórico priorizado</span></div><button className="secondary" disabled={!products.length} onClick={exportExcel}>⇩ Exportar Excel</button></div><div className="cmv-columns"><span>Produto / SKU</span><span>Qtd.</span><span>Faturamento</span><span>CMV</span><span>Lucro bruto</span><span>Margem</span><span>Markup</span></div>{products.length?<div>{products.map(p=><div className="cmv-columns" key={`${p.product_id}-${p.sku}`}><span><strong>{p.product_name}</strong><small>{p.sku||"Sem SKU"}{p.costEstimated?" · custo atual/estimado":""}</small></span><span>{p.quantity}</span><span>{money(p.revenue)}</span><span>{money(p.cmv)}</span><span>{money(p.profit)}</span><span>{p.margin.toFixed(1).replace(".",",")}%</span><span>{p.markup?p.markup.toFixed(2).replace(".",","):"—"}</span></div>)}</div>:<div className="cmv-empty"><span>▥</span><strong>{status?.connected?"Pronto para a primeira sincronização":"Nenhuma venda carregada"}</strong><p>{status?.connected?"Clique em Sincronizar vendas para importar os dados do Bling.":"Configure e autorize o Bling para calcular CMV e margem."}</p></div>}</section>
 <div className="cost-note"><strong>Como o custo será tratado</strong><p>O relatório usará primeiro o custo registrado na época da venda. Quando ele não existir, usará o custo atual do produto como estimativa e exibirá um alerta na linha.</p></div>
 {settings&&<div className="modal-wrap"><div className="modal"><div className="modal-head"><h2>Configurar aplicativo Bling</h2><button onClick={()=>setSettings(false)}>×</button></div><div className="import-note"><strong>URL de redirecionamento</strong><code>{status?.callbackUrl||`${location.origin}/api/marketplaces/bling/callback`}</code><p>Cadastre esta URL exatamente igual no aplicativo criado no Bling.</p></div><form onSubmit={save}><label>Client ID<input name="clientId" required autoComplete="off" defaultValue={status?.clientId||""}/></label><label>Client Secret<input name="clientSecret" type="password" required autoComplete="new-password"/></label>{error&&<div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary" onClick={()=>setSettings(false)}>Cancelar</button><button className="primary" disabled={busy}>{busy?"Salvando…":"Salvar com segurança"}</button></div></form></div></div>}
 </div>
}
