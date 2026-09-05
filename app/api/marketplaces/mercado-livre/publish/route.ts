import {NextResponse} from "next/server";
import {getRuntimeBucket,getRuntimeDb} from "../../../../../db/runtime";
import {requirePermission} from "../../../../../lib/auth";
import {initListings} from "../../../listings/route";
import {getMercadoLivreAccessToken,mercadoLivreFetch} from "../../../../../lib/mercado-livre";
import {logAudit} from "../../../../../lib/audit";

type Listing=Record<string,unknown>;
const clean=(value:unknown)=>String(value??"").trim();
const number=(value:unknown)=>Number(value)||0;
const errorMessage=(data:Record<string,unknown>)=>{
  const cause=Array.isArray(data.cause)?data.cause:[];
  const details=cause.flatMap((item)=>{
    const entry=item as Record<string,unknown>;
    const references=Array.isArray(entry.references)?entry.references.map((value)=>typeof value==="string"?value:JSON.stringify(value)):[];
    return [clean(entry.message),clean(entry.code),...references].filter(Boolean);
  });
  return details.join(" • ")||clean(data.message)||clean(data.error)||"O Mercado Livre recusou a publicação.";
};

async function uploadPictures(keys:string[]){
  const token=await getMercadoLivreAccessToken(),pictures:{id:string}[]=[];
  for(const key of keys.slice(0,8)){
    const object=await getRuntimeBucket().get(key);
    if(!object)continue;
    const blob=await new Response(object.body).blob(),form=new FormData();
    form.append("file",blob,key);
    const response=await fetch("https://api.mercadolibre.com/pictures/items/upload",{method:"POST",headers:{authorization:`Bearer ${token}`},body:form});
    const data=await response.json() as Record<string,unknown>;
    if(!response.ok)throw new Error(errorMessage(data));
    if(data.id)pictures.push({id:clean(data.id)});
  }
  return pictures;
}

async function resolveShippingMode(){
  try{
    const userResponse=await mercadoLivreFetch("/users/me");
    if(!userResponse.ok)return"me2";
    const user=await userResponse.json() as Record<string,unknown>,userId=clean(user.id);
    if(!userId)return"me2";
    const preferencesResponse=await mercadoLivreFetch(`/users/${encodeURIComponent(userId)}/shipping_preferences`);
    if(!preferencesResponse.ok)return"me2";
    const preferences=await preferencesResponse.json() as Record<string,unknown>,rawModes=preferences.modes;
    const modes=Array.isArray(rawModes)
      ?rawModes.map((mode)=>typeof mode==="string"?mode:clean((mode as Record<string,unknown>)?.id||(mode as Record<string,unknown>)?.mode))
      :rawModes&&typeof rawModes==="object"?Object.keys(rawModes as Record<string,unknown>):[];
    return modes.includes("me2")?"me2":modes.find((mode)=>mode&&mode!=="me1")||"me2";
  }catch{
    return"me2";
  }
}

export async function POST(request:Request){
  const user=await requirePermission("anuncios");
  await initListings();
  const body=await request.json() as {id?:number;mode?:"catalog"|"traditional";price?:number;stockQuantity?:number;mlModality?:string;sku?:string;mlCatalogProductId?:string;mlCategoryId?:string;imageKeys?:string[];gtin?:string;brand?:string;model?:string;packageVolume?:string;productName?:string;familyName?:string;weight?:number|string;width?:number|string;length?:number|string;height?:number|string;mlTitle?:string;title?:string;mlDescription?:string;description?:string};
  const id=Number(body.id),mode=body.mode==="traditional"?"traditional":"catalog";
  const listing=await getRuntimeDb().prepare("SELECT * FROM listings WHERE id=?").bind(id).first<Listing>();
  if(!listing)return NextResponse.json({error:"Anúncio não encontrado."},{status:404});
  if(clean(listing.ml_item_id))return NextResponse.json({error:"Este produto já possui anúncio publicado no Mercado Livre."},{status:409});
  const price=number(body.price)||number(listing.ml_price),quantity=Math.max(1,Math.floor(number(body.stockQuantity)||number(listing.stock_quantity)));
  if(!price)return NextResponse.json({error:"Informe e salve o preço do Mercado Livre."},{status:400});
  const catalogProductId=clean(body.mlCatalogProductId)||clean(listing.ml_catalog_product_id),categoryId=clean(body.mlCategoryId)||clean(listing.ml_category_id);
  if(mode==="catalog"&&!catalogProductId)return NextResponse.json({error:"Escolha o catálogo correto antes de publicar."},{status:400});
  if(!categoryId)return NextResponse.json({error:"Localize e confirme a categoria antes de publicar."},{status:400});
  await getRuntimeDb().prepare("UPDATE listings SET ml_price=?,stock_quantity=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(price,quantity,user.name,id).run();
  const shippingMode=await resolveShippingMode();
  const common={
    price,
    currency_id:"BRL",
    available_quantity:quantity,
    buying_mode:"buy_it_now",
    condition:"new",
    listing_type_id:clean(body.mlModality||listing.ml_modality)==="premium"?"gold_pro":"gold_special",
    shipping:{mode:shippingMode,free_shipping:false,local_pick_up:false}
  };
  let payload:Record<string,unknown>;
  try{
    if(mode==="catalog"){
      payload={...common,category_id:categoryId,catalog_product_id:catalogProductId,catalog_listing:true};
    }else{
      const imageKeys=Array.isArray(body.imageKeys)?body.imageKeys:JSON.parse(clean(listing.image_keys)||"[]") as string[];
      const pictures=await uploadPictures(imageKeys);
      if(!pictures.length)return NextResponse.json({error:"Envie pelo menos uma imagem antes de publicar."},{status:400});
      const familyName=clean(
        body.familyName||
        [clean(body.brand||listing.brand),clean(body.model||listing.model),clean(body.packageVolume||listing.package_volume)].filter(Boolean).join(" ")||
        body.productName||listing.product_name||
        body.mlTitle||body.title||listing.ml_title||listing.title
      ).slice(0,60);
      const sku=clean(body.sku||listing.sku);
      const width=number(body.width||listing.width),length=number(body.length||listing.length),height=number(body.height||listing.height);
      const weightGrams=Math.max(1,Math.round(number(body.weight||listing.weight)*1000));
      const attributes=[
        clean(body.gtin||listing.gtin)&&{id:"GTIN",value_name:clean(body.gtin||listing.gtin)},
        clean(body.brand||listing.brand)&&{id:"BRAND",value_name:clean(body.brand||listing.brand)},
        clean(body.model||listing.model)&&{id:"MODEL",value_name:clean(body.model||listing.model)},
        sku&&{id:"PART_NUMBER",value_name:sku},
        sku&&{id:"SELLER_SKU",value_name:sku},
        width&&{id:"SELLER_PACKAGE_WIDTH",value_name:`${width} cm`},
        length&&{id:"SELLER_PACKAGE_LENGTH",value_name:`${length} cm`},
        height&&{id:"SELLER_PACKAGE_HEIGHT",value_name:`${height} cm`},
        weightGrams&&{id:"SELLER_PACKAGE_WEIGHT",value_name:`${weightGrams} g`}
      ].filter(Boolean);
      payload={...common,family_name:familyName,category_id:categoryId,pictures,attributes};
    }
    const validation=await mercadoLivreFetch("/items/validate",{method:"POST",body:JSON.stringify(payload)});
    if(!validation.ok&&validation.status!==404){
      const validationData=await validation.json() as Record<string,unknown>;
      const validationText=JSON.stringify(validationData);
      const obsoleteMe1Warning=validationText.includes("shipping.lost_me1_by_user")||validationText.includes("User has not mode me1");
      if(!obsoleteMe1Warning){
        const message=`Validação da categoria: ${errorMessage(validationData)}`;
        await getRuntimeDb().prepare("UPDATE listings SET ml_publish_status='erro',ml_error=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(message,user.name,id).run();
        return NextResponse.json({error:message,details:validationData},{status:400});
      }
    }
    const response=await mercadoLivreFetch("/items",{method:"POST",body:JSON.stringify(payload)});
    const data=await response.json() as Record<string,unknown>;
    if(!response.ok){
      const message=errorMessage(data);
      await getRuntimeDb().prepare("UPDATE listings SET ml_publish_status='erro',ml_error=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(message,user.name,id).run();
      return NextResponse.json({error:message,details:data},{status:400});
    }
    const itemId=clean(data.id),permalink=clean(data.permalink);
    const description=clean(body.mlDescription||body.description||listing.ml_description||listing.description);
    if(mode==="traditional"&&itemId&&description){
      await mercadoLivreFetch(`/items/${encodeURIComponent(itemId)}/description`,{method:"POST",body:JSON.stringify({plain_text:description})});
    }
    await getRuntimeDb().prepare("UPDATE listings SET status='publicado',ml_item_id=?,ml_permalink=?,listing_url=?,ml_publish_status=?,ml_error='',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(itemId,permalink,permalink,clean(data.status)||"active",user.name,id).run();
    await logAudit({user:user.name,action:"listing.publish_ml",target:clean(listing.product_name)||`#${id}`,detail:`${mode} · ${permalink}`});
    return NextResponse.json({ok:true,itemId,permalink,status:clean(data.status)||"active"});
  }catch(error){
    const message=error instanceof Error?error.message:"Não foi possível publicar.";
    await getRuntimeDb().prepare("UPDATE listings SET ml_publish_status='erro',ml_error=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(message,user.name,id).run();
    return NextResponse.json({error:message},{status:400});
  }
}
