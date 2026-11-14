---
title: "Proxies e Acesso Remoto"
sidebar:
  label: "Visão Geral"
  groupLabel: "Proxies e Acesso Remoto"
  order: 8
---

Conecte o TomoriBot por meio de um proxy de API local ou acesse com segurança um motor em execução em outro computador.

## Escolha um guia

1. [ChatMock](/self-hosting/local-endpoints/proxies-and-remote-access/setup-chatmock/): conecte uma ponte baseada no ChatGPT na sua máquina.
2. [CLIProxyAPI](/self-hosting/local-endpoints/proxies-and-remote-access/setup-cliproxyapi/): instale um proxy e registre modelos de um backend autorizado.
3. [Cloudflare Tunnel](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/): dê a um motor local uma URL HTTPS para um bot hospedado separadamente.
4. [Opcional: Access e Caddy](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-access-and-caddy/): adicione uma verificação de autenticação separada e roteamento de API mais restrito.

Comece pelo guia de proxy se precisar de um. Siga o guia do Cloudflare apenas quando o bot rodar em outra máquina.

## Risco de conta
<!-- anchor: account-risk -->

:::danger[Use proxies de conta CLI por sua conta e risco]
Usar contas do Codex, Claude Code, Antigravity ou outras contas de CLI por meio de uma ponte de terceiros pode violar os termos do provedor e levar à suspensão ou encerramento da conta. Uma assinatura paga ou login bem-sucedido não garante permissão para uso com bot ou API de uso geral. Verifique as regras do seu provedor, plano e método de autenticação. O TomoriBot não oferece garantia de segurança da conta.
:::

As regras dos provedores variam:

- Os [termos da OpenAI](https://openai.com/policies/terms-of-use/) se aplicam ao uso individual de conta, com termos separados para API e serviços empresariais. Revise os termos aplicáveis à sua conta Codex e ao método de acesso da ponte.
- A [política de autenticação da Anthropic](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use) restringe o uso de OAuth de assinatura e o roteamento por terceiros em nome de usuários. Ela orienta desenvolvedores que criam serviços a usar chaves de API ou provedores em nuvem suportados.
- Os [termos do Antigravity do Google](https://antigravity.google/terms) proíbem explicitamente o acesso de terceiros, como pontes OAuth do Antigravity, e permitem suspensão ou encerramento. Este guia não recomenda esse método de acesso.

Use apenas backends que você tenha autorização para acessar. Para integrações suportadas por provedores, use o provedor integrado do TomoriBot quando disponível, como o Google com uma [chave de API do Gemini](https://ai.google.dev/gemini-api/docs/api-key), ou um endpoint de API autorizado. O CLIProxyAPI, a CLI/aplicação original e o serviço de modelo upstream são produtos separados.
