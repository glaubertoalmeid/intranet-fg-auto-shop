/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { syncSalesRange } from "../app/api/marketplaces/bling/cmv/route";
import { syncShopeeFees } from "../app/api/marketplaces/shopee/cmv-fees/route";
import { checkMlStatus } from "../app/api/marketplaces/mercado-livre/status-check/route";
import { processPendingPublishJobs } from "../lib/shopee-publish";
import { initPublishJobs } from "../lib/publish-jobs";
import { syncAllProducts } from "../lib/products";
import { logAudit } from "../lib/audit";

interface Env {
  WATIDY_TEST_PHONE?: string;
  WATIDY_WEBHOOK_SECRET?: string;
  WATIDY_API_TOKEN?: string;
  WATIDY_TEST_SEND_ENABLED?: string;
  WATIDY_PHONE_PATH?: string;
  WATIDY_IGNORE_BUSINESS_HOURS?: string;
  ASSETS: Fetcher;
  DB: D1Database;
  BUCKET: R2Bucket;
  OPENAI_API_KEY?: string;
  AI_ENCRYPTION_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
}

function bindGlobals(env: Env) {
  (globalThis as typeof globalThis & {__WATIDY__?: Record<string,string|undefined>}).__WATIDY__ = {WATIDY_TEST_PHONE:env.WATIDY_TEST_PHONE,WATIDY_WEBHOOK_SECRET:env.WATIDY_WEBHOOK_SECRET,WATIDY_API_TOKEN:env.WATIDY_API_TOKEN,WATIDY_TEST_SEND_ENABLED:env.WATIDY_TEST_SEND_ENABLED,WATIDY_PHONE_PATH:env.WATIDY_PHONE_PATH,WATIDY_IGNORE_BUSINESS_HOURS:env.WATIDY_IGNORE_BUSINESS_HOURS};
  (globalThis as typeof globalThis & { __FG_DB__?: D1Database }).__FG_DB__ = env.DB;
  (globalThis as typeof globalThis & { __FG_BUCKET__?: R2Bucket }).__FG_BUCKET__ = env.BUCKET;
  (globalThis as typeof globalThis & { __OPENAI_API_KEY__?: string }).__OPENAI_API_KEY__ = env.OPENAI_API_KEY;
  (globalThis as typeof globalThis & { __AI_ENCRYPTION_KEY__?: string }).__AI_ENCRYPTION_KEY__ = env.AI_ENCRYPTION_KEY;
  (globalThis as typeof globalThis & { __SUPABASE_URL__?: string }).__SUPABASE_URL__ = env.SUPABASE_URL;
  (globalThis as typeof globalThis & { __SUPABASE_SERVICE_ROLE_KEY__?: string }).__SUPABASE_SERVICE_ROLE_KEY__ = env.SUPABASE_SERVICE_ROLE_KEY;
}

// Cinco crons distintos (ver dist do wrangler.json) pra cada um cair numa invocação
// própria do Worker, com seu próprio teto de 50 sub-requisições — rodar mais de um
// desses na MESMA invocação estouraria esse limite (cada um já usa até 42 sozinho).
const SALES_SYNC_CRON = "*/15 * * * *";
const SHOPEE_FEES_CRON = "5-59/15 * * * *";
const ML_STATUS_CRON = "10-59/15 * * * *";
const PUBLISH_JOBS_CRON = "12-59/15 * * * *";
// Estoque/custo/situação do catálogo (products.stock_physical etc.) — antes só atualizava
// via webhook do Bling (estoque.*/produto.*) ou clique manual em "Sincronizar"; sem os dois,
// o Radar/Necessidade de compra ficava comprando com base em estoque de dias atrás sem
// nenhum aviso. Duas vezes por hora é o bastante pra decisão de compra, sem pesar na API do Bling.
const PRODUCTS_SYNC_CRON = "17,47 * * * *";

async function runScheduledSync(cron: string) {
  const today = new Date().toISOString().slice(0, 10);
  try {
    if (cron === SALES_SYNC_CRON) {
      // Janela curta: o próprio syncSalesRange pula quem já está sincronizado, então uma
      // janela de poucos dias é suficiente pra pegar pedidos novos a cada 15 minutos.
      const from = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
      const result = await syncSalesRange(from, today);
      if (result.newSales > 0 || result.failed.length)
        await logAudit({ user: "Automático (cron)", action: "cmv.sync", target: `${from}..${today}`, detail: `${result.newSales} venda(s) nova(s), ${result.items} item(ns)${result.failed.length ? ` · falhou: ${result.failed.map(f => f.saleId).join(", ")}` : ""}` });
    } else if (cron === SHOPEE_FEES_CRON) {
      // Janela mais larga: a Shopee só fecha a comissão/repasse dias depois da venda (após
      // a entrega e a janela de devolução), então isso reprocessa pendentes até resolver.
      // Também é aqui que cancelamento/devolução na Shopee é detectado (o Bling não reflete).
      const from = new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10);
      const result = await syncShopeeFees(from, today);
      if (result.updated > 0 || result.failed.length)
        await logAudit({ user: "Automático (cron)", action: "cmv.shopee_fees_sync", target: `${from}..${today}`, detail: `${result.updated} pedido(s) atualizados${result.cancelled ? ` · ${result.cancelled} cancelado(s) na Shopee` : ""}${result.failed.length ? ` · falhou: ${result.failed.map(f => f.orderSn).join(", ")}` : ""}` });
    } else if (cron === ML_STATUS_CRON) {
      // Confere status real no Mercado Livre (o Bling também não reflete cancelamento
      // feito do lado do ML) — só roda uma vez por pedido (status_checked).
      const from = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const result = await checkMlStatus(from, today);
      if (result.checked > 0 || result.failed.length)
        await logAudit({ user: "Automático (cron)", action: "cmv.ml_status_check", target: `${from}..${today}`, detail: `${result.checked} pedido(s) verificados${result.cancelled ? ` · ${result.cancelled} cancelado(s) no Mercado Livre` : ""}${result.failed.length ? ` · falhou: ${result.failed.map(f => f.orderId).join(", ")}` : ""}` });
    } else if (cron === PUBLISH_JOBS_CRON) {
      // Fila persistente do agente de publicação (Shopee) — continua processando mesmo
      // que ninguém esteja com a tela de Catálogo de Anúncios aberta.
      await initPublishJobs();
      const processed = await processPendingPublishJobs(3);
      if (processed > 0) await logAudit({ user: "Automático (cron)", action: "agent.publish_jobs_tick", target: "shopee", detail: `${processed} job(s) processado(s)` });
    } else if (cron === PRODUCTS_SYNC_CRON) {
      const result = await syncAllProducts();
      await logAudit({ user: "Automático (cron)", action: "products.sync", detail: `${result.imported} produto(s)${result.truncated ? " · truncado (catálogo maior que o teto de sub-requisições de uma execução)" : ""}` });
    }
  } catch (error) {
    await logAudit({ user: "Automático (cron)", action: "cmv.sync_error", target: cron, detail: error instanceof Error ? error.message : "erro desconhecido" });
  }
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    bindGlobals(env);
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    bindGlobals(env);
    ctx.waitUntil(runScheduledSync(event.cron));
  },
};

export default worker;
