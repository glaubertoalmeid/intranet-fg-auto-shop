import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../lib/auth";
import {mercadoLivreFetch} from "../../../../../lib/mercado-livre";

const clean=(value:unknown)=>String(value??"").trim();
const attrValue=(attributes:unknown,id:string)=>{
  if(!Array.isArray(attributes))return"";
  const item=attributes.find((value)=>value&&typeof value==="object"&&String((value as Record<string,unknown>).id)===id) as Record<string,unknown>|undefined;
  return clean(item?.value_name||item?.value_id);
};

export async function POST(request:Request){
  await requirePermission("anuncios");
  const body=await request.json() as Record<string,unknown>;
  const query=clean(body.query),gtin=clean(body.gtin);
  if(!query&&!gtin)return NextResponse.json({error:"Informe o GTIN ou o nome do produto."},{status:400});
  const params=new URLSearchParams({status:"active",site_id:"MLB",limit:"12"});
  if(gtin)params.set("product_identifier",gtin);else params.set("q",query);
  const response=await mercadoLivreFetch(`/products/search?${params}`);
  const data=await response.json() as Record<string,unknown>;
  if(!response.ok)return NextResponse.json({error:clean(data.message)||"Não foi possível pesquisar o catálogo."},{status:response.status});
  const results=Array.isArray(data.results)?data.results:[];
  const candidates=results.map((raw)=>{
    const item=raw as Record<string,unknown>,pictures=Array.isArray(item.pictures)?item.pictures:[];
    const picture=(pictures[0]||{}) as Record<string,unknown>;
    return{
      id:clean(item.id),
      name:clean(item.name||item.title),
      status:clean(item.status),
      domainId:clean(item.domain_id),
      categoryId:clean(item.category_id),
      picture:clean(picture.secure_url||picture.url),
      brand:attrValue(item.attributes,"BRAND"),
      model:attrValue(item.attributes,"MODEL"),
      gtin:attrValue(item.attributes,"GTIN"),
      packageVolume:attrValue(item.attributes,"PACKAGE_VOLUME")
    };
  });
  const discovered:Array<Record<string,unknown>>=[];
  if(query){
    const discovery=await mercadoLivreFetch(`/sites/MLB/domain_discovery/search?q=${encodeURIComponent(query)}&limit=8`);
    if(discovery.ok){
      const found=await discovery.json() as Array<Record<string,unknown>>;
      discovered.push(...found);
    }
  }
  const categorySeeds=[
    ...discovered.map((item)=>({id:clean(item.category_id),name:clean(item.category_name),domainId:clean(item.domain_id)})),
    ...candidates.map((item)=>({id:item.categoryId,name:"",domainId:item.domainId}))
  ].filter((item,index,all)=>item.id&&all.findIndex((other)=>other.id===item.id)===index).slice(0,8);
  const categories=await Promise.all(categorySeeds.map(async(seed)=>{
    const [detailResponse,attributesResponse]=await Promise.all([
      mercadoLivreFetch(`/categories/${encodeURIComponent(seed.id)}`),
      mercadoLivreFetch(`/categories/${encodeURIComponent(seed.id)}/attributes`)
    ]);
    const detail=detailResponse.ok?await detailResponse.json() as Record<string,unknown>:{};
    const attributes=attributesResponse.ok?await attributesResponse.json() as Array<Record<string,unknown>>:[];
    const path=Array.isArray(detail.path_from_root)
      ?detail.path_from_root.map((part)=>clean((part as Record<string,unknown>).name)).filter(Boolean).join(" › ")
      :"";
    const requiredAttributes=attributes.filter((attribute)=>{
      const tags=(attribute.tags||{}) as Record<string,unknown>;
      return tags.required===true||tags.catalog_required===true;
    }).map((attribute)=>({id:clean(attribute.id),name:clean(attribute.name)}));
    return{id:seed.id,name:clean(detail.name||seed.name),path:path||clean(detail.name||seed.name),domainId:clean(detail.domain_id||seed.domainId),requiredAttributes};
  }));
  return NextResponse.json({candidates,categories});
}
