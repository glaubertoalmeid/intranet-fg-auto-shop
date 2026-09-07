import {blingApi} from "./bling";
import {fetchAllRows,getSupabase} from "./supabase";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const list=(v:unknown)=>Array.isArray(v)?v:[];
const num=(v:unknown)=>Number(v)||0;
const text=(v:unknown)=>String(v??"").trim();

const mapProduct=(p:AnyRecord)=>({
 bling_product_id:text(p.id),
 sku:text(p.codigo),
 gtin:text(p.gtin||p.gtinEmbalagem),
 name:text(p.nome),
 brand:text(record(p.marca).descricao||p.marca),
 category:text(record(p.categoria).descricao||p.categoria),
 supplier:text(record(p.fornecedor).nome),
 cost:num(p.precoCusto||record(p.fornecedor).precoCusto),
 sale_price:num(p.preco),
 weight:num(p.pesoBruto||p.pesoLiquido),
 width:num(p.largura),height:num(p.altura),length:num(p.profundidade||p.comprimento),
 stock_physical:num(record(p.estoque).saldoVirtualTotal||record(p.estoque).saldoFisicoTotal),
 status:text(p.situacao)==="I"?"inativo":"ativo",
});

// O Workers tem um teto de sub-requisições por execução (50 no plano gratuito da
// Cloudflare) — cada chamada ao Bling ou ao Supabase conta. Cada página gasta 2 (lista +
// upsert), então esse teto cobre uns 20 mil produtos antes de truncar; ainda assim, para
// catálogos enormes, o usuário precisa clicar em Sincronizar de novo pra pegar o resto.
const SUBREQUEST_BUDGET=42;

/** Pulls the full catalog from Bling and upserts every product into Supabase's products table.
 *  Existing local-only fields (minStock, maxStock, location, supplierId) are preserved on update
 *  because they aren't part of this upsert payload. */
export async function syncAllProducts(){
 const supabase=getSupabase();
 let page=1,imported=0,spent=0,truncated=false;
 while(page<=100){
  if(spent>=SUBREQUEST_BUDGET){truncated=true;break}
  const result=await blingApi(`/produtos?pagina=${page}&limite=100`);spent++;
  const rows=list(result.data).map(record);
  const payload=rows.map(mapProduct).filter(p=>p.bling_product_id&&p.name).map(p=>({...p,synced_at:new Date().toISOString()}));
  if(payload.length){
   const {error}=await supabase.from("products").upsert(payload,{onConflict:"bling_product_id"});spent++;
   if(error)throw new Error(error.message);
   imported+=payload.length;
  }
  if(rows.length<100)break;
  page++;
 }
 await syncLastSaleDates();
 return {imported,truncated};
}

/** One product's stock/cost/price refreshed from Bling — called by the webhook dispatcher for
 *  estoque.* / produto.* events, so Etapa 0's "aguardando_modulo_estoque" gap is now closed. */
export async function syncSingleProduct(blingProductId:string){
 const payload=await blingApi(`/produtos/${blingProductId}`);
 const p=mapProduct(record(payload.data));
 if(!p.bling_product_id)return false;
 const {error}=await getSupabase().from("products").upsert({...p,synced_at:new Date().toISOString()},{onConflict:"bling_product_id"});
 if(error)throw new Error(error.message);
 return true;
}

/** Fills last_sale_at from cmv_sales (Supabase, Etapa 2 — já populado pelo sync/webhook do CMV)
 *  so "produtos parados" alerts don't need a second trip to Bling. */
async function syncLastSaleDates(){
 const supabase=getSupabase();
 const rows=await fetchAllRows<{product_id:string;sale_date:string}>((from_,to_)=>
  supabase.from("cmv_sales").select("product_id,sale_date").range(from_,to_)
 ).catch(()=>[] as {product_id:string;sale_date:string}[]);
 const lastByProduct=new Map<string,string>();
 for(const row of rows){
  if(!row.product_id)continue;
  const current=lastByProduct.get(row.product_id);
  if(!current||row.sale_date>current)lastByProduct.set(row.product_id,row.sale_date);
 }
 if(!lastByProduct.size)return;
 // Uma chamada só via função no Postgres, em vez de um update por produto — do contrário
 // um catálogo com poucas centenas de produtos vendidos já estoura o teto de
 // sub-requisições do Worker (mesmo problema do sync de vendas, ver SUBREQUEST_BUDGET).
 const updates=[...lastByProduct].map(([bling_product_id,last_sale_at])=>({bling_product_id,last_sale_at}));
 const {error}=await supabase.rpc("bulk_update_last_sale_at",{updates});
 if(error)throw new Error(error.message);
}

export type ProductAlert="zerado"|"abaixo_minimo"|"excesso"|"parado_30"|"parado_60"|"parado_90";
export function computeAlerts(row:{stock_physical:number;min_stock:number;max_stock:number;last_sale_at:string}):ProductAlert[]{
 const alerts:ProductAlert[]=[];
 if(row.stock_physical<=0)alerts.push("zerado");
 else if(row.min_stock>0&&row.stock_physical<row.min_stock)alerts.push("abaixo_minimo");
 if(row.max_stock>0&&row.stock_physical>row.max_stock)alerts.push("excesso");
 if(row.last_sale_at){
  const days=(Date.now()-new Date(row.last_sale_at).getTime())/86400000;
  if(days>=90)alerts.push("parado_90");else if(days>=60)alerts.push("parado_60");else if(days>=30)alerts.push("parado_30");
 }
 return alerts;
}

/** Curva ABC pela participação acumulada na receita: A até 80%, B até 95%, C no resto —
 *  a régua clássica de gestão de estoque que o documento pede. */
export function classifyAbc<T extends{revenue:number}>(rows:T[]):(T&{abcClass:"A"|"B"|"C"})[]{
 const sorted=[...rows].sort((a,b)=>b.revenue-a.revenue);
 const total=sorted.reduce((sum,r)=>sum+r.revenue,0)||1;
 let cumulative=0;
 return sorted.map(row=>{
  cumulative+=row.revenue;
  const share=cumulative/total;
  const abcClass=share<=0.8?"A":share<=0.95?"B":"C";
  return {...row,abcClass};
 });
}
