---
title: "Memória de longo prazo"
sidebar:
  order: 1
aiGenerated: false
---

Memórias de longo prazo são fatos curtos que a TomoriBot mantém até que alguém os remova. Elas sobrevivem a `/refresh` e reinicializações. Ela também se lembra por meio de [Documentos](/features/knowledge/memory/documents/), [Lorebooks](/features/knowledge/memory/lorebooks/) e [Memória de curto prazo](/features/knowledge/memory/short-term-memory/); `/memories` tem uma aba para cada um. Para personalidade e comportamento, veja [Múltiplas Personas](/features/chatting-personality/multiple-personas/).

## Memórias pessoais e do servidor
<!-- anchor: personal-vs-server-memories -->

Memórias pessoais são fatos sobre você. Elas acompanham você entre servidores e são usadas quando você participa de uma conversa. As memórias do servidor contêm informações para todos naquele servidor.

Cada persona tem suas próprias memórias pessoais e do servidor. Uma memória pessoal adicionada na página Global de `/personal memories` se aplica a todas as personas. Gerencie memórias pessoais com `/personal memories` e memórias do servidor com `/memories`.

Os serviços de proxy de mensagens compatíveis permitem que a TomoriBot mantenha memórias pessoais separadas para identidades com proxy verificadas. A conta do Discord que hospeda controla a privacidade e a autorização. Veja [Suporte a Proxy de Mensagens](/features/integrations/message-proxy-support/) para configuração e limitações.

## Salvando memórias

Você pode salvar memórias por conta própria, ou a TomoriBot pode decidir salvá-las durante uma conversa. Quando ela salva uma memória, ela publica um embed confirmando o que aprendeu. Sem essa confirmação, a informação permanece no histórico de conversa em vez da memória de longo prazo.

Se você quiser que ela salve algo, peça diretamente para ela se lembrar ou adicione você mesmo. Quem gerencia o servidor pode desativar o salvamento automático em `/config` > `Permissions`.

## Limites de memória
<!-- anchor: how-many-memories -->

Por padrão, cada persona pode armazenar 100 memórias pessoais e 100 memórias do servidor. As memórias pessoais globais contam para o limite pessoal de cada persona. Quem faz hospedagem própria pode alterar os limites com `MAX_PERSONAL_MEMORIES`, `MAX_SERVER_MEMORIES` e `MAX_MEMORY_LENGTH`.

:::tip
Prefira mais memórias curtas em vez de poucas longas. Uma memória que usa um `MAX_MEMORY_LENGTH` elevado é enviada por completo sempre que estiver ativa, enquanto espaços adicionais em `MAX_PERSONAL_MEMORIES` e `MAX_SERVER_MEMORIES` não custam nada até serem preenchidos. Textos de referência longos pertencem a um [documento](/features/knowledge/memory/documents/), que é pesquisado em vez de enviado por completo.
:::

### Decaimento de memória

Com um modelo de embedding configurado, uma memória que passa 7 dias de conversa contabilizados sem corresponder à conversa entra em repouso: ela continua salva, mas sai do prompt comum até que uma mensagem posterior a traga de volta. Quando a lista está cheia, um salvamento automático pode esquecer uma memória em repouso, mas nunca uma memória pessoal Global ou uma memória adicionada ou editada por alguém com `/memories` ou `/personal memories`. Veja [Decaimento de memória](/features/knowledge/memory/memory-decay/).

Para instruções que devem ser aplicadas sempre, use [atributos de persona](/features/chatting-personality/multiple-personas/#attributes), o prompt da persona ou uma [entrada de lorebook Sempre Ativa](/features/knowledge/memory/lorebooks/).

## Controlando quando as memórias são ativadas
<!-- anchor: controlling-when-memories-activate -->

As memórias ativas são incluídas quando seu proprietário e escopo correspondem à conversa. As memórias em repouso retornam por meio de busca quando relevantes. As restrições de canal restringem onde elas se aplicam, e as memórias pessoais também podem usar tags de palavras-chave.

### Tags de memórias pessoais
<!-- anchor: keyword-tags -->

As memórias pessoais podem conter tags de palavras-chave ou `#canal`. Ative a marcação em `/config` > `Behavior` > `Advanced Memory`. Quando ativada, uma memória pessoal marcada só aparece quando uma de suas palavras-chave estiver na conversa, e uma memória sem tags continua ativa. Uma tag `#canal` a limita àquele canal. Use `/tool prompt snapshot` para ver quais memórias estão ativas.

As memórias do servidor não usam mais tags de palavras-chave. As informações criadas para elas pertencem aos [Lorebooks](/features/knowledge/memory/lorebooks/), onde as palavras-chave e a opção Sempre Ativa são configuradas por entrada.

### Canais

As memórias do servidor e documentos podem ser limitados a canais selecionados e seus tópicos. As memórias pessoais usam uma tag `#canal`. Entradas de lorebook também aceitam uma seleção de canais.

Tags `#canal` antigas de memórias do servidor e documentos foram convertidas em seleções de canais. Se um canal marcado não existir mais, o item permanece ativo em todos os canais; `/memories` identifica esses itens para que você possa escolher novos canais.

## Condicionamento
<!-- anchor: conditioning -->

O condicionamento orienta o comportamento de uma persona em um servidor. Recompensas e punições dadas a uma persona com um motivo se tornam condicionamento sobre o qual ela pode agir. Interações sem um motivo são contabilizadas, mas não aparecem em seu prompt. Revise ou limpe o condicionamento com `/conditioning`.

Interações divertidas também podem permitir que personas recompensem ou punam usuários e outras personas. Interações com usuários não salvam condicionamento; interações com personas podem incentivá-las a responder. Quem gerencia o servidor pode desativar a ferramenta em `/config` > `Plugins` > `Available Tools`.

## Privacidade

Para saber o que a TomoriBot armazena e como exportar ou excluir, veja [Manuseio de Dados](/features/knowledge/data-handling/) e `/legal privacy-policy`. Você pode desativar a memória com `/personal config`.
