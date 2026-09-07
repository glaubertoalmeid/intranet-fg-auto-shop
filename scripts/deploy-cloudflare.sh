#!/usr/bin/env bash
# Deploy manual para Cloudflare Workers (fora do fluxo Codex/Sites).
# Requer CLOUDFLARE_API_TOKEN no ambiente (Account > Workers Scripts > Edit,
# Account > D1 > Edit, Account > Workers R2 Storage > Edit).
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"
cd "${project_root}"

: "${CLOUDFLARE_API_TOKEN:?defina CLOUDFLARE_API_TOKEN antes de rodar este script}"

D1_DATABASE_ID="${D1_DATABASE_ID:-801f8ac4-ba69-4082-a7b5-9217ec03fbb7}"
D1_DATABASE_NAME="${D1_DATABASE_NAME:-intranet-fg-auto-shop-db}"
R2_BUCKET_NAME="${R2_BUCKET_NAME:-}" # vazio até o R2 ser habilitado na conta

npm run build

# vinext build gera dist/server/wrangler.json com bindings placeholder
# (site-creator-d1/r2, vindos de .openai/hosting.json) e às vezes duplica
# compatibility_flags — este patch corrige os dois antes do deploy real.
node --input-type=module - "${D1_DATABASE_NAME}" "${D1_DATABASE_ID}" "${R2_BUCKET_NAME}" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const [databaseName, databaseId, bucketName] = process.argv.slice(2);
const path = "dist/server/wrangler.json";
const cfg = JSON.parse(readFileSync(path, "utf8"));
cfg.d1_databases = [{ binding: "DB", database_name: databaseName, database_id: databaseId }];
cfg.r2_buckets = bucketName ? [{ binding: "BUCKET", bucket_name: bucketName }] : [];
cfg.compatibility_flags = [...new Set(cfg.compatibility_flags)];
writeFileSync(path, JSON.stringify(cfg, null, 2));
console.log(`[deploy] D1=${databaseName} R2=${bucketName || "(nenhum ainda)"}`);
NODE

npx wrangler deploy --config dist/server/wrangler.json
