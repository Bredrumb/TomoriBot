---
title: "Por Dentro do Prompt"
sidebar:
  order: 2
aiGenerated: false
---

A TomoriBot agrupa instruções e memórias acima da conversa e, em seguida, posiciona informações dinâmicas perto das mensagens mais recentes. O [NovelAI](/features/integrations/novelai/) usa um layout separado, e as [predefinições do SillyTavern](/features/integrations/sillytavern-support/) podem reorganizar os blocos anteriores.

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

`/tool prompt snapshot` despeja o pacote exato de uma persona em um arquivo. É a verdade básica para quais memórias estão atualmente ativas, se um documento corresponde e quanto da conversa realmente cabe.

`/context` desenha o mesmo pacote que uma grade colorida da janela de contexto do modelo, uma cor por grupo de blocos acima, para que você possa ver rapidamente o que o preenche e quanto espaço resta. Um círculo marca um grupo menor que um quadrado. Também mostra o custo estimado de entrada por resposta e quantos tokens de entrada o provedor relatou para a última resposta real.

`/tool estimate cost` divide o mesmo pacote por tamanho, o que é útil para descobrir o que está consumindo seu contexto antes de aumentar qualquer limite.

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
