---
title: "Múltiplas Personas"
# Keyword-rich <title> targeting "AI companion Discord" queries; replaces
# Starlight's default "{title} | TomoriBot" for this page only. H1 and sidebar
# keep the plain title. The homepage title bets on "AI agent" + "roleplay";
# this page carries the "companion" keyword instead.
head:
  - tag: title
    content: "TomoriBot | AI Companions & Personas for Your Discord Server"
# Hand-written search snippet; overrides the auto-derived description from
# routeData.ts middleware.
description: "Execute múltiplos companheiros de IA em um servidor Discord. Personas personalizadas com seus próprios avatares, gatilhos e estilos de fala."
sidebar:
  order: 2
---

A personalidade da TomoriBot vive em uma **persona**: seu nome, avatar, traços, estilo de fala e
comportamento. Você pode ter várias personas ao mesmo tempo, cada uma sendo um personagem distinto
com seus próprios gatilhos e avatar de webhook. Esta página é sobre *como ela se comporta*; para
*o que ela sabe* (fatos e memórias), veja [Memória](/pt-BR/features/knowledge/memory/).

## Criando uma Persona

- `/persona create`: construa uma personalidade personalizada do zero.
- `/persona generate`: faça a IA gerar uma personalidade a partir de uma descrição e uma imagem.
  Requer um provedor que suporte saída estruturada. Você também pode enviar uma predefinição
  existente da TomoriBot ou um cartão do SillyTavern aqui para transformar um personagem existente (veja
  [Suporte ao SillyTavern](/pt-BR/features/integrations/sillytavern-support/)).
- `/persona default`: mude para uma das personalidades padrão integradas como base.
- `/persona export` / `/persona import`: compartilhe ou faça backup de uma persona como arquivo. A importação
  suporta trazer uma persona como um **alter** com seus próprios gatilhos e avatar de webhook.
- `/persona remove`: remova uma persona alter.

Um bom fluxo de trabalho inicial: escolha uma padrão ou gere uma, depois refine-a com atributos
e diálogos de exemplo abaixo.

## Alter Personas

Alter personas permitem que múltiplos personagens coexistam em um servidor:

- Cada alter tem sua própria personalidade, palavras-gatilho e **avatar de webhook**; assim diferentes
  personagens aparecem com nomes e imagens diferentes no mesmo canal.
- Múltiplos alters podem responder a uma única mensagem, até o limite em `/config` > Engine > Trigger.
- **Responder a uma mensagem de webhook** continua a conversa como aquela persona.
- Adicione alters via `/persona import` (opção alter); gerencie-os com `/persona` e
  `/persona remove`.

É isso que torna possível roleplay em grupo e servidores com múltiplos personagens. Para os detalhes de
execução de como os gatilhos direcionam para personas e como as identidades de webhook funcionam, veja a
referência de arquitetura sobre [comportamento multi-persona](/en/architecture/subsystems/multi-persona/).

## Moldando a Personalidade

Dois comandos fazem a maior parte do trabalho de ensiná-la como falar e agir:

### Atributos
<!-- anchor: attributes -->

`/config` > Persona > Identity & Personality adiciona traços de personalidade ou características físicas, por exemplo
`amigável`, `cabelo vermelho` ou `termina frases com *Nya~*`. Remova-os com
`/config` > Persona > Identity & Personality.

### Diálogos de Exemplo
<!-- anchor: sample-dialogues -->

`/config` > Persona > Identity & Personality ensina a ela *como ela fala* por meio de exemplos. Use os placeholders `{user}` e
`{bot}` para que os diálogos funcionem para todos (e quando você compartilhar a persona):

- `{user}`: substituído pelo nome/apelido real do usuário
- `{bot}`: substituído pelo nome atual dela

```text
{user}: Qual é o seu hobby favorito?
{bot}: Fufu~ Eu gosto de tricotar roupinhas minúsculas para pelúcias minúsculas~♥
```

Dicas para diálogos de exemplo eficazes:

- Escreva trocas naturais e conversacionais.
- Incorpore os atributos e traços que você quer que ela demonstre.
- Demonstre o tom desejado e adicione variedade para que ela generalize.

Remova exemplos com `/config` > Persona > Identity & Personality.

### Nome e Avatar

- `/config` > Persona > Identity & Personality: defina como ela se chama.
- `/config` > Persona > Identity & Personality: defina a foto de perfil dela para este servidor.

Você também pode definir um prompt de sistema personalizado com `/config` > Engine > General para moldar ainda
mais o comportamento; veja [Ajuste de Comportamento](/pt-BR/features/chatting-personality/behavior-tweaking/).

## Sprites (Avatares de Emoção)
<!-- anchor: sprites-emotion-avatars -->

Sprites são imagens de avatar alternativas que uma persona pode usar durante a conversa para expressar
uma emoção ou situação; pense neles como as expressões faciais dela. Cada sprite é uma imagem
rotulada (por exemplo `feliz`, `brava`, `envergonhada`) que ela exibe no lugar de seu avatar
normal quando se encaixa no momento.

Como ela os usa: os sprites disponíveis e suas notas de uso são fornecidos ao modelo a cada
turno. Para mostrar um, ela inicia uma linha de resposta com `NomeDaPersona (rótulo):`; essa linha
é então entregue com a imagem do sprite correspondente. Se nenhum sprite se encaixa, ela responde
normalmente.

Gerencie os sprites de uma persona em `/config` > Persona > Sprites (adicionar e remover
requerem a permissão **Gerenciar Servidor**):

- `/config` > Persona > Sprites: adicione ou substitua um sprite; escolha a persona, dê um **rótulo**,
  envie a **imagem** (PNG, JPG ou GIF) e opcionalmente adicione **instruções de uso** dizendo
  a ela quando usá-lo. Reutilizar um rótulo substitui aquele sprite. Cada persona tem um limite máximo
  de sprites.
- `/config` > Persona > Sprites: altere o nome, imagem, instruções ou toggle de
  identidade de um sprite existente.
- `/config` > Persona > Sprites: exclua sprites de uma persona.
- Exportar e importar em `/config` > Persona > Sprites: faça backup ou compartilhe todo o conjunto de
  sprites de uma persona como arquivo.

O toggle de **identidade** decora o nome da mensagem como `Rótulo (Persona)` no Discord, o que é
especialmente útil para [alter personas](#alter-personas) que falam como personagens distintos.

Mudar o avatar de uma persona padrão remove os sprites que vieram com ela, porque eles mostram
o rosto do personagem original. Sprites que você adicionou permanecem. Execute `/persona default` para trazer os
sprites padrão de volta.

## Escolha de Persona por Canal

Quer controlar qual persona responde *você* em um canal específico sem alterar a
configuração do servidor inteiro? Isso é o Destaque Pessoal; veja
[Personalização](/pt-BR/features/knowledge/personalization/#personal-spotlight).

## Formas de tratamento específicas por persona

Administradores do servidor podem usar `/config` > Persona > Identity & Personality para dar a cada persona prefixos,
sufixos e termos de tratamento independentes para masculino, feminino e neutro. A substituição pessoal
com escopo de persona de cada usuário é vinculada pela linhagem estável da persona, de modo que duas personas
podem chamar Mirri por nomes diferentes na mesma resposta multi-persona, enquanto ambas ainda direcionam
ao mesmo usuário do Discord. Editar um ponteiro oficial cria primeiro uma cópia independente; nunca altera
o catálogo compartilhado ou a persona de outro servidor.
