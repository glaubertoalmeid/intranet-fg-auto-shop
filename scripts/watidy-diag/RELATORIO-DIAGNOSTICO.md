# Diagnóstico controlado — wascript `enviar-texto` (Watidy)

Data: 2026-10-16. Protocolo seguido conforme solicitado: investigação isolada, sem
tocar clientes reais, sem crons/disparo em massa, token só em secrets de servidor,
nada de token/URL completa nos logs, até 8 chamadas de envio reais.

## 1. O que foi executado e o que ficou bloqueado

Executado:
- Revisão do código publicado (`lib/watidy/pilot.ts`, `worker/index.ts`) e do
  `dist/server/wrangler.json` gerado — confirmado método, host, parâmetros,
  codificação, ausência de ambiente de preview divergente, versão publicada
  batendo com o código.
- Script local de diagnóstico (`scripts/watidy-diag/local-test.mjs`), token lido
  de `.env.local` (gitignorado), nunca logado.
- Worker de diagnóstico isolado e separado da produção
  (`fg-watidy-diag.glaubertoalmeid.workers.dev`, `scripts/watidy-diag/worker/`),
  sem D1/fila/crons, protegido por bearer token próprio, telefone fixo no servidor,
  mensagem sempre de um template com identificador — nenhum endpoint arbitrário.
- 8 chamadas de envio controladas (local + Worker de diagnóstico + produção real),
  todas pro contato autorizado, todas com identificador único.
- 2 chamadas de leitura (`listar-etiquetas`) fora do orçamento, pra comparar
  cabeçalhos/comportamento de rede sem gerar mensagem.
- Teste isolado do endpoint de webhook próprio com payload sintético.
- Checagem da doc pública do wascript (Swagger) — não existe seção de webhook
  documentada.

Ficou bloqueado / não executado:
- Checagem de sessões duplicadas no painel do wascript — depende do usuário olhar
  lá, ainda não confirmado.
- Teste real de webhook recebendo um evento genuíno do wascript (não existe
  ambiente de staging deles pra isso, e não sabemos se o webhook está
  efetivamente registrado no painel deles apontando pro nosso endpoint).
- Reteste de produção após re-colar o token (ver hipótese principal abaixo) —
  consumiria 1 chamada além do orçamento combinado; não executado sem autorização
  explícita adicional.

## 2. Tabela de testes e resultados

Ver `scripts/watidy-diag/results.md` para a tabela completa com timestamps,
status HTTP, duração e corpo sanitizado. Resumo:

| Ambiente | Tentativas | Sucesso | Falha |
|---|---|---|---|
| Local (curl/node, fora de qualquer Cloudflare) | 3 | 3 | 0 |
| Worker de diagnóstico isolado (Cloudflare, sem D1/fila) | 4 | 4 | 0 |
| Produção (Cloudflare, Worker real da intranet) | 1 (deste protocolo) | 0 | 1 (`501`, mesmo erro de sempre) |

Produção também falhou outras 7 vezes ao longo do dia 2026-10-15/16, fora deste
protocolo formal de 8 — sempre o mesmo corpo de erro.

## 3. Fatos comprovados, hipóteses e causa ainda desconhecida

**Fatos comprovados:**
- O formato do telefone (com ou sem o 9º dígito) **não influencia** o resultado —
  sucesso nos dois formatos, em todos os ambientes testados. A correção aplicada
  em sessão anterior (remover o 9º dígito) não é, isoladamente, a causa da
  entrega funcionar ou não.
- `listar-etiquetas` funciona igualmente bem em local e no Worker de diagnóstico —
  não há bloqueio geral de rede/IP contra tráfego saindo de Cloudflare Workers.
- A própria API do wascript roda atrás da Cloudflare deles (cabeçalho `server:
  cloudflare` em toda resposta).
- O Worker de diagnóstico isolado, fazendo exatamente a mesma chamada que a
  produção faz (mesmo host, mesmo método GET, mesmo formato de telefone, mesmo
  endpoint), teve sucesso 4 de 4 vezes.
- A produção, fazendo a chamada equivalente minutos depois, falhou com o mesmo
  erro de sempre.

**Hipótese principal (não comprovada, mas a mais barata de testar):** o token da
API configurado na produção pode estar **desatualizado** em relação ao token
atualmente ativo no painel "Configurar API" do wascript — por exemplo, se o token
foi regenerado em algum momento depois da última vez que a produção foi
configurada. Um token velho/inválido pode estar gerando a mesma mensagem genérica
de erro ("Página do Whatsapp não aberta ou API desconectada") que a desconexão
real, já que não há como diferenciar as duas coisas pela mensagem.
Teste recomendado: recolar o token atual da produção (`wrangler secret put
WATIDY_API_TOKEN --name intranet-fg-auto-shop`) e testar de novo.

**Hipóteses descartadas por este protocolo:**
- Bloqueio de IP/ASN contra datacenters Cloudflare em geral (descartado por
  `listar-etiquetas` funcionar igual nos dois ambientes).
- Formato do telefone (com/sem 9º dígito) como causa da falha de entrega
  (descartado — os dois formatos funcionaram sempre que o restante da chamada
  estava correto).
- GET vs. POST como diferenciador (ambos funcionaram sempre que o restante da
  chamada estava correto, tanto local quanto no Worker de diagnóstico).

**Ainda desconhecido:**
- Por que a produção especificamente falha enquanto um Worker Cloudflare quase
  idêntico (mesma conta, mesmo código de chamada) funciona. As hipóteses restantes,
  em ordem de probabilidade:
  1. Token desatualizado na produção (ver acima — testável imediatamente).
  2. Sessão duplicada ou token associado à conexão errada no lado do wascript
     (não descartável sem o usuário checar o painel deles).
  3. Instabilidade genuína e intermitente do lado do wascript, que por
     coincidência não caiu durante a janela de ~2 minutos em que os testes do
     Worker de diagnóstico rodaram.

## 4. Correção recomendada

**Agora:** recolar `WATIDY_API_TOKEN` na produção com o valor atual do painel
"Configurar API" do wascript (mesmo processo já usado no Worker de diagnóstico),
e testar mais uma vez pelo painel `/watidy`. Essa é a correção de menor custo e
maior probabilidade de resolver, dado que é a única variável que diferencia
"Worker de diagnóstico (sucesso)" de "produção (falha)" que ainda não foi
igualada entre os dois ambientes.

**Se isso não resolver:** abrir chamado de suporte com o wascript usando a tabela
da seção 2 como evidência (mesma chamada, Worker Cloudflare, sucesso num token
recém-colado e falha no outro) — essa é uma evidência mais específica e acionável
do que o relatório genérico enviado anteriormente.

## 5. Alternativas (não testadas nesta etapa, só listadas)

| Alternativa | Custo | Manutenção | Limitação |
|---|---|---|---|
| A. Suporte wascript corrige/orienta | Zero | Nenhuma | Depende do tempo de resposta deles |
| B. Pequeno serviço intermediário fora da Cloudflare (ex. Render/Fly, testado antes de adotar) | Baixo (plano gratuito provável) | Mais uma peça de infra pra manter | Só compensa se o problema for mesmo específico de IP/rede — este protocolo não confirmou isso |
| C. Agente rodando no computador da loja | Zero (usa hardware já existente) | Depende da máquina ligada; recuperação manual de falhas | Ponto único de falha; sem portas públicas, precisa de polling de saída |
| D. Trocar só o provedor de conexão WhatsApp (Z-API etc.) | Variável (pode ter plano pago) | Reintegração do cliente de API | Preserva banco/fila/regras/tela — só troca o `lib/watidy` client |

Nenhuma dessas foi implementada ou testada nesta etapa — a prioridade era
esgotar a investigação direta antes de migrar, conforme pedido.

## 6. Relatório técnico sanitizado para o suporte

Ver `OS-da-Empresa/relatorio-bug-wascript.md` (enviado anteriormente). Esse
relatório já está desatualizado em relação às hipóteses sobre formato de
telefone/GET-vs-POST — se for enviado agora, atualizar com a tabela da seção 2
deste documento antes, priorizando a comparação "Worker de diagnóstico sucesso vs.
produção falha com os dois rodando na mesma conta Cloudflare".

## 7. Código do diagnóstico e instruções para incorporar

- `scripts/watidy-diag/local-test.mjs` — script local, não faz parte do build da
  intranet, não precisa ser incorporado.
- `scripts/watidy-diag/worker/` — Worker separado (`fg-watidy-diag`), independente
  do Worker de produção. **Recomendação:** manter rodando só enquanto o
  diagnóstico não fechar; depois disso, rodar `npx wrangler delete --name
  fg-watidy-diag --config scripts/watidy-diag/worker/wrangler.toml` pra não deixar
  uma superfície extra exposta indefinidamente (ele exige bearer token próprio,
  mas é uma coisa a menos pra manter).
- Nenhuma mudança de código de produção foi necessária para este diagnóstico,
  além da flag `WATIDY_IGNORE_BUSINESS_HOURS` (já commitada antes deste
  protocolo, por pedido separado, pra permitir teste fora do horário comercial).

## Conclusão — ATUALIZADA (resolvido)

**Causa confirmada: token da API desatualizado na produção.** Depois deste
relatório, o usuário recolou `WATIDY_API_TOKEN` na produção com o valor atual
do painel "Configurar API" do wascript e pediu um novo teste. Resultado:
`{"sent":true}` na primeira tentativa, com **entrega confirmada pelo usuário
no WhatsApp** — primeira vez que a produção (não um ambiente de diagnóstico)
entrega de verdade neste ciclo de investigação.

Isso fecha a questão: não era bloqueio de IP/Cloudflare, não era o formato do
telefone, não era GET vs. POST. Era simplesmente um token desatualizado,
mascarado o tempo todo pela mensagem de erro genérica do wascript ("Página do
Whatsapp não aberta ou API desconectada"), que não diferencia "sessão caída"
de "token inválido/antigo".

**Não migrar de fornecedor.** O wascript funciona; o problema era de
configuração do nosso lado.

**Pendências de limpeza:**
- Encerrar o Worker de diagnóstico (`fg-watidy-diag`) quando não for mais
  necessário: `npx wrangler delete --name fg-watidy-diag --config
  scripts/watidy-diag/worker/wrangler.toml`.
- O relatório de bug rascunhado para o suporte do wascript
  (`OS-da-Empresa/relatorio-bug-wascript.md`) ficou **obsoleto** — a hipótese
  dele (bloqueio de IP) não se confirmou. Recomendo não enviá-lo, ou reescrevê-lo
  do zero caso o problema recorra.
- Retomar o protocolo normal de teste de cadência do piloto (resposta do
  contato de teste pausa; encerramento manual; evento ambíguo) agora que o
  envio básico está confirmado funcionando.
- `WATIDY_PHONE_PATH` continua sem valor — falta mapear o formato real de um
  evento de webhook do wascript (nunca recebemos um de verdade).
