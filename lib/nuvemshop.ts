import {getRuntimeDb} from "../db/runtime";
import {initMercadoLivre,randomUrlSafe} from "./mercado-livre";
import {SITE_URL} from "./site-url";

export type NuvemshopConfig={
 clientId:string;
 clientSecret:string;
 accessToken:string;
 storeId:string;
 scope:string;
 lastError:string;
};

const empty:NuvemshopConfig={clientId:"",clientSecret:"",accessToken:"",storeId:"",scope:"",lastError:""};
const encryptionSecret=()=>((globalThis as typeof globalThis&{__AI_ENCRYPTION_KEY__?:string}).__AI_ENCRYPTION_KEY__||"").trim();
const decode=(value:string)=>Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")),(char)=>char.charCodeAt(0));
const encode=(value:Uint8Array)=>btoa(String.fromCharCode(...value)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
async function cryptoKey(){const raw=decode(encryptionSecret());if(raw.length!==32)throw new Error("Proteção das integrações não configurada.");return crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt","decrypt"])}
async function encrypt(value:string){const iv=crypto.getRandomValues(new Uint8Array(12));const data=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},await cryptoKey(),new TextEncoder().encode(value)));return`${encode(iv)}.${encode(data)}`}
async function decrypt(value:string){const [iv,data]=value.split(".");if(!iv||!data)return"";return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:decode(iv)},await cryptoKey(),decode(data)))}

export async function initNuvemshop(){await initMercadoLivre()}
export async function getNuvemshopConfig():Promise<NuvemshopConfig>{
 await initNuvemshop();
 const row=await getRuntimeDb().prepare("SELECT encrypted_data FROM marketplace_settings WHERE provider='nuvemshop'").first<{encrypted_data:string}>();
 if(!row)return empty;
 try{return{...empty,...JSON.parse(await decrypt(row.encrypted_data))}}catch{return empty}
}
export async function saveNuvemshopConfig(values:Partial<NuvemshopConfig>,user:string){
 const current=await getNuvemshopConfig(),encrypted=await encrypt(JSON.stringify({...current,...values}));
 await getRuntimeDb().prepare(`INSERT INTO marketplace_settings(provider,encrypted_data,updated_by,updated_at)
 VALUES('nuvemshop',?,?,CURRENT_TIMESTAMP)
 ON CONFLICT(provider) DO UPDATE SET encrypted_data=excluded.encrypted_data,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).bind(encrypted,user).run();
}

export const nuvemshopCallbackUrl=`${SITE_URL}/api/marketplaces/nuvemshop/callback`;

/** NuvemShop (Tiendanube) API client. Diferenças importantes em relação ao Bling/Mercado Livre:
 *  o token não expira (sem refresh_token) e a autenticação vai no header não-padrão
 *  "Authentication" (não "Authorization"), além de exigir um User-Agent identificando o app —
 *  requisições sem esses dois detalhes são rejeitadas pela API. */
export async function nuvemshopFetch(path:string,init:RequestInit={}){
 const config=await getNuvemshopConfig();
 if(!config.accessToken||!config.storeId)throw new Error("NuvemShop não conectado.");
 const headers=new Headers(init.headers);
 headers.set("Authentication",`bearer ${config.accessToken}`);
 headers.set("User-Agent","Intranet FG Auto Shop (glaubertoalmeid@gmail.com)");
 if(init.body&&!headers.has("content-type"))headers.set("content-type","application/json");
 return fetch(`https://api.nuvemshop.com.br/v1/${config.storeId}${path}`,{...init,headers});
}

export async function nuvemshopApi(path:string,init:RequestInit={}){
 const response=await nuvemshopFetch(path,init);
 const data=await response.json().catch(()=>null) as Record<string,unknown>|null;
 if(!response.ok)throw new Error(String((data as {message?:string}|null)?.message||"")||`A NuvemShop recusou a consulta (${response.status}).`);
 return data||{};
}

export {randomUrlSafe};
