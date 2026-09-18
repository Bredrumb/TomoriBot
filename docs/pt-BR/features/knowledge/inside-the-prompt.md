---
title: "Por Dentro do Prompt"
sidebar:
  order: 2
aiGenerated: true
---

Toda vez que você aciona a TomoriBot, o seguinte é montado e enviado ao seu modelo de texto configurado
como o prompt/contexto principal, nesta ordem:

| Bloco | Opcional? | Comandos | O que é |
|---|---|---|---|
| [**Prompt de sistema**](/pt-BR/features/chatting-personality/behavior-tweaking/#system-prompt) | | `/config` > Engine > General | Instruções básicas no topo do contexto. |

> **Texto padrão do prompt de sistema** (usado apenas enquanto nenhum prompt de sistema do servidor estiver definido):
>
> *"You are {bot}. {bot} makes sure to respond short and concisely by default. {bot} only makes lengthy responses if the situation warrants it.
>
> {{if tool:create_long_term_memory}}{bot} proactively uses the available {memory_tool} whenever someone shares a detail or {bot} notices one in the conversation that is actually worth remembering, such as a preference, an interest, or an important fact, preferring to remember things even if it is minor as long as it's not a duplicate of what {bot} already knows. {{/if}}{{if tool:update_long_term_memory}}{bot} uses {memory_update_tool} instead when new information changes or adds onto something {bot} already remembers, rather than saving a duplicate.{{/if}}
>
> {{if tool:review_capabilities}}When someone asks what {bot} can do or why something is unavailable, {bot} checks {capabilities_tool} before answering. {{/if}}{{if tool_family:url_fetch}}When more detail is needed, {bot} uses {url_fetch_tool} on `https://docs.tomoribot.app/llms.txt` for information.{{/if}}"*

| Bloco | Opcional? | Comando | O que é |
|---|---|---|---|
| **Prompt de canal (append)** | *(Opcional)* | `/config` > Channels > Channel Overrides | Varia por canal, inserido logo após o prompt de sistema. O modo *replace* da mesma página assume o slot do prompt de sistema acima em vez de adicionar um novo. |
| **Prompt da persona** | *(Opcional)* | `/config` > Persona > Advanced | Um prompt escrito especificamente para a persona ativa, separado do prompt de sistema. |
| [**Atributos da persona**](/pt-BR/features/chatting-personality/multiple-personas/#attributes) | | `/config` > Persona > Identity & Personality | Os traços de personalidade e padrões de fala da persona ativa. |
| **Informações do servidor** | | *(nenhum, do Discord)* | O nome do servidor, descrição e o canal em que ela está, extraídos diretamente do Discord. |
| [**Bloqueios persona-usuário**](/pt-BR/features/capabilities/tools-and-extensions/#ferramentas-integradas) | *(Opcional)* | `/moderation` para revisar/limpar; controlado por `/config` > Permissions (User Blocking) | Restrições ativas de silenciamento/bloqueio que esta persona mantém contra usuários específicos. |
| [**Memórias do servidor**](/pt-BR/features/knowledge/memory/#memórias-pessoais-vs-do-servidor) | | `/memories` | Os fatos de longo prazo salvos para este servidor. |
| [**Emojis do servidor**](/pt-BR/features/chatting-personality/behavior-tweaking/#capabilities-what-shes-allowed-to-do) | *(Opcional)* | `/config` > Permissions (Emoji Usage) (apenas alternância), inicialize com `/expressions initialize` | Os emojis personalizados presentes no servidor. |
| [**Figurinhas do servidor**](/pt-BR/features/chatting-personality/behavior-tweaking/#capabilities-what-shes-allowed-to-do) | *(Opcional)* | `/config` > Permissions (Sticker Usage) (apenas alternância), inicialize com `/expressions initialize` | As figurinhas personalizadas presentes no servidor. |
| [**Sprites da persona**](/pt-BR/features/chatting-personality/multiple-personas/#sprites-emotion-avatars) | *(Opcional)* | `/config` > Persona > Sprites | Sprites de expressão nomeados configurados para a persona, se houver. |
| [**Participantes da Conversa**](/pt-BR/features/knowledge/memory/#memórias-pessoais-vs-do-servidor) | *(Opcional)* | `/personal memories` (controlado por `/config` > Permissions (Personalization)) | As pessoas na conversa, seus apelidos e handles de menção, e as memórias pessoais salvas sobre cada uma delas. Carregado quando a pessoa possui uma mensagem no contexto, ou se seu nome/alias é mencionado. Também traz o canal atual e a hora local como rodapé, usando `/config` > Engine > General. |
| [**Memória de curto prazo**](/pt-BR/features/knowledge/memory/#memória-de-curto-prazo-stm) | | `/config` > Persona > Memories; `/memories` para limpar entradas; controlado por `/config` > Permissions (Short-Term Memory) | Contém resumos e mensagens recentes de diferentes canais |
| [**Documentos**](/pt-BR/features/knowledge/memory/#base-de-conhecimento-de-documentos-rag) | *(Opcional)* | `/memories` | Fragmentos relevantes extraídos da base de conhecimento usando RAG. |
| [**Condicionamento**](/pt-BR/features/knowledge/memory/#condicionamento) | *(Opcional)* | `/reward <feed\|headpat\|hug\|kiss\|tickle>`, `/punish <bite\|bonk\|pinch\|spank\|squeeze>`, gerenciado via `/conditioning remove` | Empurrões comportamentais acumulados para esta persona neste servidor. |
| [**Diálogos de exemplo**](/pt-BR/features/chatting-personality/multiple-personas/#sample-dialogues) | *(Opcional)* | `/config` > Persona > Identity & Personality | Exemplos de como esta persona fala, se houver configurados. |
| [**Mensagens recentes**](/pt-BR/features/chatting-personality/behavior-tweaking/#generation-tuning) | | `/config` > Engine > General | A conversa real, até essa quantidade de mensagens (padrão 80). Sua nota de contexto e qualquer nota de reencontro são injetadas inline dentro deste bloco, em uma profundidade configurável, em vez de um bloco separado. |

Linhas marcadas com *(Opcional)* não contribuem com nada (e não custam tokens) quando não há nada a informar, ex.: nenhum documento correspondeu, ou o servidor não possui emojis personalizados.

As mensagens recentes são a parte maior e mais frágil; é uma janela que avança conforme as pessoas conversam. Tudo acima delas é reconstruído a partir de configurações salvas e é estável.

`/tool prompt snapshot` exporta o pacote exato de uma persona para um arquivo. É a fonte da verdade para quais memórias estão ativas no momento, se algum documento correspondeu e quanto da conversa realmente coube.

`/tool estimate cost` detalha o mesmo pacote por tamanho, o que é útil para descobrir o que está consumindo seu contexto antes de aumentar qualquer limite.

### Onde as Ferramentas são definidas?

Para todo
provedor que a TomoriBot suporta nativamente, os esquemas de ferramentas são enviados através do campo `tools` do próprio provedor, então depende do provedor/engine de inferência configurado.

### Por que a TomoriBot esquece?

Essa ordenação explica quase toda pergunta de "por que ela não lembra?":

| O que aconteceu | Por quê |
|---|---|
| Ela esqueceu algo de hoje mais cedo | Passou do limite de mensagens. Estava apenas nas **Mensagens recentes**: se a Tomori não salvar como memória de longo prazo, será esquecido assim que sair da janela de mensagens. |
| Ela esqueceu algo em outro canal | **Mensagens recentes** é por canal. Apenas **Memórias do servidor**, **Participantes da Conversa** e **Memória de curto prazo** cruzam canais. A memória de curto prazo resolve isso carregando mensagens recentes de diferentes canais, mas não despeja tudo. |
| `/refresh` fez ela esquecer | Refresh corta as **Mensagens recentes** e limpa a **Memória de curto prazo** deste canal, mas não deve remover memórias de longo prazo. Exclua o embed de refresh para remover o corte. |
| Ela esqueceu algo após um reinício | **Mensagens recentes** nunca sobrevive a reinícios |

Se você quer que algo sobreviva a tudo isso, precisa se tornar uma **memória de longo prazo**. Veja [Memória](/pt-BR/features/knowledge/memory/#memória-de-longo-prazo).

## Dicas e Truques

- `/config` > Engine > General amplia a janela de conversa (20-100 mensagens). Mais
  contexto, mais tokens por resposta.
- `/config` > Engine > General injeta um lembrete curto em uma profundidade escolhida. Como ele fica
  baixo no pacote, próximo às mensagens recentes, ela é mais propensa a agir sobre ele do que sobre
  algo no prompt de sistema. Este é o melhor lugar para incentivá-la a salvar memórias
  com mais frequência.
- `/personal memories` e `/memories` escrevem diretamente nas **Memórias do servidor** e
  nos **Participantes da Conversa**, o que é uma das formas garantidas de tornar o conhecimento permanente no contexto da TomoriBot.
