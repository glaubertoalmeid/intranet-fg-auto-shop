import {NextResponse} from "next/server";
import {cookies} from "next/headers";
import {requirePermission} from "../../../../../lib/auth";
import {getNuvemshopConfig,initNuvemshop,nuvemshopCallbackUrl,randomUrlSafe} from "../../../../../lib/nuvemshop";

/** A NuvemShop não documenta de forma confiável o repasse do parâmetro "state" na volta do
 *  OAuth (diferente do Bling/Mercado Livre), então quem iniciou a conexão é identificado por
 *  um cookie httpOnly de curta duração em vez de uma linha em marketplace_oauth_states — assim
 *  o fluxo não depende de um comportamento da NuvemShop que não dá pra confirmar sem testar. */
export async function GET(){
 const user=await requirePermission("anuncios"),config=await getNuvemshopConfig();
 if(!config.clientId||!config.clientSecret)return NextResponse.redirect(new URL("/?nuvemshop=not-configured",nuvemshopCallbackUrl));
 await initNuvemshop();
 const state=randomUrlSafe(24);
 (await cookies()).set("nuvemshop_oauth",JSON.stringify({state,user:user.name}),{httpOnly:true,secure:true,sameSite:"lax",maxAge:600,path:"/"});
 const url=new URL(`https://www.nuvemshop.com.br/apps/${config.clientId}/authorize`);
 url.searchParams.set("state",state);
 return NextResponse.redirect(url);
}
