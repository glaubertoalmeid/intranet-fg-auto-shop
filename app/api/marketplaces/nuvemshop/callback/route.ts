import {NextResponse} from "next/server";
import {cookies} from "next/headers";
import {getNuvemshopConfig,initNuvemshop,saveNuvemshopConfig} from "../../../../../lib/nuvemshop";
import {SITE_URL} from "../../../../../lib/site-url";

const home=(result:string)=>NextResponse.redirect(`${SITE_URL}/?nuvemshop=${encodeURIComponent(result)}`);

export async function GET(request:Request){
 await initNuvemshop();
 const url=new URL(request.url),code=url.searchParams.get("code")||"";
 if(url.searchParams.get("error"))return home("denied");
 if(!code)return home("invalid-callback");
 const jar=await cookies(),raw=jar.get("nuvemshop_oauth")?.value;
 jar.delete("nuvemshop_oauth");
 let createdBy="";
 try{createdBy=String(JSON.parse(raw||"{}").user||"")}catch{}
 if(!createdBy)return home("expired");
 const config=await getNuvemshopConfig();
 const response=await fetch("https://www.nuvemshop.com.br/apps/authorize/token",{
  method:"POST",
  headers:{"content-type":"application/json","User-Agent":"Intranet FG Auto Shop (glaubertoalmeid@gmail.com)"},
  body:JSON.stringify({client_id:config.clientId,client_secret:config.clientSecret,grant_type:"authorization_code",code})
 });
 const data=await response.json() as Record<string,unknown>;
 if(!response.ok){
  const safeError=[data.error,data.error_description,data.message].map(value=>String(value||"").trim()).filter(Boolean).join(" — ").slice(0,500)||"A NuvemShop recusou a geração do token.";
  await saveNuvemshopConfig({lastError:safeError},createdBy);
  return home("token-error");
 }
 await saveNuvemshopConfig({
  accessToken:String(data.access_token||""),
  storeId:String(data.user_id||""),
  scope:String(data.scope||""),
  lastError:""
 },createdBy);
 return home("connected");
}
