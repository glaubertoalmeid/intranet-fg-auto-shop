import {NextResponse} from "next/server";
import {requirePermission} from "../../../lib/auth";
import {listAudit} from "../../../lib/audit";

export async function GET(request:Request){
 const user=await requirePermission("usuarios");
 if(user.role!=="master")return NextResponse.json({error:"Apenas o Master pode ver o log de auditoria."},{status:403});
 const url=new URL(request.url),limit=Number(url.searchParams.get("limit"))||200;
 return NextResponse.json(await listAudit(limit));
}
