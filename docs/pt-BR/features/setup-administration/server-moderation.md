---
title: "Moderação do Servidor"
sidebar:
  order: 2
---

A TomoriBot dá aos administradores do servidor controles sobre como ela se comporta no seu servidor: quem pode usá-la,
onde e quanto custa, através do painel `/config` e seus comandos relacionados. A maioria requer
a permissão **Gerenciar Servidor**. Esta página cobre os destaques; todos os comandos estão na
[Referência de Comandos](/pt-BR/features/command-reference/).

## Controle de Custo: Cotas
<!-- anchor: cost-control-quotas -->

Gerar conteúdo custa dinheiro (seu ou dos seus membros). Cotas limitam o uso por usuário e em todo o servidor:

- `/moderation` → `Cotas`: configure limites diários por usuário e pools redefiníveis em todo o servidor para geração de texto, imagem e vídeo.
- `/quota reset`: redefina manualmente o pool de um usuário ou do servidor.

Defina um limite por usuário como `0` para ilimitado. Pools do servidor são redefinidos em um intervalo
de dias configurável.

## BYOK de Usuário (Traga Sua Própria Chave)
<!-- anchor: user-byok-bring-your-own-key -->

`/moderation` **((Member Access))** apresenta isso como uma escolha de dois estados. **Allow Server Models** é o
padrão; **Require Personal Providers** faz cada membro trazer seu **próprio** provedor pessoal para
seus gatilhos; o servidor não paga nada em mensagens iniciadas pelo usuário. Gatilhos iniciados
pelo servidor ainda usam o provedor do servidor. Este é o controle de custo mais forte: ele transfere o gasto com
API inteiramente para os membros. Membros configuram o deles em
[Personalização → Seus Próprios Provedores](/pt-BR/features/knowledge/personalization/#your-own-providers).

Você também pode iniciar um servidor **sem** nenhum provedor de texto do lado do servidor escolhendo
**User BYOK** durante o `/setup`. Essa opção é oferecida em servidores e não em DMs, e pede
confirmação antes de concluir a etapa do provedor, porque o workspace então não tem nenhum provedor para
recorrer.

## Controle de Acesso: Listas de Permissões

- `/moderation` → `Lista Branca` → `Canais`: escolha os canais de ativação e substituições opcionais de tempo de recarga.
- `/moderation` → `Lista Branca` → `Personas`: limite em quais canais uma persona específica pode ser ativada.
- `/moderation` → `Lista Branca` → `Cargos`: restrinja a ativação a cargos específicos.
- `/config` > Engine > Trigger: defina o tempo de recarga global entre respostas.

Canais na lista de permissões herdam o tempo de recarga global, a menos que você defina uma substituição específica por canal.

## Controles de Aprendizado & Privacidade

- `/server memberpermissions`: controle quem pode ensinar coisas a ela.
- `/moderation` > User Blacklist: faça com que ela ignore completamente membros específicos. Eles não podem
  acioná-la nem usar seus comandos de interação, e suas mensagens nunca chegam ao contexto dela.
- `/config` > Channels > Channel Rules: marque canais onde a memória de curto prazo é isolada e os
  registros de pensamento são suprimidos.

## Transparência: Registros de Pensamento

`/server thought-logs` define um canal onde o raciocínio interno dela e chamadas de ferramentas bem-sucedidas
são postados; útil para auditar o que ela está fazendo (incluindo qual gatilho expôs uma ferramenta no
[Modo de Ferramenta Deliberada](/pt-BR/features/capabilities/tools-and-extensions/#deliberate-tool-mode)).

## Saudações de Boas-Vindas

`/config` > Channels > Logs & Welcome configura uma saudação automática para novos membros em um canal
escolhido. Por padrão, a Tomori espera um minuto antes de cumprimentá-los para que o onboarding do servidor
termine. Use o
botão `Limpar Boas-vindas` na mesma página para parar as saudações.

## Expressões

`/expressions initialize` registra os emojis e figurinhas personalizados do seu servidor para que ela
os use com precisão; recomendado logo após a configuração. Para saber o que ela faz com eles (uso natural de
`:emoji:`, figurinhas, reações), veja
[Expressões & Reações](/pt-BR/features/chatting-personality/chatting-and-triggers/#expressões--reações).
