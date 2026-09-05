import { NextResponse } from "next/server";
import { getRuntimeDb } from "../../../../db/runtime";
import { requirePermission } from "../../../../lib/auth";

export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){await requirePermission("materiais");const {id}=await params;const body=await req.json() as Record<string,string>;if(!body.name?.trim())return NextResponse.json({error:"Informe o nome do material."},{status:400});await getRuntimeDb().prepare("UPDATE materials SET name=?,description=?,url=?,category=?,tone=? WHERE id=?").bind(body.name.trim(),body.description?.trim()??"",body.url?.trim()??"",body.category?.trim()||"Fornecedor",body.tone||"blue",Number(id)).run();return NextResponse.json({ok:true})}
export async function DELETE(_:Request,{params}:{params:Promise<{id:string}>}){await requirePermission("materiais");const {id}=await params;await getRuntimeDb().prepare("DELETE FROM materials WHERE id=?").bind(Number(id)).run();return NextResponse.json({ok:true})}
