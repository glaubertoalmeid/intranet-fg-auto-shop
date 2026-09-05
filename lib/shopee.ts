import {getRuntimeDb} from "../db/runtime";

export type ShopeeConfig={environment:"sandbox"|"production";partnerId:string;partnerKey:string;shopId:string;accessToken:string;refreshToken:string;tokenExpiresAt:string;lastError:string};
const empty:ShopeeConfig={environment:"sandbox",partnerId:"",partnerKey:"",shopId:"",accessToken:"",refreshToken:"",tokenExpiresAt:"",lastError:""};
const encryptionSecret=()=>((globalThis as typeof globalThis&{__AI_ENCRYPTION_KEY__?:string}).__AI_ENCRYPTION_KEY__||"").trim();
const decode=(value:string)=>Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")),char=>char.charCodeAt(0));
const encode=(value:Uint8Array)=>btoa(String.fromCharCode(...value)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
async function cryptoKey(){const raw=decode(encryptionSecret());if(raw.length!==32)throw new Error("Proteção das integrações não configurada.");return crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt","decrypt"])}
async function encrypt(value:string){const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},await cryptoKey(),new TextEncoder().encode(value)));return `${encode(iv)}.${encode(encrypted)}`}
async function decrypt(value:string){const [iv,data]=value.split(".");if(!iv||!data)return"";return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:decode(iv)},await cryptoKey(),decode(data)))}

export async function initShopee(){
 const db=getRuntimeDb();
 await db.prepare(`CREATE TABLE IF NOT EXISTS marketplace_settings (provider TEXT PRIMARY KEY,encrypted_data TEXT NOT NULL,updated_by TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS marketplace_oauth_states (state TEXT PRIMARY KEY,provider TEXT NOT NULL,verifier TEXT NOT NULL,created_by TEXT NOT NULL DEFAULT '',expires_at TEXT NOT NULL)`).run();
}
async function readStored(provider:string){const row=await getRuntimeDb().prepare("SELECT encrypted_data FROM marketplace_settings WHERE provider=?").bind(provider).first<{encrypted_data:string}>();if(!row)return null;try{return JSON.parse(await decrypt(row.encrypted_data)) as Partial<ShopeeConfig>}catch{return null}}
async function writeStored(provider:string,value:unknown,user:string){const encrypted=await encrypt(JSON.stringify(value));await getRuntimeDb().prepare(`INSERT INTO marketplace_settings(provider,encrypted_data,updated_by,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(provider) DO UPDATE SET encrypted_data=excluded.encrypted_data,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).bind(provider,encrypted,user).run()}
export async function getShopeeConfig():Promise<ShopeeConfig>{
 await initShopee();
 const active=await readStored("shopee_active"),environment=active?.environment==="production"?"production":"sandbox";
 let stored=await readStored(`shopee_${environment}`);
 if(!stored){const legacy=await readStored("shopee");if(legacy?.environment===environment)stored=legacy}
 return {...empty,...stored,environment} as ShopeeConfig;
}
export async function saveShopeeConfig(values:Partial<ShopeeConfig>,user:string){
 await initShopee();
 const current=await getShopeeConfig(),environment=values.environment==="production"?"production":values.environment==="sandbox"?"sandbox":current.environment;
 const existing=await readStored(`shopee_${environment}`),next={...empty,...existing,...(current.environment===environment?current:{}),...values,environment};
 await writeStored(`shopee_${environment}`,next,user);await writeStored("shopee_active",{environment},user);
}

export const shopeeCallbackUrl="https://intranet-fg-auto-shop.glaubertoalmeid.chatgpt.site/api/marketplaces/shopee/callback";
export const shopeeHomeUrl="https://intranet-fg-auto-shop.glaubertoalmeid.chatgpt.site/";
export const shopeeHosts={sandbox:{partner:"https://openplatform.sandbox.test-stable.shopee.sg",api:"https://openplatform.sandbox.test-stable.shopee.sg"},production:{partner:"https://openplatform.shopee.com.br",api:"https://openplatform.shopee.com.br"}};
export function randomShopeeState(){return encode(crypto.getRandomValues(new Uint8Array(24)))}
export async function shopeeSign(partnerKey:string,base:string){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(partnerKey),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const signature=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(base)));return Array.from(signature,byte=>byte.toString(16).padStart(2,"0")).join("")}

type ShopeeResult={error?:string;message?:string;response?:Record<string,unknown>;[key:string]:unknown};
async function refreshShopeeToken(config:ShopeeConfig){
 const path="/api/v2/auth/access_token/get",timestamp=Math.floor(Date.now()/1000),sign=await shopeeSign(config.partnerKey,`${config.partnerId}${path}${timestamp}`),url=new URL(path,shopeeHosts[config.environment].api);
 url.searchParams.set("partner_id",config.partnerId);url.searchParams.set("timestamp",String(timestamp));url.searchParams.set("sign",sign);
 const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({refresh_token:config.refreshToken,partner_id:Number(config.partnerId),shop_id:Number(config.shopId)})});
 const data=await response.json() as ShopeeResult;if(!response.ok||data.error)throw new Error([data.error,data.message].filter(Boolean).join(" — ")||"Não foi possível renovar a conexão com a Shopee.");
 const next={...config,accessToken:String(data.access_token||""),refreshToken:String(data.refresh_token||config.refreshToken),tokenExpiresAt:new Date(Date.now()+(Number(data.expire_in)||14400)*1000).toISOString(),lastError:""};
 await saveShopeeConfig(next,"sistema");return next;
}
export async function shopeeRequest(path:string,{method="GET",query={},body}: {method?:"GET"|"POST";query?:Record<string,string|number|boolean>;body?:BodyInit}={}){
 let config=await getShopeeConfig();if(!config.partnerId||!config.partnerKey||!config.shopId||!config.refreshToken)throw new Error("Conecte a Shopee antes de continuar.");
 if(!config.accessToken||!config.tokenExpiresAt||Date.parse(config.tokenExpiresAt)<Date.now()+60_000)config=await refreshShopeeToken(config);
 const timestamp=Math.floor(Date.now()/1000),sign=await shopeeSign(config.partnerKey,`${config.partnerId}${path}${timestamp}${config.accessToken}${config.shopId}`),url=new URL(path,shopeeHosts[config.environment].api);
 url.searchParams.set("partner_id",config.partnerId);url.searchParams.set("timestamp",String(timestamp));url.searchParams.set("access_token",config.accessToken);url.searchParams.set("shop_id",config.shopId);url.searchParams.set("sign",sign);for(const [key,value] of Object.entries(query))url.searchParams.set(key,String(value));
 const headers=typeof body==="string"?{"content-type":"application/json"}:undefined;const response=await fetch(url,{method,body,headers});const raw=await response.text();let data:ShopeeResult={};try{data=raw?JSON.parse(raw):{}}catch{throw new Error(`A Shopee respondeu em formato inválido (erro ${response.status}).`)}
 if(!response.ok||data.error)throw new Error([data.error,data.message].filter(Boolean).join(" — ")||`A Shopee recusou a operação (erro ${response.status}).`);return data;
}
