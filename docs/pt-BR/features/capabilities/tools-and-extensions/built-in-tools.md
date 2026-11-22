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

### Blocos de prompt condicionais
<!-- anchor: conditional-prompt-blocks -->

Use [macros de ferramentas](/features/prompt-macros/#tool-macros) para inserir nomes de funções em
instruções salvas. Use [blocos condicionais](/features/prompt-macros/#conditional-prompt-blocks)
para incluir essas instruções apenas quando uma ferramenta ou capacidade estiver disponível.
