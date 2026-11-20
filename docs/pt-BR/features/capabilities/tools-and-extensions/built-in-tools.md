---
title: "Ferramentas integradas"
sidebar:
  order: 0
---

As ferramentas dependem do provedor ativo e do modelo compatível com chamadas de ferramentas. Muitas são protegidas por um sinalizador de recurso (`/config` > Permissões), uma permissão do Discord, uma capacidade do modelo ou uma chave de API opcional.

:::tip
Se um recurso parecer indisponível, pergunte a ela o motivo. Ela pode relatar os sinalizadores de recursos do servidor e se o modelo ativo oferece suporte a chamadas de ferramentas, o que geralmente aponta para a configuração a ser ajustada.
:::

| Ferramenta | Macro de prompt | Requer | O que faz |
|---|---|---|---|
| Revisar capacidades | `{capabilities_tool}` | - | Verifica as capacidades atuais do chat, comandos ou configurações antes de responder. |
| Criar / atualizar memória de longo prazo | `{memory_tool}` / `{memory_update_tool}` | `self_teaching_enabled` | Salva ou substitui um fato estável do servidor ou preferência do usuário. |
| Atualizar memória de curto prazo | `{short_term_memory_tool}` | - | Salva memória de trabalho temporária para o canal atual ou arco de história. |
| Criar / atualizar tarefa | `{task_tool}` / `{task_update_tool}` | - | Agenda ou edita lembretes e tarefas próprias (consulte [Tarefas agendadas](/features/capabilities/scheduled-tasks/)). |
| Mensagem entre canais | `{cross_channel_tool}` | - | Atua em outro canal ou tópico, com relatório opcional. |
| Criar tópico | `{create_thread_tool}` | `thread_creation_enabled` + permissões de tópico | Abre um tópico público e envia sua mensagem inicial. |
| Rolar dados | - | `dice_rolling_enabled` | Rola dados publicamente e usa o resultado retornado no roleplay. |
| Selecionar figurinha | `{sticker_tool}` | `sticker_usage_enabled` | Adiciona uma figurinha correspondente do servidor ou expressão personalizada a uma resposta. |
| Gerenciar mensagem | `{manage_message_tool}` | `manage_message_enabled` | Fixa, edita ou exclui mensagens recentes (fixar requer `Gerenciar mensagens`). |
| Bloquear / desbloquear usuário | `{block_user_tool}` / `{unblock_user_tool}` | `user_blocking_enabled` | Silenciamento/bloqueio no escopo da persona para um usuário (não altera memórias). |
| Interagir com mensagem recente | `{message_interaction_tool}` | - | Reage ou envia uma resposta curta a uma mensagem recente. |
| Espiar foto de perfil | `{profile_picture_tool}` | modelo de visão ou `vision_llm` | Inspeciona o avatar de um usuário ou da persona. |
| Ler documento | `{document_tool}` | - | Extrai texto de um PDF ou arquivo de texto UTF-8: código-fonte (`.py`/`.ts`/`.rs`/…), `.json`, `.yaml`, `.md`, `.txt` e qualquer anexo não binário. |
| Revelar metadados da mensagem | `{message_metadata_tool}` | - | Anota turnos recentes com identificadores e carimbos de data/hora para direcionamento preciso. |
| Processar vídeo do YouTube | `{youtube_tool}` | modelo com suporte a vídeo | Analisa um link específico do YouTube sob demanda. |
| Analisar imagem | `{image_analysis_tool}` | `vision_llm` configurado | Delega a compreensão da imagem a um modelo de visão separado. |
| Gerar imagem / imagem de anime | `{image_generation_tool}` / `{anime_image_generation_tool}` | `imagegen_enabled` + provedor compatível | Gera ou edita imagens (consulte [Geração de mídia](/features/capabilities/media-generation/image-generation/)). |
| Busca de tags no Danbooru | `{tag_search_tool}` | `danbooru_enabled` | Converte nomes de personagens, apelidos e palpites em tags exatas do Danbooru (consulte [Busca de tags no Danbooru](/features/capabilities/tools-and-extensions/danbooru/)). |
| Busca de arte no Danbooru | `{booru_post_search_tool}` | `danbooru_enabled` | Envia até 4 imagens existentes do Danbooru para 1 ou 2 tags (consulte [Busca de arte e leitura de postagens](/features/capabilities/tools-and-extensions/danbooru/#art-search-and-post-reading)). |
| Leitura de postagens no Danbooru | - | `danbooru_enabled` | Lê as tags agrupadas de uma postagem do Danbooru a partir de seu ID ou link. |
| Gerar mensagem de voz | `{voice_message_tool}` | chave ElevenLabs + voz da persona + `voice_message_enabled` | Envia uma resposta de voz falada no Discord. |

:::note[Para autores de prompts]
Ao personalizar o prompt do sistema ou as instruções da persona, faça referência às ferramentas usando suas **macros de prompt** da tabela acima em vez de codificar nomes fixos, pois as macros são expandidas para os nomes corretos durante a montagem do contexto e degradam normalmente quando uma ferramenta não está disponível.
`{pin_tool}` e `{timestamp_refresh_tool}` continuam funcionando como aliases de compatibilidade para `{manage_message_tool}` e `{message_metadata_tool}`. As ferramentas de pesquisa na web e URL abaixo também possuem macros: `{web_search_tool}`, `{image_search_tool}`, `{video_search_tool}`, `{news_search_tool}`, `{url_fetch_tool}` e `{url_metadata_tool}`. Elas são resolvidas dinamicamente para o melhor mecanismo disponível, incluindo substituições de MCP do servidor.
:::

### Blocos de prompt condicionais

O texto do prompt compatível com as macros de ferramentas acima também oferece suporte a condicionais delimitadas:

```text
{{if capability:self_teaching}}
Use {memory_tool} when a detail is worth remembering.
{{else}}
Do not promise to save long-term memories.
{{/if}}
```

Use `capability:<name>` para uma configuração ativada do TomoriBot, ou `tool:<function_name>` quando o texto deve aparecer apenas se essa ferramenta exata estiver disponível para o provedor e modelo ativos. Use `tool_family:url_fetch` quando o leitor de URL integrado ou uma substituição MCP do servidor estiver disponível. Prefixe uma condição com `!` para invertê-la. Os blocos podem ser aninhados e conter um `{{else}}`; expressões gerais `and`/`or` não são suportadas.

Os nomes de capacidades suportados são `tool_use`, `self_teaching`, `personal_memories`, `emoji_usage`, `sticker_usage`, `web_search`, `manage_message`, `thread_creation`, `image_generation`, `video_generation`, `voice_message`, `user_blocking`, `short_term_memory` e `time_awareness`.

As condições das ferramentas refletem o suporte do provedor/modelo, a configuração do servidor, os backends configurados, as substituições MCP e a lista de permissões atual do modo de ferramenta deliberada. Elas não ignoram nem preveem verificações de permissões do Discord realizadas quando uma ferramenta é executada. Nomes de capacidades desconhecidos são avaliados como falsos e registrados; blocos malformados são omitidos. Mensagens brutas do chat, saídas do modelo e resultados de ferramentas nunca são tratados como modelos condicionais.
