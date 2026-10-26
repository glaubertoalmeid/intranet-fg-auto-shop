---
name: rotina-diaria-ml
description: "Roda a coleta diária de gestão da conta Mercado Livre no navegador (visão geral, produtos, nota do Full, espaço de estoque, catálogo/preço e Product Ads) e entrega o report BLUF com ações priorizadas. Use quando o usuário pedir 'roda minha rotina diária', 'report do dia', 'como foi ontem na conta' ou 'checa a conta'."
---

# Rotina Diária de Gestão — Conta Mercado Livre

Coleta os 6 blocos abaixo via Claude in Chrome, sempre na mesma ordem, e fecha com um report BLUF. Conta padrão: **12.BSTORE** (`advertiser_id=768048`, `account_id=805746`).

## Regras de operação

- Carregue as ferramentas do Chrome numa única chamada de ToolSearch e chame `tabs_context_mcp` antes de qualquer ação. Nunca reutilize tabId de sessão anterior.
- Prefira `get_page_text` a screenshot: as telas do ML entregam todo o dado em texto.
- Use `browser_batch` para encadear navegar → esperar → ler.
- **Nunca execute ação irreversível sem ok explícito na hora**: alterar preço, aplicar "preço para ganhar", pausar/reativar anúncio, mudar orçamento ou ROAS objetivo, aceitar promoção, descartar estoque, responder comprador, enviar report. Levante, mostre, espere o ok.
- O painel de ads mostra "$" no lugar de "R$" (bug de locale). Os valores são BRL.

## Bloco 1 — Visão geral do negócio

A tela aceita período por URL, o que evita mexer no calendário:

```
https://vendedores.mercadolivre.com.br/metricas/negocio/visao-geral?start_period=custom&from_current=AAAA-MM-DDT03%3A00%3A00.000Z&to_current=AAAA-MM-DDT03%3A00%3A00.000Z
```

Colete três janelas, nesta ordem: **ontem** (D-1 a D-1), **acumulado do mês** (dia 1 até hoje), **últimos 7 dias** (`#from=seller-menu` já abre em 7 dias).

De cada janela extraia: vendas brutas, quantidade de vendas, unidades, visitas, conversão, preço médio por venda, cancelamentos e devoluções — sempre com a variação vs período anterior. Na seção de funil pegue visitas únicas → intenção de compra → vendas, e o número de carrinhos abandonados.

## Bloco 2 — Produtos vendidos

Na mesma tela, seção "Desempenho dos seus anúncios". Para cada anúncio: vendas brutas e variação, quantidade, % de participação, visitas, conversão, e as tags CATÁLOGO / CLIPS / Sem estoque.

Use a janela de **7 dias** como base do ranking (janelas curtas mostram poucos anúncios). Sinalize:

- Queda acima de 15% em item de Curva A ou B → investigação obrigatória
- Item com "Sem estoque" e histórico de venda → ruptura, prioridade máxima
- Item com muitas visitas e conversão abaixo da média da conta → problema de oferta, não de tráfego

## Bloco 3 — Nota do Full

```
https://vendedores.mercadolivre.com.br/metricas/stock-full
```

Extraia a pontuação total e os quatro componentes: tempo de estoque (30), vendas brutas por ocupação (40), fora de venda (10), rotatividade (20). Registre também o espaço atribuído e o % de uso.

O corte é dia **15 de cada mês** e define o espaço do mês seguinte; com 70+ mantém espaço estendido. Sempre diga quantos dias faltam para o corte e qual componente está drenando ponto.

## Bloco 4 — Controle de estoque no Full

```
https://vendedores.mercadolivre.com.br/anuncios/lista/space_management?filters=commingling-enabled
```

O topo da tela traz o status do estoque total (independe do filtro): boa qualidade, entrada pendente, para colocar à venda, para impulsionar vendas, para evitar descarte — com unidades e a quebra de cada um.

Reporte em unidades, não só em %, e separe o que é ação barata (inativo, sem identificação, pausado por você) do que é ação cara (baixa venda por ocupação). Na tabela, registre por produto: vendas 30d, estoque médio, a caminho, aptas/não aptas para venda, tempo até esgotar e a ação sugerida pelo ML.

## Bloco 5 — Preço e catálogo

```
https://vendedores.mercadolivre.com.br/anuncios/lista/precos?page=1&filters=ACTIVE
```

Por anúncio: status de catálogo (GANHANDO / COMPETINDO / PERDENDO), flag PREÇO ALTO, preço atual, "preço para ganhar no Mercado Livre", quanto o vendedor recebe hoje (com tarifa e frete abertos), unidades vendidas 30d e variação.

**O "preço para ganhar" não é ordem de execução.** Antes de sugerir qualquer ajuste, calcule o que sobra no preço sugerido usando a mesma quebra de tarifa e frete que a tela mostra, e apresente as alternativas: baixar preço, entrar em promoção com subsídio do ML, mudar modalidade de envio, ou aceitar não ganhar aquele catálogo. Quem decide margem é o usuário.

## Bloco 6 — Product Ads

```
https://vendedores.mercadolivre.com.br/publicidade/product-ads/admin?advertiser_id=768048&account_id=805746&navigate_to=seller_central&from=ads-manager
```

Seletor de período no topo do bloco "Métricas": Últimos 7/15/30/60/90 dias e Personalizado. Colete **30 dias, 7 dias e ontem**. O calendário do "Personalizado" é instável — se falhar duas vezes, siga com as janelas fixas e avise a lacuna em vez de insistir.

Da conta: vendas atribuídas, outras vendas, ROAS, receita, investimento, TACOS. Do rodapé: % das vendas totais que vieram de patrocinado.

Da tabela de campanhas, por campanha: diagnóstico do ML (Saudável / Ficar de olho / Agir agora), classificação (PROMOTORA / NA MÉDIA / DETRATORA), orçamento diário, ROAS objetivo, vendas atribuídas, ROAS real, ACOS, impressões, cliques, receita e investimento.

Checagens obrigatórias:

- Investimento de um dia acima do orçamento médio diário total configurado → sinalizar como possível estouro
- ROAS real abaixo do ROAS objetivo → campanha comprando venda
- TACOS subindo com receita estável ou caindo → a conta está trocando margem por volume
- Diagnóstico que muda de PROMOTORA para DETRATORA entre janelas → ruído de dia único, não decida por ele

## Formato do report

1. **BLUF** — uma frase com a história do dia: o que está acontecendo com a conta e por quê.
2. **Os números** — ontem, mês e 7 dias lado a lado, com variação.
3. **Diagnóstico** — conecte os blocos. Venda subindo com ads subindo mais rápido é venda comprada. Queda em item Curva A com PREÇO ALTO é perda de catálogo. Item sem estoque com histórico é ruptura.
4. **Plano de ação priorizado (80/20)** — no máximo 4 itens, cada um com o número que justifica a prioridade e o que precisa de decisão humana.
5. **O que precisa do seu ok** — lista explícita das ações irreversíveis pendentes.

Cada recomendação carrega o porquê. O analista precisa entender o raciocínio, não receber ordem.
