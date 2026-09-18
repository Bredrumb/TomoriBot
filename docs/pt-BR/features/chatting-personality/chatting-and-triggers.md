---
title: "Bate-papo & Gatilhos"
sidebar:
  order: 1
---

A TomoriBot só responde quando algo a aciona. Esta página aborda as formas de acioná-la,
como conversar sem as mãos com o gatilho automático e como evitar acionamentos acidentais
com o Modo de Gatilho Deliberado.

## Como Acioná-la

Por padrão, ela responde quando você:

- **Menciona ela**: `@TomoriBot`
- **Responde** a uma mensagem dela (incluindo uma mensagem de webhook de uma persona)
- **Usa uma palavra-gatilho**: qualquer palavra simples que você registrou, dita em qualquer lugar de uma mensagem
- **Usa `/respond`**: solicita uma resposta manualmente

Palavras-gatilho são o caminho mais conveniente: uma vez que uma palavra é registrada, basta
mencioná-la para ativá-la. Em uma DM, é só dizer oi; nenhum gatilho é necessário.

### Gerenciando Palavras-Gatilho

Administradores do servidor usam `/config` > Persona > Triggers para adicionar ou remover as
palavras-gatilho de uma persona selecionada. Membros comuns podem visualizar a página, mas os
controles de modificação ficam desativados.

## Expressões & Reações

Depois que ela responde, ela pode usar os emojis e figurinhas personalizados do seu servidor e
reagir a mensagens:

- Emojis personalizados são usados naturalmente na conversa com a sintaxe `:nome:` sem distinção de maiúsculas e minúsculas.
- Figurinhas podem acompanhar respostas; ela também pode adicionar reações com emojis.
- Execute `/expressions initialize` para registrar os emojis e figurinhas do seu servidor, para que ela os use com precisão.

## Canais de Roleplay

Canais de roleplay suprimem o uso de emojis personalizados e figurinhas nas respostas dela. Neles,
as pessoas também podem usar `/tool delete turn` para excluir o turno mais recente dela sem a
permissão Gerenciar Servidor.

Configure os canais na página de Regras de Canal em `/config`.

## Consciência Situacional

Além do texto da mensagem, ela recebe um panorama do contexto do Discord toda vez que
responde; assim ela pode falar sobre *onde* e *quando* a conversa está acontecendo, não
apenas sobre o que foi dito. Esse contexto inclui:

- **Onde ela está**: o nome e a descrição do servidor atual (ou que é uma Mensagem
  Direta), e o canal atual.
- **A hora atual**: o horário local do servidor e a parte aproximada do dia, com base em
  `/config` > Engine > General, além do horário local de cada pessoa, se tiver configurado em `/personal config`.
- **Quem está na conversa**: nomes de exibição dos participantes, como mencioná-los,
  quaisquer tags de aparência física e seus lembretes pendentes.
- **O que alguém está fazendo (presença)**: a atividade no Discord de um usuário: o que está **jogando**,
  **transmitindo**, **ouvindo** (por exemplo, uma faixa e artista no Spotify), **assistindo** ou seu
  status personalizado.

A presença é restringida por privacidade: só é compartilhada para usuários no nível de
privacidade **Mínimo** (o padrão; veja `/personal config`) e somente quando o bot tem a intent
*Guild Presences* do Discord habilitada. Usuários que aumentam sua privacidade, ou instâncias
de hospedagem própria executando sem essa intent, simplesmente não terão sua atividade
revelada para ela.

## Gatilho Automático (Bate-papo Sem as Mãos)

O gatilho automático permite que ela entre na conversa sem ser chamada.

- `/server autotrigger channels`: defina os canais onde ela responde sem menção.
- `/server autotrigger threshold`: defina quantas mensagens se acumulam antes de ela se manifestar.
- `/config` > Behavior > Trigger: adicione um gatilho automático probabilístico baseado em temporizador a um canal.
- `/config` > Behavior > Trigger: remova um gatilho aleatório existente.
- ~~`/natres`: temporização humanizada para respostas autônomas~~ a ser implementado

Use isso em um canal dedicado de bate-papo onde você quer que ela pareça uma participante em
vez de uma assistente convocada.

## Modo de Gatilho Deliberado

Se as pessoas dizem o nome de uma persona com frequência em conversas normais, palavras-gatilho
simples podem acioná-la por acidente. O **Modo de Gatilho Deliberado (DTM)** resolve isso
fazendo com que palavras-gatilho simples deixem de contar como um acionamento explícito.

Quando o DTM está ativado:

- `@{gatilho}` (a palavra-gatilho prefixada como uma menção) ainda funciona
- Menções do Discord ainda funcionam
- Respostas ainda funcionam
- `/respond` ainda funciona
- **Palavras-gatilho simples não a acionam mais**

Isso força uma invocação deliberada em vez de uma ativação acidental.

### Controle do Servidor e Pessoal

- `/server dtm`: administradores do servidor ativam/desativam o comportamento em todo o servidor.
- `/personal config`: cada usuário substitui a configuração para si, com três modos:
  - **off**: sempre permitir palavras-gatilho simples
  - **follow**: usar a configuração do servidor
  - **on**: sempre exigir invocação deliberada

Em `/help`, escolha **Behavior** e depois **Deliberate Trigger Mode** para o mesmo resumo no Discord.

:::note
Não confunda **Modo de Gatilho Deliberado** (esta página, controla *como ela é acionada*) com
**Modo de Ferramenta Deliberada**, que controla *quais ferramentas são expostas ao modelo* em um
determinado turno. Eles compartilham a abreviação "DTM" mas não têm relação. Veja
[Ferramentas & Extensões](/pt-BR/features/capabilities/tools-and-extensions/#modo-de-ferramenta-deliberada).
:::
