import { requirePermission } from "../../../lib/auth";
// @ts-ignore — Vite loads the attached HTML as a text asset.
import precificadorHtml from "../../../lib/precificador.html?raw";

export async function GET(){
  await requirePermission("preco_ecommerce");
  return new Response(precificadorHtml,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"private, no-store","x-frame-options":"SAMEORIGIN"}});
}
