import {NextResponse} from "next/server";
import {getRuntimeBucket,getRuntimeDb} from "../../../../../db/runtime";
import {requirePermission} from "../../../../../lib/auth";
import {shopeeRequest} from "../../../../../lib/shopee";
import {initListings} from "../../../listings/route";
import {logAudit} from "../../../../../lib/audit";

const text=(value:unknown)=>String(value??"").trim(),num=(value:unknown)=>Number(value)||0;
export async function POST(request:Request){
 const user=await requirePermission("anuncios");await initListings();
 try{
  const body=await request.json() as Record<string,unknown>,id=Math.floor(num(body.id)),categoryId=Math.floor(num(body.categoryId)),logisticId=Math.floor(num(body.logisticId));
  if(!id)throw new Error("Salve o anúncio antes de publicar.");if(!categoryId)throw new Error("Selecione a categoria da Shopee.");if(!logisticId)throw new Error("Selecione a forma de envio da Shopee.");
  const imageKeys=Array.isArray(body.imageKeys)?body.imageKeys.map(text).filter(Boolean).slice(0,8):[];if(!imageKeys.length)throw new Error("Adicione pelo menos uma imagem.");
  const imageIds:string[]=[];
  for(const key of imageKeys){
   const object=await getRuntimeBucket().get(key);if(!object)continue;const bytes=await object.arrayBuffer(),form=new FormData(),type=object.httpMetadata?.contentType||"image/jpeg";form.append("image",new File([bytes],key,{type}));
   const uploaded=await shopeeRequest("/api/v2/media_space/upload_image",{method:"POST",body:form});const imageId=String((uploaded.response as any)?.image_info?.image_id||(uploaded.response as any)?.image_id||"");if(imageId)imageIds.push(imageId);
  }
  if(!imageIds.length)throw new Error("A Shopee não aceitou as imagens do anúncio.");
  const brandName=text(body.brand)||"NoBrand",stock=Math.max(1,Math.floor(num(body.stockQuantity)));
  const payload={item_name:text(body.title).slice(0,120),description:text(body.description).slice(0,3000),item_sku:text(body.sku).slice(0,100),category_id:categoryId,brand:{brand_id:0,original_brand_name:brandName},original_price:num(body.price),normal_stock:stock,seller_stock:[{stock}],weight:num(body.weight),dimension:{package_length:num(body.length),package_width:num(body.width),package_height:num(body.height)},logistic_info:[{logistic_id:logisticId,enabled:true}],image:{image_id_list:imageIds},item_status:"NORMAL",condition:"NEW"};
  if(!payload.item_name||!payload.description||!payload.original_price||!payload.weight||!payload.dimension.package_length||!payload.dimension.package_width||!payload.dimension.package_height)throw new Error("Preencha título, descrição, preço, peso e todas as medidas.");
  const result=await shopeeRequest("/api/v2/product/add_item",{method:"POST",body:JSON.stringify(payload)}),response=(result.response||{}) as any,itemId=String(response.item_id||"");if(!itemId)throw new Error("A Shopee não retornou o código do produto publicado.");
  const db=getRuntimeDb();for(const sql of["ALTER TABLE listings ADD COLUMN shopee_item_id TEXT NOT NULL DEFAULT ''","ALTER TABLE listings ADD COLUMN shopee_publish_status TEXT NOT NULL DEFAULT ''","ALTER TABLE listings ADD COLUMN shopee_error TEXT NOT NULL DEFAULT ''"]){try{await db.prepare(sql).run()}catch{}}
  const listingUrl="";await db.prepare("UPDATE listings SET status='publicado',shopee_item_id=?,shopee_publish_status='publicado',shopee_error='',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(itemId,user.name,id).run();
  await logAudit({user:user.name,action:"listing.publish_shopee",target:text(body.title)||`#${id}`,detail:`item ${itemId}`});
  return NextResponse.json({ok:true,itemId,listingUrl});
 }catch(error){const message=error instanceof Error?error.message:"Não foi possível publicar na Shopee.";return NextResponse.json({error:message},{status:400})}
}
