import {getRuntimeDb} from "../db/runtime";

export async function initAudit(){
 await getRuntimeDb().prepare(`CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 )`).run();
}

export type AuditEntry={user:string;action:string;target?:string;detail?:string};

/** Fire-and-forget audit trail. Never throws — a logging failure must never block the actual
 *  action (price save, publish, etc). Call this right after the write it's recording succeeds. */
export async function logAudit(entry:AuditEntry){
 try{
  await initAudit();
  await getRuntimeDb().prepare("INSERT INTO audit_log(user_name,action,target,detail) VALUES(?,?,?,?)")
   .bind(entry.user||"",entry.action,entry.target||"",entry.detail||"").run();
 }catch{ /* auditoria nunca deve derrubar a ação que está sendo registrada */ }
}

export async function listAudit(limit=200){
 await initAudit();
 const rows=await getRuntimeDb().prepare("SELECT id,user_name,action,target,detail,created_at FROM audit_log ORDER BY id DESC LIMIT ?").bind(Math.min(500,Math.max(1,limit))).all();
 return rows.results||[];
}
