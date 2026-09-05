import {NextResponse} from "next/server";
import {requirePermission} from "../../../lib/auth";
import {hasAiKey,saveAiKey} from "../../../lib/ai-secret";
export async function GET(){await requirePermission("anuncios");return NextResponse.json({configured:await hasAiKey()})}
export async function PUT(req:Request){const user=await requirePermission("usuarios");const body=await req.json() as {apiKey?:string};const value=String(body.apiKey||"").trim();if(!value.startsWith("sk-")||value.length<30)return NextResponse.json({error:"A chave informada não parece válida."},{status:400});await saveAiKey(value,user.name);return NextResponse.json({ok:true})}
