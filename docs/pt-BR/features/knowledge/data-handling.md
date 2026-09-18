---
title: "Manuseio de Dados"
sidebar:
  order: 4
aiGenerated: true
---

A TomoriBot é construída para ser transparente sobre seus dados. Você pode exportar, importar ou excluir
tudo que ela armazena, e esta página explica exatamente o que é. Para o texto legal,
veja `/legal privacy-policy` e `/legal terms-of-service`.

:::note
Esta página cobre os controles no Discord, por usuário. **Hospedando sua própria instância?**
Backups e restaurações de banco de dados completo são uma operação do lado do host; veja
[Manutenção & Backups](/pt-BR/self-hosting/maintenance/).
:::

## O Que Ela Armazena

**Armazenado:**

- Memórias do servidor e pessoais
- Configurações e dados de persona dela
- Configuração do servidor
- Chaves de API criptografadas

**Não armazenado:**

- Suas mensagens do Discord
- Histórico de chat

**Enviado ao seu provedor de IA:** sempre que ela é acionada, ela busca as **mensagens mais recentes**
no canal mais quaisquer **memórias relevantes** como contexto para o modelo. Ela não monitora
nem lê mensagens fora desses acionamentos.

:::note
O provedor de IA escolhido por você (Google, OpenRouter, NovelAI, …) processa as mensagens sob *suas próprias*
políticas de privacidade. Nunca compartilhe informações pessoais sensíveis com qualquer IA.
:::

## Exporte Seus Dados

Tudo que é exportável é enviado para suas DMs como um arquivo JSON:

- `/export config`: valores de configuração do servidor (sem chaves de API, credenciais ou configurações de provedores).
- `/export personal config`: suas configurações pessoais (perfil, privacidade, aparência, modos de resposta).
- `/export memories`: memórias do servidor, com escopo para a persona principal, uma persona selecionada ou cada persona separadamente.
- `/export personal memories`: suas memórias pessoais, com escopo global, para uma persona ou para cada persona separadamente.
- `/persona export`: definições completas de personas.

## Importe Seus Dados

Anexe um arquivo previamente exportado para restaurá-lo:

- `/import config`: configuração do servidor; requer **Manage Server**. Escolha quais seções detectadas aplicar.
- `/import personal config`: suas configurações pessoais. Escolha quais seções detectadas aplicar.
- `/import memories`: memórias do servidor; requer **Manage Server**. Mesclar ou substituir, e mapear cada persona de origem se o arquivo tiver mais de uma.
- `/import personal memories`: suas memórias pessoais. Mesclar ou substituir, e mapear cada persona de origem se o arquivo tiver mais de uma.
- `/persona import`: restaurar uma persona. Também aceita cards PNG e JSON do SillyTavern e
  arquivos `.charx` Character Card V3, que importam apenas o texto do personagem (veja
  [Suporte ao SillyTavern](/pt-BR/features/integrations/sillytavern-support/)).

## Exclua Seus Dados

Estes removem ou resetam dados permanentemente; **não podem ser desfeitos**:

- `/personal memories`, `/memories`
- `/reset config`: reseta a configuração do servidor em todas as 29 tabelas de configuração para os padrões do banco de dados.
  - **Singletons restaurados para padrões DDL (18 tabelas):** chat configs, model configs, member permissions, capabilities, notice embeds, nsfw configs, speech configs, auto-trigger configs, channel scope configs, trigger behavior configs, NovelAI image generation configs, BYOK configs, memory configs, short-term memory configs, welcome configs, image quota configs, text quota configs e video quota configs.
  - **Configuração preservada (dois conjuntos):** IDs de modelos ativos, credenciais e parâmetros de endpoints personalizados em `server_model_configs` (`llm_id`, `embedding_model_id`, `diffusion_model_id`, `video_model_id`, `vision_llm_id`, `api_key`, `key_version`, `custom_endpoint_url`, `custom_model_name`, `custom_num_ctx`, `other_model_codename`, `other_model_capabilities`, `other_model_capabilities_fetched_at`), além da identidade do modelo de difusão NovelAI ativo (`nai_diffusion_model_id` em `server_novelai_imagegen_configs`).
  - **Coleções limpas (11 tabelas):** `server_auto_trigger_persona_overrides`, `stm_categories`, `random_triggers`, `channel_llm_overrides`, `channel_prompt_overrides`, `channel_context_notes`, `personalization_blacklist`, `persona_user_blocks`, `channel_whitelist`, `role_whitelist` e `channel_persona_whitelist`.
  - **Domínios preservados:** Personas e configurações de personas, memórias do servidor, memórias de curto prazo, expressões (emojis e figurinhas), consumo de cota registrado, configurações salvas de provedores e integrações externas (Matrix e MCP).
  - **Contexto e permissões:** Requer permissão Manage Server em guildas. Suportado em mensagens diretas (DMs) usando o snowflake do workspace do usuário invocador.
- `/reset personal config`: reseta a configuração do usuário e destaques pessoais de canal em todos os servidores para os padrões do banco de dados.
  - **Campos resetados:** Restaura `users.language_pref` ('en-US') e `users.privacy_level` (0), restaura todas as 13 colunas em `user_personalization_configs` (nickname, cross-server opt-in, appearance tags, character reference URL, impersonation prompt, personal DTM, deliberate tool mode, timezone offset, prefix/suffix overrides, gender identity, pronouns, addressing style) para os padrões do esquema, e exclui todos os `user_persona_naming_preferences`.
  - **Coleções limpas:** Exclui todos os `personal_spotlights` do usuário em todos os workspaces, com cascata para `personal_spotlight_personas`.
  - **Domínios pessoais preservados:** Identidade da conta do usuário, locale de registro, memórias pessoais, configurações salvas de provedores (`user_saved_provider_configs`), endpoints personalizados e tarefas/lembretes agendados.
  - **Contexto:** Disponível para todos os usuários tanto em guildas quanto em DMs.

## Optando por Sair

- `/personal config`: controlar sua visibilidade para ela, até invisibilidade total (optar por sair dos
  recursos de memória inteiramente).
- `/config` > Permissions: administradores do servidor podem desativar o autoaprendizado e outros recursos.

Veja [Memória](/pt-BR/features/knowledge/memory/) para saber como as memórias funcionam no dia a dia.
