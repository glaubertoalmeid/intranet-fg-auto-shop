import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getRuntimeDb } from "../../../db/runtime";
import { requirePermission } from "../../../lib/auth";
const catalog=[
  ["Dia dos Namorados","Brinde surpresa na compra acima de R$100 — surpreenda com um carro impecável!","2026-06-12","Brinde"],
  ["Festa de São João","15% de desconto temático em toda a loja — arraiá do carro limpo!","2026-06-24","Desconto"],
  ["Dia do Motorista","Brinde exclusivo (removedor de insetos) em qualquer compra do dia","2026-07-25","Brinde"],
  ["Dia dos Pais","Kit pai motorista: shampoo automotivo + cera de carnaúba + microfibra premium","2026-08-09","Kit especial"],
  ["Semana da Independência","Frete grátis em todo o site por 3 dias","2026-09-07","Frete grátis"],
  ["Feriado N. Sra. Aparecida","10% de desconto + brinde em compras acima de R$180","2026-10-12","Brinde"],
  ["Dia dos Professores","Cupom exclusivo: 12% de desconto mostrando comprovante","2026-10-15","Desconto"],
  ["Black Friday","Até 30% de desconto em produtos selecionados + frete grátis","2026-11-27","Desconto"],
  ["Cyber Monday","Promoções relâmpago no Instagram + cupom exclusivo para seguidores","2026-11-30","Desconto"],
  ["Natal","Kit presente de fim de ano: linha completa de limpeza com caixinha especial FG","2026-12-25","Kit especial"],
  ["Réveillon","Sorteio de kit detalhamento completo para quem comprou ao longo do ano","2026-12-31","Sorteio"],
];
async function init(){const db=getRuntimeDb();await db.prepare(`CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',event_date TEXT NOT NULL,category TEXT NOT NULL DEFAULT 'Desconto',created_by TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();const total=await db.prepare("SELECT COUNT(*) total FROM events").first<{total:number}>();if(!total?.total){await db.batch(catalog.map(e=>db.prepare("INSERT INTO events(title,description,event_date,category,created_by) VALUES(?,?,?,?,?)").bind(...e,"Catálogo FG Auto")))}}
export async function GET(){await requirePermission("calendario");await init();const r=await getRuntimeDb().prepare("SELECT * FROM events ORDER BY event_date ASC, id DESC").all();return NextResponse.json(r.results)}
export async function POST(req:Request){const user=await requirePermission("calendario");await init();const b=await req.json() as Record<string,string>;if(!b.title?.trim()||!b.event_date)return NextResponse.json({error:"Preencha título e data"},{status:400});await getRuntimeDb().prepare("INSERT INTO events(title,description,event_date,category,created_by) VALUES(?,?,?,?,?)").bind(b.title.trim(),b.description?.trim()??"",b.event_date,b.category??"Campanha",user.name).run();return NextResponse.json({ok:true},{status:201})}
