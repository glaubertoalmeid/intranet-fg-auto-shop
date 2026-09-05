import {getRuntimeDb} from "../db/runtime";
import {blingApi} from "./bling";

type AnyRecord=Record<string,unknown>;
const record=(v:unknown):AnyRecord=>v&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:{};
const list=(v:unknown)=>Array.isArray(v)?v:[];
const num=(v:unknown)=>Number(v)||0;
const text=(v:unknown)=>String(v??"").trim();

export async function initProducts(){
 // A tabela em si já vem da migração Drizzle (0003_products_master); isto só garante compatibilidade
 // caso o ambiente ainda não tenha rodado as migrações.
 await getRuntimeDb().prepare(`CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bling_product_id TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  gtin TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  subcategory TEXT NOT NULL DEFAULT '',
  supplier TEXT NOT NULL DEFAULT '',
  cost REAL NOT NULL DEFAULT 0,
  sale_price REAL NOT NULL DEFAULT 0,
  weight REAL NOT NULL DEFAULT 0,
  width REAL NOT NULL DEFAULT 0,
  height REAL NOT NULL DEFAULT 0,
  length REAL NOT NULL DEFAULT 0,
  stock_physical REAL NOT NULL DEFAULT 0,
  stock_reserved REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,
  max_stock REAL NOT NULL DEFAULT 0,
  location TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ativo',
  last_sale_at TEXT NOT NULL DEFAULT '',
  synced_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT ''
 )`).run();
 await getRuntimeDb().prepare("CREATE UNIQUE INDEX IF NOT EXISTS products_bling_id ON products(bling_product_id) WHERE bling_product_id<>''").run().catch(()=>{});
}

const mapProduct=(p:AnyRecord)=>({
 blingProductId:text(p.id),
 sku:text(p.codigo),
 gtin:text(p.gtin||p.gtinEmbalagem),
 name:text(p.nome),
 brand:text(record(p.marca).descricao||p.marca),
 category:text(record(p.categoria).descricao||p.categoria),
 supplier:text(record(p.fornecedor).nome),
 cost:num(p.precoCusto||record(p.fornecedor).precoCusto),
 salePrice:num(p.preco),
 weight:num(p.pesoBruto||p.pesoLiquido),
 width:num(p.largura),height:num(p.altura),length:num(p.profundidade||p.comprimento),
 stock:num(record(p.estoque).saldoVirtualTotal||record(p.estoque).saldoFisicoTotal),
 status:text(p.situacao)==="I"?"inativo":"ativo",
});

/** Pulls the full catalog from Bling and upserts every product into the local master table.
 *  Existing local-only fields (minStock, maxStock, location) are preserved on update. */
export async function syncAllProducts(){
 await initProducts();
 const db=getRuntimeDb();
 let page=1,imported=0;
 while(page<=100){
  const result=await blingApi(`/produtos?pagina=${page}&limite=100`);
  const rows=list(result.data).map(record);
  for(const row of rows){
   const p=mapProduct(row);
   if(!p.blingProductId||!p.name)continue;
   await db.prepare(`INSERT INTO products(bling_product_id,sku,gtin,name,brand,category,supplier,cost,sale_price,weight,width,height,length,stock_physical,status,synced_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(bling_product_id) DO UPDATE SET sku=excluded.sku,gtin=excluded.gtin,name=excluded.name,brand=excluded.brand,category=excluded.category,supplier=excluded.supplier,cost=excluded.cost,sale_price=excluded.sale_price,weight=excluded.weight,width=excluded.width,height=excluded.height,length=excluded.length,stock_physical=excluded.stock_physical,status=excluded.status,synced_at=CURRENT_TIMESTAMP`)
    .bind(p.blingProductId,p.sku,p.gtin,p.name,p.brand,p.category,p.supplier,p.cost,p.salePrice,p.weight,p.width,p.height,p.length,p.stock,p.status).run();
   imported++;
  }
  if(rows.length<100)break;
  page++;
 }
 await syncLastSaleDates();
 return {imported};
}

/** Fills last_sale_at from cmv_sales (already populated by the CMV sync/webhook) so "produtos
 *  parados" alerts don't need a second trip to Bling. */
async function syncLastSaleDates(){
 const db=getRuntimeDb();
 const hasCmv=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cmv_sales'").first();
 if(!hasCmv)return;
 await db.prepare(`UPDATE products SET last_sale_at=COALESCE((SELECT MAX(sale_date) FROM cmv_sales WHERE cmv_sales.product_id=products.bling_product_id),last_sale_at)`).run().catch(()=>{});
}

/** One product's stock/cost/price refreshed from Bling — called by the webhook dispatcher for
 *  estoque.* / produto.* events, so Etapa 0's "aguardando_modulo_estoque" gap is now closed. */
export async function syncSingleProduct(blingProductId:string){
 await initProducts();
 const payload=await blingApi(`/produtos/${blingProductId}`);
 const p=mapProduct(record(payload.data));
 if(!p.blingProductId)return false;
 await getRuntimeDb().prepare(`INSERT INTO products(bling_product_id,sku,gtin,name,brand,category,supplier,cost,sale_price,weight,width,height,length,stock_physical,status,synced_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
  ON CONFLICT(bling_product_id) DO UPDATE SET sku=excluded.sku,gtin=excluded.gtin,name=excluded.name,brand=excluded.brand,category=excluded.category,supplier=excluded.supplier,cost=excluded.cost,sale_price=excluded.sale_price,weight=excluded.weight,width=excluded.width,height=excluded.height,length=excluded.length,stock_physical=excluded.stock_physical,status=excluded.status,synced_at=CURRENT_TIMESTAMP`)
  .bind(p.blingProductId,p.sku,p.gtin,p.name,p.brand,p.category,p.supplier,p.cost,p.salePrice,p.weight,p.width,p.height,p.length,p.stock,p.status).run();
 return true;
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
