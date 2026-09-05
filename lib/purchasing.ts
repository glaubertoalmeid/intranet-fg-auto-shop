import {getRuntimeDb} from "../db/runtime";

export async function initPurchasing(){
 const db=getRuntimeDb();
 await db.prepare(`CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'elaboracao',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL DEFAULT ''
 )`).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS purchase_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  unit_cost REAL NOT NULL DEFAULT 0,
  received_quantity REAL NOT NULL DEFAULT 0
 )`).run();
}

export const PURCHASE_STATUSES=["elaboracao","enviado","confirmado","em_transporte","recebido_parcial","recebido_completo","cancelado"] as const;
export type PurchaseStatus=typeof PURCHASE_STATUSES[number];

/** Regra do documento (seção 7): estoque atual, venda média diária, prazo de entrega do
 *  fornecedor e estoque de segurança (o próprio mínimo cadastrado) definem a quantidade sugerida.
 *  suggested = ceil(avgDaily × leadTimeDays) + minStock − estoqueAtual, nunca negativo. */
export function suggestPurchaseQuantity(input:{stockPhysical:number;avgDailySales:number;leadTimeDays:number;minStock:number}){
 const coverageNeeded=input.avgDailySales*Math.max(0,input.leadTimeDays);
 const target=coverageNeeded+input.minStock;
 return Math.max(0,Math.ceil(target-input.stockPhysical));
}
