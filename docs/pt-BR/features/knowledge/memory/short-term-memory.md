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
- **Canais privados:** Por padrão, a STM não pode entrar ou sair de um canal privado. Isso se aplica a resumos, campos de memória e mensagens brutas recentes, incluindo a recordação entre dois canais privados.

Canais que restringem a visualização por meio de permissões do Discord são privados automaticamente. Tópicos privados e tópicos dentro de canais privados também são privados. Administradores podem marcar canais de texto públicos como privados em `/config` > `Canais` > `Regras de Canal`.

`Compartilhamento de STM de Canais Privados` nesse painel fica `Bloqueado` por padrão. Escolher `Permitido` permite que a STM entre e saia de canais privados e pode expor conversas privadas em outros lugares. Essa configuração nunca ativa logs de pensamento ou ferramentas multicanal direcionadas a canais privados. Sua adesão à recordação entre servidores ainda é necessária para a recordação entre servidores diferentes, e o servidor de origem controla se a STM de seus canais privados pode sair.

## Gerenciando a memória de curto prazo
<!-- anchor: managing-short-term-memory -->

Você pode visualizar ou corrigir o resumo do canal atual em `/config` > `Persona` > `Memórias`.
Quem gerencia o servidor pode ajustar parâmetros ou desativar a memória de curto prazo em `/config` > `Behavior` > `Advanced Memory`, e revisar ou limpar resumos de canais ativos em `/memories` > `Short-Term`.
`/refresh` limpa a memória do canal atual.
