import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../lib/auth";
import {blingCallbackUrl,blingWebhookUrl,getBlingConfig,saveBlingConfig} from "../../../../../lib/bling";
import {logAudit} from "../../../../../lib/audit";

export async function GET(){
 await requirePermission("anuncios");
 const config=await getBlingConfig();
 return NextResponse.json({configured:Boolean(config.clientId&&config.clientSecret),connected:Boolean(config.accessToken&&config.refreshToken),clientId:config.clientId,companyId:config.companyId,lastError:config.lastError,callbackUrl:blingCallbackUrl,webhookUrl:blingWebhookUrl});
}
export async function PUT(request:Request){
 const user=await requirePermission("usuarios"),body=await request.json() as {clientId?:string;clientSecret?:string};
 const clientId=String(body.clientId||"").trim(),clientSecret=String(body.clientSecret||"").trim();
 if(clientId.length<20)return NextResponse.json({error:"Informe o Client ID completo do Bling."},{status:400});
 if(clientSecret.length<16)return NextResponse.json({error:"Informe o Client Secret completo do Bling."},{status:400});
 await saveBlingConfig({clientId,clientSecret,accessToken:"",refreshToken:"",tokenExpiresAt:"",companyId:"",lastError:""},user.name);
 await logAudit({user:user.name,action:"integration.credentials",target:"bling",detail:`clientId ${clientId}`});
 return NextResponse.json({ok:true});
}
