---
title: "ChatMock"
sidebar:
  label: "ChatMock"
  order: 1
aiGenerated: true
---

Conecte o TomoriBot a uma ponte local de Chat Completions usando o [ChatMock](https://github.com/RayBytes/ChatMock).

:::caution[Use proxies de conta CLI por sua conta e risco]
O acesso de terceiros por meio de uma conta CLI pode violar os termos do provedor e gerar risco de suspensão da conta. Uma assinatura não garante permissão para uso de bot ou API. Revise as [orientações de risco de conta](/self-hosting/local-endpoints/proxies-and-remote-access/#account-risk) antes de fazer login; o TomoriBot não oferece garantia de segurança da conta.
:::

## 1. Iniciar o ChatMock

1. Instale o ChatMock usando as [instruções do repositório](https://github.com/RayBytes/ChatMock).
2. Se sua conta e método de acesso permitirem esse uso, autentique e inicie o servidor:

```sh
chatmock login
chatmock serve
```

3. Confirme se a API local está acessível em `http://127.0.0.1:8000/v1`.

## 2. Configurar o TomoriBot

1. Execute `/providers` ou `/personal providers` e adicione um endpoint personalizado `Compatível com OpenAI`.
2. Insira as configurações de conexão:

| Campo | Valor |
|---|---|
| URL do Endpoint | `http://127.0.0.1:8000/v1` quando o bot roda nesta máquina fora da produção |
| Token de Autenticação | A chave de cliente da ponte, se a autenticação estiver ativada |

3. Selecione o endpoint salvo e adicione um Modelo de Texto com o ID exato da API que o ChatMock expõe. Registre mais IDs na mesma conexão para alternar entre modelos.

- Um `http://127.0.0.1:8000` simples normaliza para `/v1`; não adicione `/chat/completions`.
- Permita `127.0.0.1:8000` na configuração de desenvolvimento `ALLOW_PRIVATE_NETWORK` do TomoriBot. O loopback do Docker refere-se ao contêiner.
- Ative ferramentas, imagens ou saída estruturada somente após testar a ponte e o modelo selecionado. Mantenha o vídeo desativado.
- Para um bot de produção hospedado separadamente, siga o [Cloudflare Tunnel](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/). A produção exige HTTPS público. A detecção direta de prompt do ChatMock baseada em loopback e porta não se aplica ao hostname público do relay, portanto valide o comportamento de instruções do sistema separadamente.

:::note[Tratamento do prompt de sistema e configuração de porta]
O TomoriBot detecta um endpoint em loopback na porta `CHATMOCK_PORT` (padrão `8000`) e converte instruções de sistema em um turno inicial de usuário para compatibilidade com o ChatMock. Defina `CHATMOCK_PORT` para corresponder a uma porta local diferente do ChatMock.
:::
