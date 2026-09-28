---
title: "Configuração: Codex CLI via ChatMock"
sidebar:
  order: 5
---

Se você quiser que o TomoriBot use sua conta do ChatGPT por meio de uma ponte local compatível com a OpenAI, você pode executar o [ChatMock](https://github.com/RayBytes/ChatMock) e apontar o provedor `custom` do TomoriBot para ele.

## O que o ChatMock faz

- O ChatMock executa um servidor de API local compatível com a OpenAI
- O TomoriBot pode usar esse servidor local através do provedor `custom`

## 1. Iniciar o ChatMock

Instale e inicie o ChatMock seguindo as instruções no GitHub:

- [Repositório do ChatMock](https://github.com/RayBytes/ChatMock)

Após instalar, execute:
```sh
chatmock login
chatmock serve
```

Por padrão, o ChatMock escuta em `http://127.0.0.1:8000/v1`

## 2. Configurar o TomoriBot para usar o ChatMock

No Discord, configure o provedor `custom` do TomoriBot e use:

- **URL do Endpoint**: `http://127.0.0.1:8000/v1`
- **Nome do modelo**: a string exata do modelo que o ChatMock deve receber, como `gpt-5.4` ou `gpt-5.3-codex`

Um simples `http://127.0.0.1:8000` também funciona: o TomoriBot o normaliza para `/v1` antes de acrescentar `/chat/completions`.

Habilite estas flags de capacidade para o ChatMock:
- **Function Calling / Tools**: Sim
- **Image Understanding**: Sim
- **Video Understanding**: Não
- **Saída Estruturada**: Sim

**Nota**: A Codex CLI não permite que você altere seu prompt `system`, então o prompt `system` do TomoriBot é transformado em um turno `user` no contexto como uma solução de contorno. Por favor, configure a variável de ambiente `.env` `CHATMOCK_PORT` para corresponder à sua porta atual do ChatMock para que esta solução de contorno funcione corretamente (o padrão é 8000).
