import {NextResponse} from "next/server";
import {getRuntimeDb} from "../../../../db/runtime";
import {requirePermission} from "../../../../lib/auth";
import {initPricing} from "../../pricing/route";

export async function GET(){
 await requirePermission("anuncios");
 await initPricing();
 const row=await getRuntimeDb().prepare("SELECT data FROM pricing_settings WHERE id=1").first<{data:string}>();
 return NextResponse.json(row?JSON.parse(row.data):null);
}
