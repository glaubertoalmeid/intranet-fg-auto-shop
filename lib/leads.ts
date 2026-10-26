import {getRuntimeDb} from "../db/runtime";
import {phone as normalizePhone} from "./watidy/core.mjs";

// Situação do atendimento (quem precisa agir agora) — separado da etapa comercial (onde o
// lead está no funil) e da tentativa de follow-up (quantas vezes já tentamos retomar).
// Ver app/LeadsView.tsx pros rótulos em pt-BR.
export const ATTENDANCE_STATUSES = ["novo","aguardando_equipe","aguardando_cliente","retorno_agendado","encerrado"] as const;
export type AttendanceStatus = typeof ATTENDANCE_STATUSES[number];
export const COMMERCIAL_STAGES = ["primeiro_contato","identificacao_necessidade","orcamento_enviado","negociacao","pedido_fechado","encerrado_sem_venda"] as const;
export type CommercialStage = typeof COMMERCIAL_STAGES[number];
export const PRIORITIES = ["quente","morno","frio"] as const;
export type Priority = typeof PRIORITIES[number];
export const CLOSE_REASONS = ["venda","recusa","falta_interesse","pedido_nao_contatar"] as const;
export type CloseReason = typeof CLOSE_REASONS[number];
export const FOLLOWUP_STATUSES = ["planejado","realizado","suspenso_por_resposta","cancelado"] as const;
export type FollowupStatus = typeof FOLLOWUP_STATUSES[number];
export const TIMELINE_KINDS = ["message_received","message_sent","note","status_change","followup_done"] as const;
export type TimelineKind = typeof TIMELINE_KINDS[number];

// Cadência de referência (dias desde o primeiro contato) — só um padrão sugerido pro
// vendedor usar ao planejar; nada aqui inscreve o lead automaticamente.
export const FOLLOWUP_CADENCE_DAYS = [1,3,7,14,21];
export const FOLLOWUP_SUGGESTED_MESSAGES = [
 "Oi! Ficou alguma dúvida sobre os produtos que conversamos? Posso ajudar na escolha.",
 "Olá! Conseguiu avaliar as opções? Se quiser, posso ajustar a seleção ao que você precisa.",
 "Oi! Ainda está procurando os produtos? Posso conferir as opções e condições atuais pra você.",
 "Olá! Quer que eu retome o atendimento ou prefere combinar outra data?",
 "Oi! Vou encerrar este acompanhamento por enquanto. Quando precisar, é só chamar a FG Auto Shop.",
];

export async function initLeads(){
 const db=getRuntimeDb();
 await db.prepare(`CREATE TABLE IF NOT EXISTS leads(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  origin TEXT,
  interest TEXT,
  budget_value REAL,
  assigned_user_id INTEGER,
  attendance_status TEXT NOT NULL DEFAULT 'novo',
  commercial_stage TEXT NOT NULL DEFAULT 'primeiro_contato',
  priority TEXT,
  priority_reason TEXT,
  close_reason TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 )`).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS lead_timeline(
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT,
  is_automated INTEGER,
  source TEXT NOT NULL DEFAULT 'manual',
  created_by TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 )`).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS lead_followups(
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'planejado',
  scheduled_date TEXT NOT NULL,
  suggested_message TEXT,
  note TEXT,
  completed_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 )`).run();
 // Idempotência do webhook: um evento real do wascript ainda não foi recebido (formato
 // desconhecido), então todo evento cai aqui pra registro/depuração até mapearmos o shape
 // real — ver recordInboundWebhookEvent() abaixo.
 await db.prepare(`CREATE TABLE IF NOT EXISTS lead_inbound_events(
  id TEXT PRIMARY KEY,
  dedup_key TEXT UNIQUE,
  phone TEXT,
  lead_id TEXT,
  identified INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 )`).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS lead_integration_health(
  id INTEGER PRIMARY KEY CHECK(id=1),
  last_event_at TEXT,
  total_events INTEGER NOT NULL DEFAULT 0,
  total_identified INTEGER NOT NULL DEFAULT 0
 )`).run();
 await db.prepare(`INSERT OR IGNORE INTO lead_integration_health(id) VALUES(1)`).run();
 // Trava separada da contagem da tabela: initLeads() é chamado por vários endpoints que o
 // carregamento da tela dispara em paralelo (leads/summary/team), então "contar leads e
 // inserir se vazio" é uma corrida real — duas chamadas concorrentes podem ver a tabela
 // vazia ao mesmo tempo e duplicar a semente. O UPDATE...WHERE abaixo é atômico: só uma
 // chamada concorrente consegue de fato reivindicar o seed.
 await db.prepare(`CREATE TABLE IF NOT EXISTS lead_demo_seed_lock(id INTEGER PRIMARY KEY CHECK(id=1),seeded INTEGER NOT NULL DEFAULT 0)`).run();
 await db.prepare(`INSERT OR IGNORE INTO lead_demo_seed_lock(id,seeded) VALUES(1,0)`).run();
 const claimed=await db.prepare(`UPDATE lead_demo_seed_lock SET seeded=1 WHERE id=1 AND seeded=0`).run();
 if(claimed.meta.changes)await seedDemoLeadsIfEmpty();
}

const uid=()=>crypto.randomUUID();
const nowIso=()=>new Date().toISOString();

async function seedDemoLeadsIfEmpty(){
 const db=getRuntimeDb();
 const total=await db.prepare("SELECT COUNT(*) n FROM leads").first<{n:number}>();
 if(total?.n)return;
 const today=new Date();
 const daysAgo=(n:number)=>new Date(today.getTime()-n*86400000).toISOString();
 const demo=[
  {name:"Carlos Mendes",phone:"5585988887771",origin:"Mercado Livre",interest:"Kit de limpeza automotiva",stage:"orcamento_enviado" as CommercialStage,status:"aguardando_cliente" as AttendanceStatus,priority:"quente" as Priority,created:daysAgo(2)},
  {name:"Ana Paula Souza",phone:"5585988887772",origin:"Loja física",interest:"Cera de carnaúba",stage:"primeiro_contato" as CommercialStage,status:"aguardando_equipe" as AttendanceStatus,priority:null,created:daysAgo(0)},
  {name:"Roberto Lima",phone:"5585988887773",origin:"Shopee",interest:"Protetor de chassis",stage:"negociacao" as CommercialStage,status:"retorno_agendado" as AttendanceStatus,priority:"morno" as Priority,created:daysAgo(6)},
  {name:"Fernanda Castro",phone:"5585988887774",origin:"Site",interest:"Kit polimento",stage:"pedido_fechado" as CommercialStage,status:"encerrado" as AttendanceStatus,priority:null,created:daysAgo(10)},
  {name:"Não identificado",phone:"5585988887775",origin:null,interest:null,stage:"primeiro_contato" as CommercialStage,status:"novo" as AttendanceStatus,priority:null,created:daysAgo(1)},
 ];
 for(const d of demo){
  const id=uid();
  await db.prepare(`INSERT INTO leads(id,name,phone,origin,interest,assigned_user_id,attendance_status,commercial_stage,priority,is_demo,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,?,?)`)
   .bind(id,d.name,d.phone,d.origin,d.interest,null,d.status,d.stage,d.priority,d.created,d.created).run();
  await db.prepare(`INSERT INTO lead_timeline(id,lead_id,kind,body,is_automated,source,created_by,occurred_at) VALUES(?,?,?,?,?,?,?,?)`)
   .bind(uid(),id,"note","Lead de demonstração — não é um atendimento real.",0,"manual","Sistema",d.created).run();
 }
}

export type LeadFilters={
 assignedUserId?:number|"none";status?:AttendanceStatus;stage?:CommercialStage;origin?:string;
 nextActionFilter?:"vencidos"|"hoje"|"proximos7";query?:string;from?:string;to?:string;includeDemo?:boolean;onlyDemo?:boolean;
};

type LeadRow={
 id:string;name:string;phone:string;origin:string|null;interest:string|null;budget_value:number|null;
 assigned_user_id:number|null;assigned_name:string|null;attendance_status:AttendanceStatus;commercial_stage:CommercialStage;
 priority:Priority|null;priority_reason:string|null;close_reason:CloseReason|null;is_demo:number;created_at:string;updated_at:string;
};

export async function listLeads(filters:LeadFilters){
 await initLeads();
 const db=getRuntimeDb();
 const where:string[]=[];const args:unknown[]=[];
 if(!filters.includeDemo)where.push("l.is_demo=0");
 if(filters.onlyDemo)where.push("l.is_demo=1");
 if(filters.assignedUserId==="none")where.push("l.assigned_user_id IS NULL");
 else if(typeof filters.assignedUserId==="number"){where.push("l.assigned_user_id=?");args.push(filters.assignedUserId)}
 if(filters.status){where.push("l.attendance_status=?");args.push(filters.status)}
 if(filters.stage){where.push("l.commercial_stage=?");args.push(filters.stage)}
 if(filters.origin){where.push("l.origin=?");args.push(filters.origin)}
 if(filters.from){where.push("date(l.created_at)>=date(?)");args.push(filters.from)}
 if(filters.to){where.push("date(l.created_at)<=date(?)");args.push(filters.to)}
 if(filters.query?.trim()){where.push("(l.name LIKE ? OR l.phone LIKE ?)");const q=`%${filters.query.trim()}%`;args.push(q,q)}
 const sql=`SELECT l.*, u.name as assigned_name FROM leads l LEFT JOIN users u ON u.id=l.assigned_user_id ${where.length?`WHERE ${where.join(" AND ")}`:""} ORDER BY l.updated_at DESC`;
 const rows=(await db.prepare(sql).bind(...args).all<LeadRow>()).results||[];

 // tentativas/próxima ação exigem olhar lead_followups — buscado em lote pra não fazer N+1.
 const ids=rows.map(r=>r.id);
 const followupsByLead=await loadFollowupsFor(ids);
 const lastMessagesByLead=await loadLastMessagesFor(ids);

 let enriched=rows.map(r=>enrichLead(r,followupsByLead[r.id]||[],lastMessagesByLead[r.id]));
 if(filters.nextActionFilter)enriched=enriched.filter(l=>matchesNextActionFilter(l,filters.nextActionFilter!));
 return enriched;
}

function todayIso(){return new Date().toISOString().slice(0,10)}

function matchesNextActionFilter(lead:ReturnType<typeof enrichLead>,f:"vencidos"|"hoje"|"proximos7"){
 if(!lead.nextAction)return false;
 const due=lead.nextAction.scheduledDate;const today=todayIso();
 if(f==="vencidos")return due<today;
 if(f==="hoje")return due===today;
 const in7=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
 return due>=today&&due<=in7;
}

async function loadFollowupsFor(leadIds:string[]){
 if(!leadIds.length)return {} as Record<string,FollowupRow[]>;
 const db=getRuntimeDb();
 const placeholders=leadIds.map(()=>"?").join(",");
 const rows=(await db.prepare(`SELECT * FROM lead_followups WHERE lead_id IN (${placeholders}) ORDER BY scheduled_date ASC`).bind(...leadIds).all<FollowupRow>()).results||[];
 const byLead:Record<string,FollowupRow[]>={};
 for(const r of rows)(byLead[r.lead_id]??=[]).push(r);
 return byLead;
}
type FollowupRow={id:string;lead_id:string;attempt_number:number;status:FollowupStatus;scheduled_date:string;suggested_message:string|null;note:string|null;completed_at:string|null;created_by:string|null;created_at:string;updated_at:string};

async function loadLastMessagesFor(leadIds:string[]){
 if(!leadIds.length)return {} as Record<string,{received?:string;sent?:string}>;
 const db=getRuntimeDb();
 const placeholders=leadIds.map(()=>"?").join(",");
 const rows=(await db.prepare(`SELECT lead_id,kind,occurred_at FROM lead_timeline WHERE lead_id IN (${placeholders}) AND kind IN ('message_received','message_sent') ORDER BY occurred_at ASC`).bind(...leadIds).all<{lead_id:string;kind:string;occurred_at:string}>()).results||[];
 const byLead:Record<string,{received?:string;sent?:string}>={};
 for(const r of rows){
  const entry=byLead[r.lead_id]??={};
  if(r.kind==="message_received")entry.received=r.occurred_at; else entry.sent=r.occurred_at;
 }
 return byLead;
}

function enrichLead(r:LeadRow,followups:FollowupRow[],lastMessages?:{received?:string;sent?:string}){
 const pending=followups.filter(f=>f.status==="planejado").sort((a,b)=>a.scheduled_date.localeCompare(b.scheduled_date));
 const nextAction=pending[0]?{id:pending[0].id,scheduledDate:pending[0].scheduled_date,attemptNumber:pending[0].attempt_number,suggestedMessage:pending[0].suggested_message,overdue:pending[0].scheduled_date<todayIso()}:null;
 const attemptsRealized=followups.filter(f=>f.status==="realizado").length;
 // Quem precisa agir: regra determinística a partir de eventos comprovados (ver passo 5 do
 // briefing) — nunca por inferência de conteúdo da conversa.
 let actor:"equipe"|"cliente"|"ninguem"="ninguem";
 if(r.attendance_status==="aguardando_equipe")actor="equipe";
 else if(r.attendance_status==="aguardando_cliente")actor="cliente";
 else if(r.attendance_status==="retorno_agendado")actor="equipe";
 return {
  id:r.id,name:r.name,phone:r.phone,origin:r.origin,interest:r.interest,budgetValue:r.budget_value,
  assignedUserId:r.assigned_user_id,assignedName:r.assigned_name,attendanceStatus:r.attendance_status,
  commercialStage:r.commercial_stage,priority:r.priority,priorityReason:r.priority_reason,closeReason:r.close_reason,
  isDemo:Boolean(r.is_demo),createdAt:r.created_at,updatedAt:r.updated_at,
  lastMessageReceivedAt:lastMessages?.received??null,lastMessageSentAt:lastMessages?.sent??null,
  whoActsNow:actor,nextAction,attemptsRealized,
  incomplete:!r.name||!r.phone,
 };
}
export type EnrichedLead=ReturnType<typeof enrichLead>;

export async function getLeadDetail(id:string){
 await initLeads();
 const db=getRuntimeDb();
 const row=await db.prepare("SELECT l.*, u.name as assigned_name FROM leads l LEFT JOIN users u ON u.id=l.assigned_user_id WHERE l.id=?").bind(id).first<LeadRow>();
 if(!row)return null;
 const timeline=(await db.prepare("SELECT * FROM lead_timeline WHERE lead_id=? ORDER BY occurred_at ASC").bind(id).all()).results||[];
 const followups=(await db.prepare("SELECT * FROM lead_followups WHERE lead_id=? ORDER BY scheduled_date ASC").bind(id).all<FollowupRow>()).results||[];
 const lastMessages=await loadLastMessagesFor([id]);
 return {...enrichLead(row,followups,lastMessages[id]),timeline,followups};
}

export async function createLead(input:{name:string;phone:string;origin?:string;interest?:string;assignedUserId?:number|null},createdBy:string){
 await initLeads();
 const db=getRuntimeDb();
 const id=uid();const now=nowIso();
 const cleanPhone=normalizePhone(input.phone);
 await db.prepare(`INSERT INTO leads(id,name,phone,origin,interest,assigned_user_id,attendance_status,commercial_stage,is_demo,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,0,?,?)`)
  .bind(id,input.name.trim(),cleanPhone,input.origin?.trim()||null,input.interest?.trim()||null,input.assignedUserId??null,"novo","primeiro_contato",now,now).run();
 await appendTimeline(id,{kind:"note",body:`Lead cadastrado manualmente.`,source:"manual",createdBy});
 return id;
}

export async function appendTimeline(leadId:string,entry:{kind:TimelineKind;body?:string;isAutomated?:boolean|null;source:"manual"|"webhook";createdBy?:string|null;occurredAt?:string}){
 await initLeads();
 const db=getRuntimeDb();
 await db.prepare(`INSERT INTO lead_timeline(id,lead_id,kind,body,is_automated,source,created_by,occurred_at) VALUES(?,?,?,?,?,?,?,?)`)
  .bind(uid(),leadId,entry.kind,entry.body??null,entry.isAutomated===undefined?null:entry.isAutomated?1:0,entry.source,entry.createdBy??null,entry.occurredAt??nowIso()).run();
 await db.prepare("UPDATE leads SET updated_at=? WHERE id=?").bind(nowIso(),leadId).run();
}

export async function updateLeadClassification(id:string,patch:Partial<{name:string;origin:string|null;interest:string|null;budgetValue:number|null;assignedUserId:number|null;attendanceStatus:AttendanceStatus;commercialStage:CommercialStage;priority:Priority|null;priorityReason:string|null;closeReason:CloseReason|null}>,changedBy:string){
 await initLeads();
 const db=getRuntimeDb();
 const current=await db.prepare("SELECT * FROM leads WHERE id=?").bind(id).first<LeadRow>();
 if(!current)throw new Error("Lead não encontrado.");
 const fields:string[]=[];const args:unknown[]=[];
 const changes:string[]=[];
 function set(column:string,value:unknown,label:string,oldValue:unknown){
  if(value===undefined)return;
  fields.push(`${column}=?`);args.push(value);
  if(String(oldValue??"")!==String(value??""))changes.push(label);
 }
 set("name",patch.name,"nome",current.name);
 set("origin",patch.origin,"origem",current.origin);
 set("interest",patch.interest,"interesse",current.interest);
 set("budget_value",patch.budgetValue,"valor de orçamento",current.budget_value);
 set("assigned_user_id",patch.assignedUserId,"responsável",current.assigned_user_id);
 set("attendance_status",patch.attendanceStatus,"situação do atendimento",current.attendance_status);
 set("commercial_stage",patch.commercialStage,"etapa comercial",current.commercial_stage);
 set("priority",patch.priority,"prioridade",current.priority);
 set("priority_reason",patch.priorityReason,"motivo da prioridade",current.priority_reason);
 set("close_reason",patch.closeReason,"motivo de encerramento",current.close_reason);
 if(!fields.length)return;
 fields.push("updated_at=?");args.push(nowIso());
 args.push(id);
 await db.prepare(`UPDATE leads SET ${fields.join(",")} WHERE id=?`).bind(...args).run();
 if(changes.length)await appendTimeline(id,{kind:"status_change",body:`Atualizado por ${changedBy}: ${changes.join(", ")}.`,source:"manual",createdBy:changedBy});
}

export async function createFollowup(leadId:string,input:{scheduledDate:string;suggestedMessage?:string},createdBy:string){
 await initLeads();
 const db=getRuntimeDb();
 const countRow=await db.prepare("SELECT COUNT(*) n FROM lead_followups WHERE lead_id=?").bind(leadId).first<{n:number}>();
 const attemptNumber=(countRow?.n??0)+1;
 const id=uid();
 await db.prepare(`INSERT INTO lead_followups(id,lead_id,attempt_number,status,scheduled_date,suggested_message,created_by) VALUES(?,?,?,?,?,?,?)`)
  .bind(id,leadId,attemptNumber,"planejado",input.scheduledDate,input.suggestedMessage??null,createdBy).run();
 await appendTimeline(leadId,{kind:"status_change",body:`${createdBy} planejou a tentativa ${attemptNumber} de follow-up para ${input.scheduledDate}.`,source:"manual",createdBy});
 return id;
}

export async function updateFollowup(id:string,patch:{status?:FollowupStatus;scheduledDate?:string;note?:string},changedBy:string){
 await initLeads();
 const db=getRuntimeDb();
 const current=await db.prepare("SELECT * FROM lead_followups WHERE id=?").bind(id).first<FollowupRow>();
 if(!current)throw new Error("Follow-up não encontrado.");
 const fields:string[]=[];const args:unknown[]=[];
 if(patch.status){fields.push("status=?");args.push(patch.status);if(patch.status==="realizado"){fields.push("completed_at=?");args.push(nowIso())}}
 if(patch.scheduledDate){fields.push("scheduled_date=?");args.push(patch.scheduledDate)}
 if(patch.note!==undefined){fields.push("note=?");args.push(patch.note)}
 fields.push("updated_at=?");args.push(nowIso());
 args.push(id);
 await db.prepare(`UPDATE lead_followups SET ${fields.join(",")} WHERE id=?`).bind(...args).run();
 const what=patch.status==="realizado"?`registrou que a tentativa ${current.attempt_number} foi realizada`:patch.status==="cancelado"?`cancelou a tentativa ${current.attempt_number}`:patch.scheduledDate?`adiou a tentativa ${current.attempt_number} para ${patch.scheduledDate}`:`atualizou a tentativa ${current.attempt_number}`;
 await appendTimeline(current.lead_id,{kind:patch.status==="realizado"?"followup_done":"status_change",body:`${changedBy} ${what}.${patch.note?` ${patch.note}`:""}`,source:"manual",createdBy:changedBy});
}

/** Resposta do cliente suspende todo planejamento pendente — nunca reinicia outra
 *  sequência automaticamente (ver briefing, seção 6). */
export async function suspendPendingFollowupsOnCustomerReply(leadId:string){
 const db=getRuntimeDb();
 await db.prepare("UPDATE lead_followups SET status='suspenso_por_resposta',updated_at=? WHERE lead_id=? AND status='planejado'").bind(nowIso(),leadId).run();
}

export async function getSummary(filters:Pick<LeadFilters,"from"|"to"|"includeDemo">){
 await initLeads();
 const leads=await listLeads({...filters,includeDemo:filters.includeDemo});
 const today=todayIso();
 return {
  novosNoPeriodo:leads.filter(l=>(!filters.from||l.createdAt.slice(0,10)>=filters.from)&&(!filters.to||l.createdAt.slice(0,10)<=filters.to)).length,
  aguardandoEquipe:leads.filter(l=>l.attendanceStatus==="aguardando_equipe").length,
  aguardandoCliente:leads.filter(l=>l.attendanceStatus==="aguardando_cliente").length,
  retornosHoje:leads.filter(l=>l.nextAction?.scheduledDate===today).length,
  retornosAtrasados:leads.filter(l=>l.nextAction?.overdue).length,
  pedidosFechados:leads.filter(l=>l.commercialStage==="pedido_fechado"&&(!filters.from||l.updatedAt.slice(0,10)>=filters.from)&&(!filters.to||l.updatedAt.slice(0,10)<=filters.to)).length,
 };
}

export async function getIntegrationHealth(){
 await initLeads();
 const db=getRuntimeDb();
 const health=await db.prepare("SELECT * FROM lead_integration_health WHERE id=1").first<{last_event_at:string|null;total_events:number;total_identified:number}>();
 const unidentified=await db.prepare("SELECT COUNT(*) n FROM lead_inbound_events WHERE identified=0").first<{n:number}>();
 const failures=(await db.prepare("SELECT received_at,note FROM lead_inbound_events WHERE note LIKE '[webhook-error:%' ORDER BY received_at DESC LIMIT 10").all<{received_at:string;note:string}>()).results||[];
 return {
  lastEventAt:health?.last_event_at??null,
  totalEvents:health?.total_events??0,
  totalIdentified:health?.total_identified??0,
  pendingUnidentified:unidentified?.n??0,
  webhookNeverReceivedRealEvent:!(health?.total_events),
  recentFailures:failures,
 };
}

/** Falha dura no processamento do webhook (payload grande demais, JSON inválido, exceção não
 *  prevista) — nunca deve derrubar a resposta HTTP pro wascript, só fica registrada aqui pra
 *  investigação, já que este ambiente não tem acesso a `wrangler tail` em tempo real. */
export async function logWebhookFailure(kind:string,detail:string){
 try{
  await initLeads();
  await getRuntimeDb().prepare("INSERT INTO lead_inbound_events(id,dedup_key,phone,lead_id,identified,note,received_at) VALUES(?,?,?,?,0,?,?)")
   .bind(uid(),null,null,null,`[webhook-error:${kind}] ${detail}`.slice(0,500),nowIso()).run();
 }catch{ /* se até o log falhar, não há mais nada seguro a fazer aqui */ }
}

/** Normaliza um evento de webhook do wascript pro funil de leads — independente e sem
 *  nenhum efeito sobre o piloto Watidy (fila/pausa/estágios de lib/watidy/pilot.ts ficam
 *  intocados; isso só É chamado A MAIS, depois do fluxo existente, no mesmo handler).
 *  Como nunca recebemos um evento real do wascript, não presumimos o formato: se não
 *  conseguirmos identificar com confiança telefone + tipo (recebida/enviada/nota/status),
 *  o evento fica registrado em lead_inbound_events com identified=0 pra revisão manual —
 *  nunca criamos ou movemos um lead com base em uma suposição. */
export async function recordInboundWebhookEvent(payload:unknown){
 await initLeads();
 const db=getRuntimeDb();
 const now=nowIso();
 await db.prepare("UPDATE lead_integration_health SET last_event_at=?,total_events=total_events+1 WHERE id=1").bind(now).run();

 // Formato real do webhook "Mensagens" do wascript — confirmado contra tráfego real em
 // produção em 2026-10-19 (20/20 eventos amostrados bateram com o mesmo shape):
 //   {name, number, unreadMessages, lastMessage:{text,timestamp,type},
 //    eventID, eventDetails:{id:{fromMe,...}, from, to, type, subtype, ...}}
 // Um teste isolado anterior (2026-10-16) tinha vindo em {"data":{"numero","nome","mensagem"}}
 // — mantido como fallback caso outro evento (Follow Up, CRM, Encerrar Atendimento etc.)
 // ainda use esse formato mais simples. A doc pública do wascript não documenta nenhum dos
 // dois, então não presumimos mais do que o que já observamos de verdade.
 const candidatePhonePaths=["number","data.numero","numero","data.phone","phone","from","sender","data.from","data.sender","contact.phone"];
 const candidateNamePaths=["name","data.nome","nome","data.name"];
 const candidateIdPaths=["eventID","eventDetails.id._serialized","id","messageId","message_id","data.id","data.messageId"];
 const candidateBodyPaths=["lastMessage.text","data.mensagem","mensagem","message","data.message","text","data.text","body","data.body"];
 const candidateBoolFromMePaths=["eventDetails.id.fromMe","fromMe","data.fromMe"];
 const candidateDirectionStringPaths=["direction","data.direction","type","data.type"];
 const candidateTimestampPaths=["lastMessage.timestamp","eventDetails.t","eventDetails.clientReceivedTsMillis","timestamp","data.timestamp","date","data.date","data.messageTimestamp"];
 const OUTBOUND_STRINGS=["sent","outbound","out","enviada","enviado"];

 const phoneRaw=firstString(payload,candidatePhonePaths);
 const normalizedPhone=phoneRaw?normalizePhone(phoneRaw):null;
 const externalId=firstString(payload,candidateIdPaths);
 const body=firstString(payload,candidateBodyPaths);
 const fromMe=firstBoolean(payload,candidateBoolFromMePaths);
 const directionStr=firstString(payload,candidateDirectionStringPaths);
 const directionKnown=fromMe!==null||directionStr!==null;
 const identified=Boolean(normalizedPhone&&(body!==null||directionKnown));

 // O wascript manda vários "pings" de evento (inclusive status/leitura, sem mensagem nova)
 // que carregam o mesmo lastMessage repetido — um eventID novo a cada ping NÃO significa
 // mensagem nova. Por isso a chave de dedup prioriza o conteúdo (telefone+corpo+timestamp)
 // quando identificado; eventID só entra como fallback pra evento sem corpo reconhecido.
 const dedupKey=(identified&&normalizedPhone)
  ?`${normalizedPhone}:${body??""}:${extractEventTimestamp(payload,candidateTimestampPaths)??""}`
  :externalId||(normalizedPhone?`${normalizedPhone}:${hashPayload(payload)}`:null);

 // Reivindica a chave de dedup ATOMICAMENTE antes de qualquer efeito colateral (criar lead,
 // gravar timeline). Um SELECT-depois-INSERT separado tinha uma corrida real: o wascript manda
 // pings quase simultâneos com o mesmo conteúdo, e os dois passavam pelo SELECT antes de
 // qualquer um inserir, duplicando a timeline e só falhando (com erro feio) no INSERT final.
 // INSERT OR IGNORE + checar `changes` resolve isso numa operação só.
 if(dedupKey){
  const claimed=await db.prepare("INSERT OR IGNORE INTO lead_inbound_events(id,dedup_key,phone,identified,received_at) VALUES(?,?,?,0,?)").bind(uid(),dedupKey,normalizedPhone,now).run();
  if(!claimed.meta.changes)return {processed:false,reason:"evento duplicado (já registrado)"};
 }

 if(!identified){
  if(dedupKey)await db.prepare("UPDATE lead_inbound_events SET note=? WHERE dedup_key=?").bind("Formato do evento ainda não mapeado — nenhum telefone/corpo reconhecido com confiança.",dedupKey).run();
  else await db.prepare("INSERT INTO lead_inbound_events(id,dedup_key,phone,lead_id,identified,note,received_at) VALUES(?,?,?,?,0,?,?)")
   .bind(uid(),null,normalizedPhone,null,"Formato do evento ainda não mapeado — nenhum telefone/corpo reconhecido com confiança.",now).run();
  return {processed:false,reason:"formato não identificado"};
 }

 const nameRaw=firstString(payload,candidateNamePaths);
 const lead=await db.prepare("SELECT id FROM leads WHERE phone=? AND is_demo=0").bind(normalizedPhone).first<{id:string}>();
 let leadId=lead?.id;
 if(!leadId){
  leadId=uid();
  await db.prepare(`INSERT INTO leads(id,name,phone,attendance_status,commercial_stage,is_demo,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?)`)
   .bind(leadId,nameRaw?.trim()||"Sem informação",normalizedPhone,"novo","primeiro_contato",now,now).run();
 }

 // fromMe=true (ou direction/type reconhecido como saída) é mensagem enviada pela equipe;
 // na ausência de qualquer sinal de direção reconhecido, trata como recebida por padrão —
 // é o lado mais seguro pra não deixar uma resposta real de cliente passar despercebida.
 const isOutbound=fromMe===true||(directionStr!==null&&OUTBOUND_STRINGS.includes(directionStr.toLowerCase()));
 const isInbound=!isOutbound;
 // Eventos fora de ordem: usa o horário do próprio evento quando o payload traz um (épocas
 // em segundos ou milissegundos), em vez do horário de recebimento, pra timeline ficar na
 // ordem real mesmo que os eventos cheguem fora de ordem. Sem isso no payload, usa "now".
 const occurredAt=extractEventTimestamp(payload,candidateTimestampPaths)??now;
 await appendTimeline(leadId,{
  kind:isInbound?"message_received":"message_sent",
  body:body??undefined,
  isAutomated:null, // não dá pra distinguir resposta humana de automática com os dados disponíveis
  source:"webhook",
  occurredAt,
 });
 if(isInbound){
  await db.prepare("UPDATE leads SET attendance_status='aguardando_equipe' WHERE id=?").bind(leadId).run();
  await suspendPendingFollowupsOnCustomerReply(leadId);
 }

 if(dedupKey)await db.prepare("UPDATE lead_inbound_events SET lead_id=?,identified=1 WHERE dedup_key=?").bind(leadId,dedupKey).run();
 else await db.prepare("INSERT INTO lead_inbound_events(id,dedup_key,phone,lead_id,identified,received_at) VALUES(?,?,?,?,1,?)").bind(uid(),null,normalizedPhone,leadId,now).run();
 await db.prepare("UPDATE lead_integration_health SET total_identified=total_identified+1 WHERE id=1").run();
 return {processed:true};
}

function getPath(obj:unknown,path:string):unknown{
 return path.split(".").reduce((v:unknown,k)=>v&&typeof v==="object"?(v as Record<string,unknown>)[k]:undefined,obj);
}
function firstString(payload:unknown,paths:string[]):string|null{
 for(const p of paths){const v=getPath(payload,p);if(typeof v==="string"&&v.trim())return v;if(typeof v==="number")return String(v)}
 return null;
}
function extractEventTimestamp(payload:unknown,paths:string[]):string|null{
 for(const p of paths){
  const v=getPath(payload,p);
  if(typeof v==="number"&&v>0){
   const ms=v>1e12?v:v*1000; // epoch em segundos vs. milissegundos
   const d=new Date(ms);
   if(!isNaN(d.getTime()))return d.toISOString();
  }
  if(typeof v==="string"){const d=new Date(v);if(!isNaN(d.getTime()))return d.toISOString()}
 }
 return null;
}
function firstBoolean(payload:unknown,paths:string[]):boolean|null{
 for(const p of paths){const v=getPath(payload,p);if(typeof v==="boolean")return v}
 return null;
}
function hashPayload(payload:unknown):string{
 const s=JSON.stringify(payload).slice(0,500);
 let hash=0;for(let i=0;i<s.length;i++)hash=(hash*31+s.charCodeAt(i))|0;
 return Math.abs(hash).toString(36);
}
