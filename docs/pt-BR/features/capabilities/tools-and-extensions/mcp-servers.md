---
title: "Servidores MCP"
sidebar:
  order: 3
---

Servidores [MCP](https://modelcontextprotocol.io/) (Model Context Protocol) a estendem com
ferramentas externas que você mesmo registra.

### Adicionando um MCP Online

Use o endpoint HTTPS direto de um provedor com suporte a MCP Streamable HTTP ou SSE:

Adicione o endpoint e qualquer autenticação necessária em `/config` > `Plugins` > `Servidores MCP`.
Escolha `Corretor de prosa` para um verificador de regras da Revisão de respostas; suas ferramentas não são chamadas durante o chat.

Os tokens de autenticação são criptografados em repouso. Desativar um servidor usado para pesquisa ou leitura de URL
restaura a ferramenta integrada. Uma lista de ferramentas salva reflete a última descoberta bem-sucedida e não
garante que o servidor esteja acessível no momento.

As respostas de ferramentas são limitadas a 8 MiB, incluindo todo o stream para conexões SSE. Peça ao
provedor paginação ou resultados menores se uma ferramenta exceder o limite.

### Adicionando um MCP que precisa de login

Alguns serviços, como Linear e Notion, pedem que você faça login na sua conta em vez de fornecer um
token. Adicione o MCP com `Token de Autenticação` em branco. Quando o servidor pede login, o painel
mostra um botão `Fazer Login`:

1. Escolha `Fazer Login` e entre no serviço em até 10 minutos.
2. A página de confirmação mostra o nome do seu servidor do Discord e o endereço do MCP. Escolha `Conectar` apenas se
   ambos estiverem corretos e você mesmo tiver iniciado este login.
3. O painel é atualizado no Discord assim que o MCP é adicionado.

Todo membro que usa as ferramentas do MCP atua como a conta que fez login, portanto use uma conta cujos
dados todo o servidor possa ver.

Quando um login expira ou o serviço pede mais acesso, as ferramentas desse MCP são pausadas e sua linha
mostra `Reconectar`. Escolha essa opção e faça login novamente; o MCP mantém seu nome, tipo e espaço.

O login funciona apenas ao adicionar um MCP em um servidor, não em uma DM. Em um bot com hospedagem própria, o host faz
a configuração primeiro; consulte [Configuração de Login MCP](/self-hosting/mcp-servers/mcp-sign-in/).

### Servidores MCP Locais

Servidores MCP locais são suportados apenas em instâncias com hospedagem própria, porque o bot público hospedado
exige HTTPS e bloqueia endereços locais/privados. Se você executa sua própria instância, consulte
[Configuração: Servidor MCP Local](/self-hosting/mcp-servers/setup-local-mcp/).

:::danger[Adicione apenas servidores MCP em que você confia]
Um servidor MCP malicioso pode fazer injeção de prompt nela com instruções ocultas, exfiltrar
dados que usuários enviam para suas ferramentas ou retornar resultados falsos ou prejudiciais que ela repassará ao seu
servidor. Trate servidores MCP como extensões de navegador: na dúvida, não adicione. Sempre revise
as ferramentas descritas de um MCP antes de adicioná-lo.
:::
