# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Intranet FG Auto Shop** — an internal full-stack app for an auto-parts/car-care distributor (FG Auto). Modules: pricing/listings for marketplaces, product catalog & stock (synced from Bling ERP), purchasing/reorder radar, CMV (cost-of-goods) report, a commercial dashboard, CNPJ lookup, tasks/calendar/materials, users & permissions.

Stack: **Next.js 16 (App Router) + React 19**, running on **vinext** (adapts Next.js to Cloudflare Workers) via **Vite 8** + `@cloudflare/vite-plugin`. Originally scaffolded by OpenAI's "Sites" builder tool — some scaffolding (see "Two hosting targets" below) still reflects that origin.

## Commands

```bash
npm install              # do NOT use `npm run install:ci` locally — that script requires
                          # Linux flock/GNU timeout (see "Sites-only scripts" below)
npm run build             # vinext build; also validates the built artifact
npm run lint               # eslint (next/core-web-vitals + next/typescript)
npm test                   # build + a single smoke test (tests/rendered-html.test.mjs) —
                            # only checks that the Sites dev-preview HTML marker renders;
                            # not a general test suite
npm run db:generate        # drizzle-kit generate (db/schema.ts changes) — schema.ts only
                            # covers a few legacy tables; most tables aren't modeled there
                            # (see "Two databases" below)
```

**Dev server — do not run `npm run dev` directly on Windows.** npm always executes `package.json` scripts via `cmd.exe` on Windows, even from Git Bash, so the script's Unix env-var syntax (`WRANGLER_LOG_PATH=... vite`) fails with "not recognized as an internal command". Instead run the underlying binary directly:
```bash
WRANGLER_LOG_PATH=.wrangler/wrangler.log npx vite
```
Same issue applies to any other script using `VAR=val cmd` syntax — invoke the binary directly instead of `npm run`.

**Deploying:**
- **Cloudflare Workers** (the actively-used target): `CLOUDFLARE_API_TOKEN=... bash scripts/deploy-cloudflare.sh`. This script exists because `vinext build` emits `dist/server/wrangler.json` with placeholder D1/R2 bindings (`site-creator-d1`/`site-creator-r2`, sourced from `.openai/hosting.json` — meant for the Sites platform to fill in) and, in this environment, a duplicated `compatibility_flags` entry; the script patches in the real D1 database id/name and de-dupes the flags before calling `wrangler deploy`. Live URL: `https://intranet-fg-auto-shop.glaubertoalmeid.workers.dev`.
- **Codex/Sites** (original hosting): a separate, user-driven publish flow outside this repo/session; `npm run build` is what Sites' own remote builder runs against a pushed commit. `scripts/install-ci.sh`, `scripts/build-verified.sh`, `scripts/sites-env.sh`, `scripts/validate-artifact.sh` are Sites-CI-only (need Linux `flock`/GNU `timeout`) — don't add local dev workflow dependencies on them beyond `sites-env.sh`'s env-setup pattern.

## Architecture

### Two hosting targets, one codebase
The app can run under OpenAI Sites (original) or as a plain Cloudflare Worker (`scripts/deploy-cloudflare.sh`). `worker/index.ts` is the Worker entry point (`Env` interface lists every binding/secret the app reads); `vite.config.ts`'s `localBindingConfig` simulates D1/R2 bindings for local dev only. `lib/site-url.ts` (`SITE_URL`) is the single source of truth for the public origin, consumed by every OAuth callback/webhook URL (Bling, Mercado Livre, Shopee) — if the deploy target's domain changes, update this one file, **and** update the Redirect URI registered in each marketplace's developer-app settings to match (they must match exactly), or those OAuth flows will land the user on the wrong domain.

### Two databases, mid-migration
- **Cloudflare D1** (SQLite, via `db/runtime.ts`'s `getRuntimeDb()`) — the original store. No central schema file governs it: nearly every route/lib module bootstraps its own tables inline with `CREATE TABLE IF NOT EXISTS` on first use (see `lib/auth.ts`'s `initAuth()` for the pattern). Still backs: auth (`users`/`sessions`), `tasks`, `events`, `materials`, `listings`, pricing, `audit`, and marketplace OAuth config/tokens (`marketplace_settings`, `marketplace_oauth_states`) for Bling/Mercado Livre/Shopee.
- **Supabase** (Postgres, via `lib/supabase.ts`'s `getSupabase()`, service-role client — bypasses RLS, same trust level the D1 binding already had) — the migration target. Currently holds `cmv_sales` (Bling sales/CMV data), `products`, `suppliers`, `purchase_orders`, `purchase_order_items`. `db/schema.ts` (Drizzle) still declares `products`/`suppliers`/`purchase_orders`/`purchase_order_items` as SQLite tables — that's now **stale/unused**; those tables live in Supabase, not D1. When creating a new Supabase table, **always add an explicit `GRANT` to `service_role`** alongside any RLS policy — a policy without a grant still fails with `permission denied for table`. When using `.upsert(rows, {onConflict: "col"})`, the target column needs a *non-partial* unique constraint — a partial unique index (`WHERE ...`) doesn't satisfy PostgREST's `ON CONFLICT` matching.

### Cloudflare Workers subrequest budget
Workers cap subrequests per invocation (50 on the free plan). D1 access via binding doesn't count; every `fetch()` — to the Bling API or to Supabase — does. Any sync/bulk loop (see `app/api/marketplaces/bling/cmv/route.ts`'s `Budget` class) must check-and-increment a budget *before every single network call*, not just once per outer work-unit — a work-unit with many sub-calls (e.g. one sale with many line items each needing a cost lookup) can blow the cap on its own. Batch writes into one request instead of one-per-row wherever possible.

### Auth & permissions
Cookie session (`fg_session`) hashed into D1 `sessions`; `lib/auth.ts`'s `requirePermission(permission)` throws a `Response(401/403)` if unauthenticated/unauthorized (routes catch this generically, so denials currently surface as a generic 500 rather than the real status — a known pre-existing quirk, not something to "fix" opportunistically). `role: "master"` bypasses all permission checks. `PERMISSIONS` in `lib/auth.ts` is the full list of gate-able module keys.

### Marketplace integrations (Bling / Mercado Livre / Shopee)
Each has its own OAuth module (`lib/bling.ts`, `lib/mercado-livre.ts`, `lib/shopee.ts`) storing encrypted tokens in D1 `marketplace_settings`, encrypted via `lib/ai-secret.ts` (AES-GCM, keyed by the `AI_ENCRYPTION_KEY` secret). `lib/bling.ts`'s `blingApi`/`blingFetch` is the single Bling REST client for the whole app — always import it rather than hand-rolling another fetch+auth wrapper. Bling quirks worth knowing before writing new integration code: `loja` (store) and `vendedor` (seller) on an order only ever carry `{id}` — resolve names via `GET /canais-venda` / `GET /vendedores` (see `app/api/marketplaces/bling/cmv/route.ts`); `marca`/`categoria` on a product are sometimes a bare string and sometimes `{descricao}` — normalize with a helper that never stringifies the raw object (a naive `String(obj)` silently writes the literal text `"[object Object]"` into the database); there's no partial product update — `PUT /produtos/{id}` expects the full record back (see `app/api/admin/update-bling-product-cost/route.ts`'s read-modify-write pattern) with `nome`/`tipo`/`situacao`/`formato`/`variacoes` required.

### `app/api/admin/*` — one-time / master-only maintenance endpoints
A recurring pattern for operations that need to run once against production and can't reasonably go through a UI (data migrations, bulk Bling corrections). Gated by `role === "master"`, invoked by pasting a `fetch(...)` snippet into the browser console while logged in — there is no automated/service-token path to these by design (self-issuing a bypass credential for a master-gated write action was deliberately reverted once already; don't reintroduce one).

### Frontend
Single-page app shell in `app/Intranet.tsx` (sidebar nav + section switch + global search); each module is a top-level client component (`ProductsView.tsx`, `PurchasingView.tsx`, `ComercialView.tsx`, `CmvReportView.tsx`, etc.) that owns its own data fetching — no shared state/store library. Styling is one large hand-written `app/globals.css` (no CSS modules/Tailwind components in practice, despite Tailwind being in the deps) using a fixed set of utility-ish class names (`.panel`, `.cmv-columns`, `.cmv-filters`, `.cmv-kpis` etc.) reused across modules — prefer reusing an existing class pattern over inventing a new one for a similar layout need.
