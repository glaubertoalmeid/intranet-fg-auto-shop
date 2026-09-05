import {NextResponse} from "next/server";
import {getRuntimeDb} from "../../../../db/runtime";
import {requirePermission} from "../../../../lib/auth";
import {listingMeasure} from "../../../../lib/listing-measures";
import {initListings} from "../route";

type Row={sku?:unknown;productName?:unknown;salePrice?:unknown;weight?:unknown;width?:unknown;length?:unknown;height?:unknown};
const clean=(value:unknown)=>String(value??"").trim();
const num=(value:unknown)=>{const n=Number(value);return Number.isFinite(n)&&n>=0?n:0};

export async function POST(req:Request){
 const user=await requirePermission("anuncios");
 await initListings();
 const body=await req.json() as {rows?:Row[]};
 const rows=Array.isArray(body.rows)?body.rows.slice(0,1000):[];
 const valid=rows.filter(row=>clean(row.productName));
 if(!valid.length)return NextResponse.json({error:"Nenhum produto válido foi encontrado."},{status:400});
 const db=getRuntimeDb();
 const existing=(await db.prepare("SELECT sku FROM listings WHERE sku<>''").all<{sku:string}>()).results;
 const known=new Set(existing.map(row=>row.sku.toLowerCase()));
 let skipped=0;
 const statements=[];
 for(const row of valid){
  const sku=clean(row.sku);
  if(sku&&known.has(sku.toLowerCase())){skipped++;continue}
  if(sku)known.add(sku.toLowerCase());
  statements.push(db.prepare("INSERT INTO listings(sku,product_name,platform,status,sale_price,title,description,packaging,weight,width,length,height,image_keys,listing_url,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
   .bind(sku,clean(row.productName),"ambos","preparacao",num(row.salePrice),"","","",listingMeasure("weight",row.weight),listingMeasure("width",row.width),listingMeasure("length",row.length),listingMeasure("height",row.height),"","",user.name,user.name));
 }
 if(statements.length)await db.batch(statements);
 return NextResponse.json({ok:true,imported:statements.length,skipped},{status:201});
}
