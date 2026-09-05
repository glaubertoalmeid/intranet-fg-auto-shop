import {NextResponse} from "next/server";
import {getRuntimeDb} from "../../../../../db/runtime";
import {getMercadoLivreConfig,initMercadoLivre,mercadoLivreCallbackUrl,saveMercadoLivreConfig} from "../../../../../lib/mercado-livre";

const home=(result:string)=>NextResponse.redirect(`https://intranet-fg-auto-shop.glaubertoalmeid.chatgpt.site/?ml=${encodeURIComponent(result)}`);

export async function GET(request:Request){
  await initMercadoLivre();
  const url=new URL(request.url),code=url.searchParams.get("code")||"",state=url.searchParams.get("state")||"";
  if(url.searchParams.get("error"))return home("denied");
  if(!code||!state)return home("invalid-callback");
  const row=await getRuntimeDb().prepare("SELECT verifier,created_by FROM marketplace_oauth_states WHERE state=? AND provider='mercado_livre' AND expires_at>CURRENT_TIMESTAMP")
    .bind(state).first<{verifier:string;created_by:string}>();
  await getRuntimeDb().prepare("DELETE FROM marketplace_oauth_states WHERE state=?").bind(state).run();
  if(!row)return home("expired");
  const config=await getMercadoLivreConfig();
  const body=new URLSearchParams({
    grant_type:"authorization_code",
    client_id:config.clientId,
    client_secret:config.clientSecret,
    code,
    redirect_uri:mercadoLivreCallbackUrl,
    code_verifier:row.verifier
  });
  const response=await fetch("https://api.mercadolibre.com/oauth/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body});
  const data=await response.json() as Record<string,unknown>;
  if(!response.ok){
    const safeError=[data.error,data.error_description,data.message].map(value=>String(value||"").trim()).filter(Boolean).join(" — ").slice(0,500)||"O Mercado Livre recusou a geração do token.";
    await saveMercadoLivreConfig({lastError:safeError},row.created_by);
    return home("token-error");
  }
  const expiresIn=Number(data.expires_in)||21600;
  await saveMercadoLivreConfig({
    accessToken:String(data.access_token||""),
    refreshToken:String(data.refresh_token||""),
    tokenExpiresAt:new Date(Date.now()+expiresIn*1000).toISOString(),
    mlUserId:String(data.user_id||""),
    lastError:""
  },row.created_by);
  return home("connected");
}
