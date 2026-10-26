"use client";
import {FormEvent, useEffect, useMemo, useState} from "react";

type AttendanceStatus = "novo"|"aguardando_equipe"|"aguardando_cliente"|"retorno_agendado"|"encerrado";
type CommercialStage = "primeiro_contato"|"identificacao_necessidade"|"orcamento_enviado"|"negociacao"|"pedido_fechado"|"encerrado_sem_venda";
type Priority = "quente"|"morno"|"frio";
type CloseReason = "venda"|"recusa"|"falta_interesse"|"pedido_nao_contatar";
type FollowupStatus = "planejado"|"realizado"|"suspenso_por_resposta"|"cancelado";

type NextAction = {id:string;scheduledDate:string;attemptNumber:number;suggestedMessage:string|null;overdue:boolean};
type Lead = {
 id:string;name:string;phone:string;origin:string|null;interest:string|null;budgetValue:number|null;
 assignedUserId:number|null;assignedName:string|null;attendanceStatus:AttendanceStatus;commercialStage:CommercialStage;
 priority:Priority|null;priorityReason:string|null;closeReason:CloseReason|null;isDemo:boolean;createdAt:string;updatedAt:string;
 lastMessageReceivedAt:string|null;lastMessageSentAt:string|null;whoActsNow:"equipe"|"cliente"|"ninguem";
 nextAction:NextAction|null;attemptsRealized:number;incomplete:boolean;
};
type TimelineEntry={id:string;lead_id:string;kind:string;body:string|null;is_automated:number|null;source:string;created_by:string|null;occurred_at:string;created_at:string};
type Followup={id:string;lead_id:string;attempt_number:number;status:FollowupStatus;scheduled_date:string;suggested_message:string|null;note:string|null;completed_at:string|null;created_by:string|null};
type LeadDetail = Lead & {timeline:TimelineEntry[];followups:Followup[]};
type TeamMember={id:number;name:string};
type AuthUser={id:number;name:string;username:string;role:"master"|"user";permissions:string[]};
type Summary={novosNoPeriodo:number;aguardandoEquipe:number;aguardandoCliente:number;retornosHoje:number;retornosAtrasados:number;pedidosFechados:number;health:{lastEventAt:string|null;totalEvents:number;totalIdentified:number;pendingUnidentified:number;webhookNeverReceivedRealEvent:boolean;recentFailures:{received_at:string;note:string}[]}};

const ATTENDANCE_LABELS:Record<AttendanceStatus,string>={novo:"Novo / sem classificação",aguardando_equipe:"Aguardando equipe",aguardando_cliente:"Aguardando cliente",retorno_agendado:"Retorno agendado",encerrado:"Encerrado"};
const STAGE_LABELS:Record<CommercialStage,string>={primeiro_contato:"Primeiro contato",identificacao_necessidade:"Identificação da necessidade",orcamento_enviado:"Orçamento enviado",negociacao:"Negociação",pedido_fechado:"Pedido fechado",encerrado_sem_venda:"Encerrado sem venda"};
const STAGES:CommercialStage[]=["primeiro_contato","identificacao_necessidade","orcamento_enviado","negociacao","pedido_fechado","encerrado_sem_venda"];
const PRIORITY_LABELS:Record<Priority,string>={quente:"Quente",morno:"Morno",frio:"Frio"};
const CLOSE_REASON_LABELS:Record<CloseReason,string>={venda:"Venda",recusa:"Recusa",falta_interesse:"Falta de interesse",pedido_nao_contatar:"Pedido para não contatar"};
const FOLLOWUP_STATUS_LABELS:Record<FollowupStatus,string>={planejado:"Planejado",realizado:"Realizado",suspenso_por_resposta:"Suspenso por resposta",cancelado:"Cancelado"};
const SUGGESTED_MESSAGES=[
 "Oi! Ficou alguma dúvida sobre os produtos que conversamos? Posso ajudar na escolha.",
 "Olá! Conseguiu avaliar as opções? Se quiser, posso ajustar a seleção ao que você precisa.",
 "Oi! Ainda está procurando os produtos? Posso conferir as opções e condições atuais pra você.",
 "Olá! Quer que eu retome o atendimento ou prefere combinar outra data?",
 "Oi! Vou encerrar este acompanhamento por enquanto. Quando precisar, é só chamar a FG Auto Shop.",
];

const fmtDateTime=(iso:string|null)=>iso?new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Fortaleza",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(iso)):"Sem informação";
const fmtDate=(iso:string|null)=>iso?new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Fortaleza",day:"2-digit",month:"2-digit",year:"numeric"}).format(new Date(iso+(iso.length<=10?"T12:00:00":""))):"—";
const todayIso=()=>new Date().toLocaleDateString("en-CA",{timeZone:"America/Fortaleza"});

export default function LeadsView({currentUser}:{currentUser:AuthUser}){
 const [viewMode,setViewMode]=useState<"lista"|"kanban">("lista");
 const [leads,setLeads]=useState<Lead[]>([]);
 const [summary,setSummary]=useState<Summary|null>(null);
 const [team,setTeam]=useState<TeamMember[]>([]);
 const [loading,setLoading]=useState(true);
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const [newLeadOpen,setNewLeadOpen]=useState(false);

 const [assignedFilter,setAssignedFilter]=useState<string>(""); // "" | "none" | userId
 const [statusFilter,setStatusFilter]=useState<AttendanceStatus|"">("");
 const [stageFilter,setStageFilter]=useState<CommercialStage|"">("");
 const [originFilter,setOriginFilter]=useState("");
 const [nextActionFilter,setNextActionFilter]=useState<""|"vencidos"|"hoje"|"proximos7">("");
 const [query,setQuery]=useState("");
 const [from,setFrom]=useState("");
 const [to,setTo]=useState("");
 const [demoMode,setDemoMode]=useState<"real"|"all"|"only">("real");

 function buildParams(){
  const p=new URLSearchParams();
  if(assignedFilter)p.set("assignedUserId",assignedFilter);
  if(statusFilter)p.set("status",statusFilter);
  if(stageFilter)p.set("stage",stageFilter);
  if(originFilter)p.set("origin",originFilter);
  if(nextActionFilter)p.set("nextAction",nextActionFilter);
  if(query.trim())p.set("q",query.trim());
  if(from)p.set("from",from);
  if(to)p.set("to",to);
  p.set("demo",demoMode);
  return p;
 }

 async function load(){
  setLoading(true);
  const params=buildParams();
  const [leadsRes,summaryRes,teamRes]=await Promise.all([
   fetch(`/api/leads?${params}`),
   fetch(`/api/leads/summary?${new URLSearchParams({from,to,demo:demoMode})}`),
   fetch(`/api/leads/team`),
  ]);
  if(leadsRes.ok)setLeads(await leadsRes.json());
  if(summaryRes.ok)setSummary(await summaryRes.json());
  if(teamRes.ok)setTeam(await teamRes.json());
  setLoading(false);
 }
 useEffect(()=>{load()},[]); // eslint-disable-line react-hooks/exhaustive-deps

 const originOptions=useMemo(()=>{const set=new Set<string>();for(const l of leads)if(l.origin)set.add(l.origin);return [...set]},[leads]);

 function applyPreset(preset:"meus"|"aguardandoMim"|"hoje"|"atrasados"|"semResponsavel"){
  if(preset==="meus"){setAssignedFilter(String(currentUser.id));setStatusFilter("");setNextActionFilter("")}
  else if(preset==="aguardandoMim"){setAssignedFilter(String(currentUser.id));setStatusFilter("aguardando_equipe");setNextActionFilter("")}
  else if(preset==="hoje"){setNextActionFilter("hoje");setAssignedFilter("");setStatusFilter("")}
  else if(preset==="atrasados"){setNextActionFilter("vencidos");setAssignedFilter("");setStatusFilter("")}
  else if(preset==="semResponsavel"){setAssignedFilter("none");setStatusFilter("");setNextActionFilter("")}
  setTimeout(load,0);
 }

 async function createLead(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  const f=new FormData(e.currentTarget);
  const body={name:f.get("name"),phone:f.get("phone"),origin:f.get("origin"),interest:f.get("interest"),assignedUserId:f.get("assignedUserId")?Number(f.get("assignedUserId")):null};
  const r=await fetch("/api/leads",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  if(r.ok){setNewLeadOpen(false);await load()}
 }

 const kpis:[string,number|string,string][]=summary?[
  ["NOVOS NO PERÍODO",summary.novosNoPeriodo,"leads criados no intervalo"],
  ["AGUARDANDO EQUIPE",summary.aguardandoEquipe,"precisa de resposta nossa"],
  ["AGUARDANDO CLIENTE",summary.aguardandoCliente,"esperando o cliente responder"],
  ["RETORNOS HOJE",summary.retornosHoje,"próxima ação vence hoje"],
  ["RETORNOS ATRASADOS",summary.retornosAtrasados,"próxima ação vencida"],
  ["PEDIDOS FECHADOS",summary.pedidosFechados,"etapa: pedido fechado, no período"],
 ]:[];

 return <div className="cmv-area leads-area">
  <header className="cmv-head"><div><p className="eyebrow">ATENDIMENTOS E LEADS</p><h1>Quem precisa de atenção agora</h1><p>Organização e planejamento do funil — nenhum envio automático para clientes reais acontece aqui.</p></div>
   <div className="head-actions"><button className="primary" onClick={()=>setNewLeadOpen(true)}>+ Novo lead</button></div>
  </header>

  {summary?.health.webhookNeverReceivedRealEvent&&<div className="leads-health-banner"><span>i</span><div><strong>Nenhum evento real do WhatsApp foi recebido ainda</strong><p>O webhook do wascript nunca entregou um evento de verdade pra esta intranet — os dados abaixo (além dos leads de demonstração) são só o que foi cadastrado manualmente. Veja as instruções de ativação no fim da tela.</p></div></div>}
  {summary&&!summary.health.webhookNeverReceivedRealEvent&&summary.health.pendingUnidentified>0&&<div className="leads-health-banner warn"><span>!</span><div><strong>{summary.health.pendingUnidentified} evento(s) do WhatsApp em formato não reconhecido</strong><p>Chegaram eventos reais, mas o formato ainda não foi mapeado — nada foi vinculado a um lead automaticamente pra não arriscar errar. Última recepção: {fmtDateTime(summary.health.lastEventAt)}.</p></div></div>}
  {summary&&summary.health.recentFailures.length>0&&<div className="leads-health-banner warn"><span>!</span><div><strong>{summary.health.recentFailures.length} falha(s) recente(s) ao processar eventos do webhook</strong><ul className="leads-failure-list">{summary.health.recentFailures.map((f,i)=><li key={i}><code>{fmtDateTime(f.received_at)}</code> — {f.note}</li>)}</ul></div></div>}

  <section className="cmv-kpis leads-kpis">{kpis.map(([label,value,hint])=><article className="panel" key={label}><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>)}</section>

  <div className="purchasing-tabs leads-presets">
   <button className="chip" onClick={()=>applyPreset("meus")}>Meus atendimentos</button>
   <button className="chip" onClick={()=>applyPreset("aguardandoMim")}>Aguardando minha resposta</button>
   <button className="chip" onClick={()=>applyPreset("hoje")}>Retornos de hoje</button>
   <button className="chip" onClick={()=>applyPreset("atrasados")}>Atrasados</button>
   <button className="chip" onClick={()=>applyPreset("semResponsavel")}>Sem responsável</button>
  </div>

  <section className="cmv-filters panel leads-filters">
   <label>Vendedor<select value={assignedFilter} onChange={e=>setAssignedFilter(e.target.value)}><option value="">Todos</option><option value="none">Sem responsável</option>{team.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
   <label>Situação<select value={statusFilter} onChange={e=>setStatusFilter(e.target.value as AttendanceStatus|"")}><option value="">Todas</option>{(Object.entries(ATTENDANCE_LABELS) as [AttendanceStatus,string][]).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
   <label>Etapa comercial<select value={stageFilter} onChange={e=>setStageFilter(e.target.value as CommercialStage|"")}><option value="">Todas</option>{(Object.entries(STAGE_LABELS) as [CommercialStage,string][]).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
   <label>Próxima ação<select value={nextActionFilter} onChange={e=>setNextActionFilter(e.target.value as typeof nextActionFilter)}><option value="">Qualquer</option><option value="vencidos">Vencidos</option><option value="hoje">Hoje</option><option value="proximos7">Próximos 7 dias</option></select></label>
   <label>Origem<select value={originFilter} onChange={e=>setOriginFilter(e.target.value)}><option value="">Todas</option>{originOptions.map(o=><option key={o} value={o}>{o}</option>)}</select></label>
   <label>Período<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
   <label>até<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
   <label>Buscar<input type="text" placeholder="Nome ou telefone…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <label>Dados<select value={demoMode} onChange={e=>setDemoMode(e.target.value as typeof demoMode)}><option value="real">Somente reais</option><option value="all">Reais + demonstração</option><option value="only">Somente demonstração</option></select></label>
   <button className="secondary" onClick={load}>Aplicar filtros</button>
  </section>

  <div className="purchasing-tabs">
   <button className={viewMode==="lista"?"tab active":"tab"} onClick={()=>setViewMode("lista")}>Lista</button>
   <button className={viewMode==="kanban"?"tab active":"tab"} onClick={()=>setViewMode("kanban")}>Kanban</button>
  </div>

  {loading?<div className="loading">Carregando atendimentos…</div>:
   leads.length===0?<div className="cmv-empty"><span>✓</span><strong>Nenhum atendimento encontrado</strong><p>Ajuste os filtros ou cadastre o primeiro lead.</p></div>:
   viewMode==="lista"?<LeadsTable leads={leads} onOpen={setSelectedId}/>:<LeadsKanban leads={leads} onOpen={setSelectedId} onMove={async(id,stage)=>{await fetch(`/api/leads/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({commercialStage:stage})});await load()}}/>}

  {selectedId&&<LeadDrawer id={selectedId} team={team} currentUser={currentUser} close={()=>setSelectedId(null)} onChanged={load}/>}

  {newLeadOpen&&<Modal title="Novo lead" close={()=>setNewLeadOpen(false)}>
   <form onSubmit={createLead}>
    <label>Nome<input name="name" required placeholder="Nome do cliente"/></label>
    <label>Telefone<input name="phone" required placeholder="Ex.: 5585999999999"/></label>
    <label>Origem<input name="origin" placeholder="Ex.: Mercado Livre, loja física…"/></label>
    <label>Interesse / produtos<input name="interest" placeholder="Ex.: Kit de limpeza"/></label>
    <label>Responsável<select name="assignedUserId"><option value="">Sem responsável</option>{team.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    <div className="modal-actions"><button type="button" className="secondary" onClick={()=>setNewLeadOpen(false)}>Cancelar</button><button type="submit" className="primary">Cadastrar</button></div>
   </form>
  </Modal>}

  <section className="panel leads-webhook-help">
   <div className="table-head"><strong>Integração de webhook (wascript)</strong></div>
   <div className="leads-webhook-body">
    <p>Esta tela reaproveita o mesmo receptor de webhook do piloto Watidy (<code>/api/watidy/webhook</code>) — nenhuma rota nova precisa ser cadastrada no wascript. Se o webhook ainda não estiver ativo lá:</p>
    <ol>
     <li>No painel do wascript, abra a configuração de Webhook/API.</li>
     <li>Aponte a URL de eventos para o mesmo endereço já usado pelo piloto (a URL completa, com a chave, está só no servidor — confira com quem configurou o piloto, nunca em texto de suporte ou aqui).</li>
     <li>Salve e envie uma mensagem de teste para o número autorizado para confirmar que o evento chega — ele vai aparecer no aviso desta tela com data/hora da última recepção.</li>
    </ol>
    <p>Até um evento real chegar, o formato de origem/mensagens automáticas não pode ser mapeado com segurança — por isso a tela mostra &quot;Sem informação&quot; nesses campos em vez de arriscar um valor errado.</p>
   </div>
  </section>
 </div>;
}

function Badge({children,tone}:{children:React.ReactNode;tone:string}){return <span className={`chip lead-badge tone-${tone}`}>{children}</span>}

function AttendanceBadge({status}:{status:AttendanceStatus}){
 const tone=status==="aguardando_equipe"?"warn":status==="aguardando_cliente"?"info":status==="encerrado"?"muted":status==="retorno_agendado"?"accent":"default";
 return <Badge tone={tone}>{ATTENDANCE_LABELS[status]}</Badge>;
}
function PriorityBadge({priority}:{priority:Priority|null}){
 if(!priority)return <span className="lead-muted">—</span>;
 const tone=priority==="quente"?"hot":priority==="morno"?"warm":"cold";
 return <Badge tone={tone}>{PRIORITY_LABELS[priority]}</Badge>;
}

function LeadsTable({leads,onOpen}:{leads:Lead[];onOpen:(id:string)=>void}){
 return <section className="panel large">
  <div className="cmv-columns lead-columns"><span>Lead</span><span>Responsável</span><span>Origem</span><span>Etapa</span><span>Situação</span><span>Quem age agora</span><span>Próxima ação</span><span>Tentativas</span></div>
  <div>{leads.map(l=><div className="cmv-columns lead-columns lead-row" key={l.id} onClick={()=>onOpen(l.id)}>
   <span><strong>{l.name||"Sem nome"}</strong><small className="lead-phone">{l.phone}{l.isDemo&&<em className="demo-tag">DEMO</em>}{l.incomplete&&<em className="incomplete-tag" title="Dados incompletos">⚠</em>}</small></span>
   <span>{l.assignedName||"Sem responsável"}</span>
   <span>{l.origin||"Não identificada"}</span>
   <span>{STAGE_LABELS[l.commercialStage]}</span>
   <span><AttendanceBadge status={l.attendanceStatus}/></span>
   <span>{l.whoActsNow==="equipe"?"Equipe":l.whoActsNow==="cliente"?"Cliente":"—"}</span>
   <span>{l.nextAction?<span className={l.nextAction.overdue?"next-action overdue":"next-action"}>{fmtDate(l.nextAction.scheduledDate)}</span>:"Sem planejamento"}</span>
   <span>{l.attemptsRealized}</span>
  </div>)}</div>
 </section>;
}

function LeadsKanban({leads,onOpen,onMove}:{leads:Lead[];onOpen:(id:string)=>void;onMove:(id:string,stage:CommercialStage)=>void}){
 return <div className="kanban-board">
  {STAGES.map(stage=>{
   const items=leads.filter(l=>l.commercialStage===stage);
   return <div className="kanban-column" key={stage}>
    <div className="kanban-column-head"><strong>{STAGE_LABELS[stage]}</strong><span>{items.length}</span></div>
    {items.map(l=><article className="kanban-card" key={l.id}>
     <div onClick={()=>onOpen(l.id)}>
      <strong>{l.name||"Sem nome"}</strong>
      <small className="lead-phone">{l.phone}{l.isDemo&&<em className="demo-tag">DEMO</em>}</small>
      <div className="kanban-card-meta"><AttendanceBadge status={l.attendanceStatus}/><PriorityBadge priority={l.priority}/></div>
      {l.nextAction&&<div className={l.nextAction.overdue?"next-action overdue":"next-action"}>Próxima ação: {fmtDate(l.nextAction.scheduledDate)}</div>}
     </div>
     <select value={stage} onChange={e=>onMove(l.id,e.target.value as CommercialStage)} onClick={e=>e.stopPropagation()}>
      {STAGES.map(s=><option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
     </select>
    </article>)}
    {!items.length&&<div className="kanban-empty">Vazio</div>}
   </div>;
  })}
 </div>;
}

function LeadDrawer({id,team,currentUser,close,onChanged}:{id:string;team:TeamMember[];currentUser:AuthUser;close:()=>void;onChanged:()=>void}){
 const [lead,setLead]=useState<LeadDetail|null>(null);
 const [loading,setLoading]=useState(true);
 const [noteText,setNoteText]=useState("");
 const [manualContact,setManualContact]=useState(false);
 const [followupDate,setFollowupDate]=useState("");
 const [followupMessage,setFollowupMessage]=useState(SUGGESTED_MESSAGES[0]);
 const [error,setError]=useState("");

 async function load(){
  setLoading(true);
  const r=await fetch(`/api/leads/${id}`);
  if(r.ok)setLead(await r.json());
  setLoading(false);
 }
 useEffect(()=>{load()},[id]); // eslint-disable-line react-hooks/exhaustive-deps

 async function patch(body:Record<string,unknown>){
  setError("");
  const r=await fetch(`/api/leads/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  const data=await r.json();
  if(!r.ok){setError(data.error||"Não foi possível salvar.");return}
  await load();await onChanged();
 }
 async function addNote(e:FormEvent){
  e.preventDefault();
  if(!noteText.trim())return;
  await fetch(`/api/leads/${id}/notes`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:noteText,manualContact})});
  setNoteText("");setManualContact(false);await load();await onChanged();
 }
 async function addFollowup(e:FormEvent){
  e.preventDefault();
  if(!followupDate)return;
  await fetch(`/api/leads/${id}/followups`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({scheduledDate:followupDate,suggestedMessage:followupMessage})});
  setFollowupDate("");await load();await onChanged();
 }
 async function updateFollowup(followupId:string,body:Record<string,unknown>){
  await fetch(`/api/leads/${id}/followups/${followupId}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  await load();await onChanged();
 }

 const canTransfer=currentUser.role==="master";

 return <div className="modal-wrap" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}>
  <div className="modal lead-drawer">
   <div className="modal-head"><h2>{lead?.name||"Lead"}</h2><button onClick={close}>×</button></div>
   {loading||!lead?<div className="loading">Carregando…</div>:<div className="lead-drawer-body">
    <div className="lead-drawer-columns">
     <section className="lead-drawer-col">
      <h3>Linha do tempo</h3>
      <div className="lead-timeline">
       {lead.timeline.length?lead.timeline.map(t=><div className={`timeline-entry kind-${t.kind}`} key={t.id}>
        <div className="timeline-meta"><strong>{timelineLabel(t.kind)}</strong><span>{fmtDateTime(t.occurred_at)}</span>{t.created_by&&<span className="timeline-author">· {t.created_by}</span>}{t.source==="webhook"&&<span className="timeline-source">· WhatsApp</span>}</div>
        {t.body&&<p>{t.body}</p>}
        {t.is_automated===null&&(t.kind==="message_received"||t.kind==="message_sent")&&<small className="timeline-limitation">Não é possível identificar se foi uma resposta humana ou automática com os dados disponíveis.</small>}
       </div>):<p className="lead-muted">Sem histórico ainda.</p>}
      </div>
      <form onSubmit={addNote} className="lead-note-form">
       <textarea value={noteText} onChange={e=>setNoteText(e.target.value)} placeholder="Escrever uma nota interna…"/>
       <label className="active-check"><input type="checkbox" checked={manualContact} onChange={e=>setManualContact(e.target.checked)}/> Registrar que entrei em contato pelo WhatsApp agora</label>
       <button type="submit" className="secondary">Adicionar</button>
      </form>
     </section>

     <section className="lead-drawer-col">
      <h3>Ficha comercial</h3>
      <div className="lead-field-grid">
       <label>Responsável<select value={lead.assignedUserId??""} onChange={e=>patch({assignedUserId:e.target.value?Number(e.target.value):null})} disabled={!canTransfer&&Boolean(lead.assignedUserId)&&lead.assignedUserId!==currentUser.id}>
        <option value="">Sem responsável</option>{team.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
       </select></label>
       <label>Situação do atendimento<select value={lead.attendanceStatus} onChange={e=>patch({attendanceStatus:e.target.value})}>{(Object.entries(ATTENDANCE_LABELS) as [AttendanceStatus,string][]).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
       <label>Etapa comercial<select value={lead.commercialStage} onChange={e=>patch({commercialStage:e.target.value})}>{(Object.entries(STAGE_LABELS) as [CommercialStage,string][]).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
       <label>Prioridade<select value={lead.priority??""} onChange={e=>patch({priority:e.target.value||null})}><option value="">Sem prioridade</option>{(Object.entries(PRIORITY_LABELS) as [Priority,string][]).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
       <label>Interesse / produtos<input defaultValue={lead.interest??""} onBlur={e=>patch({interest:e.target.value||null})}/></label>
       <label>Valor do orçamento<input type="number" step="0.01" defaultValue={lead.budgetValue??""} onBlur={e=>patch({budgetValue:e.target.value?Number(e.target.value):null})}/></label>
       <label>Origem<input defaultValue={lead.origin??""} onBlur={e=>patch({origin:e.target.value||null})} placeholder="Não identificada"/></label>
      </div>
      {lead.attendanceStatus==="encerrado"&&<label>Motivo de encerramento<select value={lead.closeReason??""} onChange={e=>patch({closeReason:e.target.value||null})}><option value="">—</option>{(Object.entries(CLOSE_REASON_LABELS) as [CloseReason,string][]).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>}
      {error&&<div className="form-error">{error}</div>}

      <h3>Próxima ação</h3>
      <div className="lead-followups">
       {lead.followups.length?lead.followups.map(f=><div className={`followup-row status-${f.status}`} key={f.id}>
        <div><strong>Tentativa {f.attempt_number}</strong><span>{fmtDate(f.scheduled_date)} · {FOLLOWUP_STATUS_LABELS[f.status]}{f.scheduled_date<todayIso()&&f.status==="planejado"?" (vencido)":""}</span></div>
        {f.suggested_message&&<p className="followup-message">&quot;{f.suggested_message}&quot;</p>}
        {f.status==="planejado"&&<div className="followup-actions">
         <button className="secondary" onClick={()=>updateFollowup(f.id,{status:"realizado"})}>Marcar como realizado</button>
         <button className="secondary" onClick={()=>{const d=prompt("Nova data (AAAA-MM-DD):",f.scheduled_date);if(d)updateFollowup(f.id,{scheduledDate:d})}}>Adiar</button>
         <button className="secondary" onClick={()=>updateFollowup(f.id,{status:"cancelado"})}>Cancelar</button>
        </div>}
       </div>):<p className="lead-muted">Nenhuma tentativa planejada.</p>}
      </div>
      <form onSubmit={addFollowup} className="lead-followup-form">
       <label>Data da próxima ação<input type="date" value={followupDate} onChange={e=>setFollowupDate(e.target.value)} required/></label>
       <label>Texto sugerido<select value={followupMessage} onChange={e=>setFollowupMessage(e.target.value)}>{SUGGESTED_MESSAGES.map((m,i)=><option key={i} value={m}>{m.slice(0,50)}…</option>)}</select></label>
       <button type="submit" className="secondary">Planejar follow-up</button>
      </form>
     </section>
    </div>
   </div>}
  </div>
 </div>;
}

function timelineLabel(kind:string){
 return kind==="message_received"?"Mensagem recebida":kind==="message_sent"?"Mensagem enviada":kind==="note"?"Nota interna":kind==="followup_done"?"Follow-up realizado":"Mudança de situação";
}

function Modal({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}){return <div className="modal-wrap" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><div className="modal"><div className="modal-head"><h2>{title}</h2><button onClick={close}>×</button></div>{children}</div></div>}
