import { NextResponse } from "next/server";
import { getRuntimeDb } from "../../../../db/runtime";
import { requirePermission } from "../../../../lib/auth";
export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){await requirePermission("calendario");const {id}=await params;const b=await req.json() as Record<string,string>;if(!b.title?.trim()||!b.event_date)return NextResponse.json({error:"Preencha título e data"},{status:400});await getRuntimeDb().prepare("UPDATE events SET title=?,description=?,event_date=?,category=? WHERE id=?").bind(b.title.trim(),b.description?.trim()??"",b.event_date,b.category??"Desconto",Number(id)).run();return NextResponse.json({ok:true})}
export async function DELETE(_:Request,{params}:{params:Promise<{id:string}>}){await requirePermission("calendario");const {id}=await params;await getRuntimeDb().prepare("DELETE FROM events WHERE id=?").bind(Number(id)).run();return NextResponse.json({ok:true})}
