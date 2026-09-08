"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import ListingCatalogView from "./ListingCatalogView";
import CnpjLookupView from "./CnpjLookupView";
import CmvReportView from "./CmvReportView";
import ComercialView from "./ComercialView";
import ProductsView from "./ProductsView";
import PurchasingView from "./PurchasingView";

type Task = { id:number; title:string; detail:string; priority:string; due_date:string; completed:number; created_by:string; assigned_user_id:number|null; assigned_name:string|null; assigned_email:string|null };
type TeamMember = { id:number; name:string; username:string };
type EventItem = { id:number; title:string; description:string; event_date:string; category:string; created_by:string };
type MaterialItem = { id:number; name:string; description:string; url:string; category:string; tone:string };
type AuthUser = { id:number; name:string; username:string; role:"master"|"user"; permissions:string[] };
type ManagedUser = AuthUser & { active:number; created_at:string; reset_requested_at:string|null };
type Section = "painel" | "calendario" | "tarefas" | "materiais" | "preco_ecommerce" | "anuncios" | "cnpj" | "relatorios_cmv" | "comercial" | "produtos" | "compras" | "usuarios";

const nav = [
  { id:"painel" as Section, icon:"▦", label:"Painel inicial" },
  { id:"calendario" as Section, icon:"□", label:"Datas e campanhas" },
  { id:"tarefas" as Section, icon:"✓", label:"Tarefas" },
  { id:"materiais" as Section, icon:"▣", label:"Materiais e Drives" },
  { id:"preco_ecommerce" as Section, icon:"⚙", label:"Configuração de preços" },
  { id:"anuncios" as Section, icon:"▤", label:"Catálogo de Anúncios" },
  { id:"cnpj" as Section, icon:"⌕", label:"Consulta de CNPJ" },
  { id:"relatorios_cmv" as Section, icon:"▥", label:"Rentabilidade e CMV" },
  { id:"comercial" as Section, icon:"↗", label:"Comercial" },
  { id:"produtos" as Section, icon:"⬡", label:"Produtos e Estoque" },
  { id:"compras" as Section, icon:"⇪", label:"Compras" },
  { id:"usuarios" as Section, icon:"♙", label:"Usuários e acessos" },
];

const formatDate = (date:string) => date ? new Intl.DateTimeFormat("pt-BR", {day:"2-digit", month:"short"}).format(new Date(date + "T12:00:00")) : "Sem prazo";
const initials = (name:string) => name.split(/\s+/).slice(0,2).map(p=>p[0]).join("").toUpperCase();

export default function Intranet() {
  const [auth,setAuth] = useState<AuthUser|null>(null);
  const [authLoading,setAuthLoading] = useState(true);
  const [setupRequired,setSetupRequired] = useState(false);
  const [section,setSection] = useState<Section>("painel");
  const [tasks,setTasks] = useState<Task[]>([]);
  const [team,setTeam] = useState<TeamMember[]>([]);
  const [events,setEvents] = useState<EventItem[]>([]);
  const [loading,setLoading] = useState(true);
  const [taskOpen,setTaskOpen] = useState(false);
  const [editingTask,setEditingTask] = useState<Task|null>(null);
  const [eventOpen,setEventOpen] = useState(false);
  const [editingEvent,setEditingEvent] = useState<EventItem|null>(null);
  const [menuOpen,setMenuOpen] = useState(false);
  const [deepLink,setDeepLink] = useState<{productId?:number;orderId?:number;supplierId?:number}>({});

  async function loadAuth(){
    try {
      const response=await fetch("/api/auth/status");
      const contentType=response.headers.get("content-type")??"";
      if(!contentType.includes("application/json"))throw new Error("O acesso está temporariamente indisponível. Atualize a página e tente novamente.");
      const data=await response.json();
      setAuth(data.user??null);
      setSetupRequired(Boolean(data.setupRequired));
    } finally { setAuthLoading(false); }
  }
  async function loadAll(user=auth){
    try {
      const requests:Promise<void>[]=[];
      if(user?.permissions.includes("tarefas")) requests.push(fetch("/api/tasks").then(async r=>{if(r.ok)setTasks(await r.json())}));
      if(user?.role==="master") requests.push(fetch("/api/team").then(async r=>{if(r.ok)setTeam(await r.json())}));
      if(user?.permissions.includes("calendario")) requests.push(fetch("/api/events").then(async r=>{if(r.ok)setEvents(await r.json())}));
      await Promise.all(requests);
    } finally { setLoading(false); }
  }
  useEffect(()=>{ loadAuth(); },[]);
  useEffect(()=>{
    if(!auth)return;
    loadAll(auth);
    const first=nav.find(n=>auth.permissions.includes(n.id));
    if(first&&!auth.permissions.includes(section))setSection(first.id);
  },[auth]);

  const pending = tasks.filter(t=>!t.completed);
  const today = new Date();
  const upcoming = useMemo(()=>events.filter(e=>new Date(e.event_date+"T23:59:59")>=today).slice(0,5),[events]);

  async function addTask(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); const f=new FormData(e.currentTarget);
    const response=await fetch(editingTask?`/api/tasks/${editingTask.id}`:"/api/tasks",{method:editingTask?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(Object.fromEntries(f))});
    if(response.ok){setTaskOpen(false);setEditingTask(null);await loadAll()}
  }
  function openTask(task:Task|null=null){setEditingTask(task);setTaskOpen(true)}
  async function addEvent(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); const f=new FormData(e.currentTarget);
    const url=editingEvent?`/api/events/${editingEvent.id}`:"/api/events";
    await fetch(url,{method:editingEvent?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(Object.fromEntries(f))});
    setEventOpen(false); setEditingEvent(null); await loadAll();
  }
  function openEvent(event:EventItem|null=null){setEditingEvent(event);setEventOpen(true)}
  async function toggleTask(t:Task){
    setTasks(v=>v.map(x=>x.id===t.id?{...x,completed:x.completed?0:1}:x));
    await fetch(`/api/tasks/${t.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({completed:!t.completed})});
  }
  async function removeTask(id:number){ await fetch(`/api/tasks/${id}`,{method:"DELETE"}); setTasks(v=>v.filter(t=>t.id!==id)); }
  async function removeEvent(id:number){ await fetch(`/api/events/${id}`,{method:"DELETE"}); setEvents(v=>v.filter(e=>e.id!==id)); }

  function goToProduct(id:number){setDeepLink({productId:id});setSection("produtos")}
  function goToSupplier(id:number){setDeepLink({supplierId:id});setSection("compras")}
  function goToOrder(id:number){setDeepLink({orderId:id});setSection("compras")}
  function goToTask(){setSection("tarefas")}

  if(authLoading)return <div className="auth-screen"><div className="loading">Verificando acesso…</div></div>;
  if(!auth)return <AuthScreen setupRequired={setupRequired} onAuthenticated={loadAuth}/>;
  const can=(permission:string)=>auth.role==="master"||auth.permissions.includes(permission);
  const permittedNav=nav.filter(n=>can(n.id));
  const userName=auth.name;
  const title = section==="painel"?"Visão geral":section==="calendario"?"Datas comemorativas e campanhas":section==="materiais"?"Materiais de fornecedores":section==="preco_ecommerce"?"Configuração de preços":section==="anuncios"?"Catálogo de Anúncios":section==="cnpj"?"Consulta de CNPJ":section==="relatorios_cmv"?"Rentabilidade e CMV":section==="comercial"?"Comercial":section==="produtos"?"Produtos e Estoque":section==="compras"?"Compras":section==="usuarios"?"Usuários e acessos":"Tarefas e pendências";
  return <div className="app-shell">
    <aside className={menuOpen?"sidebar open":"sidebar"}>
      <div className="brand"><img className="brand-logo" src="/logo-fg-auto-header.png" alt="FG Auto — Distribuidora Car Care"/><span className="brand-app-label">INTRANET</span></div>
      <nav>
        {permittedNav.map(n=><button key={n.id} className={section===n.id?"nav-item active":"nav-item"} onClick={()=>{setSection(n.id);setMenuOpen(false)}}><span>{n.icon}</span>{n.label}</button>)}
        {can("operacional")&&<>
        <a className="nav-item shop-link external-first" href="https://loja.fgauto.com.br/" target="_blank" rel="noopener noreferrer"><span>↗</span>Loja FG Auto</a>
        <a className="nav-item marketplace-link" href="https://fgautos.lojavirtualnuvem.com.br/admin/dashboard" target="_blank" rel="noopener noreferrer"><span className="market-badge nuvem">N</span>Admin Nuvemshop</a>
        <a className="nav-item marketplace-link" href="https://www.mercadolivre.com.br/" target="_blank" rel="noopener noreferrer"><span className="market-badge ml">ML</span>Mercado Livre</a>
        <a className="nav-item marketplace-link" href="https://seller.shopee.com.br/" target="_blank" rel="noopener noreferrer"><span className="market-badge shopee">S</span>Central Shopee</a>
        <a className="nav-item marketplace-link" href="https://www.bling.com.br/inicio" target="_blank" rel="noopener noreferrer"><span className="market-badge bling">B</span>ERP Bling</a>
        <a className="nav-item marketplace-link" href="https://web.whatsapp.com/" target="_blank" rel="noopener noreferrer"><span className="market-badge whatsapp">W</span>WhatsApp Web</a>
        <a className="nav-item marketplace-link" href="https://app.joddaia.com.br/dashboard" target="_blank" rel="noopener noreferrer"><span className="market-badge jodda">J</span>Jodda IA</a>
        </>}
        {can("bancos")&&<>
        <a className="nav-item marketplace-link bank-link-first" href="https://banco.bradesco/html/corporate/net-empresa/index.shtm" target="_blank" rel="noopener noreferrer"><span className="market-badge bradesco">B</span>Bradesco Empresa</a>
        <a className="nav-item marketplace-link" href="https://aapj.bb.com.br/aapj/loginpfe.bb" target="_blank" rel="noopener noreferrer"><span className="market-badge bb">BB</span>Banco do Brasil PJ</a>
        </>}
      </nav>
      <div className="sidebar-foot"><div className="status-dot"/><div><strong>{auth.role==="master"?"Usuário Master":auth.username}</strong><small>Dados sincronizados</small></div><button className="logout-btn" onClick={async()=>{await fetch("/api/auth/logout",{method:"POST"});setAuth(null)}}>Sair</button></div>
    </aside>
    {menuOpen&&<button className="scrim" aria-label="Fechar menu" onClick={()=>setMenuOpen(false)}/>}

    <main className="main">
      <header className="topbar"><button className="menu-btn" onClick={()=>setMenuOpen(true)}>☰</button><div><p>FG Auto Shop <span>/ {title}</span></p></div><GlobalSearch onProduct={goToProduct} onSupplier={goToSupplier} onOrder={goToOrder} onTask={goToTask}/><div className="user"><div className="avatar">{initials(userName)}</div><div><strong>{userName}</strong><small>Equipe FG Auto</small></div></div></header>
      <div className="page">
        {section!=="preco_ecommerce"&&section!=="anuncios"&&section!=="cnpj"&&section!=="relatorios_cmv"&&section!=="produtos"&&section!=="compras"&&section!=="comercial"&&<section className="page-head"><div><p className="eyebrow">CENTRAL DE OPERAÇÕES</p><h1>{section==="painel"?`Olá, ${userName.split(" ")[0]}!`:title}</h1><p>{section==="painel"?"Acompanhe as prioridades e campanhas da equipe em um só lugar.":section==="calendario"?"Catálogo anual para planejar promoções, brindes, kits, frete grátis e sorteios.":section==="materiais"?"Acesse fotos, vídeos e materiais de divulgação disponibilizados pelos fornecedores.":section==="usuarios"?"Crie logins e defina quais módulos cada pessoa pode acessar.":auth.role==="master"?"Atribua tarefas à equipe e acompanhe todas as pendências.":"Acompanhe somente as tarefas direcionadas a você."}</p></div>{section!=="materiais"&&section!=="usuarios"&&<div className="head-actions">{section!=="calendario"&&can("calendario")&&<button className="secondary" onClick={()=>openEvent()}>+ Nova data</button>} {section!=="tarefas"&&auth.role==="master"&&can("tarefas")&&<button className="primary" onClick={()=>openTask()}>+ Nova tarefa</button>}</div>}</section>}

        {loading?<div className="loading">Carregando informações…</div>:section==="painel"?<>
          <section className="stat-grid">
            <article className="stat-card"><div className="stat-icon blue">✓</div><div><span>TAREFAS PENDENTES</span><strong>{pending.length}</strong><small>{tasks.filter(t=>t.completed).length} concluídas</small></div></article>
            <article className="stat-card"><div className="stat-icon violet">□</div><div><span>PRÓXIMAS CAMPANHAS</span><strong>{upcoming.length}</strong><small>no calendário</small></div></article>
            <article className="stat-card"><div className="stat-icon green">↗</div><div><span>STATUS DA EQUIPE</span><strong>Online</strong><small>dados compartilhados</small></div></article>
          </section>
          <section className="dashboard-grid">
            <div className="panel"><PanelTitle title="Prioridades da equipe" action="Ver tarefas" onClick={()=>setSection("tarefas")}/><div className="list">{pending.slice(0,5).map(t=><TaskRow key={t.id} task={t} toggle={()=>toggleTask(t)}/>)}{!pending.length&&<Empty text="Nenhuma pendência. Tudo em dia!"/>}</div></div>
            <div className="panel"><PanelTitle title="Próximas campanhas" action="Ver calendário" onClick={()=>setSection("calendario")}/><div className="list">{upcoming.map(e=><EventRow key={e.id} event={e}/>) }{!upcoming.length&&<Empty text="Nenhuma campanha cadastrada."/>}</div></div>
          </section>
        </>:section==="tarefas"?<section className="panel large"><div className="table-head"><div><strong>{pending.length} pendências</strong><span> · {tasks.filter(t=>t.completed).length} concluídas</span></div>{auth.role==="master"&&<button className="primary" onClick={()=>openTask()}>+ Nova tarefa</button>}</div><div className="list">{tasks.map(t=><div className={t.completed?"task-row done":"task-row"} key={t.id}><TaskRow task={t} toggle={()=>toggleTask(t)}/>{auth.role==="master"&&<><button className="icon-btn" onClick={()=>openTask(t)} aria-label="Editar">✎</button><button className="icon-btn danger" onClick={()=>removeTask(t.id)} aria-label="Excluir">×</button></>}</div>)}{!tasks.length&&<Empty text={auth.role==="master"?"Crie a primeira tarefa da equipe.":"Nenhuma tarefa foi atribuída a você."}/>}</div></section>
        :section==="materiais"?<MaterialsView/>
        :section==="preco_ecommerce"?<PriceEcommerceView/>
        :section==="anuncios"?<ListingCatalogView isMaster={auth.role==="master"}/>
        :section==="cnpj"?<CnpjLookupView/>
        :section==="relatorios_cmv"?<CmvReportView isMaster={auth.role==="master"}/>
        :section==="comercial"?<ComercialView/>
        :section==="produtos"?<ProductsView openProductId={deepLink.productId}/>
        :section==="compras"?<PurchasingView initialTab={deepLink.orderId?"pedidos":deepLink.supplierId?"fornecedores":undefined} openOrderId={deepLink.orderId} openSupplierId={deepLink.supplierId}/>
        :section==="usuarios"?<UsersView/>
        :<CalendarView events={events} onAdd={()=>openEvent()} onEdit={openEvent} onRemove={removeEvent}/>} 
      </div>
    </main>
    {taskOpen&&<Modal title={editingTask?"Editar e reatribuir tarefa":"Nova tarefa"} close={()=>{setTaskOpen(false);setEditingTask(null)}}><form onSubmit={addTask}><label>Tarefa<input name="title" required defaultValue={editingTask?.title??""} placeholder="Ex.: Atualizar preços da campanha"/></label><label>Detalhes<textarea name="detail" defaultValue={editingTask?.detail??""} placeholder="Informações para a equipe"/></label><label>Responsável<select name="assigned_user_id" required defaultValue={editingTask?.assigned_user_id??""}><option value="" disabled>Selecione uma pessoa</option>{team.map(member=><option value={member.id} key={member.id}>{member.name} — {member.username}</option>)}</select></label><div className="form-grid"><label>Prioridade<select name="priority" defaultValue={editingTask?.priority??"media"}><option value="alta">Alta</option><option value="media">Média</option><option value="baixa">Baixa</option></select></label><label>Prazo<input name="due_date" type="date" defaultValue={editingTask?.due_date??""}/></label></div><ModalActions close={()=>{setTaskOpen(false);setEditingTask(null)}}/></form></Modal>}
    {eventOpen&&<Modal title={editingEvent?"Editar data ou campanha":"Nova data ou campanha"} close={()=>{setEventOpen(false);setEditingEvent(null)}}><form onSubmit={addEvent}><label>Nome da data<input name="title" required defaultValue={editingEvent?.title??""} placeholder="Ex.: Dia do Motorista"/></label><label>Descrição da oferta<textarea name="description" defaultValue={editingEvent?.description??""} placeholder="Oferta, ideia ou observação"/></label><div className="form-grid"><label>Data<input name="event_date" type="date" required defaultValue={editingEvent?.event_date??""}/></label><label>Tipo de campanha<select name="category" defaultValue={editingEvent?.category??"Desconto"}><option>Desconto</option><option>Brinde</option><option>Kit especial</option><option>Frete grátis</option><option>Sorteio</option></select></label></div><ModalActions close={()=>{setEventOpen(false);setEditingEvent(null)}}/></form></Modal>}
  </div>;
}

function AuthScreen({setupRequired,onAuthenticated}:{setupRequired:boolean;onAuthenticated:()=>Promise<void>}){
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [forgot,setForgot]=useState(false);
  const [notice,setNotice]=useState("");
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); setError(""); setBusy(true);
    const form=new FormData(e.currentTarget);
    const values=Object.fromEntries(form);
    if(setupRequired&&values.password!==values.confirmPassword){setError("As senhas não coincidem.");setBusy(false);return}
    try{
      const response=await fetch(setupRequired?"/api/auth/setup":"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(values)});
      const contentType=response.headers.get("content-type")??"";
      if(!contentType.includes("application/json"))throw new Error("O acesso está temporariamente indisponível. Atualize a página e tente novamente.");
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Não foi possível entrar.");
      await onAuthenticated();
    }catch(err){setError(err instanceof Error?err.message:"Não foi possível entrar.");}
    finally{setBusy(false)}
  }
  async function requestReset(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError("");setNotice("");
    const form=new FormData(e.currentTarget);
    try{const response=await fetch("/api/auth/forgot-password",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:form.get("username")})}),data=await response.json();if(!response.ok)throw new Error(data.error||"Não foi possível enviar a solicitação.");setNotice(data.message)}
    catch(err){setError(err instanceof Error?err.message:"Não foi possível enviar a solicitação.")}
    finally{setBusy(false)}
  }
  return <main className="auth-screen"><section className="auth-card">
    <img src="/logo-fg-auto-header.png" alt="FG Auto Shop"/>
    <p className="eyebrow">INTRANET FG AUTO SHOP</p>
    <h1>{setupRequired?"Criar usuário Master":forgot?"Recuperar acesso":"Acesso da equipe"}</h1>
    <p>{setupRequired?"Este primeiro usuário terá acesso total e poderá cadastrar toda a equipe.":forgot?"Informe seu e-mail. O usuário Master receberá a solicitação para criar uma senha temporária.":"Entre com seu e-mail e senha para acessar a intranet."}</p>
    {forgot?<form onSubmit={requestReset}>
      <label>E-mail<input name="username" type="email" required autoCapitalize="none" autoComplete="email" placeholder="nome@empresa.com.br"/></label>
      {notice&&<div className="connection-success"><strong>✓ Solicitação enviada</strong><p>{notice}</p></div>}
      {error&&<div className="form-error">{error}</div>}
      <button className="primary auth-submit" disabled={busy}>{busy?"Enviando…":"Solicitar nova senha"}</button>
      <button type="button" className="auth-link" onClick={()=>{setForgot(false);setError("");setNotice("")}}>← Voltar para o login</button>
    </form>:<form onSubmit={submit}>
      {setupRequired&&<label>Nome completo<input name="name" required autoComplete="name" placeholder="Seu nome"/></label>}
      <label>E-mail<input name="username" type="email" required autoCapitalize="none" autoComplete="email" placeholder="nome@empresa.com.br"/></label>
      <label>Senha<input name="password" type="password" required minLength={8} autoComplete={setupRequired?"new-password":"current-password"} placeholder="Mínimo de 8 caracteres"/></label>
      {setupRequired&&<label>Confirmar senha<input name="confirmPassword" type="password" required minLength={8} autoComplete="new-password"/></label>}
      {error&&<div className="form-error">{error}</div>}
      <button className="primary auth-submit" disabled={busy}>{busy?"Aguarde…":setupRequired?"Criar Master e entrar":"Entrar"}</button>
      {!setupRequired&&<button type="button" className="auth-link" onClick={()=>{setForgot(true);setError("")}}>Esqueci minha senha</button>}
    </form>}
    <small>Por segurança, nunca envie sua senha por WhatsApp ou pelo chat.</small>
  </section></main>
}

const permissionLabels:Record<string,string>={
  painel:"Painel inicial",calendario:"Datas e campanhas",tarefas:"Tarefas",
  materiais:"Materiais e Drives",preco_ecommerce:"Configuração de preços",anuncios:"Catálogo de Anúncios",cnpj:"Consulta de CNPJ",relatorios_cmv:"Rentabilidade e CMV",comercial:"Comercial",produtos:"Produtos e Estoque",compras:"Compras",operacional:"Loja, marketplaces, Bling e WhatsApp",
  bancos:"Contas bancárias"
};

type AuditRow={id:number;user_name:string;action:string;target:string;detail:string;created_at:string};
const auditLabels:Record<string,string>={"cmv.sync":"Sincronizou vendas (CMV)","pricing.create":"Criou precificação","pricing.update":"Alterou preço/custo","pricing.delete":"Excluiu precificação","listing.publish_ml":"Publicou no Mercado Livre","listing.publish_shopee":"Publicou na Shopee","integration.credentials":"Alterou credenciais de integração","user.update":"Alterou usuário/permissões","user.delete":"Excluiu usuário"};
function AuditLogView(){
  const [rows,setRows]=useState<AuditRow[]>([]);const [loading,setLoading]=useState(true);
  useEffect(()=>{fetch("/api/audit").then(r=>r.ok?r.json():[]).then(setRows).finally(()=>setLoading(false))},[]);
  return <section className="panel audit-log"><div className="panel-title"><h2>Log de auditoria</h2><span>Quem alterou preço, custo, credenciais, anúncios e usuários</span></div>
    {loading?<div className="loading">Carregando…</div>:rows.length?<div className="audit-rows">{rows.map(row=><div className="audit-row" key={row.id}><strong>{row.user_name||"—"}</strong><span>{auditLabels[row.action]||row.action}</span><small>{row.target}{row.detail?` · ${row.detail}`:""}</small><time>{new Date(row.created_at).toLocaleString("pt-BR")}</time></div>)}</div>:<div className="cmv-empty"><span>▤</span><strong>Nenhum evento registrado ainda</strong></div>}
  </section>;
}
function UsersView(){
  const empty={name:"",username:"",password:"",role:"user",active:true,permissions:["painel"]};
  const [users,setUsers]=useState<ManagedUser[]>([]);
  const [form,setForm]=useState<any>(empty);
  const [editing,setEditing]=useState<number|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  async function load(){const r=await fetch("/api/users");if(r.ok)setUsers(await r.json())}
  useEffect(()=>{load()},[]);
  function edit(user:ManagedUser){setEditing(user.id);setError("");setForm({name:user.name,username:user.username,password:"",role:user.role,active:Boolean(user.active),permissions:user.permissions})}
  function reset(){setEditing(null);setError("");setForm(empty)}
  function togglePermission(key:string){setForm((v:any)=>({...v,permissions:v.permissions.includes(key)?v.permissions.filter((p:string)=>p!==key):[...v.permissions,key]}))}
  async function save(e:FormEvent){
    e.preventDefault();setBusy(true);setError("");
    const payload={...form,active:form.role==="master"?true:form.active};
    if(editing&&!payload.password)delete payload.password;
    const r=await fetch(editing?`/api/users/${editing}`:"/api/users",{method:editing?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
    const data=await r.json();
    if(!r.ok)setError(data.error||"Não foi possível salvar.");
    else{reset();await load()}
    setBusy(false);
  }
  async function remove(user:ManagedUser){
    if(user.role==="master"||!confirm(`Excluir o acesso de ${user.name}?`))return;
    const r=await fetch(`/api/users/${user.id}`,{method:"DELETE"});
    if(r.ok){if(editing===user.id)reset();await load()}
  }
  return <div className="users-area">
    <section className="users-summary"><div><strong>{users.length}</strong><span>usuários cadastrados</span></div><div><strong>{users.filter(u=>u.active).length}</strong><span>acessos ativos</span></div><div className={users.some(u=>u.reset_requested_at)?"reset-summary pending":"reset-summary"}><strong>{users.filter(u=>u.reset_requested_at).length}</strong><span>pedidos de nova senha</span></div><p>O Master sempre possui acesso completo.</p></section>
    <div className="users-grid">
      <section className="panel user-list"><div className="panel-title"><h2>Equipe</h2><button onClick={reset}>+ Novo usuário</button></div>
        {users.map(user=><article className={user.reset_requested_at?"user-row-card reset-pending":"user-row-card"} key={user.id}><div className="avatar">{initials(user.name)}</div><div><strong>{user.name}</strong><span>{user.username} · {user.role==="master"?"Master":"Equipe"}</span><small>{user.reset_requested_at?"Solicitou uma nova senha":user.role==="master"?"Acesso total":user.permissions.map(p=>permissionLabels[p]||p).join(", ")}</small></div><span className={user.reset_requested_at?"reset-request":user.active?"access-active":"access-blocked"}>{user.reset_requested_at?"Redefinir senha":user.active?"Ativo":"Bloqueado"}</span><button className="icon-btn" onClick={()=>edit(user)}>✎</button><button className="icon-btn danger" disabled={user.role==="master"} onClick={()=>remove(user)}>×</button></article>)}
      </section>
      <section className="panel user-form"><div className="panel-title"><h2>{editing?"Editar usuário":"Novo usuário"}</h2>{editing&&<button onClick={reset}>Cancelar</button>}</div>
        <form onSubmit={save}>{editing&&users.find(user=>user.id===editing)?.reset_requested_at&&<div className="reset-alert"><strong>Este usuário solicitou uma nova senha</strong><p>Defina uma senha temporária abaixo e informe-a diretamente ao usuário.</p></div>}<label>Nome completo<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>E-mail<input type="email" required autoCapitalize="none" autoComplete="email" value={form.username} onChange={e=>setForm({...form,username:e.target.value})}/></label><label>{editing?"Nova senha (opcional)":"Senha inicial"}<input type="password" required={!editing||Boolean(users.find(user=>user.id===editing)?.reset_requested_at)} minLength={8} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder={editing?"Mínimo de 8 caracteres":""}/></label>
          <div className="permission-head"><strong>Permissões</strong><span>Escolha o que esta pessoa poderá acessar.</span></div>
          <div className="permission-grid">{Object.entries(permissionLabels).map(([key,label])=><label className="permission-check" key={key}><input type="checkbox" checked={form.permissions.includes(key)} onChange={()=>togglePermission(key)}/><span>{label}</span></label>)}</div>
          <label className="active-check"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> Usuário ativo</label>
          {error&&<div className="form-error">{error}</div>}<button className="primary save-user" disabled={busy}>{busy?"Salvando…":"Salvar usuário"}</button>
        </form>
      </section>
    </div>
    <AuditLogView/>
  </div>
}

function PriceEcommerceView(){return <section className="price-module"><iframe src="/api/preco-ecommerce" title="Preço E-commerce — Mercado Livre e Shopee"/></section>}

type SearchProduct={id:number;sku:string;name:string;brand:string;stock_physical:number};
type SearchSupplier={id:number;name:string;contact:string};
type SearchOrder={id:number;status:string;supplier_name:string};
type SearchTask={id:number;title:string;priority:string;completed:number};
type SearchResults={products:SearchProduct[];suppliers:SearchSupplier[];purchaseOrders:SearchOrder[];tasks:SearchTask[]};
const emptySearch:SearchResults={products:[],suppliers:[],purchaseOrders:[],tasks:[]};

/** Busca global (Ctrl+K) na barra superior — produtos, fornecedores, pedidos de compra e
 *  tarefas, cada seção só aparece se o resultado da API trouxer algo (a API já filtra por
 *  permissão do usuário). Clicar num resultado navega direto pro item. */
function GlobalSearch({onProduct,onSupplier,onOrder,onTask}:{onProduct:(id:number)=>void;onSupplier:(id:number)=>void;onOrder:(id:number)=>void;onTask:()=>void}){
 const [query,setQuery] = useState("");
 const [results,setResults] = useState<SearchResults>(emptySearch);
 const [open,setOpen] = useState(false);
 const inputRef = useRef<HTMLInputElement>(null);
 const boxRef = useRef<HTMLDivElement>(null);

 useEffect(()=>{
  function onKeyDown(e:KeyboardEvent){
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();inputRef.current?.focus();inputRef.current?.select()}
   else if(e.key==="Escape"){setOpen(false);inputRef.current?.blur()}
  }
  function onClickOutside(e:MouseEvent){if(boxRef.current&&!boxRef.current.contains(e.target as Node))setOpen(false)}
  window.addEventListener("keydown",onKeyDown);document.addEventListener("mousedown",onClickOutside);
  return ()=>{window.removeEventListener("keydown",onKeyDown);document.removeEventListener("mousedown",onClickOutside)};
 },[]);

 useEffect(()=>{
  if(query.trim().length<2){setResults(emptySearch);return}
  const t=setTimeout(async()=>{
   const r=await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
   if(r.ok)setResults(await r.json());
  },250);
  return ()=>clearTimeout(t);
 },[query]);

 const hasResults=results.products.length||results.suppliers.length||results.purchaseOrders.length||results.tasks.length;
 function pick(action:()=>void){action();setQuery("");setResults(emptySearch);setOpen(false)}

 return <div className="global-search" ref={boxRef}>
  <span className="global-search-icon">⌕</span>
  <input ref={inputRef} value={query} placeholder="Buscar em todo o app… Ctrl+K" onFocus={()=>setOpen(true)} onChange={e=>{setQuery(e.target.value);setOpen(true)}}/>
  <kbd>Ctrl K</kbd>
  {open&&query.trim().length>=2&&<div className="global-search-results">
   {!hasResults&&<div className="global-search-empty">Nenhum resultado para "{query}"</div>}
   {results.products.length>0&&<div className="global-search-group"><small>PRODUTOS</small>{results.products.map(p=><button key={p.id} onClick={()=>pick(()=>onProduct(p.id))}><strong>{p.name}</strong><span>{p.sku||"Sem SKU"} · estoque {p.stock_physical}</span></button>)}</div>}
   {results.suppliers.length>0&&<div className="global-search-group"><small>FORNECEDORES</small>{results.suppliers.map(s=><button key={s.id} onClick={()=>pick(()=>onSupplier(s.id))}><strong>{s.name}</strong><span>{s.contact||"Sem contato"}</span></button>)}</div>}
   {results.purchaseOrders.length>0&&<div className="global-search-group"><small>PEDIDOS DE COMPRA</small>{results.purchaseOrders.map(o=><button key={o.id} onClick={()=>pick(()=>onOrder(o.id))}><strong>Pedido #{o.id}</strong><span>{o.supplier_name||"Sem fornecedor"} · {o.status}</span></button>)}</div>}
   {results.tasks.length>0&&<div className="global-search-group"><small>TAREFAS</small>{results.tasks.map(t=><button key={t.id} onClick={()=>pick(onTask)}><strong>{t.title}</strong><span>{t.completed?"Concluída":"Pendente"} · prioridade {t.priority}</span></button>)}</div>}
  </div>}
 </div>;
}

function PanelTitle({title,action,onClick}:{title:string;action:string;onClick:()=>void}){return <div className="panel-title"><h2>{title}</h2><button onClick={onClick}>{action} →</button></div>}
function Empty({text}:{text:string}){return <div className="empty"><span>✓</span><p>{text}</p></div>}
function TaskRow({task,toggle}:{task:Task;toggle:()=>void}){return <div className="task-content"><button className={task.completed?"check checked":"check"} onClick={toggle}>{task.completed?"✓":""}</button><div className="row-main"><strong>{task.title}</strong><span>{task.detail||"Sem observações"}</span>{task.assigned_name&&<small className="task-assignee">Responsável: {task.assigned_name}</small>}</div><div className="row-meta"><span className={`priority ${task.priority}`}>{task.priority}</span><small>{formatDate(task.due_date)}</small></div></div>}
function EventRow({event}:{event:EventItem}){const [day,mon]=formatDate(event.event_date).replace(".","").split(" de ");return <div className="event-row"><div className="date-tile"><strong>{day}</strong><span>{mon}</span></div><div className="row-main"><strong>{event.title}</strong><span>{event.description||event.category}</span></div></div>}
function CalendarView({events,onAdd,onEdit,onRemove}:{events:EventItem[];onAdd:()=>void;onEdit:(e:EventItem)=>void;onRemove:(id:number)=>void}){
  const [filter,setFilter]=useState("Todos"); const [search,setSearch]=useState("");
  const types=["Todos","Desconto","Brinde","Kit especial","Frete grátis","Sorteio"];
  const filtered=events.filter(e=>(filter==="Todos"||e.category===filter)&&(`${e.title} ${e.description}`.toLowerCase().includes(search.toLowerCase())));
  const count=(type:string)=>events.filter(e=>e.category===type).length;
  return <div className="campaign-module">
    <section className="campaign-stats"><div><strong>{events.length}</strong><span>datas no catálogo</span></div>{types.slice(1).map(t=><div key={t}><strong>{count(t)}</strong><span>{t}</span></div>)}</section>
    <section className="panel large campaign-panel"><div className="catalog-tools"><div className="filter-chips">{types.map(t=><button key={t} className={filter===t?"filter-chip selected":"filter-chip"} onClick={()=>setFilter(t)}>{t}{t!=="Todos"&&<small>{count(t)}</small>}</button>)}</div><input className="catalog-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar data ou campanha…"/></div><div className="table-head"><div><strong>{filtered.length} datas encontradas</strong><span> · catálogo anual compartilhado</span></div><button className="primary" onClick={onAdd}>+ Nova data</button></div><div className="calendar-list">{filtered.map(e=><div className={`calendar-card campaign-${slugType(e.category)}`} key={e.id}><div className="calendar-date"><strong>{new Date(e.event_date+"T12:00:00").getDate()}</strong><span>{new Intl.DateTimeFormat("pt-BR",{month:"short"}).format(new Date(e.event_date+"T12:00:00"))}</span></div><div className="row-main"><span className="category">{e.category}</span><strong>{e.title}</strong><p>{e.description||"Sem descrição"}</p></div><button className="icon-btn" onClick={()=>onEdit(e)} aria-label="Editar">✎</button><button className="icon-btn danger" onClick={()=>onRemove(e.id)} aria-label="Excluir">×</button></div>)}{!filtered.length&&<Empty text="Nenhuma data encontrada com esses filtros."/>}</div></section>
  </div>
}
function slugType(type:string){return type.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g,"-")}
function MaterialsView(){
  const empty={name:"",description:"",url:"",category:"Fornecedor",tone:"blue"};
  const [items,setItems]=useState<MaterialItem[]>([]);
  const [form,setForm]=useState(empty);
  const [editing,setEditing]=useState<MaterialItem|null>(null);
  const [open,setOpen]=useState(false);
  const [error,setError]=useState("");
  async function load(){const response=await fetch("/api/materials");if(response.ok)setItems(await response.json())}
  useEffect(()=>{load()},[]);
  function add(){setEditing(null);setForm(empty);setError("");setOpen(true)}
  function edit(item:MaterialItem){setEditing(item);setForm({name:item.name,description:item.description,url:item.url,category:item.category,tone:item.tone});setError("");setOpen(true)}
  async function save(e:FormEvent){e.preventDefault();const response=await fetch(editing?`/api/materials/${editing.id}`:"/api/materials",{method:editing?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(form)});const data=await response.json();if(!response.ok){setError(data.error||"Não foi possível salvar.");return}setOpen(false);await load()}
  async function remove(item:MaterialItem){if(!confirm(`Excluir "${item.name}"?`))return;const response=await fetch(`/api/materials/${item.id}`,{method:"DELETE"});if(response.ok)await load()}
  return <div className="materials-area">
    <div className="materials-note"><span>i</span><div><strong>Biblioteca de materiais para postagem</strong><p>Renomeie, edite links, acrescente novas pastas ou exclua materiais. As alterações ficam disponíveis para toda a equipe.</p></div><button className="primary materials-add" onClick={add}>+ Adicionar material</button></div>
    <div className="drive-grid">{items.map(item=><article className={item.url?"drive-card editable":"drive-card editable pending"} key={item.id}><div className={`drive-icon ${item.tone}`}>{item.category==="FG Auto"?"FG":"▰"}</div><div className="drive-info"><small>GOOGLE DRIVE · {item.category.toUpperCase()}</small><h2>{item.name}</h2><p>{item.description||"Sem descrição."}</p>{item.url?<a href={item.url} target="_blank" rel="noopener noreferrer">Abrir pasta ↗</a>:<span>Link pendente</span>}</div><div className="drive-actions"><button className="icon-btn" onClick={()=>edit(item)} aria-label="Editar">✎</button><button className="icon-btn danger" onClick={()=>remove(item)} aria-label="Excluir">×</button></div></article>)}{!items.length&&<Empty text="Adicione o primeiro material da equipe."/>}</div>
    {open&&<Modal title={editing?"Editar material":"Adicionar material"} close={()=>setOpen(false)}><form onSubmit={save}><label>Nome<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Ex.: Materiais Vonixx"/></label><label>Descrição<textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Fotos, vídeos e materiais para postagem"/></label><label>Link da pasta<input type="url" value={form.url} onChange={e=>setForm({...form,url:e.target.value})} placeholder="https://drive.google.com/..."/></label><div className="form-grid"><label>Categoria<input value={form.category} onChange={e=>setForm({...form,category:e.target.value})} placeholder="Fornecedor"/></label><label>Cor<select value={form.tone} onChange={e=>setForm({...form,tone:e.target.value})}><option value="blue">Azul</option><option value="green">Verde</option><option value="violet">Roxo</option><option value="orange">Laranja</option></select></label></div>{error&&<div className="form-error">{error}</div>}<ModalActions close={()=>setOpen(false)}/></form></Modal>}
  </div>
}
function Modal({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}){return <div className="modal-wrap" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><div className="modal"><div className="modal-head"><h2>{title}</h2><button onClick={close}>×</button></div>{children}</div></div>}
function ModalActions({close}:{close:()=>void}){return <div className="modal-actions"><button type="button" className="secondary" onClick={close}>Cancelar</button><button type="submit" className="primary">Salvar</button></div>}
