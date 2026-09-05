import { NextResponse } from "next/server";
import { getRuntimeDb } from "../../../db/runtime";
import { requirePermission } from "../../../lib/auth";

export async function GET(){const user=await requirePermission("tarefas");if(user.role!=="master")return NextResponse.json({error:"Somente o Master pode consultar a equipe para atribuição."},{status:403});const result=await getRuntimeDb().prepare("SELECT id,name,username FROM users WHERE active=1 ORDER BY role='master' DESC,name ASC").all();return NextResponse.json(result.results)}
