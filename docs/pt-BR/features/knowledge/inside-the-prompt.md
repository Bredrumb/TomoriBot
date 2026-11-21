---
title: "Por Dentro do Prompt"
sidebar:
  order: 2
aiGenerated: false
---

A TomoriBot agrupa instruções e memórias acima da conversa e, em seguida, posiciona informações dinâmicas perto das mensagens mais recentes. O [NovelAI](/features/integrations/novelai/) usa um layout separado, e as [predefinições do SillyTavern](/features/integrations/sillytavern-support/) podem reorganizar os blocos anteriores.
[Macros de prompt](/features/prompt-macros/) inserem nomes atuais e referências de ferramentas em
instruções salvas.

| Posição | O que a TomoriBot recebe | Onde gerenciar |
|---|---|---|
| Parte do sistema | Prompts de sistema, canal e persona; atributos da persona; orientações de ferramentas; informações do servidor; restrições entre persona e usuário; memórias do servidor; emojis, figurinhas e sprites; entradas de lorebook Always On; condicionamento. | `/config`, `/memories`, `/moderation`, `/expressions` e `/conditioning` |
| Acima da conversa | Perfis de participantes, apelidos, memórias pessoais, lembretes e tarefas da persona; memória de curto prazo mais antiga do mesmo canal em sua posição padrão; definições de ferramentas de texto quando necessárias. | `/personal memories`, `/memories` e `/config` |
| Exemplos e conversa | Diálogos de exemplo, seguidos pelas mensagens recentes deste canal. | `/config` > `Persona` > `Identidade e Personalidade`; `Comportamento` > `Comportamento Geral` |
| Logo acima dos quatro turnos de fala mais recentes | Memória de curto prazo recente ou que contém conteúdo de outros canais, entradas de lorebook ativadas por palavras-chave ou chance, documentos recuperados, presença de participantes e a hora atual com a linha do canal. | `/memories` e `/config` |
| Entre as mensagens recentes | Notas de contexto na profundidade escolhida, além de lembretes de ferramentas e percepção de tempo. | `/config` > `Comportamento` > `Comportamento Geral`; `Persona` > `Avançado`; `Canais` > `Substituições de Canal` |

Um turno de fala agrupa mensagens consecutivas de uma pessoa ou persona. Quatro turnos de fala podem conter muitas mensagens. Em uma conversa curta, a TomoriBot faz a contagem incluindo diálogos de exemplo adjacentes, quando disponíveis. A memória de curto prazo pode ficar mais próxima da mensagem mais recente se você configurou uma profundidade menor. Blocos opcionais vazios não consomem tokens.

Mensagens recentes crescem dentro de um intervalo e depois descartam mensagens mais antigas em lote. O lote corresponde a 30% do seu limite de mensagens, arredondado para baixo para um número par. Com o limite padrão de 80, o lote é 24: uma janela cheia mantém sua mensagem inicial enquanto novas mensagens chegam e avança 24 mensagens quando ultrapassaria 80. Uma troca típica de duas mensagens deixa 58 mensagens após esse avanço. Conversas curtas, atualizações e o espaço disponível no modelo podem deixar menos mensagens.

Uma nota de contexto colocada antes do grupo de informações dinâmicas se desloca pelo histórico mais antigo a cada resposta do bot, tornando o cache de prompt menos eficiente. Mantê-la perto da mensagem mais recente evita essa interrupção extra no cache.

:::tip
Alguns modelos usam informações próximas ao início ou final de um prompt longo de forma mais confiável do que informações no meio. Para provedores que usam notas de contexto, tente colocar uma instrução perto da mensagem mais recente. O efeito depende do modelo e da tarefa. Consulte [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/) e [Lost in the Haystack](https://arxiv.org/abs/2505.18148).
:::

### Inspecionando o prompt
<!-- anchor: inspecting-the-prompt -->

- `/tool prompt snapshot` salva o prompt após o ajuste para caber no modelo. O cartão de download informa
  o que foi cortado.
- `/context` mostra uma divisão visual do uso do contexto e do custo estimado de entrada.
- `/tool estimate cost` detalha o prompt por tamanho e custo.

### Ajuste de contexto
<!-- anchor: context-fitting -->

O limite de mensagens define até onde a TomoriBot olha para trás. O ajuste começa com o histórico selecionado dentro
desse limite. Para a maioria dos provedores, o orçamento de entrada é o que resta da janela de contexto do modelo após
reservar espaço para a resposta e considerar a margem de erro de estimativa. Em 150%, o prompt precisa de uma vez e
meia esse orçamento de entrada antes de cortar.

Quando a estimativa excede esse orçamento, a TomoriBot descarta as trocas de chat mais antigas em lotes e
mantém a solicitação mais recente. Conteúdo fixo, como instruções e diálogos de exemplo, pode deixar o
prompt acima do orçamento depois que todas as trocas elegíveis forem removidas. A TomoriBot ajusta o texto primeiro. Quando os esquemas de
ferramentas são incluídos em uma inspeção, o aviso de ajuste também verifica o tamanho estimado deles.
O provedor aplica seu próprio modelo de chat e contagem de tokens. Ele pode cortar mais contexto ou rejeitar
uma solicitação acima do limite.

O NovelAI conta os tokens a partir de seu prompt renderizado e limita a memória separadamente. Ele pode cortar diálogos de
exemplo, memórias e turnos de chat mais antigos e, em seguida, reduzir o limite da resposta. Os detalhes de inspeção e exportação
estão em [Prompt Snapshot](/architecture/subsystems/prompt-snapshot/).

### Onde as Ferramentas são definidas?

Para provedores com suporte a chamadas de ferramentas, o TomoriBot envia as definições de ferramentas pela interface compatível do provedor.

### Por que a TomoriBot esquece?

| O que aconteceu | Por que |
|---|---|
| Ela esqueceu algo de hoje cedo | Ultrapassou o limite de mensagens sem ser salvo como memória de longo prazo. |
| Ela esqueceu algo em outro canal | Mensagens recentes são específicas por canal. Memórias do servidor, memórias de participantes e memória de curto prazo fornecem informações selecionadas de outros canais. |
| `/refresh` a fez esquecer | O refresh interrompe as mensagens recentes e limpa a memória de curto prazo deste canal, mas não deve remover a memória de longo prazo. Exclua o embed de refresh para remover o corte. |

Se você deseja que algo sobreviva a todos os itens acima, isso deve se tornar uma memória de longo prazo. Consulte [Memória](/pt-BR/features/knowledge/memory/long-term-memory/).

## Dicas e Truques

- `/config` > Comportamento > Comportamento Geral amplia a janela de conversa (20-100 mensagens). Mais
  contexto, mais tokens por resposta.
- `/config` > Comportamento > Comportamento Geral injeta um lembrete curto em uma profundidade escolhida. Como ele fica
  baixo no pacote, próximo às mensagens recentes, ela é mais propensa a agir sobre ele do que sobre
  algo no prompt de sistema. Este é o melhor lugar para incentivá-la a salvar memórias
  com mais frequência.
- `/personal memories` e `/memories` escrevem diretamente nas Memórias do servidor e
  nos Participantes da Conversa, o que é uma das formas garantidas de tornar o conhecimento permanente no contexto da TomoriBot.
