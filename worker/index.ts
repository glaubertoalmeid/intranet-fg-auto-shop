/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
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

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    (globalThis as typeof globalThis & { __FG_DB__?: D1Database }).__FG_DB__ = env.DB;
    (globalThis as typeof globalThis & { __FG_BUCKET__?: R2Bucket }).__FG_BUCKET__ = env.BUCKET;
    (globalThis as typeof globalThis & { __OPENAI_API_KEY__?: string }).__OPENAI_API_KEY__ = env.OPENAI_API_KEY;
    (globalThis as typeof globalThis & { __AI_ENCRYPTION_KEY__?: string }).__AI_ENCRYPTION_KEY__ = env.AI_ENCRYPTION_KEY;
    (globalThis as typeof globalThis & { __SUPABASE_URL__?: string }).__SUPABASE_URL__ = env.SUPABASE_URL;
    (globalThis as typeof globalThis & { __SUPABASE_SERVICE_ROLE_KEY__?: string }).__SUPABASE_SERVICE_ROLE_KEY__ = env.SUPABASE_SERVICE_ROLE_KEY;
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
};

export default worker;
