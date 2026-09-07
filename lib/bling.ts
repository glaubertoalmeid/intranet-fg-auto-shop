import {getRuntimeDb} from "../db/runtime";
import {initMercadoLivre,randomUrlSafe} from "./mercado-livre";
import {SITE_URL} from "./site-url";

export type BlingConfig={
 clientId:string;
 clientSecret:string;
 accessToken:string;
 refreshToken:string;
 tokenExpiresAt:string;
 companyId:string;
 lastError:string;
};

const empty:BlingConfig={clientId:"",clientSecret:"",accessToken:"",refreshToken:"",tokenExpiresAt:"",companyId:"",lastError:""};
const encryptionSecret=()=>((globalThis as typeof globalThis&{__AI_ENCRYPTION_KEY__?:string}).__AI_ENCRYPTION_KEY__||"").trim();
const decode=(value:string)=>Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")),(char)=>char.charCodeAt(0));
const encode=(value:Uint8Array)=>btoa(String.fromCharCode(...value)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
async function cryptoKey(){const raw=decode(encryptionSecret());if(raw.length!==32)throw new Error("Proteção das integrações não configurada.");return crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt","decrypt"])}
async function encrypt(value:string){const iv=crypto.getRandomValues(new Uint8Array(12));const data=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},await cryptoKey(),new TextEncoder().encode(value)));return`${encode(iv)}.${encode(data)}`}
async function decrypt(value:string){const [iv,data]=value.split(".");if(!iv||!data)return"";return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:decode(iv)},await cryptoKey(),decode(data)))}

export async function initBling(){await initMercadoLivre()}
export async function getBlingConfig():Promise<BlingConfig>{
 await initBling();
 const row=await getRuntimeDb().prepare("SELECT encrypted_data FROM marketplace_settings WHERE provider='bling'").first<{encrypted_data:string}>();
 if(!row)return empty;
 try{return{...empty,...JSON.parse(await decrypt(row.encrypted_data))}}catch{return empty}
}
export async function saveBlingConfig(values:Partial<BlingConfig>,user:string){
 const current=await getBlingConfig(),encrypted=await encrypt(JSON.stringify({...current,...values}));
 await getRuntimeDb().prepare(`INSERT INTO marketplace_settings(provider,encrypted_data,updated_by,updated_at)
 VALUES('bling',?,?,CURRENT_TIMESTAMP)
 ON CONFLICT(provider) DO UPDATE SET encrypted_data=excluded.encrypted_data,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).bind(encrypted,user).run();
}

export const blingCallbackUrl=`${SITE_URL}/api/marketplaces/bling/callback`;
export const blingWebhookUrl=`${SITE_URL}/api/marketplaces/bling/webhooks`;

export async function getBlingAccessToken(){
 const config=await getBlingConfig();
 if(!config.accessToken||!config.refreshToken)throw new Error("Bling não conectado.");
 if(new Date(config.tokenExpiresAt).getTime()>Date.now()+60_000)return config.accessToken;
 const response=await fetch("https://www.bling.com.br/Api/v3/oauth/token",{method:"POST",headers:{
  authorization:`Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
  "content-type":"application/x-www-form-urlencoded","enable-jwt":"1"
 },body:new URLSearchParams({grant_type:"refresh_token",refresh_token:config.refreshToken})});
 const data=await response.json() as Record<string,unknown>;
 if(!response.ok)throw new Error("A autorização do Bling expirou. Conecte novamente.");
 await saveBlingConfig({accessToken:String(data.access_token||""),refreshToken:String(data.refresh_token||config.refreshToken),tokenExpiresAt:new Date(Date.now()+(Number(data.expires_in)||21600)*1000).toISOString()},"Renovação automática");
 return String(data.access_token||"");
}

export async function blingFetch(path:string,init:RequestInit={}){
 const token=await getBlingAccessToken(),headers=new Headers(init.headers);
 headers.set("authorization",`Bearer ${token}`);headers.set("enable-jwt","1");
 if(init.body&&!headers.has("content-type"))headers.set("content-type","application/json");
 return fetch(`https://api.bling.com.br/Api/v3${path}`,{...init,headers});
}

/** JSON helper on top of blingFetch — parses the body and throws Bling's own error description on failure.
 *  This is the single Bling API client for the whole app; every module (CMV, catálogo de anúncios,
 *  webhooks) imports blingApi/blingFetch from here instead of maintaining its own OAuth + fetch. */
export async function blingApi(path:string,init:RequestInit={}){
 const response=await blingFetch(path,init);
 const data=await response.json().catch(()=>null) as Record<string,unknown>|null;
 if(!response.ok){
  const err=data?.error as {description?:string;message?:string}|undefined;
  throw new Error(String(err?.description||err?.message||data?.message||"")||`O Bling recusou a consulta (${response.status}).`);
 }
 return data||{};
}

export {randomUrlSafe};
