---
title: "Configuração: Servidor MCP Local"
sidebar:
  order: 6
---

Os servidores [MCP](https://modelcontextprotocol.io/) estendem o TomoriBot com ferramentas externas. Servidores MCP online
(HTTPS) funcionam em qualquer instância: veja
[Tools & Extensions](/pt-BR/features/capabilities/tools-and-extensions/#mcp-servers). Servidores MCP **locais** são
diferentes:

:::caution[Apenas para hospedagem própria]
Servidores MCP locais são **suportados apenas em instâncias de hospedagem própria**. O bot público hospedado
exige HTTPS e bloqueia endereços locais/privados por segurança, então ele não consegue acessar um servidor em
`localhost` ou na sua rede local (LAN).
:::

## 1. Execute um servidor MCP local

Inicie qualquer servidor MCP que exponha um transporte HTTP/SSE em uma porta local. Por exemplo, muitos
servidores MCP rodam via Node:

```sh
npx -y <some-mcp-server> --port 3000
```

O comando exato depende do servidor que você está executando. Anote a URL e o caminho de transporte que ele
imprime: geralmente algo como `http://localhost:3000/sse`.

As próprias ferramentas do TomoriBot esperam que o **Node.js v20+** esteja disponível para as ferramentas do MCP no host.

## 2. Registre-o no Discord

Abra `/config` > Plugins > Servidores MCP, escolha `Adicionar MCP`, aponte o campo **URL**
para o seu servidor local e deixe o campo obrigatório `Tipo de Servidor` em seu valor padrão `Propósito Geral`:

```text
http://localhost:3000/sse
```

Deixe o campo `Token de Autenticação` em branco: nenhum token de autenticação é necessário para servidores locais.

## 3. Gerencie-o

- Abra a página Config e escolha `Remover` na linha do servidor. A confirmação o cancela o registro,
  desconecta-o imediatamente e libera um espaço.

## Segurança

:::danger[Adicione apenas servidores MCP em que você confia]
Mesmo um servidor local que você mesmo executa pode se comportar mal se o seu código não for confiável. Um servidor MCP
malicioso pode fazer prompt-inject no modelo, exfiltrar dados passados para suas ferramentas, ou retornar resultados
prejudiciais que o TomoriBot irá retransmitir. Revise o que um servidor MCP faz antes de conectá-lo.
:::

Para o fluxo MCP online e a justificativa completa de segurança, veja
[Tools & Extensions → MCP Servers](/pt-BR/features/capabilities/tools-and-extensions/#mcp-servers).
