import { NextResponse } from "next/server";
import { getRuntimeDb } from "../../../db/runtime";
import { requirePermission } from "../../../lib/auth";

const initialMaterials = [
  ["Drive de fornecedor 1","Fotos, vídeos e peças prontas para divulgação.","https://drive.google.com/drive/u/0/folders/1A-i9kurSbHcq_KMDJSEZm9Ky7-KcVODY","Fornecedor","blue"],
  ["Drive de fornecedor 2","Fotos, vídeos e peças prontas para divulgação.","https://drive.google.com/drive/folders/1UYWjHwg7rjn-cGLRDvAXN4Aix72WPUuN?usp=drive_link","Fornecedor","green"],
  ["Drive de fornecedor 3","Fotos, vídeos e peças prontas para divulgação.","https://drive.google.com/drive/folders/1FLqXkcEpVse28tznpZbhp9DLhIXSHhSG","Fornecedor","violet"],
  ["Drive próprio da FG Auto","Espaço reservado para os materiais internos da empresa.","","FG Auto","orange"],
];

async function init(){
  const db=getRuntimeDb();
  await db.prepare(`CREATE TABLE IF NOT EXISTS materials (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',url TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT 'Fornecedor',tone TEXT NOT NULL DEFAULT 'blue',position INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  const total=await db.prepare("SELECT COUNT(*) total FROM materials").first<{total:number}>();
  if(!total?.total)await db.batch(initialMaterials.map((m,i)=>db.prepare("INSERT INTO materials(name,description,url,category,tone,position) VALUES(?,?,?,?,?,?)").bind(...m,i)));
}

export async function GET(){await requirePermission("materiais");await init();const result=await getRuntimeDb().prepare("SELECT * FROM materials ORDER BY position ASC,id ASC").all();return NextResponse.json(result.results)}
export async function POST(req:Request){await requirePermission("materiais");await init();const body=await req.json() as Record<string,string>;if(!body.name?.trim())return NextResponse.json({error:"Informe o nome do material."},{status:400});const total=await getRuntimeDb().prepare("SELECT COUNT(*) total FROM materials").first<{total:number}>();await getRuntimeDb().prepare("INSERT INTO materials(name,description,url,category,tone,position) VALUES(?,?,?,?,?,?)").bind(body.name.trim(),body.description?.trim()??"",body.url?.trim()??"",body.category?.trim()||"Fornecedor",body.tone||"blue",Number(total?.total??0)).run();return NextResponse.json({ok:true},{status:201})}
