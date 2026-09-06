import {createClient,SupabaseClient} from "@supabase/supabase-js";

let cached:SupabaseClient|null=null;

/** Server-only client authenticated as service_role — bypasses RLS, same trust level the D1
 *  binding already has. Never expose SUPABASE_SERVICE_ROLE_KEY to the client bundle. */
export function getSupabase():SupabaseClient{
 const url=(globalThis as typeof globalThis&{__SUPABASE_URL__?:string}).__SUPABASE_URL__?.trim();
 const key=(globalThis as typeof globalThis&{__SUPABASE_SERVICE_ROLE_KEY__?:string}).__SUPABASE_SERVICE_ROLE_KEY__?.trim();
 if(!url||!key)throw new Error("Supabase não está configurado neste ambiente (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY).");
 if(!cached||cached.supabaseUrl!==url)cached=createClient(url,key,{auth:{persistSession:false}});
 return cached;
}

/** PostgREST caps a single response at 1000 rows — paginate with .range() until a page
 *  comes back short, mirroring the page-loop already used for the Bling REST API. */
export async function fetchAllRows<T>(build:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:{message:string}|null}>):Promise<T[]>{
 const pageSize=1000,rows:T[]=[];
 for(let page=0;page<200;page++){
  const from=page*pageSize,to=from+pageSize-1;
  const {data,error}=await build(from,to);
  if(error)throw new Error(error.message);
  const batch=data||[];
  rows.push(...batch);
  if(batch.length<pageSize)break;
 }
 return rows;
}
