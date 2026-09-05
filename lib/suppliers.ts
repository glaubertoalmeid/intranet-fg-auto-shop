import {getRuntimeDb} from "../db/runtime";

export async function initSuppliers(){
 await getRuntimeDb().prepare(`CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  brands TEXT NOT NULL DEFAULT '',
  lead_time_days REAL NOT NULL DEFAULT 0,
  payment_terms TEXT NOT NULL DEFAULT '',
  min_order_value REAL NOT NULL DEFAULT 0,
  freight TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 )`).run();
}
