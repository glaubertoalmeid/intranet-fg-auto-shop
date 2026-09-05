import {NextResponse} from "next/server";
import {requirePermission} from "../../../lib/auth";
import {getRuntimeDb} from "../../../db/runtime";

const isDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v);
const num=(v:unknown)=>Number(v)||0;

type GroupRow={label:string;revenue:number;cmv:number;quantity:number;orders:number};

export async function GET(request:Request){
 try{
  await requirePermission("comercial");
  const url=new URL(request.url);
  const now=new Date(),to=isDate(url.searchParams.get("to")||"")?url.searchParams.get("to")!:now.toISOString().slice(0,10);
  const fallback=new Date(now.getTime()-31*86400000).toISOString().slice(0,10),from=isDate(url.searchParams.get("from")||"")?url.searchParams.get("from")!:fallback;

  const db=getRuntimeDb();
  const hasCmv=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cmv_sales'").first();
  if(!hasCmv)return NextResponse.json({empty:true,from,to});

  const groupBy=async(column:string,extraWhere=""):Promise<GroupRow[]>=>{
   const rows=(await db.prepare(`SELECT ${column} label,SUM(revenue) revenue,SUM(quantity*cost) cmv,SUM(quantity) quantity,COUNT(DISTINCT sale_id) orders
    FROM cmv_sales WHERE sale_date>=? AND sale_date<=? AND ${column}<>'' ${extraWhere}
    GROUP BY ${column} ORDER BY revenue DESC`).bind(from,to).all<GroupRow>()).results||[];
   return rows.map((r:GroupRow)=>({...r,revenue:num(r.revenue),cmv:num(r.cmv),quantity:num(r.quantity),orders:num(r.orders)}));
  };
  const withDerived=(rows:GroupRow[])=>rows.map(r=>({...r,profit:r.revenue-r.cmv,margin:r.revenue?((r.revenue-r.cmv)/r.revenue)*100:0,ticketMedio:r.orders?r.revenue/r.orders:0}));

  const [byChannel,bySeller,byBrand,byCategory,byCustomer]=await Promise.all([
   groupBy("channel").then(withDerived),
   groupBy("seller").then(withDerived),
   groupBy("brand").then(withDerived),
   groupBy("category").then(withDerived),
   groupBy("customer_name").then(withDerived),
  ]);

  const productRows=(await db.prepare(`SELECT product_name label,sku,SUM(revenue) revenue,SUM(quantity*cost) cmv,SUM(quantity) quantity,COUNT(DISTINCT sale_id) orders
   FROM cmv_sales WHERE sale_date>=? AND sale_date<=? GROUP BY product_id,sku,product_name ORDER BY revenue DESC`).bind(from,to).all<GroupRow&{sku:string}>()).results||[];
  const productsWithDerived=withDerived(productRows.map((r:GroupRow)=>({...r,revenue:num(r.revenue),cmv:num(r.cmv),quantity:num(r.quantity),orders:num(r.orders)})));
  const topProducts=[...productsWithDerived].slice(0,10);
  const bottomProducts=[...productsWithDerived].filter(p=>p.quantity>0).sort((a,b)=>a.revenue-b.revenue).slice(0,10);

  const totalsRow=await db.prepare("SELECT SUM(revenue) revenue,SUM(quantity*cost) cmv,SUM(quantity) quantity,COUNT(DISTINCT sale_id) orders FROM cmv_sales WHERE sale_date>=? AND sale_date<=?").bind(from,to).first<GroupRow>();
  const revenue=num(totalsRow?.revenue),cmv=num(totalsRow?.cmv),orders=num(totalsRow?.orders),quantity=num(totalsRow?.quantity);
  const totals={revenue,cmv,profit:revenue-cmv,margin:revenue?((revenue-cmv)/revenue)*100:0,orders,quantity,ticketMedio:orders?revenue/orders:0};

  // O documento pede as duas perguntas separadas de propósito: o canal que mais fatura não é
  // necessariamente o que mais dá lucro (comissão/frete corroem a margem de forma desigual).
  const revenueLeader=[...byChannel].sort((a,b)=>b.revenue-a.revenue)[0]||null;
  const profitLeader=[...byChannel].sort((a,b)=>b.profit-a.profit)[0]||null;

  return NextResponse.json({from,to,totals,byChannel,bySeller,byBrand,byCategory,topProducts,bottomProducts,topCustomers:byCustomer.slice(0,10),leaders:{revenueLeader,profitLeader}});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível carregar o comercial."},{status:500})}
}
