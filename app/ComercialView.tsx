"use client";
import {useEffect,useState} from "react";

type Group={label:string;revenue:number;cmv:number;profit:number;margin:number;quantity:number;orders:number;ticketMedio:number};
type Data={from:string;to:string;empty?:boolean;totals:Group;byChannel:Group[];bySeller:Group[];byBrand:Group[];byCategory:Group[];topProducts:(Group&{sku:string})[];bottomProducts:(Group&{sku:string})[];topCustomers:Group[];leaders:{revenueLeader:Group|null;profitLeader:Group|null}};

const money=(v:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v||0);
const pct=(v:number)=>`${(v||0).toFixed(1).replace(".",",")}%`;

export default function ComercialView(){
 const today=new Date().toISOString().slice(0,10),monthAgo=new Date(Date.now()-31*86400000).toISOString().slice(0,10);
 const [from,setFrom]=useState(monthAgo),[to,setTo]=useState(today),[data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(true),[tab,setTab]=useState<"canais"|"produtos"|"clientes">("canais");

 async function load(){setLoading(true);const r=await fetch(`/api/commercial?from=${from}&to=${to}`);if(r.ok)setData(await r.json());setLoading(false)}
 useEffect(()=>{load()},[]); // eslint-disable-line react-hooks/exhaustive-deps

 const totals=data?.totals||{revenue:0,cmv:0,profit:0,margin:0,quantity:0,orders:0,ticketMedio:0};
 const {revenueLeader,profitLeader}=data?.leaders||{revenueLeader:null,profitLeader:null};
 const sameLeader=revenueLeader&&profitLeader&&revenueLeader.label===profitLeader.label;

 return <div className="cmv-area comercial-area">
  <header className="cmv-head"><div><p className="eyebrow">COMERCIAL</p><h1>De onde vem o faturamento</h1><p>Canais, vendedores, marcas, categorias, produtos e clientes.</p></div></header>

  <section className="cmv-filters panel comercial-filters">
   <label>Período<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
   <label>até<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
   <button className="secondary" onClick={load}>Aplicar período</button>
  </section>

  {loading?<div className="loading">Carregando…</div>:data?.empty?<div className="cmv-empty"><span>▥</span><strong>Ainda não há vendas sincronizadas</strong><p>Sincronize o CMV em Rentabilidade e CMV para alimentar o Comercial.</p></div>:<>
   <section className="cmv-kpis comercial-kpis">
    <article className="panel"><span>FATURAMENTO</span><strong>{money(totals.revenue)}</strong></article>
    <article className="panel"><span>PEDIDOS</span><strong>{totals.orders}</strong></article>
    <article className="panel"><span>TICKET MÉDIO</span><strong>{money(totals.ticketMedio)}</strong></article>
    <article className="panel"><span>LUCRO BRUTO</span><strong>{money(totals.profit)}</strong></article>
    <article className="panel"><span>MARGEM</span><strong>{pct(totals.margin)}</strong></article>
   </section>

   {revenueLeader&&profitLeader&&<section className="leader-callout">
    <div><span>CANAL QUE MAIS VENDE</span><strong>{revenueLeader.label}</strong><small>{money(revenueLeader.revenue)} em faturamento</small></div>
    <div><span>CANAL QUE MAIS DÁ LUCRO</span><strong>{profitLeader.label}</strong><small>{money(profitLeader.profit)} de lucro · {pct(profitLeader.margin)} de margem</small></div>
    {!sameLeader&&<p className="leader-note">São canais diferentes — faturar mais não é o mesmo que lucrar mais; comissão e frete corroem a margem de forma desigual entre canais.</p>}
   </section>}

   <div className="purchasing-tabs">
    <button className={tab==="canais"?"tab active":"tab"} onClick={()=>setTab("canais")}>Canais, vendedores, marcas</button>
    <button className={tab==="produtos"?"tab active":"tab"} onClick={()=>setTab("produtos")}>Produtos</button>
    <button className={tab==="clientes"?"tab active":"tab"} onClick={()=>setTab("clientes")}>Clientes</button>
   </div>

   {tab==="canais"&&<div className="comercial-groups">
    <GroupTable title="Por canal" rows={data?.byChannel||[]}/>
    <GroupTable title="Por vendedor" rows={data?.bySeller||[]}/>
    <GroupTable title="Por marca" rows={data?.byBrand||[]}/>
    <GroupTable title="Por categoria" rows={data?.byCategory||[]}/>
   </div>}

   {tab==="produtos"&&<div className="comercial-groups">
    <ProductTable title="Produtos mais vendidos" rows={data?.topProducts||[]}/>
    <ProductTable title="Produtos menos vendidos" rows={data?.bottomProducts||[]}/>
   </div>}

   {tab==="clientes"&&<section className="panel cmv-table">
    <div className="cmv-columns comercial-columns"><span>Cliente</span><span>Pedidos</span><span>Faturamento</span><span>Ticket médio</span></div>
    {(data?.topCustomers||[]).length?data!.topCustomers.map(c=><div className="cmv-columns comercial-columns" key={c.label}><span>{c.label}</span><span>{c.orders}</span><span>{money(c.revenue)}</span><span>{money(c.ticketMedio)}</span></div>):<div className="cmv-empty"><span>▥</span><strong>Sem dados de cliente</strong><p>O Bling não retornou nome de contato para os pedidos do período.</p></div>}
   </section>}
  </>}
 </div>;
}

function GroupTable({title,rows}:{title:string;rows:Group[]}){
 return <section className="panel cmv-table comercial-group-table">
  <div className="table-head"><strong>{title}</strong></div>
  <div className="cmv-columns comercial-columns"><span>{title.replace("Por ","")}</span><span>Pedidos</span><span>Faturamento</span><span>Margem</span></div>
  {rows.length?rows.map(r=><div className="cmv-columns comercial-columns" key={r.label}><span>{r.label}</span><span>{r.orders}</span><span>{money(r.revenue)}</span><span>{pct(r.margin)}</span></div>):<div className="cmv-empty small"><p>Sem dados no período.</p></div>}
 </section>;
}

function ProductTable({title,rows}:{title:string;rows:(Group&{sku:string})[]}){
 return <section className="panel cmv-table comercial-group-table">
  <div className="table-head"><strong>{title}</strong></div>
  <div className="cmv-columns comercial-columns"><span>Produto</span><span>Qtd.</span><span>Faturamento</span><span>Margem</span></div>
  {rows.length?rows.map(r=><div className="cmv-columns comercial-columns" key={`${r.label}-${r.sku}`}><span><strong>{r.label}</strong><small>{r.sku}</small></span><span>{r.quantity}</span><span>{money(r.revenue)}</span><span>{pct(r.margin)}</span></div>):<div className="cmv-empty small"><p>Sem dados no período.</p></div>}
 </section>;
}
