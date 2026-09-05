import {NextResponse} from "next/server";
import {getRuntimeDb} from "../../../../db/runtime";
import {initAuth} from "../../../../lib/auth";

export async function POST(request:Request){
 await initAuth();
 const body=await request.json() as {username?:string},username=String(body.username||"").trim().toLowerCase();
 if(!username.includes("@"))return NextResponse.json({error:"Informe um e-mail válido."},{status:400});
 await getRuntimeDb().prepare("UPDATE users SET reset_requested_at=CURRENT_TIMESTAMP WHERE username=? AND active=1").bind(username).run();
 return NextResponse.json({ok:true,message:"Solicitação enviada. Peça ao usuário Master para criar uma senha temporária em Usuários e acessos."});
}
