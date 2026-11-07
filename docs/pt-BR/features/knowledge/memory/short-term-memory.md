---
title: "Memória de curto prazo"
sidebar:
  order: 5
aiGenerated: false
---

A TomoriBot lê mensagens recentes no canal ativo. A memória de curto prazo (STM) expande isso ao manter um contexto de trabalho temporário:

- **Contexto do canal:** Reforça o tópico ou a situação em andamento no canal atual.
- **Contexto entre canais:** Recorda conversas recentes de outros canais, e entre servidores quando a recordação entre servidores estiver ativada.

Ela só se lembra de conversas das quais participou. Ela atualiza o resumo de um canal quando responde, e em nenhum outro momento, portanto um canal movimentado onde ninguém fala com ela não deixa memória. A memória de curto prazo de cada canal expira após 24 horas por padrão. Se você optar por não participar em `/personal config`, suas mensagens serão excluídas da memória de curto prazo.

A memória de curto prazo recente e a memória que carrega o conteúdo de outros canais ficam logo acima dos quatro turnos de fala mais recentes. A memória mais antiga deste canal permanece acima da conversa na configuração padrão. Uma profundidade configurada menor pode manter o conteúdo mais próximo da mensagem mais recente. Veja [Por Dentro do Prompt](/features/knowledge/inside-the-prompt/) para a disposição completa.

## Exemplo entre canais

- **Canais públicos:** Você discute uma recomendação de álbum com a TomoriBot em `#music`. Alguns minutos depois em `#general`, você pergunta qual álbum ela sugeriu. Como ela respondeu em `#music`, ela recorda esse contexto em `#general`.
- **Canais privados:** Se essa conversa aconteceu em um canal privado, ela não se lembrará dela em `#general`. Os resumos de canais privados permanecem isolados, a menos que uma pessoa com cargo de administração ative o Desvio de privacidade de STM em `/config` > `Permissions`.

## Gerenciando a memória de curto prazo
<!-- anchor: managing-short-term-memory -->

Você pode visualizar ou corrigir o resumo do canal atual em `/config` > `Persona` > `Memórias`.
Quem gerencia o servidor pode ajustar parâmetros ou desativar a memória de curto prazo em `/config` > `Behavior` > `Advanced Memory`, e revisar ou limpar resumos de canais ativos em `/memories` > `Short-Term`.
`/refresh` limpa a memória do canal atual.
