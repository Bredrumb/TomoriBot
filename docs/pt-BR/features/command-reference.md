---
title: "Referência de Comandos"
sidebar:
  order: 6
---

<!--
  GENERATED FILE: do not edit by hand.
  Run `bun run generate-command-reference` from the repository root.
-->

Todos os comandos de barra (slash commands) atualmente registrados pela TomoriBot, gerados a partir dos mesmos construtores de comando e descrições em inglês usados para o registro no Discord.

Grupos de comandos de nível superior: **39**. Comandos de barra executáveis: **81**.

## `/comment`

Enviar um embed de comentário visível no chat mas invisível no contexto.

| Comando | Resumo |
|---|---|
| `/comment` | Enviar um embed de comentário visível no chat mas invisível no contexto. |

## `/compact`

Resumir a conversa recente em uma memória compacta do sistema.

| Comando | Resumo |
|---|---|
| `/compact` | Resumir a conversa recente em uma memória compacta do sistema. |

## `/conditioning`

Gerenciar memórias persistentes de condicionamento de recompensa e punição.

| Comando | Resumo |
|---|---|
| `/conditioning manage` | Gerenciar histórico de condicionamento injetado em todas as personas neste servidor. |
| `/conditioning remove` | Remover entradas de condicionamento de todas as personas neste servidor. |

## `/config`

Configurar persona, comportamento, canal, permissão e configurações de modelo.

| Comando | Resumo |
|---|---|
| `/config` | Configurar persona, comportamento, canal, permissão e configurações de modelo. |

## `/contribute`

Encontrar o código-fonte e formas de ajudar a construir a TomoriBot.

| Comando | Resumo |
|---|---|
| `/contribute github` | Obter o link do repositório no GitHub e aprender como contribuir para a TomoriBot. |

## `/donate`

Apoiar o desenvolvimento e custos de hospedagem da TomoriBot.

| Comando | Resumo |
|---|---|
| `/donate kofi` | Apoiar o desenvolvimento da TomoriBot através de doações no Ko-fi. |

## `/export`

Exportar sua configuração ou memórias como um arquivo portátil.

| Comando | Resumo |
|---|---|
| `/export config` | Exportar a configuração deste servidor como um arquivo portátil. |
| `/export memories` | Exportar memórias como um arquivo portátil. |
| `/export personal config` | Exportar sua configuração pessoal como um arquivo portátil. |
| `/export personal memories` | Exportar as memórias que sua conta possui como um arquivo portátil. |

## `/expressions`

Ensinar à TomoriBot quando usar os emojis e figurinhas personalizados deste servidor.

| Comando | Resumo |
|---|---|
| `/expressions edit` | Editar a emoção e instruções de uso de um emoji ou figurinha individual |
| `/expressions initialize` | Analisar e classificar todos os emojis e figurinhas personalizados usando visão de IA |

## `/generate`

Gerar imagens, vídeos e mensagens de voz com IA.

| Comando | Resumo |
|---|---|
| `/generate image` | Gerar uma imagem de IA a partir do seu próprio prompt ou da cena atual do canal |
| `/generate scene` | Gerar uma cena curta com roteiro entre personas selecionadas. |
| `/generate video` | Gerar um vídeo de IA usando Google Veo, OpenRouter ou Z.ai |
| `/generate voice-message` | Falar uma mensagem com uma voz que você escolher |

## `/help`

Navegar por guias de configuração, recursos, provedores, memória, comportamento, ferramentas, mídia e integrações.

| Comando | Resumo |
|---|---|
| `/help` | Navegar por guias de configuração, recursos, provedores, memória, comportamento, ferramentas, mídia e integrações. |

## `/impersonate`

Personificar personas, usuários ou injetar prompts de sistema.

| Comando | Resumo |
|---|---|
| `/impersonate persona` | Enviar uma mensagem como uma das personas deste servidor. |
| `/impersonate system` | Injetar uma mensagem de sistema no contexto da conversa. |
| `/impersonate user` | Fazer o bot escrever e enviar uma mensagem como se fosse aquele membro. |

## `/import`

Importar configuração ou memórias de um arquivo portátil.

| Comando | Resumo |
|---|---|
| `/import config` | Importar um arquivo de configuração do servidor. |
| `/import memories` | Importar um arquivo de memórias do servidor. |
| `/import personal config` | Importar um arquivo de configuração pessoal. |
| `/import personal memories` | Importar um arquivo de memórias pessoais. |

## `/kill`

Parar imediatamente o stream atual e limpar respostas enfileiradas neste canal.

| Comando | Resumo |
|---|---|
| `/kill` | Parar imediatamente o stream atual e limpar respostas enfileiradas neste canal. |

## `/learn`

Aprender, extrair e incorporar histórico de conversas na memória.

| Comando | Resumo |
|---|---|
| `/learn history` | Extrair conhecimento do histórico de mensagens deste canal usando IA. |

## `/legal`

Ver os termos de serviço, política de privacidade e licença da TomoriBot.

| Comando | Resumo |
|---|---|
| `/legal license` | Ver a licença de código aberto da TomoriBot |
| `/legal privacy-policy` | Ver a Política de Privacidade da TomoriBot |
| `/legal terms-of-service` | Ver os Termos de Serviço da TomoriBot |

## `/matrix`

Vincular canais do Discord a salas do Matrix para retransmissão bidirecional.

| Comando | Resumo |
|---|---|
| `/matrix link` | Vincular um canal do Discord a uma sala do Matrix para retransmissão bidirecional |
| `/matrix unlink` | Remover a ponte do Matrix de um canal do Discord |

## `/memories`

Inspecionar e gerenciar memórias do servidor, documentos e memória de curto prazo.

| Comando | Resumo |
|---|---|
| `/memories` | Inspecionar e gerenciar memórias do servidor, documentos e memória de curto prazo. |

## `/model`

Gerenciar os modelos de IA padrão deste servidor.

| Comando | Resumo |
|---|---|
| `/model override remove` | Remover substituições de modelo de canal e persona. |

## `/moderation`

Gerenciar permissões de membros, lista negra, lista de permissões de canais e cargos, e configurações de cota.

| Comando | Resumo |
|---|---|
| `/moderation` | Gerenciar permissões de membros, lista negra, lista de permissões de canais e cargos, e configurações de cota. |

## `/novelai`

Configurar geração de texto e imagem do NovelAI para este servidor.

| Comando | Resumo |
|---|---|
| `/novelai generate image` | Gerar uma imagem NovelAI usando tags no estilo imageboard e uma referência de personagem opcional. |
| `/novelai usage` | Mostrar o medidor de uso de geração NovelAI Opus deste servidor (Gerenciar Servidor necessário). |

## `/nsfw`

Comandos e configurações com restrição de idade.

| Comando | Resumo |
|---|---|
| `/nsfw jailbreaks` | Gerenciar comportamentos opcionais de jailbreak para meus prompts neste servidor. |

## `/nuke`

Apagar completamente todos os dados do servidor. Requer re-executar /setup depois.

| Comando | Resumo |
|---|---|
| `/nuke` | Apagar completamente todos os dados do servidor. Requer re-executar /setup depois. |

## `/persona`

Gerenciar predefinições de personalidade

| Comando | Resumo |
|---|---|
| `/persona create` | Criar uma predefinição de personalidade simples manualmente |
| `/persona default` | Aplicar uma configuração de personalidade predefinida |
| `/persona export` | Exportar a personalidade atual como um arquivo PNG compartilhável |
| `/persona generate` | Geração de personalidade com IA (requer um provedor compatível) |
| `/persona import` | Importar uma persona de um arquivo PNG, JSON ou CHARX |
| `/persona remove` | Remover uma persona alter do servidor |

## `/personal`

Gerenciar suas configurações pessoais

| Comando | Resumo |
|---|---|
| `/personal config` | Gerenciar suas preferências pessoais, privacidade, modelos e perfil. |
| `/personal language` | Escolha o idioma em que a TomoriBot fala com você. |
| `/personal memories` | Gerenciar suas memórias pessoais de longo prazo e contexto conversacional de curto prazo. |
| `/personal nuke` | Apagar tudo que a TomoriBot armazena sobre você, em todos os servidores. |
| `/personal providers` | Gerenciar suas credenciais de provedores pessoais, endpoints e catálogos de modelos. |

## `/ping`

Verificar a latência do bot.

| Comando | Resumo |
|---|---|
| `/ping` | Verificar a latência do bot. |

## `/providers`

Adicionar, visualizar, editar e remover credenciais de provedores, endpoints e catálogos de modelos.

| Comando | Resumo |
|---|---|
| `/providers` | Adicionar, visualizar, editar e remover credenciais de provedores, endpoints e catálogos de modelos. |

## `/punish`

Me punir com interações brincalhonas.

| Comando | Resumo |
|---|---|
| `/punish bite` | Me dê uma mordidinha brincalhona! |
| `/punish bonk` | Me dê um bonk na cabeça! |
| `/punish pinch` | Me dê um beliscão! |
| `/punish spank` | Me dê uma palmadinha brincalhona! |
| `/punish squeeze` | Me dê um apertão! |

## `/quota`

Gerenciar redefinições de cota de geração.

| Comando | Resumo |
|---|---|
| `/quota reset global` | Redefinir o pool de cota de geração de todo o servidor. |
| `/quota reset user` | Redefinir o uso diário de cota de um usuário. |

## `/refresh`

Limpar o histórico de conversa (somente neste canal).

| Comando | Resumo |
|---|---|
| `/refresh` | Limpar o histórico de conversa (somente neste canal). |

## `/reset`

Redefinir a configuração do servidor ou pessoal para os padrões.

| Comando | Resumo |
|---|---|
| `/reset config` | Redefinir a configuração deste servidor para os padrões do banco de dados. |
| `/reset personal config` | Redefinir sua configuração pessoal para os padrões do banco de dados. |

## `/respond`

Acionar manualmente resposta à última mensagem neste canal.

| Comando | Resumo |
|---|---|
| `/respond` | Acionar manualmente resposta à última mensagem neste canal. |

## `/reward`

Me recompensar com interações divertidas.

| Comando | Resumo |
|---|---|
| `/reward feed` | Me dê um lanchinho delicioso! |
| `/reward headpat` | Me faça um carinho na cabeça! |
| `/reward hug` | Me dê um abraço! |
| `/reward kiss` | Me dê um beijo! |
| `/reward tickle` | Me faça cócegas! |

## `/scheduled-task`

Gerenciar tarefas agendadas e lembretes.

| Comando | Resumo |
|---|---|
| `/scheduled-task edit` | Editar uma tarefa agendada ou lembrete. |
| `/scheduled-task remove` | Remover uma tarefa agendada ou lembrete. |

## `/setup`

Iniciar o processo de configuração inicial. Configurar provedor de IA e personalidade.

| Comando | Resumo |
|---|---|
| `/setup` | Iniciar o processo de configuração inicial. Configurar provedor de IA e personalidade. |

## `/stats`

Ver estatísticas de uso

| Comando | Resumo |
|---|---|
| `/stats generate` | Gerar um cartão de imagem de estatísticas compartilhável. |
| `/stats persona` | Ver as estatísticas de uso de uma persona neste servidor. |
| `/stats personal` | Ver suas próprias estatísticas de uso. |
| `/stats server` | Ver estatísticas de uso de todo o servidor. |

## `/status`

Mostrar o status atual pessoal, do servidor ou da persona.

| Comando | Resumo |
|---|---|
| `/status` | Mostrar o status atual pessoal, do servidor ou da persona. |

## `/support`

Obter ajuda, relatar bugs e entrar na comunidade da TomoriBot.

| Comando | Resumo |
|---|---|
| `/support discord` | Obter o link oficial do servidor Discord para relatos de bugs, feedback e chat da comunidade. |

## `/tool`

Ações utilitárias para contexto de conversa, prompts e diagnósticos.

| Comando | Resumo |
|---|---|
| `/tool delete turn` | Excluir o último turno da persona do canal. |
| `/tool estimate cost` | Estimar custos de API para provedores de IA pagos |
| `/tool prompt snapshot` | Exportar o prompt LLM exato de uma persona para um arquivo para depuração. |

## `/update`

Ver as notas de lançamento mais recentes da TomoriBot

| Comando | Resumo |
|---|---|
| `/update` | Ver as notas de lançamento mais recentes da TomoriBot |
