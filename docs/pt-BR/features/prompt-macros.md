---
title: "Macros de Prompt"
sidebar:
  order: 5.5
---

As macros de prompt inserem nomes atuais, ferramentas disponíveis e outros valores quando a TomoriBot prepara uma
resposta. Use um bloco condicional para incluir uma instrução apenas quando ela se aplicar.

## Macros de Nome
<!-- anchor: names -->

Use macros de nome em prompts salvos, atributos, diálogos de exemplo, lorebooks e memórias.
Em uma nota de contexto, use `{@userId}`.

| Macro | O que insere | Exemplo |
| --- | --- | --- |
| `{bot}`, `{char}` | O nome da persona ativa. | `You are {char}.` vira `You are Lilya.` quando Lilya está ativa. |
| `{user}` | A pessoa que acionou a resposta. Em prompts compartilhados, atributos, lorebooks e memórias do servidor, vira `User`. Em uma memória pessoal, nomeia a pessoa que a memória descreve. | Em um diálogo de exemplo, `Hi, {user}!` vira `Hi, Mirri!` quando Mirri aciona a resposta. |
| `{user_formatted}` | O nome do usuário que acionou com o prefixo e sufixo que a persona ativa usa. | A predefinição em inglês de Lilya muda `Hi, {user_formatted}!` para `Hi, Mirri-senpai!` para Mirri. |
| `{user_term}` | O termo de tratamento da persona ativa para o usuário que acionou. | A predefinição em inglês de Rose usa `fam` (neutro), `bro` (masculino) ou `sis` (feminino). |
| `{@123456789012345678}` | O apelido do usuário do Discord com esse ID, mesmo quando outra pessoa acionou a resposta. | Com `Navigator` salvo como apelido, `Ask {@123456789012345678}.` vira `Ask Navigator.` |

Macros nomeadas aceitam chaves simples ou duplas e ignoram maiúsculas e minúsculas. Por exemplo, `{{char}}` e `{CHAR}`
funcionam. Em um prompt compartilhado de sistema ou de persona, use `{user_formatted}` ou `{user_term}` para se referir
à pessoa que acionou a resposta. Essas duas macros permanecem como escritas em preenchimentos de resposta.
Defina um termo de tratamento neutro em `Hábitos de Nomenclatura` da persona antes de usar `{user_term}` em seu texto.

### Referir-se a um usuário específico do Discord
<!-- anchor: refer-to-a-specific-discord-user -->

Ative o `Modo de Desenvolvedor` e copie o ID de usuário da pessoa. Veja o
[guia do Discord para copiar IDs](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID).
Coloque o número depois de `@` dentro de chaves simples, como em
`Treat {@123456789012345678} as the ship's navigator.`

A TomoriBot usa o apelido da pessoa para a persona ativa, depois o apelido global em
`/personal config` > `Perfil` e, por fim, o nome de usuário do Discord. Se o servidor desativar memórias
pessoais, se a pessoa estiver na lista negra ou se a privacidade estiver definida como `Completo`, ela usa o nome de
usuário do Discord. Se não conseguir resolver um nome, a macro permanece como escrita.

O chat ao vivo mantém a macro como escrita, incluindo mensagens citadas literalmente na memória de curto prazo ou
copiadas para uma predefinição com `{{input}}` ou `{{lastChatMessage}}`. Um atributo compartilhado pelo perfil
público de uma persona também a mantém como escrita quando outra persona o lê.

### Menções e links do Discord

Menções de usuário (`<@userId>` e `<@!userId>`) usam o apelido global salvo da pessoa quando as memórias
pessoais estão ativadas. Elas recorrem ao apelido do servidor ou nome de usuário, inclusive para usuários
na lista negra. Use `{@userId}` para resolver um apelido específico da persona.

Uma menção de canal (`<#channelId>`) ou um link de canal ou mensagem do Discord fornece um rótulo de
canal legível quando a TomoriBot consegue resolver o canal. Uma menção de cargo (`<@&roleId>`) vira um
nome como `@Raid Guides` se o cargo existir no servidor atual. Menções de cargo não resolvidas
permanecem como escritas.

## Escolhas aleatórias

Use `{{random: north, south}}` ou `{{random::north::south}}` para escolher uma opção durante a montagem do
prompt. A forma com dois pontos duplos pode incluir vírgulas dentro de uma opção. Ambas as formas também aceitam
chaves simples.

## Macros de ferramentas
<!-- anchor: tool-macros -->

Use uma macro de ferramenta para inserir o nome da função disponível para o provedor e modelo atuais.
Uma macro integrada sem ferramenta disponível se expande para `an unavailable tool`. Coloque a instrução em
um [bloco condicional](#conditional-prompt-blocks) para omiti-la quando a ferramenta estiver indisponível.
Para saber o que cada ferramenta faz e quais configurações a ativam, consulte
[Ferramentas integradas](/features/capabilities/tools-and-extensions/built-in-tools/).

### Macros de ferramentas integradas

| Macro | Nome da função para condições `tool:` | Exemplo de instrução permanente |
| --- | --- | --- |
| `{capabilities_tool}` | `review_capabilities` | `Use {capabilities_tool} to check what you can do here before promising a feature such as stickers or voice messages.` |
| `{memory_tool}` | `create_long_term_memory` | `Save lasting member preferences, such as favorite party games, with {memory_tool} so you can use them in future chats.` |
| `{memory_update_tool}` | `update_long_term_memory` | `Use {memory_update_tool} to revise the existing memory when a member corrects a saved preference or a moderator changes a recurring event.` |
| `{short_term_memory_tool}` | `update_short_term_memory` | `At roleplay scene breaks, use {short_term_memory_tool} to record where the party stopped, what clues they found, and what they plan to do next.` |
| `{task_tool}` | `create_task` | `Schedule game-night and poll reminders with {task_tool} when members request them. Confirm the scheduled time afterward.` |
| `{task_update_tool}` | `update_task` | `Use {task_update_tool} to reschedule the existing reminder when a member changes its time or repeat schedule.` |
| `{cross_channel_tool}` | `cross_channel_message` | `When asked to publish event results, post them in #announcements with {cross_channel_tool} and report back here.` |
| `{create_thread_tool}` | `create_thread` | `When members explicitly ask for a spoiler discussion thread, use {create_thread_tool} and open with a question about the episode.` |
| `{sticker_tool}` | `select_sticker_for_response` | `Celebrate raid clears with {sticker_tool} when the server has a sticker that fits the moment.` |
| `{manage_message_tool}`, `{pin_tool}` | `manage_message` | `Pin guides and event recaps with {manage_message_tool} when a moderator asks.` |
| `{message_interaction_tool}` | `interact_with_recent_message` | `Use {message_interaction_tool} to react with 🎉 to new tournament result announcements.` |
| `{conditioning_interaction_tool}` | `interact_with_target` | `Use {conditioning_interaction_tool} for requested victory hugs after major wins.` |
| `{profile_picture_tool}` | `peek_profile_picture` | `When members ask for avatar feedback, inspect the avatar with {profile_picture_tool} before commenting on the design.` |
| `{document_tool}` | `read_file` | `Use {document_tool} to read attached rules PDFs before answering questions about scoring or eligibility.` |
| `{message_metadata_tool}`, `{timestamp_refresh_tool}` | `reveal_message_metadata` | `Use {message_metadata_tool} when members ask for the exact send time or reactions on a recent poll or announcement.` |
| `{gif_tool}` | `process_gif` | `Use {gif_tool} to inspect an attached reaction GIF when its motion matters to the conversation.` Disponível apenas em desenvolvimento. |
| `{youtube_tool}` | `process_youtube_video` | `Use {youtube_tool} when members ask about a specific move shown in a linked YouTube guide.` |
| `{image_analysis_tool}` | `analyze_image` | `When helping with an error screenshot, read the visible error with {image_analysis_tool} before suggesting a fix.` |
| `{image_generation_tool}` | `generate_image` | `For requested event banners, use {image_generation_tool} and leave room for the event title.` |
| `{anime_image_generation_tool}` | `generate_image_nai` | `Use {anime_image_generation_tool} for requested anime-style roleplay art. Keep the characters' established outfits.` |
| `{tag_search_tool}` | `danbooru_search_tags` | `Resolve character nicknames and alternate spellings with {tag_search_tool} before searching for fan art.` |
| `{booru_post_search_tool}` | `danbooru_search_posts` | `When members ask to browse existing anime fan art, post a small selection with {booru_post_search_tool}.` |
| `{voice_message_tool}` | `generate_voice_message` | `Send quest briefings and dramatic recaps with {voice_message_tool} when players ask to hear them aloud.` |
| `{block_user_tool}` | `block_user` | `Use {block_user_tool} to apply a persona mute when a moderator asks to stop a member from triggering you for a set time.` |
| `{unblock_user_tool}` | `unblock_user` | `Use {unblock_user_tool} to lift a persona mute early when a moderator asks.` |
| `{user_info_tool}` | `update_user_info` | `Save a member's requested nickname or honorific for this persona with {user_info_tool}.` |

`{pin_tool}` e `{timestamp_refresh_tool}` são aliases de compatibilidade.

### Macros de pesquisa e URL

Essas macros podem selecionar uma ferramenta MCP do servidor no lugar da função integrada. Se nenhuma estiver
disponível, elas inserem uma descrição da ferramenta.

| Macro | O que seleciona |
| --- | --- |
| `{web_search_tool}` | Uma ferramenta de pesquisa na web ou a `web_search` integrada. |
| `{image_search_tool}`, `{video_search_tool}`, `{news_search_tool}` | Uma ferramenta de pesquisa para a mídia solicitada, recorrendo à pesquisa na web. |
| `{url_fetch_tool}` | Um leitor de URL ou a `fetch_url` integrada. |
| `{url_metadata_tool}` | Uma ferramenta MCP que pode inspecionar uma URL, ou a `fetch_url` integrada. |

## Blocos de prompt condicionais
<!-- anchor: conditional-prompt-blocks -->

```text
{{if tool:create_long_term_memory}}
Use {memory_tool} to save lasting member preferences for future chats.
{{else}}
Tell the user when you cannot save a long-term memory.
{{/if}}
```

| Condição | Quando seu ramo aparece |
| --- | --- |
| `{{if tool:<function_name>}}` | A ferramenta exata está disponível para o provedor e modelo. |
| `{{if capability:<name>}}` | A capacidade nomeada está ativada. |
| `{{if tool_family:url_fetch}}` | O leitor de URL integrado ou uma substituição MCP do servidor está disponível. |

Prefixe a condição com `!`, como em `{{if !capability:time_awareness}}`, para testar sua
ausência. Use no máximo um `{{else}}` por bloco e feche cada bloco com `{{/if}}`. Aninhe blocos em até
32 níveis. Use blocos aninhados para múltiplos requisitos.

Os nomes de capacidades suportados são `tool_use`, `self_teaching`, `personal_memories`, `emoji_usage`,
`sticker_usage`, `web_search`, `manage_message`, `thread_creation`, `image_generation`,
`video_generation`, `voice_message`, `user_blocking`, `short_term_memory` e `time_awareness`.
`tool_use` é falso quando o modelo ativo não consegue chamar ferramentas.

As condições de ferramentas verificam as ferramentas disponíveis quando o prompt é montado, incluindo restrições
do `Modo de Ferramenta Deliberada`. As permissões do Discord são verificadas quando a ferramenta é executada. Nomes de capacidades
desconhecidos são avaliados como falsos e produzem um aviso. A TomoriBot omite blocos malformados e deixa
as tags condicionais como escritas se o aninhamento exceder o limite.

## Macros de predefinição do SillyTavern
<!-- anchor: sillytavern-preset-macros -->

Essas macros adicionais funcionam dentro dos nós de predefinição do SillyTavern. Os nós de predefinição também aceitam as
macros de identidade, escolha aleatória e ferramentas descritas acima.

| Macro | O que insere |
| --- | --- |
| `{{user}}`, `<USER>` | O membro que acionou a resposta. |
| `{{char}}`, `{{bot}}`, `<BOT>` | O nome da persona ativa. |
| `{{personality}}` | Os atributos da persona. |
| `{{description}}` | O prompt da persona. |
| `{{scenario}}` | Vazio. Cenários de cards importados viram atributos da persona. |
| `{{mesExamples}}` | Diálogos de exemplo. |
| `{{lastChatMessage}}`, `{{input}}` | A mensagem de usuário mais recente no histórico de chat fornecido. |
| `{{time}}`, `{{date}}`, `{{weekday}}` | Hora, data ou dia da semana do servidor em inglês, como `3:45 PM`, `October 28, 2026` ou `Wednesday`. |
| `{{isotime}}`, `{{isodate}}` | Hora do servidor em `HH:mm` ou data em `YYYY-MM-DD`. |
| `{{model}}`, `{{provider}}` | Os IDs configurados do modelo e do provedor. Escolhas do randomizador por turno e modelos de fallback não alteram esses valores. |
| `{{char_version}}` | Vazio. A TomoriBot não armazena versão de card. |
| `{{roll:2d6}}` | A soma de uma rolagem de dados, até 100 dados e 1.000 lados por dado. |
| `{{// notes}}` | Vazio. Use para comentários na predefinição. |
| `{{trim}}` | Remove os espaços em branco iniciais e finais do nó. |
| `{{setvar::key::value}}`, `{{addvar::key::value}}` | Define ou anexa texto a uma variável compartilhada entre os nós da predefinição. |
| `{{getvar::key}}` | O valor da variável, ou vazio se não estiver definida. |

`<USER>` e `<BOT>` são tokens de compatibilidade que diferenciam maiúsculas e minúsculas. As cinco macros de data e hora usam
uma leitura do relógio e o deslocamento UTC fixo do servidor. Altere o deslocamento do servidor quando o horário de
verão mudar. Todas as cinco ficam vazias quando a Consciência de Tempo está desativada. Coloque-as em nós tardios ou
injetados por profundidade para manter o texto anterior elegível para o cache de prompt.

### Condicionais de predefinição
<!-- anchor: preset-conditionals -->

```text
{{#if description}}Follow the character description.{{else}}Use a neutral voice.{{/if}}
{{#unless {{getvar::compact}}}}Include scene details.{{/unless}}
```

Um nome simples como `description` significa `{{description}}`. Você pode colocar uma macro de valor diretamente
na condição, como em `{{#if {{input}}}}`. A TomoriBot ignora maiúsculas/minúsculas e espaços ao redor quando
testa o valor. Texto vazio, `false` e `0` são falsos. Macros de valor não reconhecidas contam como vazias.

Esses blocos podem ser aninhados com [condições de ferramentas e capacidades](#conditional-prompt-blocks).
Feche `#if` com `{{/if}}` e `#unless` com `{{/unless}}`. Um bloco de predefinição não fechado termina ao
final de seu nó. A TomoriBot descarta tags de fechamento soltas e tags `{{else}}` soltas, e omite blocos com
um segundo `{{else}}` ou um fechamento incompatível. O limite de 32 níveis também se aplica a blocos mistos.

As condições de predefinição veem declarações de variáveis anteriores na ordem dos nós, incluindo antes no
mesmo nó. Declarações dentro de um ramo de predefinição ignorado não têm efeito. Um `{{getvar::key}}`
fora de uma condição vê o valor final depois que a TomoriBot visita os nós ativados. Condições de ferramentas e
capacidades são executadas após a atribuição de variáveis.

## Verificar uma macro

Execute `/tool prompt snapshot` para a persona e o canal que você deseja verificar. Abra o arquivo exportado e
procure a instrução renderizada. Use `/context` para ver quais partes do prompt ocupam
espaço. Consulte [Inspecionando o prompt](/features/knowledge/inside-the-prompt/#inspecting-the-prompt).
