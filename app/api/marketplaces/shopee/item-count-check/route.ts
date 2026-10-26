import {NextResponse} from "next/server";
import {requirePermission} from "../../../../../lib/auth";
import {shopeeRequest} from "../../../../../lib/shopee";

export async function GET(){
 try{
  await requirePermission("anuncios");
  const result=await shopeeRequest("/api/v2/product/get_item_list",{query:{offset:0,page_size:100,item_status:"NORMAL"}});
  return NextResponse.json(result.response);
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"erro"},{status:500})}
}
