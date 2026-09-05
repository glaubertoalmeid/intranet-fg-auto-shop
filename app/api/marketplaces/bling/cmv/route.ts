import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../lib/auth";
import {blingApi} from "../../../../../lib/bling";
import {getRuntimeDb} from "../../../../../db/runtime";
import {logAudit} from "../../../../../lib/audit";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const list=(v:unknown)=>Array.isArray(v)?v:[];
const num=(v:unknown)=>Number(v)||0;
const text=(v:unknown)=>String(v??"").trim();
const isDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v);

async function init(){
 await getRuntimeDb().prepare(`CREATE TABLE IF NOT EXISTS cmv_sales (sale_id TEXT NOT NULL,item_id TEXT NOT NULL,product_id TEXT NOT NULL DEFAULT '',sku TEXT NOT NULL DEFAULT '',product_name TEXT NOT NULL DEFAULT '',quantity REAL NOT NULL DEFAULT 0,revenue REAL NOT NULL DEFAULT 0,cost REAL NOT NULL DEFAULT 0,cost_estimated INTEGER NOT NULL DEFAULT 1,sale_date TEXT NOT NULL DEFAULT '',channel TEXT NOT NULL DEFAULT '',seller TEXT NOT NULL DEFAULT '',brand TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT '',customer_name TEXT NOT NULL DEFAULT '',synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(sale_id,item_id))`).run();
 await getRuntimeDb().prepare("ALTER TABLE cmv_sales ADD COLUMN customer_name TEXT NOT NULL DEFAULT ''").run().catch(()=>{});
}

/** Pulls sales + items from Bling for a date range and upserts them into cmv_sales.
 *  Exported so the webhook handler can call the same logic incrementally for a single order. */
export async function syncSalesRange(from:string,to:string){
 await init();
 let page=1;const sales:AnyRecord[]=[];
 while(page<=10){const result=await blingApi(`/pedidos/vendas?pagina=${page}&limite=100&dataInicial=${from}&dataFinal=${to}`),batch=list(result.data).map(record);sales.push(...batch);if(batch.length<100)break;page++}
 let imported=0;
 for(const summary of sales){
  const saleId=text(summary.id);if(!saleId)continue;
  imported+=await syncSingleSale(saleId,summary);
 }
 return {sales:sales.length,items:imported};
}

export async function syncSingleSale(saleId:string,summary:AnyRecord={}){
 await init();
 const detail=record((await blingApi(`/pedidos/vendas/${saleId}`)).data),items=list(detail.itens).map(record);
 const saleDate=text(detail.data||summary.data).slice(0,10),channel=text(record(detail.loja).descricao||record(detail.loja).nome||record(summary.loja).descricao),seller=text(record(detail.vendedor).nome||record(summary.vendedor).nome),customerName=text(record(detail.contato).nome||record(summary.contato).nome);
 let imported=0;
 for(let index=0;index<items.length;index++){
  const item=items[index],product=record(item.produto),productId=text(product.id),quantity=num(item.quantidade),unitPrice=num(item.valor||item.preco||item.valorUnitario),discount=num(item.desconto),revenue=Math.max(0,quantity*unitPrice-discount);
  let cost=num(item.valorCusto||item.custo);let brand="",category="";const estimated=cost<=0;
  if(productId&&estimated){try{const p=record((await blingApi(`/produtos/${productId}`)).data);cost=num(p.precoCusto||p.custo||record(p.fornecedor).precoCusto);brand=text(record(p.marca).descricao||p.marca);category=text(record(p.categoria).descricao||p.categoria)}catch{/* mantém custo zerado e sinaliza estimativa */}}
  await getRuntimeDb().prepare(`INSERT INTO cmv_sales(sale_id,item_id,product_id,sku,product_name,quantity,revenue,cost,cost_estimated,sale_date,channel,seller,brand,category,customer_name,synced_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(sale_id,item_id) DO UPDATE SET product_id=excluded.product_id,sku=excluded.sku,product_name=excluded.product_name,quantity=excluded.quantity,revenue=excluded.revenue,cost=excluded.cost,cost_estimated=excluded.cost_estimated,sale_date=excluded.sale_date,channel=excluded.channel,seller=excluded.seller,brand=excluded.brand,category=excluded.category,customer_name=excluded.customer_name,synced_at=CURRENT_TIMESTAMP`).bind(saleId,text(item.id||index),productId,text(item.codigo||product.codigo),text(item.descricao||product.nome),quantity,revenue,cost,estimated?1:0,saleDate,channel,seller,brand,category,customerName).run();
  imported++;
 }
 return imported;
}

export async function POST(request:Request){
 try{
  const user=await requirePermission("relatorios_cmv");await init();
  const body=await request.json().catch(()=>({})) as {from?:string;to?:string};
  const now=new Date(),to=isDate(body.to||"")?body.to!:now.toISOString().slice(0,10),fallback=new Date(now.getTime()-31*86400000).toISOString().slice(0,10),from=isDate(body.from||"")?body.from!:fallback;
  const result=await syncSalesRange(from,to);
  await logAudit({user:user.name,action:"cmv.sync",target:`${from}..${to}`,detail:`${result.sales} pedido(s), ${result.items} item(ns)`});
  return NextResponse.json({ok:true,...result,from,to});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível sincronizar as vendas."},{status:500})}
}

export async function GET(request:Request){
 try{
  await requirePermission("relatorios_cmv");await init();
  const url=new URL(request.url);
  const from=url.searchParams.get("from")||"",to=url.searchParams.get("to")||"";
  const channel=url.searchParams.get("channel")||"",brand=url.searchParams.get("brand")||"",category=url.searchParams.get("category")||"",seller=url.searchParams.get("seller")||"",product=url.searchParams.get("product")||"";

  const where:string[]=[],binds:unknown[]=[];
  if(isDate(from)){where.push("sale_date>=?");binds.push(from)}
  if(isDate(to)){where.push("sale_date<=?");binds.push(to)}
  if(channel){where.push("channel=?");binds.push(channel)}
  if(brand){where.push("brand=?");binds.push(brand)}
  if(category){where.push("category=?");binds.push(category)}
  if(seller){where.push("seller=?");binds.push(seller)}
  if(product){where.push("(product_name LIKE ? OR sku LIKE ?)");binds.push(`%${product}%`,`%${product}%`)}
  const clause=where.length?`WHERE ${where.join(" AND ")}`:"";

  const rows=await getRuntimeDb().prepare(`SELECT product_id,sku,product_name,SUM(quantity) quantity,SUM(revenue) revenue,SUM(quantity*cost) cmv,MAX(cost_estimated) cost_estimated FROM cmv_sales ${clause} GROUP BY product_id,sku,product_name ORDER BY revenue DESC`).bind(...binds).all<AnyRecord>();
  const products=(rows.results||[]).map((row:AnyRecord)=>{const revenue=num(row.revenue),cmv=num(row.cmv),profit=revenue-cmv;return{...row,quantity:num(row.quantity),revenue,cmv,profit,margin:revenue?profit/revenue*100:0,markup:cmv?revenue/cmv:0,costEstimated:Boolean(row.cost_estimated)}});
  const totals=products.reduce((a:{revenue:number;cmv:number;profit:number},p:typeof products[number])=>({revenue:a.revenue+p.revenue,cmv:a.cmv+p.cmv,profit:a.profit+p.profit}),{revenue:0,cmv:0,profit:0});

  // Filter option lists reflect only the period, so choosing one filter never empties the others.
  const periodWhere:string[]=[],periodBinds:unknown[]=[];
  if(isDate(from)){periodWhere.push("sale_date>=?");periodBinds.push(from)}
  if(isDate(to)){periodWhere.push("sale_date<=?");periodBinds.push(to)}
  const distinct=async(col:string):Promise<string[]>=>{
   const clauses=[...periodWhere,`${col}<>''`];
   const r=await getRuntimeDb().prepare(`SELECT DISTINCT ${col} v FROM cmv_sales WHERE ${clauses.join(" AND ")} ORDER BY v`).bind(...periodBinds).all<{v:string}>().catch(()=>({results:[] as {v:string}[]}));
   return (r.results||[]).map((x:{v:string})=>x.v).filter(Boolean);
  };
  const [channels,brands,categories,sellers]=await Promise.all([distinct("channel"),distinct("brand"),distinct("category"),distinct("seller")]);

  return NextResponse.json({products,totals:{...totals,margin:totals.revenue?totals.profit/totals.revenue*100:0},filters:{channels,brands,categories,sellers}});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível carregar o relatório."},{status:500})}
}
