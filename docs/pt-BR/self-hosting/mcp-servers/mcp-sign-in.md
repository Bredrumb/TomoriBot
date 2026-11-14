---
title: "Configuração de Login MCP"
description: "Permita que seu TomoriBot com hospedagem própria adicione servidores MCP que solicitam login de conta."
sidebar:
  order: 1
---

Alguns servidores MCP pedem aos administradores que façam login em uma conta em vez de colar um token. Um bot com hospedagem própria
oferece esse login apenas quando `TOMORI_PUBLIC_BASE_URL` está definido. Sem ele, apenas servidores MCP que
aceitam um token em `Token de Autenticação` funcionam.

Se você usa o [bot público implantado](https://discord.com/oauth2/authorize?client_id=841644102059556915),
não precisa desta página; consulte [Servidores MCP](/features/capabilities/tools-and-extensions/mcp-servers/).

## Escolha uma URL base

Defina `TOMORI_PUBLIC_BASE_URL` no `.env` para um endereço sem caminho e reinicie o bot:

| Valor | Use quando |
|---|---|
| `http://127.0.0.1:8080` ou `http://localhost:8080` | O login é concluído em um navegador na própria máquina do bot. Nenhum domínio ou túnel é necessário. |
| `https://<seu-host>` | Os administradores fazem login nos próprios computadores. Você precisa de um endereço HTTPS público que encaminhe para o bot. |

Definir a variável inicia o servidor HTTP do bot em `PORT` (padrão `8080`), e esse servidor escuta
em todas as interfaces de rede. Um login em andamento fica na memória, portanto reiniciar o bot durante um
significa iniciá-lo novamente pelo Discord.

## Endereço de loopback

- Use a porta em `PORT`. O bot registra um aviso na inicialização quando eles diferem.
- Conclua o login em um navegador na máquina do bot. De outro computador, encaminhe a porta por
  SSH primeiro e depois escolha `Fazer Login` no navegador desse computador:

  ```sh
  ssh -L 8080:127.0.0.1:8080 <user>@<bot-host>
  ```

- Cada serviço decide se aceita um endereço de loopback. Se algum recusar, use um endereço HTTPS
  ou um token.

## Endereço HTTPS

Encaminhe estes caminhos do seu endereço público para a `PORT` do bot:

- `GET /oauth/callback`
- `GET /oauth/mcp/start`
- `POST /oauth/mcp/confirm`
- `GET /oauth/client.json`

Os serviços identificam seu bot por `https://<seu-host>/oauth/client.json`, portanto escolha o nome do host
antes do primeiro login e mantenha-o.

## Docker Compose

O Compose não publica a porta do bot. Crie `docker-compose.override.yaml` ao lado de
`docker-compose.yaml`:

```yaml
services:
  tomoribot:
    ports:
      - "127.0.0.1:8080:8080"
```

Mantenha o prefixo `127.0.0.1:`, porque sem ele todos os computadores na sua rede podem alcançar o
servidor HTTP do bot. Um proxy reverso ou túnel rodando na mesma máquina ainda consegue encaminhar para esta
porta.
