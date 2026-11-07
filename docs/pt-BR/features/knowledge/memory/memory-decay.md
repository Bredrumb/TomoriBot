---
title: "Decaimento de memória"
sidebar:
  order: 2
aiGenerated: false
---

Pense nas [memórias de longo prazo](/features/knowledge/memory/long-term-memory/) de uma persona como anotações sobre uma mesa. Ela relê cada anotação sobre a mesa antes de cada resposta, portanto, uma mesa cheia torna cada resposta mais longa e mais cara. O decaimento de memória move as anotações de que ninguém precisa há algum tempo para uma gaveta. Elas não são jogadas fora: quando a conversa aborda uma anotação na gaveta, ela a pega de volta. Esta documentação chama as anotações na mesa de *ativas* e as anotações na gaveta de *em repouso*.

O decaimento necessita de um modelo de embedding; consulte [Provedores & Modelos](/features/setup-administration/providers-and-models/). Sem um modelo, todas as memórias permanecem ativas.

## Como uma memória entra em repouso e retorna

1. Toda memória possui um contador de dias sem uso. Ele começa em 0.
2. A cada resposta, a TomoriBot realiza uma busca. Ela transforma a mensagem mais recente em um embedding (uma lista de números que descreve seu significado; consulte [Como funciona a busca](/features/knowledge/memory/documents/#how-search-works)) e o compara com cada memória que ela pode usar naquela conversa.
3. Até 3 das correspondências mais próximas, entre memórias do servidor e pessoais, contam como usadas se forem uma correspondência razoável. Seus contadores voltam para 0.
4. Todas as outras memórias nessa busca ganham um dia. Isso acontece no máximo uma vez por dia (UTC), não importa quantas mensagens sejam enviadas.
5. Aos 7 dias contabilizados, a memória entra em repouso. Ela não é mais enviada com todas as respostas, mas permanece salva e pesquisável.
6. Quando uma mensagem posterior corresponde a uma memória em repouso, ela a adiciona àquela resposta e seu contador é zerado, tornando-a ativa novamente.

Estar ativa é diferente de ser usada. Uma memória permanece ativa apenas enquanto continuar sendo uma das principais correspondências para alguma mensagem.

Apenas dias em que a busca for bem-sucedida contam. Um dia sem conversas, ou uma resposta em que a busca falhar, não altera nada, portanto nenhuma memória entra em repouso apenas pela passagem do tempo.

### Exemplo

Uma memória do servidor: "O gato de Juno se chama Mochi":

| Dias de chat | O que acontece | Contador | Estado |
|---|---|---|---|
| O dia em que é salva | Salva | 0 | Ativa |
| Os 6 dias de chat seguintes | Conversas sobre jogos; Mochi nunca é mencionado | 6 | Ativa |
| Uma semana calma | Ninguém conversa | 6 | Ativa, pausada |
| O próximo dia de chat | Outra conversa sem Mochi | 7 | Em repouso |
| Um dia de chat posterior | Juno pergunta "como vai o Mochi?" | 0 | Recordada para essa resposta, depois ativa |

## Quais conversas são contabilizadas

As memórias do servidor envelhecem nos dias em que a persona conversa naquele servidor. As memórias pessoais são pesquisadas apenas quando o proprietário delas participa da conversa, portanto, envelhecem apenas nesses dias. Bau visita uma vez por mês, portanto as memórias de Bau precisam de 7 visitas em que nunca sejam mencionadas antes de entrarem em repouso, e os dias movimentados dos membros regulares não as desgastam.

Memórias ocultadas por configurações de privacidade, uma lista de bloqueio, limites de canal ou tags nunca são pesquisadas, portanto não envelhecem nem retornam.

## Quando a memória está cheia

Cada persona armazena 100 memórias do servidor e 100 memórias pessoais por padrão. Quando a TomoriBot salva uma nova memória em uma lista cheia, ela esquece uma memória em repouso para abrir espaço. Uma memória que nunca foi correspondida é esquecida primeiro, e depois aquela cuja correspondência ocorreu há mais tempo. A confirmação mostra o que foi salvo e o que foi esquecido, seguindo a configuração de visibilidade de aviso de memória do servidor.

Ela nunca esquece:

- uma memória pessoal Global
- uma memória que alguém adicionou ou editou com `/memories` ou `/personal memories`

Memórias importadas não são protegidas. Para proteger uma memória, edite-a e salve-a uma vez com `/memories` ou `/personal memories`. Uma memória protegida ainda pode entrar em repouso e retornar por meio de busca; a proteção serve apenas para evitar que ela seja esquecida.

Se nenhuma memória for qualificada ou se a busca não estiver disponível para aquela resposta, o salvamento será recusado.

## Instruções pertencem a outro lugar

Uma memória como "Sempre responda a Juno em espanhol" raramente corresponde ao que as pessoas dizem, portanto ela pode entrar em repouso e deixar de se aplicar. Coloque instruções que devam ser aplicadas sempre em [atributos de persona](/features/chatting-personality/multiple-personas/#attributes), no prompt da persona ou em uma [entrada de lorebook Sempre Ativa](/features/knowledge/memory/lorebooks/).

## Custo e cache de prompt

A busca consiste em uma requisição de embedding por resposta, compartilhada com a busca de [documentos](/features/knowledge/memory/documents/). Memórias recordadas ficam próximas ao final do prompt, ao lado de documentos, para que o início do prompt permaneça o mesmo entre respostas. Os provedores oferecem descontos para o início repetido de prompts, portanto a recordação preserva esse desconto. O início só se altera em uma resposta após uma memória transitar entre os estados ativa e em repouso.

## Desativando o decaimento

Quem faz hospedagem própria pode definir `MEMORY_DECAY_ENABLED=false` para desativar o decaimento em toda a instalação. Com isso, todas as memórias permanecem ativas, nada é esquecido para abrir espaço e uma lista cheia recusa novos salvamentos. A busca em documentos continua funcionando. O decaimento também necessita da extensão de banco de dados `pgvector`; consulte [Configuração manual](/self-hosting/manual-setup/#pgvector--documentrag-memory).
