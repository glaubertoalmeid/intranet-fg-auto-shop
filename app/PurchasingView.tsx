"use client";
import {FormEvent,useEffect,useState} from "react";

type Supplier={id:number;name:string;contact:string;phone:string;whatsapp:string;email:string;brands:string;lead_time_days:number;payment_terms:string;min_order_value:number;freight:string;notes:string;orderCount:number;productCount:number};
type Suggestion={id:number;sku:string;name:string;cost:number;stock_physical:number;min_stock:number;supplier_id:number|null;supplier_name:string|null;avgDailySales:number;suggestedQuantity:number;estimatedCost:number};
type SuggestionGroup={supplierId:number|null;supplierName:string;items:Suggestion[];totalCost:number};
type RadarSummary={valorARepor:number;itensAbaixoDaRegua:number;zeradosQueVendem:number};
type ZeradoItem={id:number;sku:string;name:string;qty30:number;cost:number;supplierName:string|null};
type Order={id:number;supplier_id:number;supplier_name:string;status:string;itemCount:number;totalCost:number;created_at:string;notes:string};
type OrderItem={id:number;product_id:number;product_name:string;sku:string;quantity:number;unit_cost:number;received_quantity:number};

const money=(v:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v||0);
const statusLabels:Record<string,string>={elaboracao:"Em elaboração",enviado:"Enviado",confirmado:"Confirmado",em_transporte:"Em transporte",recebido_parcial:"Recebido parcialmente",recebido_completo:"Recebido completo",cancelado:"Cancelado"};
const statusFlow=["elaboracao","enviado","confirmado","em_transporte","recebido_completo"];

export default function PurchasingView(){
 const [tab,setTab]=useState<"radar"|"necessidade"|"fornecedores"|"pedidos">("radar");
 return <div className="cmv-area purchasing-area">
  <header className="cmv-head"><div><p className="eyebrow">COMPRAS</p><h1>O que preciso comprar</h1><p>Sugestão calculada, fornecedores e pedidos de compra.</p></div></header>
  <div className="purchasing-tabs">
   <button className={tab==="radar"?"tab active":"tab"} onClick={()=>setTab("radar")}>Radar de reposição</button>
   <button className={tab==="necessidade"?"tab active":"tab"} onClick={()=>setTab("necessidade")}>Necessidade de compra</button>
   <button className={tab==="fornecedores"?"tab active":"tab"} onClick={()=>setTab("fornecedores")}>Fornecedores</button>
   <button className={tab==="pedidos"?"tab active":"tab"} onClick={()=>setTab("pedidos")}>Pedidos de compra</button>
  </div>
  {tab==="radar"&&<RadarTab onOpenNecessidade={()=>setTab("necessidade")}/>}
  {tab==="necessidade"&&<SuggestionsTab/>}
  {tab==="fornecedores"&&<SuppliersTab/>}
  {tab==="pedidos"&&<OrdersTab/>}
 </div>;
}

/** Painel de decisão rápida — antes da lista detalhada por fornecedor (aba Necessidade
 *  de compra), mostra o tamanho do problema em 3 números e os itens mais urgentes:
 *  zerados com venda recente, que não podem esperar o ciclo normal de reposição. */
function RadarTab({onOpenNecessidade}:{onOpenNecessidade:()=>void}){
 const [summary,setSummary]=useState<RadarSummary>({valorARepor:0,itensAbaixoDaRegua:0,zeradosQueVendem:0});
 const [zerados,setZerados]=useState<ZeradoItem[]>([]);
 const [loading,setLoading]=useState(true);
 useEffect(()=>{
  fetch("/api/purchasing/suggestions").then(r=>r.ok?r.json():null).then(d=>{if(d){setSummary(d.summary);setZerados(d.zerados)}}).finally(()=>setLoading(false));
 },[]);
 if(loading)return <div className="loading">Calculando…</div>;
 return <div className="radar-area">
  <section className="cmv-kpis">
   <article className="panel"><span>VALOR A REPOR</span><strong>{money(summary.valorARepor)}</strong><small>soma das sugestões × custo</small></article>
   <article className="panel alert-warning-card"><span>ITENS ABAIXO DA RÉGUA</span><strong>{summary.itensAbaixoDaRegua}</strong><small>produtos na hora de comprar</small></article>
   <article className="panel alert-critical-card"><span>ZERADOS QUE VENDEM</span><strong>{summary.zeradosQueVendem}</strong><small>estoque zero, giro sem saldo — prioridade</small></article>
  </section>
  <section className="panel large">
   <div className="table-head"><div><strong>Zerados que vendem</strong><span> · estoque zero com venda nos últimos 30 dias, ordenado pelo mais urgente</span></div><button className="secondary" onClick={onOpenNecessidade}>Ver necessidade completa →</button></div>
   {zerados.length?<div className="cmv-columns radar-columns">
    <span>Produto / SKU</span><span>Vendas 30d</span><span>Custo</span><span>Fornecedor</span>
   </div>:null}
   {zerados.length?<div>{zerados.map(z=><div className="cmv-columns radar-columns" key={z.id}><span><strong>{z.name}</strong><small>{z.sku||"Sem SKU"}</small></span><span>{z.qty30}</span><span>{money(z.cost)}</span><span>{z.supplierName||"Sem fornecedor"}</span></div>)}</div>
   :<div className="cmv-empty"><span>✓</span><strong>Nenhum produto zerado com venda recente</strong><p>Tudo o que vende tem estoque no momento.</p></div>}
  </section>
 </div>;
}

function SuggestionsTab(){
 const [groups,setGroups]=useState<SuggestionGroup[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState<number|null>(null),[notice,setNotice]=useState("");
 async function load(){setLoading(true);const r=await fetch("/api/purchasing/suggestions");if(r.ok)setGroups((await r.json()).groups);setLoading(false)}
 useEffect(()=>{load()},[]); // eslint-disable-line react-hooks/exhaustive-deps
 async function createOrder(group:SuggestionGroup){
  if(!group.supplierId){setNotice("Vincule um fornecedor a esses produtos (na Visão 360º) antes de gerar o pedido.");return}
  setBusy(group.supplierId);
  const items=group.items.map(i=>({productId:i.id,quantity:i.suggestedQuantity,unitCost:i.cost}));
  const r=await fetch("/api/purchase-orders",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({supplierId:group.supplierId,items})});
  const d=await r.json();setBusy(null);
  if(r.ok){setNotice(`Pedido #${d.id} criado em elaboração.`);await load()}else setNotice(d.error||"Não foi possível criar o pedido.");
 }
 if(loading)return <div className="loading">Calculando…</div>;
 if(!groups.length)return <div className="cmv-empty"><span>▥</span><strong>Nenhuma necessidade de compra no momento</strong><p>Todos os produtos estão com estoque acima do mínimo projetado.</p></div>;
 return <div className="suggestion-groups">
  {notice&&<div className="connection-success cmv-error"><strong>{notice}</strong></div>}
  {groups.map(g=><section className="panel suggestion-group" key={g.supplierId??"sem_fornecedor"}>
   <div className="table-head"><div><strong>{g.supplierName}</strong><span> · {g.items.length} produto(s) · estimado {money(g.totalCost)}</span></div><button className="primary" disabled={busy===g.supplierId} onClick={()=>createOrder(g)}>{busy===g.supplierId?"Criando…":"Criar pedido de compra"}</button></div>
   <div className="cmv-columns suggestion-columns"><span>Produto / SKU</span><span>Estoque</span><span>Venda média/dia</span><span>Qtd. sugerida</span><span>Custo estimado</span></div>
   {g.items.map(i=><div className="cmv-columns suggestion-columns" key={i.id}><span><strong>{i.name}</strong><small>{i.sku||"Sem SKU"}</small></span><span>{i.stock_physical}</span><span>{i.avgDailySales}</span><span><strong>{i.suggestedQuantity}</strong></span><span>{money(i.estimatedCost)}</span></div>)}
  </section>)}
 </div>;
}

function SuppliersTab(){
 const empty={name:"",contact:"",phone:"",whatsapp:"",email:"",brands:"",leadTimeDays:0,paymentTerms:"",minOrderValue:0,freight:"",notes:""};
 const [suppliers,setSuppliers]=useState<Supplier[]>([]),[form,setForm]=useState<typeof empty>(empty),[editing,setEditing]=useState<number|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 async function load(){const r=await fetch("/api/suppliers");if(r.ok)setSuppliers(await r.json())}
 useEffect(()=>{load()},[]); // eslint-disable-line react-hooks/exhaustive-deps
 function edit(s:Supplier){setEditing(s.id);setForm({name:s.name,contact:s.contact,phone:s.phone,whatsapp:s.whatsapp,email:s.email,brands:s.brands,leadTimeDays:s.lead_time_days,paymentTerms:s.payment_terms,minOrderValue:s.min_order_value,freight:s.freight,notes:s.notes})}
 function reset(){setEditing(null);setForm(empty);setError("")}
 async function save(e:FormEvent){e.preventDefault();setBusy(true);setError("");const r=await fetch(editing?`/api/suppliers/${editing}`:"/api/suppliers",{method:editing?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(form)});const d=await r.json();setBusy(false);if(!r.ok){setError(d.error||"Não foi possível salvar.");return}reset();await load()}
 async function remove(s:Supplier){if(!confirm(`Excluir ${s.name}?`))return;const r=await fetch(`/api/suppliers/${s.id}`,{method:"DELETE"});const d=await r.json();if(!r.ok){alert(d.error);return}if(editing===s.id)reset();await load()}
 return <div className="users-grid suppliers-grid">
  <section className="panel user-list"><div className="panel-title"><h2>Fornecedores</h2><button onClick={reset}>+ Novo fornecedor</button></div>
   {suppliers.map(s=><article className="user-row-card" key={s.id}><div className="avatar">{s.name.slice(0,2).toUpperCase()}</div><div><strong>{s.name}</strong><span>{s.contact||"Sem contato"} · prazo {s.lead_time_days||0}d</span><small>{s.productCount} produto(s) · {s.orderCount} pedido(s)</small></div><button className="icon-btn" onClick={()=>edit(s)}>✎</button><button className="icon-btn danger" onClick={()=>remove(s)}>×</button></article>)}
   {!suppliers.length&&<div className="cmv-empty"><span>▤</span><strong>Nenhum fornecedor cadastrado</strong></div>}
  </section>
  <section className="panel user-form"><div className="panel-title"><h2>{editing?"Editar fornecedor":"Novo fornecedor"}</h2>{editing&&<button onClick={reset}>Cancelar</button>}</div>
   <form onSubmit={save}>
    <label>Empresa<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
    <label>Contato<input value={form.contact} onChange={e=>setForm({...form,contact:e.target.value})}/></label>
    <label>Telefone<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
    <label>WhatsApp<input value={form.whatsapp} onChange={e=>setForm({...form,whatsapp:e.target.value})}/></label>
    <label>E-mail<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
    <label>Marcas fornecidas<input placeholder="Vonixx, Vintex…" value={form.brands} onChange={e=>setForm({...form,brands:e.target.value})}/></label>
    <label>Prazo de entrega (dias)<input type="number" value={form.leadTimeDays} onChange={e=>setForm({...form,leadTimeDays:Number(e.target.value)})}/></label>
    <label>Condição de pagamento<input value={form.paymentTerms} onChange={e=>setForm({...form,paymentTerms:e.target.value})}/></label>
    <label>Pedido mínimo (R$)<input type="number" value={form.minOrderValue} onChange={e=>setForm({...form,minOrderValue:Number(e.target.value)})}/></label>
    <label>Frete<input value={form.freight} onChange={e=>setForm({...form,freight:e.target.value})}/></label>
    <label>Observações<textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></label>
    {error&&<div className="form-error">{error}</div>}<button className="primary save-user" disabled={busy}>{busy?"Salvando…":"Salvar fornecedor"}</button>
   </form>
  </section>
 </div>;
}

function OrdersTab(){
 const [orders,setOrders]=useState<Order[]>([]),[detailId,setDetailId]=useState<number|null>(null),[detail,setDetail]=useState<{order:Order;items:OrderItem[]}|null>(null);
 async function load(){const r=await fetch("/api/purchase-orders");if(r.ok)setOrders(await r.json())}
 useEffect(()=>{load()},[]); // eslint-disable-line react-hooks/exhaustive-deps
 async function openDetail(id:number){setDetailId(id);setDetail(null);const r=await fetch(`/api/purchase-orders/${id}`);if(r.ok)setDetail(await r.json())}
 async function advance(order:Order){
  const idx=statusFlow.indexOf(order.status);if(idx<0||idx>=statusFlow.length-1)return;
  await fetch(`/api/purchase-orders/${order.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({status:statusFlow[idx+1]})});
  await load();if(detailId===order.id)await openDetail(order.id);
 }
 async function cancel(order:Order){if(!confirm("Cancelar este pedido?"))return;await fetch(`/api/purchase-orders/${order.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({status:"cancelado"})});await load();if(detailId===order.id)setDetailId(null)}
 async function saveReceiving(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!detail)return;
  const f=new FormData(e.currentTarget);
  const items=detail.items.map(i=>({itemId:i.id,receivedQuantity:Number(f.get(`qty-${i.id}`))}));
  const allReceived=items.every(i=>{const original=detail.items.find(x=>x.id===i.itemId)!;return i.receivedQuantity>=original.quantity});
  await fetch(`/api/purchase-orders/${detail.order.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({items,status:allReceived?"recebido_completo":"recebido_parcial"})});
  await load();await openDetail(detail.order.id);
 }
 return <>
  <section className="panel cmv-table orders-table">
   <div className="cmv-columns orders-columns"><span>Pedido</span><span>Fornecedor</span><span>Status</span><span>Itens</span><span>Valor</span><span></span></div>
   {orders.map(o=><div className="cmv-columns orders-columns" key={o.id}>
    <span><strong>#{o.id}</strong><small>{new Date(o.created_at).toLocaleDateString("pt-BR")}</small></span>
    <span>{o.supplier_name}</span>
    <span><i className={`status-badge status-${o.status}`}>{statusLabels[o.status]}</i></span>
    <span>{o.itemCount}</span>
    <span>{money(o.totalCost)}</span>
    <span className="order-actions"><button className="secondary" onClick={()=>openDetail(o.id)}>Ver</button>{o.status!=="cancelado"&&o.status!=="recebido_completo"&&<button className="secondary" onClick={()=>advance(o)}>Avançar</button>}</span>
   </div>)}
   {!orders.length&&<div className="cmv-empty"><span>▥</span><strong>Nenhum pedido de compra ainda</strong><p>Gere um a partir da aba Necessidade de compra.</p></div>}
  </section>
  {detailId&&<div className="modal-wrap" onClick={()=>setDetailId(null)}><div className="modal modal-wide" onClick={e=>e.stopPropagation()}>
   <div className="modal-head"><h2>Pedido #{detailId}</h2><button onClick={()=>setDetailId(null)}>×</button></div>
   {!detail?<div className="loading">Carregando…</div>:<>
    <div className="product-detail-head"><div><strong>{detail.order.supplier_name}</strong><span>Status: {statusLabels[detail.order.status]}</span></div>
     {detail.order.status!=="cancelado"&&detail.order.status!=="recebido_completo"&&<button className="icon-btn danger" onClick={()=>cancel(detail.order)}>Cancelar pedido</button>}
    </div>
    {detail.order.status==="em_transporte"||detail.order.status==="confirmado"?
     <form onSubmit={saveReceiving} className="receiving-form">
      <div className="cmv-columns receiving-columns"><span>Produto</span><span>Pedido</span><span>Recebido</span></div>
      {detail.items.map(i=><div className="cmv-columns receiving-columns" key={i.id}><span><strong>{i.product_name}</strong><small>{i.sku}</small></span><span>{i.quantity}</span><span><input name={`qty-${i.id}`} type="number" step="1" min="0" max={i.quantity} defaultValue={i.received_quantity||i.quantity}/></span></div>)}
      <button className="primary">Registrar conferência de mercadoria</button>
     </form>
     :<div className="cmv-columns receiving-columns"><span>Produto</span><span>Pedido</span><span>Recebido</span></div>}
    {detail.order.status!=="em_transporte"&&detail.order.status!=="confirmado"&&detail.items.map(i=><div className="cmv-columns receiving-columns" key={i.id}><span><strong>{i.product_name}</strong><small>{i.sku}</small></span><span>{i.quantity}</span><span>{i.received_quantity||"—"}</span></div>)}
   </>}
  </div></div>}
 </>;
}
