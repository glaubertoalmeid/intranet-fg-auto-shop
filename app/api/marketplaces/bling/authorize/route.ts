import {NextResponse} from "next/server";
import {getRuntimeDb} from "../../../../../db/runtime";
import {requirePermission} from "../../../../../lib/auth";
import {blingCallbackUrl,getBlingConfig,initBling,randomUrlSafe} from "../../../../../lib/bling";

export async function GET(){
 const user=await requirePermission("anuncios"),config=await getBlingConfig();
 if(!config.clientId||!config.clientSecret)return NextResponse.redirect(new URL("/?bling=not-configured",blingCallbackUrl));
 await initBling();
 const state=randomUrlSafe(24),expires=new Date(Date.now()+10*60*1000).toISOString();
 await getRuntimeDb().prepare("DELETE FROM marketplace_oauth_states WHERE expires_at<CURRENT_TIMESTAMP").run();
 await getRuntimeDb().prepare("INSERT INTO marketplace_oauth_states(state,provider,verifier,created_by,expires_at) VALUES(?,'bling','',?,?)").bind(state,user.name,expires).run();
 const url=new URL("https://www.bling.com.br/Api/v3/oauth/authorize");
 url.searchParams.set("response_type","code");url.searchParams.set("client_id",config.clientId);url.searchParams.set("state",state);
 return NextResponse.redirect(url);
}
