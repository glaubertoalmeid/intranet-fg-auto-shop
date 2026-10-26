import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../lib/auth";
import {getNuvemshopConfig,nuvemshopCallbackUrl,saveNuvemshopConfig} from "../../../../../lib/nuvemshop";
import {logAudit} from "../../../../../lib/audit";

export async function GET(){
 await requirePermission("anuncios");
 const config=await getNuvemshopConfig();
 return NextResponse.json({
  configured:Boolean(config.clientId&&config.clientSecret),
  connected:Boolean(config.accessToken&&config.storeId),
  clientId:config.clientId,
  storeId:config.storeId,
  lastError:config.lastError,
  callbackUrl:nuvemshopCallbackUrl
 });
}

export async function PUT(request:Request){
 const user=await requirePermission("usuarios");
 const body=await request.json() as {clientId?:string;clientSecret?:string};
 const clientId=String(body.clientId||"").trim();
 const clientSecret=String(body.clientSecret||"").trim();
 if(!/^\d+$/.test(clientId))return NextResponse.json({error:"Informe o Client ID numérico da NuvemShop."},{status:400});
 if(clientSecret.length<8)return NextResponse.json({error:"Informe o Client Secret completo."},{status:400});
 await saveNuvemshopConfig({clientId,clientSecret,accessToken:"",storeId:"",scope:"",lastError:""},user.name);
 await logAudit({user:user.name,action:"integration.credentials",target:"nuvemshop",detail:`clientId ${clientId}`});
 return NextResponse.json({ok:true});
}
