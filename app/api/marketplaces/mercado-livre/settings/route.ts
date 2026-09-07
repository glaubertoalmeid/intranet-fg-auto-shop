import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../lib/auth";
import {getMercadoLivreConfig,mercadoLivreCallbackUrl,saveMercadoLivreConfig} from "../../../../../lib/mercado-livre";
import {logAudit} from "../../../../../lib/audit";
import {SITE_URL} from "../../../../../lib/site-url";

export async function GET(){
  await requirePermission("anuncios");
  const config=await getMercadoLivreConfig();
  return NextResponse.json({
    configured:Boolean(config.clientId&&config.clientSecret),
    connected:Boolean(config.accessToken&&config.refreshToken),
    clientId:config.clientId,
    mlUserId:config.mlUserId,
    lastError:config.lastError,
    tokenExpiresAt:config.tokenExpiresAt,
    callbackUrl:mercadoLivreCallbackUrl,
    notificationUrl:`${SITE_URL}/api/marketplaces/mercado-livre/notifications`
  });
}

export async function PUT(request:Request){
  const user=await requirePermission("usuarios");
  const body=await request.json() as {clientId?:string;clientSecret?:string};
  const clientId=String(body.clientId||"").trim();
  const clientSecret=String(body.clientSecret||"").trim();
  if(!/^\d+$/.test(clientId))return NextResponse.json({error:"Informe o App ID numérico do Mercado Livre."},{status:400});
  if(clientSecret.length<8)return NextResponse.json({error:"Informe o novo Client Secret completo."},{status:400});
  await saveMercadoLivreConfig({clientId,clientSecret,accessToken:"",refreshToken:"",tokenExpiresAt:"",mlUserId:"",lastError:""},user.name);
  await logAudit({user:user.name,action:"integration.credentials",target:"mercado_livre",detail:`clientId ${clientId}`});
  return NextResponse.json({ok:true});
}
