import {NextResponse} from "next/server";
import {getRuntimeDb} from "../../../../../db/runtime";
import {requirePermission} from "../../../../../lib/auth";
import {getMercadoLivreConfig,initMercadoLivre,mercadoLivreCallbackUrl,pkceChallenge,randomUrlSafe} from "../../../../../lib/mercado-livre";

export async function GET(){
  const user=await requirePermission("anuncios");
  const config=await getMercadoLivreConfig();
  if(!config.clientId||!config.clientSecret)return NextResponse.redirect(new URL("/?ml=not-configured",mercadoLivreCallbackUrl));
  await initMercadoLivre();
  const state=randomUrlSafe(24),verifier=randomUrlSafe(48),challenge=await pkceChallenge(verifier);
  const expires=new Date(Date.now()+10*60*1000).toISOString();
  await getRuntimeDb().prepare("DELETE FROM marketplace_oauth_states WHERE expires_at<CURRENT_TIMESTAMP").run();
  await getRuntimeDb().prepare("INSERT INTO marketplace_oauth_states(state,provider,verifier,created_by,expires_at) VALUES(?,'mercado_livre',?,?,?)")
    .bind(state,verifier,user.name,expires).run();
  const url=new URL("https://auth.mercadolivre.com.br/authorization");
  url.searchParams.set("response_type","code");
  url.searchParams.set("client_id",config.clientId);
  url.searchParams.set("redirect_uri",mercadoLivreCallbackUrl);
  url.searchParams.set("state",state);
  url.searchParams.set("code_challenge",challenge);
  url.searchParams.set("code_challenge_method","S256");
  return NextResponse.redirect(url);
}
