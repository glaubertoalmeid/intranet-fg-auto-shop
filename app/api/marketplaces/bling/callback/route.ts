import {NextResponse} from "next/server";
import {getRuntimeDb} from "../../../../../db/runtime";
import {blingCallbackUrl,getBlingConfig,initBling,saveBlingConfig} from "../../../../../lib/bling";
import {SITE_URL} from "../../../../../lib/site-url";

const home=(result:string)=>NextResponse.redirect(`${SITE_URL}/?bling=${encodeURIComponent(result)}`);
export async function GET(request:Request){
 await initBling();
 const url=new URL(request.url),code=url.searchParams.get("code")||"",state=url.searchParams.get("state")||"";
 if(url.searchParams.get("error"))return home("denied");
 if(!code||!state)return home("invalid-callback");
 const row=await getRuntimeDb().prepare("SELECT created_by FROM marketplace_oauth_states WHERE state=? AND provider='bling' AND expires_at>CURRENT_TIMESTAMP").bind(state).first<{created_by:string}>();
 await getRuntimeDb().prepare("DELETE FROM marketplace_oauth_states WHERE state=?").bind(state).run();
 if(!row)return home("expired");
 const config=await getBlingConfig();
 const response=await fetch("https://www.bling.com.br/Api/v3/oauth/token",{method:"POST",headers:{
  authorization:`Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
  "content-type":"application/x-www-form-urlencoded","enable-jwt":"1"
 },body:new URLSearchParams({grant_type:"authorization_code",code,redirect_uri:blingCallbackUrl})});
 const data=await response.json() as Record<string,unknown>;
 if(!response.ok){
  const safeError=[data.error,data.error_description,(data.error as Record<string,unknown>|undefined)?.description].map(value=>String(value||"").trim()).filter(Boolean).join(" — ").slice(0,500)||"O Bling recusou a geração do token.";
  await saveBlingConfig({lastError:safeError},row.created_by);return home("token-error");
 }
 await saveBlingConfig({accessToken:String(data.access_token||""),refreshToken:String(data.refresh_token||""),tokenExpiresAt:new Date(Date.now()+(Number(data.expires_in)||21600)*1000).toISOString(),lastError:""},row.created_by);
 return home("connected");
}
