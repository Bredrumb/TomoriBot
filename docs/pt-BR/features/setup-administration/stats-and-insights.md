---
title: "Estatísticas & Insights"
sidebar:
  order: 4
---

A TomoriBot rastreia o uso para que você possa ver quem fala com quem, quais personas e modelos são utilizados,
e quais ferramentas disparam; depois transforma tudo em um infográfico compartilhável.

## Painéis de Texto

Três comandos abrem um painel interativo com abas (Visão Geral, Personas, Modelos & Custo,
Ferramentas & Comandos, Expressão, Pessoas Favoritas, Ranking):

As abas de texto são painéis públicos duráveis controlados por quem as invocou. Elas ficam disponíveis
até a mensagem ser removida, e outro usuário não pode operar os controles.

- `/stats personal`: seu próprio uso.
- `/stats persona`: uso de uma persona neste servidor.
- `/stats server`: uso em todo o servidor.

A maioria suporta uma janela de **período de tempo**, e estatísticas pessoais podem ser limitadas a este servidor ou
a todos os servidores.

:::note
**Contagem de tokens** é o uso relatado pelo próprio provedor quando disponível (uma estimativa
baseada em caracteres é usada apenas para provedores que não relatam nenhuma). **Custo** precifica esses tokens
pelas taxas de tabela do catálogo de modelos, então pode diferir da sua fatura real (cache de prompt, descontos,
cotas de nível gratuito, etc.).
:::

## Cartões de Infográfico Compartilháveis

`/stats generate` renderiza um cartão de imagem elegante que você pode enviar no chat:

- **Personal Wrapped**: sua atividade pessoal, no estilo Spotify Wrapped.
- **Persona Affinity**: estatísticas de uma persona neste servidor.
- **Server Leaderboard**: classificações gerais do servidor.

Usuários totalmente privados (`/personal config`) não podem gerar cartões pessoais.

Para saber como os cartões são compostos e renderizados, veja a referência de arquitetura sobre o
[subsistema de infográficos de estatísticas](/en/architecture/subsystems/stats-infographic/).
