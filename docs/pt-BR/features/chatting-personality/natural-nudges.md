---
title: "Natural Nudges"
description: "Permita que as personas do TomoriBot iniciem conversas quando um canal do Discord ficar silencioso e entrem naquelas que combinam com seus interesses, em um ritmo adaptado à atividade do seu servidor."
sidebar:
  order: 4
aiGenerated: true
---

O Natural Nudges permite que o TomoriBot fale sem ser mencionado, de duas maneiras:

- **Toques Ociosos**: quando um canal fica silencioso, uma de suas personas escolhe algo para fazer, como saber como alguém está, retomar uma conversa anterior, trazer um novo assunto ou encenar uma breve conversa com outra persona, postando com a própria voz.
- **Toques Ativos**: quando os membros estão conversando sobre algo de que uma persona gosta, essa persona entra na conversa.

Os toques foram pensados para parecer um amigo que aparece para conversar:

- **O ritmo acompanha o servidor**: servidores que conversam com o TomoriBot todos os dias recebem cerca de um toque ocioso por dia; servidores que raramente falam com ela não recebem nenhum, nem toques ativos.
- **Ela espera uma pausa natural**: um toque ocioso só começa em um canal que esteve silencioso por uma a três horas, durante o horário em que o servidor costuma estar ativo.
- **Ela fica em silêncio quando ninguém responde**: cada toque ocioso sem resposta faz com que o próximo espere mais tempo, e após três consecutivos sem resposta ela para até que alguém volte a falar com ela.
- **Na dúvida, ela não diz nada**: se alguém postar primeiro, o canal ficar movimentado ou nada se encaixar, o toque é descartado.

O Natural Nudges funciona apenas em servidores, nunca em mensagens diretas (DMs).

## Toques Ativos
<!-- anchor: active-nudges -->

Um toque ativo acontece quando uma persona entra em uma conversa em andamento porque o assunto trata de algo de que ela gosta. Veja como acontece:

1. Enquanto os membros conversam em um canal qualificado, o TomoriBot conta as mensagens. Tópicos contam como parte do canal principal, e a contagem reinicia sempre que uma persona fala.
2. De tempos em tempos (mais rápido em servidores mais movimentados e com maior frequência para toques ativos), ela lê as últimas cinco mensagens e avalia se a conversa realmente trata dos interesses de alguma de suas personas. Uma menção passageira não conta.
3. A persona com esse interesse responde. Se várias personas compartilharem o mesmo interesse, a que esteve mais quieta recentemente costuma ser a escolhida, enquanto a que acabou de falar aguarda a vez. De vez em quando outra persona assume a vez, com mais frequência uma com quem o servidor raramente conversa.
4. A resposta chega de 15 a 45 segundos depois, com a personalidade habitual da persona. Se outra persona falar primeiro, os membros mudarem de assunto ou o canal ficar movimentado, ela não diz nada.

Há no máximo um toque ativo por canal (incluindo tópicos) por hora, além de um limite diário para todo o servidor. A persona precisa ter interesses cadastrados em sua página de Toques para participar, e personas Silenciosas nunca participam.

## Toques Ociosos
<!-- anchor: idle-nudges -->

Os toques ociosos esperam até que um canal fique em silêncio por um tempo, durante os horários em que seu servidor costuma estar acordado. Existem 28 toques integrados em quatro categorias. Você pode ajustá-los e adicionar os seus para todo o servidor no `/nudge-studio`, e cada persona pode ter toques ociosos próprios (veja [Toques ociosos de persona](#persona-idle-nudges)).

| Categoria | O que faz | Pré-requisitos | Notas |
|---|---|---|---|
| <a id="ping-user"></a>Mencionar Usuário | Confere como um membro está ou compartilha algo que ele possa gostar. | Conversa recente com esta persona neste servidor, uma memória e permissão para mencionar. Privacidade total, listas de bloqueio de personalização e bloqueios de persona excluem membros. | Contatos frequentes têm preferência; menções recentes reduzem as chances de repetição. Desative em `/personal config` > `Privacidade` > `Menções de Personas`. |
| Retomar Tópico | Retoma uma conversa que ficou pendente. | Uma conversa inacabada. | N/A |
| Iniciar Tópico | Traz algo novo, geralmente sobre os interesses da persona. | Sem requisitos adicionais de categoria. | N/A |
| <a id="play-scene"></a>Encenar Cena | Inicia uma breve conversa entre duas ou três personas. | Outra persona permitida a dar toques naquele canal. | Personas tagarelas participam com mais frequência; as silenciosas nunca participam. Se um membro enviar mensagem, a cena para e uma persona responde a ele. Cenas surpresa não mencionam seu alvo. |

### Escolher e criar toques ociosos

Abra `/nudge-studio` (requer `Gerenciar Servidor`) para explorar cada categoria. O ponto colorido mostra se um toque está ativado, se falta um pré-requisito ou se está desativado. Cada linha termina com sua origem: `Integrado`, `Personalizado do servidor` ou `Para <persona>` no caso de toques de uma persona. Categorias com mais de 12 linhas continuam em páginas seguintes.

`Alternar disponibilidade...` escolhe quais personas podem usar um toque:

- **Todas marcadas:** qualquer persona no canal pode usá-lo, incluindo as que você adicionar depois.
- **Algumas marcadas:** apenas essas personas podem usá-lo. Novas personas permanecem de fora até você marcá-las.
- **Nenhuma marcada:** o toque fica desativado.

Um toque pertencente a uma persona tem apenas uma caixa de seleção, `Disponível para <persona>`, pois apenas a dona pode usá-lo. Desmarcá-lo desativa o toque sem excluí-lo.

Limitar um toque do servidor a uma persona não o move para a página daquela persona. Ele continua sendo um toque do servidor, e apenas as entradas próprias da persona viajam com o cartão da persona.

Abaixo da lista você pode adicionar até 25 toques próprios para todo o servidor. Escolher um toque do servidor ou de uma persona abre-o para edição, e a mesma entrada pode ser editada na página de `Toques` da persona. Novos toques criados aqui são sempre toques do servidor. `Remover Toques` lista os toques editáveis na página atual, e desmarcar um remove o toque. Cada um contém:

- **Nome**: o rótulo exibido no estúdio.
- **Instrução**: o que a persona pretende fazer. Escreva `{persona}` onde vai o nome dela, `{partner}` para a outra persona em uma cena e `{target}` para o membro envolvido.
- **Objetivo oculto** (opcional): a pequena meta pessoal que a persona mantém após sua abertura.
- **Pré-requisitos**: o que precisa estar presente antes da execução, como uma memória recente ou uma ferramenta disponível. Uma ferramenta escolhida nos Pré-requisitos já está incluída, sendo removida desta lista ao salvar.
- **Ferramentas recomendadas**: ferramentas que a persona é incentivada a usar quando as possui. O toque ainda é executado sem elas.

### Toques ociosos de persona
<!-- anchor: persona-idle-nudges -->

Uma persona pode carregar toques ociosos que correspondam ao seu caráter, como Rose conferindo uma roupa de cosplay ou Aphel recomendando um álbum. Eles se somam aos toques integrados e do servidor e não os substituem.

Abra `/config` > `Persona` > `Toques`. `Toques Ociosos` fica abaixo de `Interesses`:

- `Selecione ou adicione um toque ocioso...` adiciona um com `+ Adicionar <categoria>` ou edita um existente. Todas as quatro categorias estão disponíveis, com os mesmos campos de um toque do servidor. Uma persona suporta até 20, separados dos 25 do servidor.
- `Alternar disponibilidade...` ativa ou desativa entradas individuais para esta persona.
- `Remover Toques Ociosos` exclui as entradas desmarcadas.
- `Restaurar Toques da Predefinição` aparece para uma persona que segue uma predefinição oficial e tem sua própria cópia da lista.

Como funcionam:

- Apenas a persona dona os inicia. Em uma cena, a dona lidera e qualquer outra persona autorizada pode entrar como parceira.
- Eles seguem os mesmos pré-requisitos, horários de silêncio, nível de frequência e limite diário de qualquer outro toque ocioso. Mais entradas dão mais opções à persona, mas não a fazem falar com mais frequência.
- Interesses guiam toques ativos. Toques ociosos de persona guiam apenas toques ociosos.

Predefinições oficiais incluem toques ociosos. Uma persona que segue sua predefinição lê essa lista à medida que a predefinição é atualizada. Na primeira vez em que você adiciona, edita ou remove uma entrada, a persona obtém sua própria cópia de toda a lista, e atualizações futuras da predefinição não a alterarão mais. Ativar ou desativar uma entrada não cria uma cópia. `Restaurar Toques da Predefinição` substitui a lista da persona pela lista atual da predefinição e mantém seus interesses, loquacidade e as escolhas de ativação das entradas existentes. `Ressincronizar com predefinição` em `Identidade e Personalidade` também redefine a lista e as opções de ativação.

Cartões de persona (`/persona export`) incluem os toques ociosos da persona, seja da predefinição ou de sua cópia própria, e importar o cartão os restaura. Opções de ativação são locais do servidor e não são exportadas, portanto entradas importadas começam ativadas. Toques do servidor nunca vão para um cartão. Um cartão antigo que ainda corresponda a uma predefinição oficial segue os toques ociosos atuais dessa predefinição. Outros cartões antigos são importados sem toques ociosos de persona.

### Mencionar Usuário
<!-- anchor: ping-user -->

Esse tipo de toque ocioso menciona um membro pelo nome, portanto só escolhe pessoas que a persona realmente conhece:

- **Eles conversaram com esta persona recentemente**: apenas membros que iniciaram uma conversa com essa persona neste servidor nos últimos 14 dias podem ser escolhidos. Ter sido mencionado ou citado em uma conversa não conta, e ter proximidade com a mesma persona em outro servidor também não conta.
- **A persona os conhece**: o membro tem uma memória com essa persona nos últimos 30 dias, ou uma memória de curto prazo (STM) recente com ela.
- **Eles não desativaram a opção**: qualquer pessoa pode desativar as Menções de Personas para si mesma em `/personal config` > Privacidade. Membros com privacidade Completa, membros na lista de bloqueio de personalização do servidor e membros bloqueados pela persona nunca são escolhidos.

Entre esses membros, os mais próximos são escolhidos com mais frequência: cada mensagem enviada para essa persona neste servidor nos últimos 14 dias, e cada canal em que conversaram recentemente, aumenta suas chances. Alguém que uma persona mencionou nos últimos três dias tem menos chance de ser escolhido novamente. A menção vai apenas para esse membro individual; um toque de menção nunca menciona cargos, `@everyone` ou qualquer outra pessoa. Qualquer resposta no canal conta como resposta.

### Encenar Cena
<!-- anchor: play-scene -->

Uma cena é um breve diálogo entre personas, com duas a quatro mensagens de duração. A persona que toma a iniciativa abre a cena e escolhe um parceiro (às vezes dois) entre as outras personas permitidas naquele canal. Personas mais comunicativas entram com mais frequência, e personas Silenciosas nunca participam.

- **Os membros vêm primeiro**: quando alguém posta no canal durante a cena, as mensagens restantes da cena são descartadas e a persona que estava prestes a falar responde à pessoa, como em uma conversa em que alguém acabou de entrar. Se a postagem nomeou ou mencionou uma persona específica, essa persona responde no lugar.
- **Planos permanecem em segredo**: as personas podem planejar uma surpresa inofensiva para alguém que conhecem, mas a cena não menciona esse membro.

### Objetivos ocultos

Junto com a abertura, cada toque ocioso dá à persona uma pequena meta privada, como "descobrir quem mais gosta desse anime". A meta fica anexada acima da abertura e apenas essa persona a vê, para que continue buscando o objetivo em respostas posteriores. Em uma cena, cada persona recebe seu próprio objetivo, que as outras nunca veem. Quando a abertura sai do contexto que a persona lembra, a meta desaparece. Objetivos ocultos nunca pedem dados pessoais, dinheiro ou qualquer coisa fora do chat. Membros com permissão para usar o snapshot de prompt podem visualizá-los.

## Configurações

O Natural Nudges vem ativado por padrão e nada precisa ser configurado previamente. Assim que as pessoas no servidor começarem a conversar regularmente com o TomoriBot, toques ociosos e ativos começarão nos canais onde conversam com ela.

Para alterar o funcionamento, abra `/config` > Plugins > Natural Nudges (requer Gerenciar Servidor):

- **Toques Ociosos** e **Toques Ativos**: ativam ou desativam cada modalidade separadamente.
- **Canais**: funciona de forma automática com os canais onde as pessoas conversaram com o TomoriBot nos últimos 14 dias (exceto canais de roleplay). Você pode escolher canais manualmente ou limpar a lista para voltar ao modo automático. Um canal onde outros bots postam frequentemente nunca fica silencioso, portanto é ignorado.
- **Seleção de Modelos**: escolhe os dois modelos de IA utilizados pelo Natural Nudges. Modelos gratuitos do Google estão sujeitos aos termos de uso gratuito do Google, que permitem que o Google utilize as conversas enviadas a eles.
  - **Planejador de Toques Ociosos**: planeja os toques ociosos. Por padrão, é o modelo de chat do servidor. Nem todos os modelos conseguem realizar essa tarefa; se o seu não puder, o painel avisará e permitirá escolher outro.
  - **Verificador de Toques Ativos**: analisa a conversa de tempos em tempos para ver se combina com algum interesse. Ele roda com muito mais frequência do que o planejador, por isso um modelo pequeno e econômico é o mais indicado. Por padrão, o TomoriBot escolhe um para você: um modelo de Decisão (um modelo pequeno criado para responder a perguntas de escolha única) se o servidor tiver uma chave da OpenRouter, Gemma 4 31B se tiver uma chave do Google, ou o Planejador de Toques Ociosos caso contrário. Você pode escolher qualquer um desses manualmente, incluindo modelos de Decisão.

A página mostra o nível de atividade do servidor, quantos toques ociosos esperar a cada semana e com que frequência ela verifica as conversas para toques ativos.

### Frequência

- **Frequência**: define o ritmo separadamente para toques ociosos e para toques ativos: Rara, Suave (o padrão), Normal ou Animada. Mesmo no nível Animada, ela permanecerá quieta em um servidor que raramente conversa com o TomoriBot.
- **Limites diários**: acompanham o nível de frequência: Rara permite 1 toque ocioso e 1 ativo por dia; Suave 3 de cada; Normal 5 toques ociosos e 6 ativos; Animada 8 toques ociosos e 10 ativos.
- **Limites de verificação**: evitam que toques ativos esgotem uma chave de IA: o TomoriBot verifica conversas no máximo 10 vezes ao dia no modo Rara, 20 no Suave, 40 no Normal e 60 no Animada. Depois que uma verificação não encontra nada, aquele canal espera mais tempo antes da próxima, de 10 minutos até 3 horas. Se o provedor de IA indicar que a chave atingiu seu limite, os toques ativos são pausados por 3 horas.

### Quando permanece desligado

- **Estatísticas de uso desativadas**: o TomoriBot avalia a atividade de um servidor por meio de suas estatísticas de uso. Se quem hospeda o bot desativou as estatísticas, os toques nunca começarão.
- **Membros pagam com suas próprias chaves (BYOK)**: se o seu servidor faz com que cada membro use sua própria chave de IA, nenhuma chave cobre uma mensagem que ninguém solicitou, portanto o Natural Nudges permanece desligado.

## Configurações de Persona

Cada persona tem sua própria página de **Toques** em `/config` > Persona:

- **Loquacidade**: com que frequência essa persona é quem toma a iniciativa de falar. Personas Silenciosas nunca iniciam toques ociosos nem participam de toques ativos; tímidas falam menos e tagarelas com mais frequência.
- **Interesses**: até 8 tópicos que a persona gosta de trazer e participar, cada um com uma breve descrição e exemplos (por exemplo, **anime de mecha**: ficção sobre robôs gigantes pilotados, como Gundam).
- **Toques Ociosos**: até 20 toques que apenas esta persona usa, descritos em [Toques ociosos de persona](#persona-idle-nudges).

Predefinições oficiais incluem essas configurações. O comando `/persona generate` sugere interesses para novas personas; `Gerar Interesses` adiciona novos por meio de seu modelo de texto atual. Exportações de personas incluem os três.

## Quando os toques disparam

### Heat
<!-- anchor: heat -->

O Heat define o ritmo tanto dos toques ociosos quanto das verificações ativas para todo o seu servidor, entre membros e personas. As configurações do Natural Nudges mostram o Heat medido, seu ajuste salvo e o Heat usado para toques de um total de 50.

#### TLDR: Mais mensagens para o TomoriBot = Mais Heat = Mais toques automáticos

#### Atividade e decaimento

O Heat medido é uma média diária ponderada de interações nos últimos 30 dias. Turnos de conversa comuns e turnos de `/punish` humanos contribuem uma vez; turnos de `/reward` humanos contribuem três vezes mais. Toques gerados e Interações Divertidas entre personas não contribuem em nada.

O peso de uma interação cai pela metade a cada três dias:

$$
w(d) = 2^{-d/3}
$$

Aqui, `d` é o número de dias atrás, usando dias UTC: a atividade de hoje tem peso 1, de três dias atrás tem peso 0.5 e de seis dias atrás tem peso 0.25. A atividade sai do cálculo após 30 dias. Com `E_d` como o total ponderado de interações de cada dia, o Heat medido `A` é:

$$
A = \frac{\sum_{d=0}^{29} E_d \cdot w(d)}{\sum_{d=0}^{29} w(d)}
$$

Uma atividade estável de 10 interações ponderadas todos os dias gera cerca de 10 de Heat medido. Seu ajuste salvo `Δ` é somado após essa média, e o resultado é limitado entre 0 e 50:

$$
H = \min(50, \max(0, A + \Delta))
$$

A atividade medida não tem teto, portanto o Heat de um servidor movimentado decai a partir de seu valor total. Ambos os modos precisam de Heat medido e Heat efetivo de pelo menos 1. Um ajuste altera o ritmo assim que a atividade medida atinge esse mínimo. A pausa de 14 dias sem chat direto continua valendo para qualquer valor de Heat.

#### Intervalos ociosos e verificações ativas

Para um Heat efetivo `H` de pelo menos 1, seu nível de frequência fornece estes valores:

| Frequência | Divisor ocioso D | Limite diário ocioso C | Multiplicador ativo M |
|---|---|---|---|
| `Rare` | 175 | 1 | 2 |
| `Gentle` | 25 | 2 | 1 |
| `Normal` | 15 | 3 | 0.6 |
| `Lively` | 8 | 6 | 0.35 |

Os toques ociosos estimados por dia `R` aumentam com o Heat até atingirem o limite diário:

$$
R = \min\left(\frac{H}{D}, C\right)
$$

O intervalo base é de `16 / R` horas. Cada intervalo recebe um multiplicador aleatório entre 0.5 e 1.5, e cada convite consecutivo sem resposta triplica o próximo intervalo. Três convites sem resposta pausam os toques ociosos até que alguém volte a falar com o TomoriBot. Canais silenciosos, horário de atividade, pré-requisitos e a decisão do planejador ainda determinam se um toque programado de fato começará.

Para verificações ativas, o Heat altera o número de mensagens humanas necessárias em um canal. Primeiro calcule uma escala de intervalo `s`, com a contribuição do Heat mantida entre 0.5 e 4:

$$
s = M \cdot \min\left(4, \max\left(0.5, \frac{15}{H}\right)\right)
$$

A meta de mensagens de uma verificação é sorteada aleatoriamente entre `max(1, round(15 × s))` e `max(1, round(40 × s))`, inclusive. O arredondamento usa a mensagem inteira mais próxima, arredondando metades para cima. Tópicos compartilham o contador do canal pai. Os tempos de recarga e limites diários continuam em vigor, e o verificador só convida uma persona a falar quando a conversa coincide com um interesse. Essas fórmulas controlam o momento; uma verificação pode não produzir resposta.

Por exemplo, com ambas as frequências definidas como `Gentle`:

| Heat efetivo | Toques ociosos estimados por semana | Mensagens humanas entre verificações ativas |
|---|---|---|
| Abaixo de 1 | 0 | Sem verificações |
| 5 | Cerca de 1.4 | 45-120 |
| 15 | Cerca de 4.2 | 15-40 |
| 30 | Cerca de 8.4 | 8-20 |
| 45 | Cerca de 12.6 | 8-20 |
| 50 | Até 14 | 8-20 |

As verificações ativas atingem seu intervalo mais rápido no Heat 30. Os toques ociosos atingem seus limites diários no Heat 50 para `Gentle`, 45 para `Normal` e 48 para `Lively`. `Rare` atinge cerca de dois toques ociosos estimados por semana no Heat 50, com no máximo um por dia. Sua estimativa semanal é um guia de ritmo; momentos aleatórios e verificações de elegibilidade afetam o envio real. Heat acima de 50 não aumenta a velocidade de agendamento.

## O Que É Armazenado

Configurações, toques personalizados, interesses e toques ociosos de persona são salvos com a configuração do seu servidor. O histórico de toques, incluindo se alguém respondeu e quem foi mencionado, é mantido por 30 dias. Objetivos são mantidos por até 90 dias.

- **Configuração do servidor:** `/reset` restaura as configurações de toques e remove toques personalizados. Exportações e importações de configuração trazem configurações e toques personalizados, excluindo a lista de canais específicos do servidor. Toques ociosos de persona permanecem com sua persona após uma redefinição e viajam em seu cartão de persona. `/persona default` e a exclusão de uma persona removem seus toques ociosos.
- **Configuração pessoal:** sua escolha de `Menções de Personas` sobrevive a `/reset personal config`, é incluída em `/export personal config` e é apagada com `/personal nuke`.
