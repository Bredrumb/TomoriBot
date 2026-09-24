---
title: "Ferramentas & Extensões"
sidebar:
  order: 1
---

A TomoriBot é baseada em agentes: além de conversar, ela pode chamar **ferramentas** para pesquisar na web, ler documentos, gerar mídia, definir lembretes, agir em outros canais e muito mais. Ela decide quando usá-las com base na conversa. Esta página aborda as ferramentas integradas, como estendê-la com servidores MCP e como manter as declarações de ferramentas enxutas com o Modo de Ferramenta Deliberada.

Aqui estão alguns exemplos divertidos:

- **1. Verificador de Bem-Estar**
  ```text
  A cada poucas horas, faça uma verificação obrigatória de bem-estar em @Bredrumb.
  Pergunte como ele se sente no momento e se ele fez alguma pausa na codificação recentemente.
  Acompanhe o estado emocional dele ao longo do tempo com {memory_tool} e/or {memory_update_tool} para reportar a ele mais tarde.
  ```
- **2. Notícias Semanais de ~~Eventos Atuais~~ Yuri**
  ```text
  Toda sexta-feira, compile os capítulos notáveis de mangá yuri da semana, episódios de anime e lançamentos de fanart da comunidade usando {web_search_tool}.
  Apresente os resultados com {voice_message_tool} usando uma voz ASMR sedutora.
  ```
- **3. Polícia do Sono**
  ```text
  Se você notar através da {message_metadata_tool} que alguém está no bate-papo depois das 2h da manhã, use {voice_message_tool} para enviar uma canção de ninar ASMR ameaçadoramente calma mandando-os ir para a cama.
  Se eles continuarem conversando 10 minutos depois, use {manage_message_tool} para excluir a mensagem deles para o próprio bem e lembrá-los de que a privação do sono é a principal causa de seus problemas.
  ```

## Ferramentas Integradas
<!-- anchor: built-in-tools -->

As ferramentas dependem de o provedor/modelo ativo suportar chamada de ferramentas (tool calling), e muitas estão condicionadas a uma flag de recurso (uma opção em `/config` > Permissions), uma permissão do Discord, uma capacidade do modelo ou uma chave de API opcional.

| Ferramenta | Macro de prompt | Requer | O que faz |
|---|---|---|---|
| Revisar capacidades | `{capabilities_tool}` | — | Verificar habilidades atuais de chat, comandos ou configurações antes de responder. |
| Criar / atualizar memória de longo prazo | `{memory_tool}` / `{memory_update_tool}` | `self_teaching_enabled` | Salvar ou substituir um fato estável do servidor ou preferência do usuário. |
| Atualizar memória de curto prazo | `{short_term_memory_tool}` | (indisponível no NovelAI) | Salvar memória de trabalho temporária para o canal/arco de história atual. |
| Criar / atualizar tarefa | `{task_tool}` / `{task_update_tool}` | — | Agendar ou editar lembretes e tarefas próprias (veja [Tarefas Agendadas](/pt-BR/features/capabilities/scheduled-tasks/)). |
| Mensagem entre canais | `{cross_channel_tool}` | (indisponível no NovelAI) | Agir em outro canal/tópico, com um relatório de retorno opcional. |
| Criar tópico | `{create_thread_tool}` | `thread_creation_enabled` + permissões de tópico | Abrir um tópico público e postar sua mensagem inicial. |
| Selecionar figurinha | `{sticker_tool}` | `sticker_usage_enabled` | Adicionar uma figurinha do servidor correspondente a uma resposta. |
| Gerenciar mensagem | `{manage_message_tool}` | `manage_message_enabled` | Fixar, editar ou excluir mensagens recentes (fixar requer Gerenciar Mensagens). |
| Bloquear / desbloquear usuário | `{block_user_tool}` / `{unblock_user_tool}` | `user_blocking_enabled` | Silenciamento/bloqueio de um usuário no escopo da persona (não afeta memórias). |
| Interagir com mensagem recente | `{message_interaction_tool}` | — | Reagir ou enviar uma resposta curta a uma mensagem recente. |
| Olhar foto de perfil | `{profile_picture_tool}` | modelo de visão ou `vision_llm` | Inspecionar o avatar de um usuário ou da persona. |
| Ler documento | `{document_tool}` | — | Extrair texto de um PDF ou de **qualquer** arquivo de texto UTF-8: código-fonte (`.py`/`.ts`/`.rs`/…), `.json`, `.yaml`, `.md`, `.txt` e qualquer anexo não binário. |
| Revelar metadados da mensagem | `{message_metadata_tool}` | — | Anotar turnos recentes com identificadores/carimbos de data/hora para direcionamento preciso. |
| Processar vídeo do YouTube | `{youtube_tool}` | modelo com suporte a vídeo | Analisar um link específico do YouTube sob demanda. |
| Analisar imagem | `{image_analysis_tool}` | `vision_llm` configurado | Delegar a compreensão de imagem a um modelo de visão separado. |
| Gerar imagem / imagem de anime | `{image_generation_tool}` / `{anime_image_generation_tool}` | `imagegen_enabled` + provedor compatível | Gerar ou editar imagens (veja [Geração de Mídia](/pt-BR/features/capabilities/media-generation/)). |
| Gerar mensagem de voz | `{voice_message_tool}` | chave ElevenLabs + voz da persona + `voice_message_enabled` | Enviar uma resposta de voz falada no Discord. |

:::note[Para autores de prompts]
Ao personalizar o prompt de sistema dela ou as instruções da persona, faça referência às ferramentas por meio de suas **macros de prompt** da tabela acima em vez de codificar nomes de ferramentas de forma fixa: as macros se expandem para os nomes corretos no momento da montagem do contexto e degradam suavemente quando uma ferramenta não está disponível.
`{pin_tool}` e `{timestamp_refresh_tool}` ainda funcionam como aliases de compatibilidade para `{manage_message_tool}` e `{message_metadata_tool}`. As ferramentas de pesquisa na web e URLs abaixo também têm macros: `{web_search_tool}`, `{image_search_tool}`, `{video_search_tool}`, `{news_search_tool}`, `{url_fetch_tool}` e `{url_metadata_tool}`; estas são resolvidas dinamicamente para o melhor mecanismo disponível, incluindo substituições de MCP do servidor.
:::

### Blocos de Prompt Condicionais

O texto de prompt que suporta as macros de ferramentas acima também suporta condicionais com escopo:

```text
{{if capability:self_teaching}}
Use {memory_tool} quando um detalhe valer a pena ser lembrado.
{{else}}
Não prometa salvar memórias de longo prazo.
{{/if}}
```

Use `capability:<name>` para uma configuração ativada da TomoriBot, ou `tool:<function_name>` quando o texto deve aparecer apenas se essa ferramenta exata estiver disponível para o provedor e modelo ativos. Use `tool_family:url_fetch` quando o leitor de URLs integrado ou uma substituição MCP do servidor estiver disponível. Adicione o prefixo `!` a uma condição para invertê-la. Os blocos podem ser aninhados e podem conter um `{{else}}`; expressões gerais de `and`/`or` não são suportadas.

Os nomes de capacidades suportados são `tool_use`, `self_teaching`, `personal_memories`, `emoji_usage`, `sticker_usage`, `web_search`, `manage_message`, `thread_creation`, `image_generation`, `video_generation`, `voice_message`, `user_blocking`, `short_term_memory` e `time_awareness`.

As condições de ferramentas refletem o suporte do provedor/modelo, a configuração do servidor, os backends configurados, as substituições de MCP e a lista de permissões atual do Modo de Ferramenta Deliberada. Elas não contornam nem preveem verificações de permissão do Discord executadas quando uma ferramenta é acionada. Nomes de capacidade desconhecidos são avaliados como falsos e registrados em log; blocos malformados são omitidos. Mensagens brutas do chat, saídas do modelo e resultados de ferramentas nunca são tratados como modelos condicionais.

## Pesquisa na Web & Leitura de URLs
<!-- anchor: web-search--url-reading -->

O modelo vê uma única ferramenta unificada `web_search(query, category)`. Por trás dela, um despachante encaminha cada chamada por uma cadeia de mecanismos e retorna o primeiro sucesso:

**Brave → SearXNG → DuckDuckGo → IAsk**

- O **Brave** é executado primeiro quando uma chave de API do Brave está configurada (defina-a com `/providers`); ele adiciona pesquisa de imagens, vídeos e notícias. ⚠️ Defina um limite de uso de $5 no painel do Brave para evitar cobranças inesperadas.
- O **DuckDuckGo** é o padrão quando nenhuma chave está configurada, alternando em cascata para o **IAsk** em caso de limites de taxa ou resultados vazios.
- O **SearXNG** e o **Crawl4AI** são servidores opcionais de hospedagem própria que desbloqueiam mais categorias e buscas de páginas renderizadas pelo navegador; veja [Hospedagem Própria](/pt-BR/self-hosting/).

Para ler uma página específica, ela usa `fetch_url`. Ele não está disponível no NovelAI.

## Servidores MCP
<!-- anchor: mcp-servers -->

Servidores [MCP](https://modelcontextprotocol.io/) (Model Context Protocol) estendem as capacidades dela com ferramentas externas que você mesmo registra.

### Adicionando um MCP Online

Qualquer servidor MCP hospedado publicamente com um endpoint HTTPS funciona. Usando o [Smithery.ai](https://smithery.ai) como exemplo:

1. Crie uma conta e gere uma chave de API a partir do seu perfil.
2. Abra um MCP no catálogo e copie a **URL de conexão** (por exemplo, `https://youtube.run.tools`).
3. Abra `/config` > Plugins > MCP Servers, escolha **+ Add MCP**, cole a URL de conexão em **URL**, cole sua chave do Smithery em **Auth Token** e escolha o **Server Type** necessário. **General Purpose** fica selecionado por padrão.

Se um servidor não precisar de autenticação, deixe **Auth Token** em branco. Seu token de autenticação é criptografado em repouso e nunca é exibido novamente. Abra a mesma página de Configuração para inspecionar o estado configurado, ativar ou desativar um servidor, ou remover um com confirmação explícita. A remoção o desconecta imediatamente e libera um slot. Cada linha salva também mostra os nomes das ferramentas delimitadas de sua última descoberta bem-sucedida. **None discovered** é um resultado conhecido de zero ferramentas; **Discovery unknown** identifica uma linha legada ou um servidor que ainda não possui um snapshot bem-sucedido. Abrir a interface de gerenciamento de MCP apenas lê os metadados salvos e não entra em contato com o servidor remoto.

### Servidores MCP Locais

Servidores MCP locais são **suportados apenas em instâncias de hospedagem própria**: o bot público hospedado exige HTTPS e bloqueia endereços locais/privados. Se você executa sua própria instância, veja [Configuração: Servidor MCP Local](/pt-BR/self-hosting/local-endpoints/setup-local-mcp/).

:::danger[Adicione apenas servidores MCP em que você confia]
Um servidor MCP malicioso pode **injetar prompts** nela com instruções ocultas, **exfiltrar** dados que os usuários passam para suas ferramentas ou retornar **resultados prejudiciais/falsos** que ela retransmitirá para o seu servidor. Trate servidores MCP como extensões de navegador; em caso de dúvida, não adicione. Sempre revise as ferramentas descritas de um MCP antes de adicioná-lo.
:::

## Modo de Ferramenta Deliberada
<!-- anchor: deliberate-tool-mode -->

Cada ferramenta declarada aumenta o tamanho do prompt. O **Modo de Ferramenta Deliberada** mantém as declarações de ferramentas fora dos turnos normais de chat, a menos que a mensagem pareça realmente precisar de uma ferramenta; isso reduz o tamanho do prompt e ajuda modelos menores/locais a responderem mais rápido.

- Primeiro, ela verifica a mensagem quanto à **intenção de ferramenta**. Gatilhos integrados cobrem solicitações comuns (lembretes, pesquisa na web, atualizações de memória, mensagens entre canais, geração de imagem/vídeo/voz, análise de mídia, criação de tópicos, ações de mensagem). Perguntas sobre seu modelo atual, ferramentas, configurações ou por que uma capacidade está indisponível expõem a revisão de capacidades e o acesso à documentação oficial em conjunto. Expressões de acompanhamento também funcionam, como "faça isso de novo, mas com mais raiva" após um pedido de mensagem de voz.
- Os administradores de servidores podem adicionar **frases de gatilho personalizadas** literais com `/server trigger add`: por exemplo, mapeando `pic`, `img` ou `pfp` para geração de imagem.
- Os gatilhos integrados leem expressões em inglês. Outros idiomas acessam as mesmas ferramentas por meio da lista de palavras-chave de cada idioma. A lista de cada idioma incluído é verificada em todas as mensagens, independentemente da sua configuração de idioma, de modo que um servidor bilíngue funciona em ambos os idiomas.
- Frases personalizadas em japonês, chinês ou coreano também correspondem dentro de palavras mais longas, pois esses idiomas não separam palavras com espaços. Uma frase terminada em `*` corresponde a qualquer palavra que comece com ela: `remind*` cobre `reminder` e `reminding`.

### Controles

- `/server dtm`: administradores do servidor ativam/desativam.
- `/personal config`: usuários substituem a configuração para si mesmos.
- Com um canal de registros de pensamentos configurado (`/server thought-logs`), chamadas de ferramentas bem-sucedidas no modo deliberado são registradas lá junto com o gatilho que expôs a ferramenta.

O Modo de Ferramenta Deliberada apenas decide quais ferramentas são *mostradas* ao modelo; o modelo ainda precisa escolher chamar uma. Em `/help`, escolha **Behavior** e depois **Deliberate Tool Mode** para o resumo no Discord.

:::note
O **Modo de Ferramenta Deliberada** (esta seção) não tem relação com o **Modo de Gatilho Deliberado**, que controla como *ela* é acionada; veja [Conversas & Gatilhos](/pt-BR/features/chatting-personality/chatting-and-triggers/#deliberate-trigger-mode). Ambos são abreviados como "DTM" no Discord.
:::

## Atualizações Estruturadas de Informações do Usuário

A ferramenta integrada `update_user_info` lida com solicitações explícitas para alterar o apelido, prefixo, sufixo, identidade de gênero, pronomes, estilo de tratamento ou deslocamento numérico UTC de um usuário registrado. Ela usa o mesmo resolvedor de nome, alias, menção e Discord-ID com reconhecimento de colisão que outras ferramentas pessoais. Um destino omitido refere-se ao humano que disparou o turno; `all` e `everyone` nunca são destinos curinga.

Cada campo é seu próprio parâmetro opcional, portanto, uma alteração é expressa passando o campo. A remoção é uma lista `clear` de nomes de campos, o que mantém uma regra única para campos de texto, enum e numéricos da mesma forma; uma string em branco é convertida em uma remoção em vez de ser rejeitada. Não há parâmetro de escopo ou ação, pois o escopo segue o campo:

| Campos | Armazenado | Efeito |
|---|---|---|
| apelido, prefixo, sufixo | por linhagem da persona | apenas a persona que fez a alteração se dirige a eles de forma diferente |
| identidade de gênero, pronomes, estilo de tratamento, fuso horário | uma vez por usuário | toda persona lê o mesmo valor |

Essa divisão segue o armazenamento em vez da preferência: os campos de identidade têm um único slot por usuário e nenhum equivalente por persona. O aviso de sucesso rotula as linhas com escopo de persona com o nome da persona, para que a diferença seja visível em vez de implícita. Uma linha sem rótulo é global, o que dispensa explicações próprias, pois o escopo global é o caso esperado.

O contexto do participante nomeia o prefixo e o sufixo de cada usuário separadamente do seu apelido, de modo que uma solicitação para remover um título se resolva em uma alteração de afixo em vez de uma reescrita do apelido. Um afixo removido é armazenado como uma supressão explícita, de modo que a remoção não possa ser desfeita por uma camada de precedência inferior que ainda forneça um valor.

Quando um apelido é enviado com um afixo que já está resolvido, o afixo redundante é removido comparando-o com o valor resolvido; o apelido nunca é dividido por espaços em branco para adivinhar um limite. Uma atualização relata a forma de tratamento resultante sempre que esse nome realmente mudar, de modo que uma alteração de estilo de tratamento fica visível no mesmo turno, mesmo que nenhum campo de nomenclatura tenha aparecido nele, enquanto uma edição de pronome ou fuso horário não reapresenta um nome que nada alterou.

Cada campo é validado antes de uma gravação atômica única. A privacidade restritiva bloqueia adições e alterações, mas ainda permite limpar valores. A ferramenta não pode editar termos de tratamento para toda a persona. A opção padrão ativada de Atualizações de Informações do Usuário em `/config` > Permissions controla tanto a exposição da ferramenta quanto a defesa contra invocações obsoletas. O comando manual `/personal config` permanece disponível quando a opção estiver desativada.
