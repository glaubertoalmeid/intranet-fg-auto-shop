# Resultados — diagnóstico wascript (FG Auto Shop)

Nunca contém token nem URL completa com credencial. Horários em UTC.
Contato autorizado: ver WATIDY_TEST_PHONE em .env.local (raw, 13 dígitos) / mesmo número sem o 9º dígito (stripped).
Worker de diagnóstico: `fg-watidy-diag.glaubertoalmeid.workers.dev` (isolado, sem D1/fila).

## Testes de envio (orçamento: até 8)

| # | ts_utc | env | método | phone_format | id | http_status | duração | resultado |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-10-16T02:19:xx (pré-protocolo) | local | GET | stripped | (ad-hoc) | 200 | - | sucesso |
| 2 | 2026-10-16T02:44:18.116Z | local | POST | stripped | L-POST-01 | 200 | 1314ms | sucesso |
| 3 | 2026-10-16T02:44:30.859Z | local | POST | raw | L-POST-02 | 200 | 860ms | sucesso |
| 4 | 2026-10-16T02:51:10.545Z | worker-diag | POST | stripped | W-POST-01 | 200 | 741ms | sucesso |
| 5 | 2026-10-16T02:51:22.969Z | worker-diag | POST | stripped | W-POST-02 | 200 | 508ms | sucesso |
| 6 | 2026-10-16T02:51:33.532Z | worker-diag | GET | stripped | W-GET-01 | 200 | 771ms | sucesso |
| 7 | 2026-10-16T02:52:38.567Z | worker-diag | POST | raw | W-POST-03 | 200 | 524ms | sucesso |
| 8 | 2026-10-16T02:55:39.676Z | **production** (token ainda antigo) | GET | stripped | job da fila /watidy | 501 | — | falha — `"Página do Whatsapp não aberta ou API desconectada"` |
| 9 (fora do orçamento, autorizado explicitamente) | 2026-10-16T03:0x UTC | **production** (token recolado) | GET | stripped | job da fila /watidy | 200 | — | **sucesso — `{"sent":true}`, entrega confirmada pelo usuário no WhatsApp** |

## Teste de leitura (não conta no orçamento)

| ts_utc | env | endpoint | http_status | nota |
|---|---|---|---|---|
| 2026-10-16T02:47:28Z | local | listar-etiquetas | 200 | server:cloudflare, cf-ray:...-GRU |
| 2026-10-16T02:50:51.819Z | worker-diag | listar-etiquetas | 200 | mesmo etag do teste local — sem diferença |

## Achados até aqui

1. **wascript está atrás da própria Cloudflare** (`server: cloudflare`, `cf-ray` presente em toda resposta, inclusive das chamadas locais).
2. **Formato de telefone (com/sem o 9º dígito) não fez diferença em nenhum teste** — sucesso nos dois formatos, local e Worker. A conclusão anterior de que isso era "a causa" do problema de entrega não se sustentou neste protocolo controlado.
3. **`listar-etiquetas` funciona igual em local e Worker** — não há bloqueio geral de IP/rede contra o datacenter da Cloudflare.
4. **4 de 4 chamadas de `enviar-texto` pelo Worker de diagnóstico isolado (sem D1/fila/crons) tiveram sucesso** — não reproduziu a falha que a produção vinha tendo repetidamente.
5. Produção (intranet real) vinha falhando com `501 "Página do Whatsapp não aberta ou API desconectada"` repetidamente ao longo do dia (8 falhas registradas), a última antes deste protocolo às 02:20 UTC, mesmo com WhatsApp Web confirmado aberto pelo usuário no momento.
6. **CAUSA CONFIRMADA:** o token `WATIDY_API_TOKEN` configurado na produção estava desatualizado em relação ao token ativo no painel "Configurar API" do wascript. Recolar o token atual na produção resolveu — envio com sucesso (`{"sent":true}`) e entrega confirmada pelo usuário no WhatsApp na primeira tentativa após a correção.

## Webhook (fora do orçamento de envio)

- `POST /api/watidy/webhook?key=...` com payload sintético `{"data":{"phone":"...","message":"..."}}` → `200 {"ok":true,"classification":"ambiguous"}`.
- Confirmado: autenticação do endpoint funciona; classificação é sempre "ambiguous" porque `WATIDY_PHONE_PATH` nunca foi configurado (nunca recebemos um evento real do wascript pra mapear o formato).
- A documentação pública do wascript (Swagger) não lista nenhum endpoint/formato de webhook — não há como inferir o formato sem um evento real ou suporte deles.
