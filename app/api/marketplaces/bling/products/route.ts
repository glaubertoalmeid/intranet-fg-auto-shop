import {NextResponse} from "next/server";
import {getRuntimeBucket,getRuntimeDb} from "../../../../../db/runtime";
import {requirePermission} from "../../../../../lib/auth";
import {blingFetch} from "../../../../../lib/bling";
import {listingMeasure} from "../../../../../lib/listing-measures";
import {initListings} from "../../../listings/route";

type AnyRecord=Record<string,any>;
const text=(value:unknown)=>String(value??"").trim();
const searchable=(value:unknown)=>text(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g," ").trim();
const matchesProduct=(product:AnyRecord,query:string)=>{const needle=searchable(query);if(!needle)return true;return searchable([product.nome,product.name,product.codigo,product.sku,product.gtin,product.gtinEmbalagem,product.descricaoCurta,product.descricaoComplementar].filter(Boolean).join(" ")).includes(needle)};
const number=(value:unknown)=>{const parsed=Number(value);return Number.isFinite(parsed)&&parsed>=0?parsed:0};
const productImage=(product:AnyRecord)=>text(product.imagemURL||product.imagemUrl||product.imageUrl||product.midia?.imagens?.externas?.[0]?.link||product.midia?.imagens?.internas?.[0]?.link);
// marca/categoria às vezes vêm como string, às vezes como {descricao} — nunca stringificar o objeto cru.
const label=(v:unknown):string=>typeof v==="string"?v.trim():text((v as AnyRecord)?.descricao);
// Largura/altura/profundidade ficam DENTRO de "dimensoes" na resposta real do Bling (confirmado
// com dado ao vivo — /produtos/{id} devolve {"dimensoes":{"largura":12,"altura":20,...}}), não
// na raiz do produto. Ler product.largura direto sempre dava 0, mesmo com a medida cadastrada.
const productSummary=(product:AnyRecord)=>{const dim=product.dimensoes||{};return{id:text(product.id),name:text(product.nome||product.name),sku:text(product.codigo||product.sku),gtin:text(product.gtin||product.gtinEmbalagem),salePrice:number(product.preco),cost:number(product.precoCusto),stock:number(product.estoque?.saldoVirtualTotal||product.estoque?.saldoFisicoTotal),weight:number(product.pesoBruto||product.pesoLiquido),width:number(dim.largura??product.largura),length:number(dim.profundidade??product.profundidade??product.comprimento),height:number(dim.altura??product.altura),brand:label(product.marca),picture:productImage(product),status:text(product.situacao),format:text(product.formato)}};
async function json(response:Response){const payload=await response.json() as AnyRecord;if(!response.ok)throw new Error(text(payload?.error?.description||payload?.error?.message||payload?.message)||`O Bling recusou a consulta (${response.status}).`);return payload}
async function savePicture(url:string){if(!/^https:\/\//i.test(url))return"";try{const response=await fetch(url);if(!response.ok)return"";const contentType=response.headers.get("content-type")||"image/jpeg";if(!contentType.startsWith("image/"))return"";const ext=contentType.includes("png")?"png":contentType.includes("webp")?"webp":"jpg",key=`anuncio-${crypto.randomUUID()}.${ext}`;await getRuntimeBucket().put(key,response.body!,{httpMetadata:{contentType},customMetadata:{source:"bling"}});return key}catch{return""}}

/** Kit (formato "E") não guarda custo no próprio registro — é a soma dos componentes da
 *  estrutura (mesma lógica já usada no cálculo de CMV, agora reaplicada aqui pra o
 *  anúncio importado já nascer com o custo certo, sem precisar de outro backfill depois). */
async function kitCost(product:AnyRecord):Promise<number>{
 if(text(product.formato)!=="E")return 0;
 const componentes=Array.isArray(product.estrutura?.componentes)?product.estrutura.componentes:[];
 let sum=0;
 for(const comp of componentes){
  const compId=text(comp?.produto?.id);if(!compId)continue;
  try{
   const payload=await json(await blingFetch(`/produtos/${compId}`));
   const compData=payload.data||{};
   sum+=number(compData.precoCusto||compData.fornecedor?.precoCusto)*number(comp.quantidade);
  }catch{/* componente indisponível — segue sem ele, não trava a importação */}
 }
 return sum;
}

export async function GET(request:Request){
 await requirePermission("anuncios");
 const url=new URL(request.url),query=text(url.searchParams.get("q")),page=Math.max(1,Number(url.searchParams.get("page"))||1);
 if(!query){const params=new URLSearchParams({pagina:String(page),limite:"50"}),payload=await json(await blingFetch(`/produtos?${params}`)),products=(Array.isArray(payload.data)?payload.data:[]).map(productSummary).filter((p:AnyRecord)=>p.id&&p.name);return NextResponse.json({products,page,hasMore:products.length===50})}
 const found=new Map<string,AnyRecord>();
 const add=(rows:AnyRecord[])=>{for(const row of rows)if(matchesProduct(row,query)){const product=productSummary(row);if(product.id&&product.name)found.set(product.id,product)}};
 const directParams=new URLSearchParams({pagina:"1",limite:"100",criterio:query}),direct=await json(await blingFetch(`/produtos?${directParams}`));add(Array.isArray(direct.data)?direct.data:[]);
 if(!found.size){for(let scanPage=1;scanPage<=20&&found.size<50;scanPage++){const params=new URLSearchParams({pagina:String(scanPage),limite:"100"}),payload=await json(await blingFetch(`/produtos?${params}`)),rows=Array.isArray(payload.data)?payload.data:[];add(rows);if(rows.length<100)break}}
 return NextResponse.json({products:Array.from(found.values()).slice(0,50),page:1,hasMore:false,query});
}

export async function POST(request:Request){
 const user=await requirePermission("anuncios");await initListings();const body=await request.json() as {ids?:unknown[]},ids=(Array.isArray(body.ids)?body.ids:[]).map(text).filter(id=>/^\d+$/.test(id)).slice(0,50);if(!ids.length)return NextResponse.json({error:"Selecione pelo menos um produto do Bling."},{status:400});
 const db=getRuntimeDb();try{await db.prepare("ALTER TABLE listings ADD COLUMN bling_product_id TEXT NOT NULL DEFAULT ''").run()}catch{}
 const existing=(await db.prepare("SELECT bling_product_id,sku FROM listings").all<{bling_product_id:string;sku:string}>()).results,knownIds=new Set(existing.map(row=>text(row.bling_product_id))),knownSkus=new Set(existing.map(row=>text(row.sku).toLowerCase()).filter(Boolean));
 const stockById=new Map<string,number>();try{const params=new URLSearchParams();ids.forEach(id=>params.append("idsProdutos[]",id));const payload=await json(await blingFetch(`/estoques/saldos?${params}`));for(const row of Array.isArray(payload.data)?payload.data:[]){stockById.set(text(row.produto?.id||row.idProduto),number(row.saldoVirtualTotal??row.saldoFisicoTotal))}}catch{}
 let imported=0,skipped=0,failed=0;
 for(const id of ids){if(knownIds.has(id)){skipped++;continue}try{const payload=await json(await blingFetch(`/produtos/${id}`)),product=productSummary(payload.data||{});if(!product.name){failed++;continue}if(product.sku&&knownSkus.has(product.sku.toLowerCase())){skipped++;continue}const pictureKey=await savePicture(product.picture),stock=Math.max(0,Math.floor(stockById.get(id)??product.stock));const cost=product.cost>0?product.cost:await kitCost(payload.data||{});await db.prepare(`INSERT INTO listings(bling_product_id,sku,product_name,platform,status,sale_price,cost,title,description,packaging,weight,width,length,height,image_keys,listing_url,gtin,brand,stock_quantity,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,product.sku,product.name,"ambos","preparacao",product.salePrice,cost,"","","",listingMeasure("weight",product.weight),listingMeasure("width",product.width),listingMeasure("length",product.length),listingMeasure("height",product.height),JSON.stringify(pictureKey?[pictureKey]:[]),"",product.gtin,product.brand,stock,user.name,user.name).run();knownIds.add(id);if(product.sku)knownSkus.add(product.sku.toLowerCase());imported++}catch{failed++}}
 return NextResponse.json({ok:true,imported,skipped,failed},{status:201});
}
