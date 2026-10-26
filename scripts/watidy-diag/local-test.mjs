#!/usr/bin/env node
// Diagnóstico isolado do envio wascript — roda fora da intranet de produção.
// Lê o token de .env.local (gitignorado) via WATIDY_DIAG_TOKEN; nunca imprime
// o token nem a URL completa com o token no stdout ou no log.
//
// Uso:
//   node local-test.mjs --method GET|POST --phone-format raw|stripped --id "L-POST-01" [--dry-run]
//
// O contato de teste vem de WATIDY_TEST_PHONE em .env.local (gitignorado, veja
// .env.local.example), formato raw = 13 dígitos com o 9º dígito (ex: 55DDNDDDDDDDD).
// stripped = o mesmo número sem o 9º dígito — o que o código de produção hoje envia.

import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(here, '.env.local');
if (!existsSync(envPath)) {
  console.error('Faltando .env.local com WATIDY_DIAG_TOKEN=... (veja .env.local.example)');
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);
const token = env.WATIDY_DIAG_TOKEN;
if (!token) { console.error('WATIDY_DIAG_TOKEN ausente em .env.local'); process.exit(1); }

const RAW_PHONE = env.WATIDY_TEST_PHONE;
if (!RAW_PHONE) { console.error('WATIDY_TEST_PHONE ausente em .env.local (veja .env.local.example)'); process.exit(1); }
const STRIPPED_PHONE = RAW_PHONE.length === 13 ? RAW_PHONE.slice(0, 4) + RAW_PHONE.slice(5) : RAW_PHONE;

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);
const method = (args.method || 'POST').toUpperCase();
const phoneFormat = args['phone-format'] || 'stripped';
const id = args.id || `L-${method}-${Date.now()}`;
const dryRun = process.argv.includes('--dry-run');
const phone = phoneFormat === 'raw' ? RAW_PHONE : STRIPPED_PHONE;
const message = `Teste FG — local ${method} — ${id}`;

function sanitizedUrlNote(u) {
  // nunca grava a URL completa (tem o token no path); só o shape.
  return `https://api-whatsapp.wascript.com.br/api/enviar-texto/<token>${u.search}`;
}

async function run() {
  const startedAt = new Date().toISOString();
  let url, init;
  if (method === 'GET') {
    url = new URL(`https://api-whatsapp.wascript.com.br/api/enviar-texto/${encodeURIComponent(token)}`);
    url.searchParams.set('phone', phone);
    url.searchParams.set('message', message);
    init = { method: 'GET' };
  } else {
    url = new URL(`https://api-whatsapp.wascript.com.br/api/enviar-texto/${encodeURIComponent(token)}`);
    init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, message }) };
  }

  console.log(`[diag] env=local método=${method} phone-format=${phoneFormat} id=${id}`);
  console.log(`[diag] request=${sanitizedUrlNote(url)}`);
  if (dryRun) { console.log('[diag] --dry-run: nada enviado.'); return; }

  const t0 = Date.now();
  let status = null, bodyText = '', errorMsg = null, headersOut = {};
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
    status = res.status;
    for (const [k, v] of res.headers.entries()) headersOut[k] = v;
    bodyText = await res.text();
  } catch (e) {
    errorMsg = e instanceof Error ? e.message : String(e);
  }
  const durationMs = Date.now() - t0;

  const row = {
    ts_utc: startedAt,
    env: 'local',
    version: 'local-test.mjs',
    method,
    phone_format: phoneFormat,
    id,
    http_status: status,
    headers: headersOut,
    body_sanitized: bodyText.slice(0, 300),
    duration_ms: durationMs,
    error: errorMsg,
  };
  console.log('[diag] resultado:', JSON.stringify(row, null, 2));

  const logLine = `| ${row.ts_utc} | local | ${method} | ${phoneFormat} | ${id} | ${status ?? '-'} | ${durationMs}ms | ${(bodyText || errorMsg || '').replace(/\|/g, '/').slice(0, 140)} |\n`;
  appendFileSync(path.join(here, 'results.md'), logLine);
}

run();
