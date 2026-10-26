// Worker de diagnóstico isolado — testa a chamada enviar-texto do wascript a partir
// da rede de saída da Cloudflare, sem nenhuma dependência da intranet de produção
// (sem D1, sem fila, sem rotas públicas de verdade). Existe só para comparar contra
// o teste local equivalente (ver ../local-test.mjs) e deve ser descartado ao final
// do diagnóstico.
//
// Protegido por um bearer token próprio (DIAG_ADMIN_TOKEN); o telefone é sempre o
// contato de teste autorizado (fixo no env, nunca vindo da requisição) e a mensagem
// é sempre um template fixo com um identificador curto — nunca conteúdo arbitrário.

const RAW_PHONE_ENV = 'WATIDY_TEST_PHONE'; // secret do Worker; formato 13 dígitos com o 9º

function stripNinthDigit(p) {
  return p.length === 13 ? p.slice(0, 4) + p.slice(5) : p;
}

function sanitizeBody(text) {
  return text.slice(0, 300);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/send' && url.pathname !== '/listar-etiquetas') {
      return Response.json({ error: 'only /send or /listar-etiquetas are implemented' }, { status: 404 });
    }
    const auth = request.headers.get('authorization') || '';
    if (auth !== `Bearer ${env.DIAG_ADMIN_TOKEN}`) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (!env.WATIDY_API_TOKEN || !env[RAW_PHONE_ENV]) {
      return Response.json({ error: 'worker not configured: faltam secrets' }, { status: 500 });
    }

    if (url.pathname === '/listar-etiquetas') {
      // Chamada de leitura, não conta no orçamento de envios — só pra comparar cabeçalhos/
      // comportamento de rede entre local e Worker num endpoint que não dispara WhatsApp.
      const t0 = Date.now();
      let status = null, bodyText = '', errorMsg = null, headersOut = {};
      try {
        const res = await fetch(`https://api-whatsapp.wascript.com.br/api/listar-etiquetas/${encodeURIComponent(env.WATIDY_API_TOKEN)}`, { signal: AbortSignal.timeout(15000) });
        status = res.status;
        for (const [k, v] of res.headers.entries()) headersOut[k] = v;
        bodyText = await res.text();
      } catch (e) {
        errorMsg = e instanceof Error ? e.message : String(e);
      }
      return Response.json({
        ts_utc: new Date().toISOString(),
        env: 'worker-diag',
        endpoint: 'listar-etiquetas',
        http_status: status,
        headers: headersOut,
        body_sanitized: sanitizeBody(bodyText),
        duration_ms: Date.now() - t0,
        error: errorMsg,
      });
    }

    const method = (url.searchParams.get('method') || 'POST').toUpperCase();
    const phoneFormat = url.searchParams.get('phone_format') || 'stripped';
    const id = (url.searchParams.get('id') || `W-${Date.now()}`).slice(0, 60);
    if (!/^[A-Za-z0-9._-]{1,60}$/.test(id)) {
      return Response.json({ error: 'id inválido (use apenas letras/números/._-)' }, { status: 400 });
    }
    if (method !== 'GET' && method !== 'POST') {
      return Response.json({ error: 'method deve ser GET ou POST' }, { status: 400 });
    }
    if (phoneFormat !== 'raw' && phoneFormat !== 'stripped') {
      return Response.json({ error: 'phone_format deve ser raw ou stripped' }, { status: 400 });
    }

    const rawPhone = env[RAW_PHONE_ENV];
    const phone = phoneFormat === 'raw' ? rawPhone : stripNinthDigit(rawPhone);
    const message = `Teste FG — Worker ${method} — ${id}`;

    const base = `https://api-whatsapp.wascript.com.br/api/enviar-texto/${encodeURIComponent(env.WATIDY_API_TOKEN)}`;
    let fetchUrl, fetchInit;
    if (method === 'GET') {
      const u = new URL(base);
      u.searchParams.set('phone', phone);
      u.searchParams.set('message', message);
      fetchUrl = u;
      fetchInit = { method: 'GET' };
    } else {
      fetchUrl = new URL(base);
      fetchInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, message }),
      };
    }

    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    let status = null, bodyText = '', errorMsg = null, redirected = false, headersOut = {};
    try {
      const res = await fetch(fetchUrl, { ...fetchInit, signal: AbortSignal.timeout(15000), redirect: 'manual' });
      status = res.status;
      redirected = status >= 300 && status < 400;
      for (const [k, v] of res.headers.entries()) headersOut[k] = v;
      bodyText = await res.text();
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
    }
    const durationMs = Date.now() - t0;

    return Response.json({
      ts_utc: startedAt,
      env: 'worker-diag',
      worker_version: env.CF_VERSION_METADATA ? env.CF_VERSION_METADATA.id : 'unknown',
      method,
      phone_format: phoneFormat,
      id,
      http_status: status,
      redirected,
      headers: headersOut,
      body_sanitized: sanitizeBody(bodyText),
      duration_ms: durationMs,
      error: errorMsg,
    });
  },
};
