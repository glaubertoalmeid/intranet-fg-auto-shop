import {getRuntimeDb} from "../db/runtime";

type MercadoLivreConfig={
  clientId:string;
  clientSecret:string;
  accessToken:string;
  refreshToken:string;
  tokenExpiresAt:string;
  mlUserId:string;
  lastError:string;
};

const empty:MercadoLivreConfig={clientId:"",clientSecret:"",accessToken:"",refreshToken:"",tokenExpiresAt:"",mlUserId:"",lastError:""};
const encryptionSecret=()=>((globalThis as typeof globalThis&{__AI_ENCRYPTION_KEY__?:string}).__AI_ENCRYPTION_KEY__||"").trim();
const decode=(value:string)=>Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")),(char)=>char.charCodeAt(0));
const encode=(value:Uint8Array)=>btoa(String.fromCharCode(...value)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");

async function cryptoKey(){
  const raw=decode(encryptionSecret());
  if(raw.length!==32)throw new Error("Proteção das integrações não configurada.");
  return crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt","decrypt"]);
}

async function encrypt(value:string){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},await cryptoKey(),new TextEncoder().encode(value)));
  return `${encode(iv)}.${encode(encrypted)}`;
}

async function decrypt(value:string){
  const [iv,data]=value.split(".");
  if(!iv||!data)return"";
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:decode(iv)},await cryptoKey(),decode(data)));
}

export async function initMercadoLivre(){
  const db=getRuntimeDb();
  await db.prepare(`CREATE TABLE IF NOT EXISTS marketplace_settings (
    provider TEXT PRIMARY KEY,
    encrypted_data TEXT NOT NULL,
    updated_by TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS marketplace_oauth_states (
    state TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    verifier TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT '',
    expires_at TEXT NOT NULL
  )`).run();
}

export async function getMercadoLivreConfig():Promise<MercadoLivreConfig>{
  await initMercadoLivre();
  const row=await getRuntimeDb().prepare("SELECT encrypted_data FROM marketplace_settings WHERE provider='mercado_livre'").first<{encrypted_data:string}>();
  if(!row)return empty;
  try{return {...empty,...JSON.parse(await decrypt(row.encrypted_data))} as MercadoLivreConfig}catch{return empty}
}

export async function saveMercadoLivreConfig(values:Partial<MercadoLivreConfig>,user:string){
  await initMercadoLivre();
  const current=await getMercadoLivreConfig();
  const next={...current,...values};
  const encrypted=await encrypt(JSON.stringify(next));
  await getRuntimeDb().prepare(`INSERT INTO marketplace_settings(provider,encrypted_data,updated_by,updated_at)
    VALUES('mercado_livre',?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(provider) DO UPDATE SET encrypted_data=excluded.encrypted_data,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
    .bind(encrypted,user).run();
}

export const mercadoLivreCallbackUrl="https://intranet-fg-auto-shop.glaubertoalmeid.chatgpt.site/api/marketplaces/mercado-livre/callback";

export function randomUrlSafe(bytes=32){
  return encode(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkceChallenge(verifier:string){
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier)));
  return encode(digest);
}

export async function getMercadoLivreAccessToken(){
  const config=await getMercadoLivreConfig();
  if(!config.accessToken||!config.refreshToken)throw new Error("Mercado Livre não conectado.");
  if(new Date(config.tokenExpiresAt).getTime()>Date.now()+60_000)return config.accessToken;
  const body=new URLSearchParams({
    grant_type:"refresh_token",
    client_id:config.clientId,
    client_secret:config.clientSecret,
    refresh_token:config.refreshToken
  });
  const response=await fetch("https://api.mercadolibre.com/oauth/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body});
  const data=await response.json() as Record<string,unknown>;
  if(!response.ok)throw new Error("A autorização do Mercado Livre expirou. Conecte a conta novamente.");
  const expiresIn=Number(data.expires_in)||21600;
  const accessToken=String(data.access_token||"");
  await saveMercadoLivreConfig({
    accessToken,
    refreshToken:String(data.refresh_token||config.refreshToken),
    tokenExpiresAt:new Date(Date.now()+expiresIn*1000).toISOString(),
    mlUserId:String(data.user_id||config.mlUserId)
  },"Renovação automática");
  return accessToken;
}

export async function mercadoLivreFetch(path:string,init:RequestInit={}){
  const token=await getMercadoLivreAccessToken();
  const headers=new Headers(init.headers);
  headers.set("authorization",`Bearer ${token}`);
  if(init.body&&!headers.has("content-type")&&typeof init.body==="string")headers.set("content-type","application/json");
  return fetch(`https://api.mercadolibre.com${path}`,{...init,headers});
}
