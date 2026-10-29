---
title: "Memória"
sidebar:
  order: 1
aiGenerated: false
---

A TomoriBot possui um sistema de memória persistente para que ela se lembre de fatos entre conversas. Esta
página é sobre *o que ela sabe* (fatos, contexto, documentos). Para *como ela se comporta*
(personalidade, tom), veja [Múltiplas Personas](/pt-BR/features/chatting-personality/multiple-personas/).

## Hierarquia de Memória

Da mais permanente à mais efêmera

| Nível | O que é | Quanto tempo dura |
|---|---|---|
| Memória de longo prazo (LTM) | Fatos salvos sobre um usuário ou servidor, documentos enviados e condicionamento | Para sempre, até que alguém remova. Sobrevive a `/refresh`, reinícios, tudo |
| Memória de curto prazo (STM) | Um resumo que ela escreve para um canal, mais algumas mensagens recentes | 24 horas. Pode alcançar outros canais |
| Histórico de chat | As mensagens recentes no canal em que ela está respondendo | Apenas este canal, apenas até que saiam do alcance de `/config` > Engine > General (padrão de 80 mensagens mais recentes). `/refresh` corta imediatamente |

Quase tudo que ela parece "saber" em uma conversa é apenas o histórico de chat recente, e é por isso
que ela parece esquecer uma mensagem quando a conversa fica muito longa. **Apenas a memória de longo prazo é
permanente.** A STM fica no meio: útil para manter uma cena entre canais sem
salvar nada definitivamente, mas ainda expira.

Para ver exatamente o que é entregue a ela em qualquer turno, veja
[Por Dentro do Prompt](/pt-BR/features/knowledge/inside-the-prompt/).

## Memória de Longo Prazo
<!-- anchor: long-term-memory -->

Memórias de longo prazo são a única coisa que ela mantém permanentemente. Elas não são afetadas por
`/refresh`, por reinícios ou por mudança de canal.

### Memórias Pessoais vs. do Servidor
<!-- anchor: personal-vs-server-memories -->

Existem dois tipos de memória de longo prazo:

- Memórias pessoais (`/personal memories`): fatos sobre um usuário individual, ex.:
  "Amaori ama gatos", "prefere modo escuro", "alérgico a amendoim". Elas são vinculadas a *você*
  e acompanham você em todos os servidores, mas ela só as utiliza em conversas das quais você está participando ativamente.
- Memórias do servidor (`/memories`): informações relevantes para todo o servidor,
  ex.: "Noite de jogos é toda sexta às 20h", "proibido NSFW", "#geral é para
  avisos". Elas ficam dentro do servidor e estão sempre presentes lá.

As memórias são isoladas por persona por padrão. Cada persona (incluindo alters) mantém seu
próprio conjunto separado de memórias pessoais e do servidor, então personas diferentes significam que ela não consegue lembrar
o que outra persona aprendeu. A única exceção é uma memória pessoal adicionada a partir da página Global
em `/personal memories`, que então se aplica a todas as personas especificamente para você. Memórias
do servidor não possuem essa opção; o conjunto de memórias do servidor de cada persona sempre permanece separado, mesmo
dentro do mesmo servidor.

Use `/memories` para navegar, adicionar, editar, remover ou mover memórias do servidor para a
base de conhecimento de documentos. `/personal memories` gerencia os fatos vinculados a você.
As memórias persistem até que você as remova.

Em servidores novos, o acesso de membros não gerentes para criar, editar ou remover memórias compartilhadas do servidor está desabilitado por padrão. Membros com permissão `Gerenciar Servidor` mantêm acesso o tempo todo, e gerentes podem habilitar o acesso para outros membros através de `/moderation` Acesso de Membros.

### Identidades de Proxy de Mensagens

Ao ativar um serviço de proxy de mensagens compatível, a TomoriBot pode manter memórias pessoais para cada identidade de proxy verificada de forma independente da conta do Discord que enviou a mensagem. A conta hospedeira continua controlando privacidade, bloqueios, tempos de recarga e autorização. A TomoriBot nunca adivinha uma identidade a partir do nome ou avatar de um webhook, e um webhook não verificado não recebe um perfil de memória separado.

Atualmente, o PluralKit é o único serviço selecionável. Consulte [Suporte a Proxy de Mensagens](/pt-BR/features/integrations/message-proxy-support/) para ver detalhes de configuração e limitações.

### Como as Memórias São Salvas

Existem exatamente duas maneiras de criar uma memória de longo prazo:

1. Você salva com `/personal memories` ou `/memories`.
2. Ela salva sozinha quando decide que algo vale a pena guardar.

Quando ela salva sozinha, ela publica um embed dizendo que aprendeu algo. **Esse embed é
a confirmação.** Se você disser algo a ela e nenhum embed aparecer, nada foi salvo: ainda é
apenas histórico de chat, então ela vai perder quando a conversa avançar, e não terá
a informação em um canal diferente.

Se ela não está salvando coisas que você quer que sejam mantidas, você tem três opções, em ordem crescente de
força:

- Peça diretamente a ela para lembrar.
- Adicione um lembrete com `/config` > Engine > General, ou com qualquer um dos outros comandos que carregam
  prompts de [Por Dentro do Prompt](/pt-BR/features/knowledge/inside-the-prompt/) (`/config` > Persona > Avançado,
  `/config` > Engine > General, `/config` > Channels > Channel Overrides). Uma nota de contexto em particular fica
  posicionada mais abaixo no prompt dela, o que torna mais provável que ela atue sobre ela. Algo tão simples como *"É
  encorajado criar memórias de longo prazo para informações que valem a pena ser lembradas"* geralmente é
  suficiente. Para referenciar a ferramenta de salvar memória pelo nome sem fixar algo que pode
  variar por provedor, use a
  [macro de prompt](/pt-BR/features/capabilities/tools-and-extensions/#ferramentas-integradas) `{memory_tool}`
  em vez disso, ex.: *"Use {memory_tool} sempre que..."*.
- Salve você mesmo com `/personal memories`, que é um método garantido.

Administradores do servidor podem desativar o salvamento automático dela inteiramente com `/config` > Permissions.

### Quantas Memórias
<!-- anchor: how-many-memories -->

Por padrão, ela armazena até 100 memórias pessoais e 100 memórias do servidor. Quem faz hospedagem própria pode alterar esses valores com as variáveis .env `MAX_PERSONAL_MEMORIES`, `MAX_SERVER_MEMORIES` e
`MAX_MEMORY_LENGTH`. Aumentar o *comprimento* custa muito mais contexto do que aumentar a *quantidade*, então
prefira mais memórias curtas em vez de poucas longas.

Essas quantidades são por persona, não por usuário ou por servidor. Cada persona mantém seu próprio conjunto,
então um servidor rodando quatro personas tem quatro cotas separadas. Suas próprias memórias pessoais
globais contam contra a cota pessoal de cada persona.


### Base de Conhecimento de Documentos (RAG)
<!-- anchor: document-knowledge-base-rag -->

Administradores do servidor podem fornecer a ela documentos para referência usando RAG. Os documentos são fragmentados e armazenados como embeddings pesquisáveis; ela automaticamente recupera
  conteúdo relevante ao responder. Em servidores novos, o gerenciamento de documentos também é restrito a membros com `Gerenciar Servidor` por padrão; gerentes podem conceder acesso a membros através de `/moderation` Acesso de Membros.

Requer um modelo de embedding, configurado com `/config` > Models > Switch Models. Veja
[Provedores & Modelos](/pt-BR/features/setup-administration/providers-and-models/). A
página de Documentos em `/memories` fornece escopos por persona e por servidor, contagens de documentos
e fragmentos ao vivo, uploads, navegação de documentos e remoção:

- Envie arquivos de texto, PDF ou Markdown como conhecimento do servidor. O escopo define se ele é
  vinculado apenas a esta persona (o padrão) ou ao servidor inteiro para que todas as personas possam referenciá-lo.
- `/learn history`: extrai o histórico do canal em conhecimento pesquisável. A opção `learner` escolhe quem
  aprende: uma persona (deixe em branco para a persona principal), **Automático** (cada persona que falou
  recebe sua própria cópia) ou **Global** (todas as personas compartilham).
- Navegue pelos documentos armazenados fragmento por fragmento. Administradores do servidor podem editar fragmentos individuais, alterar
  a quais canais um documento é limitado ou excluir um único fragmento sem remover o documento inteiro.
- Remova documentos armazenados ou fragmentos individuais diretamente do painel.

#### Prompts de Importação de Histórico

Ao importar o histórico de um canal com `/learn history`, a opção `prompt` muda como a TomoriBot extrai
memórias:

- Conversa extrai fatos isolados de chats normais. Ele resolve pronomes e usa timestamps absolutos quando datas ou horários são mencionados ou podem ser inferidos.
- Roleplay procura cenas, lore, relacionamentos e eventos memoráveis sem tentar preservar cada pequeno detalhe.
- In-Character precisa de uma persona em `learner`. Extrai memórias do ponto de vista dessa persona, usando o prompt, atributos, memórias existentes e documentos relevantes dessa persona como contexto.

O prompt é exibido antes da importação para que você possa ajustá-lo para o canal ou cena.

Importações de histórico são armazenadas como documentos, então `/memories` também funciona com elas.

### Condicionamento
<!-- anchor: conditioning -->

`/conditioning` é uma memória por persona, por servidor, que direciona o comportamento de uma persona ao
longo do tempo. Um empurrãozinho mais leve do que um atributo completo ou prompt de sistema. Use para reforçar
como um personagem específico deve agir em um servidor específico.

Use a opção `user` de `/reward` ou `/punish` para enviar um embed de brincadeira com esse usuário como alvo.
Escolha `user` ou `persona`, apenas um por vez. Interações com usuários não salvam condicionamento nem geram
respostas da IA, mesmo com uma `reason`; o rodapé "vai se lembrar disso" é só uma brincadeira.
Tanto para usuários quanto para personas, o motivo aparece em itálico na frase da ação.

Ative `Interações divertidas` em `/config` > `Plugins` > `Ferramentas Disponíveis` para permitir que personas façam gestos deliberados para usuários ou outras personas. A opção vem ativada por padrão e pode ser desativada nesse mesmo menu. Cada gesto precisa de alvo, ação e motivo; alimentar também exige informar a comida. Usuários recebem um embed de brincadeira. Personas recebem condicionamento e entram na fila para reagir quando a persona atual terminar de falar. A persona que reage não pode usar essa ferramenta durante a resposta. Tanto a ferramenta quanto os comandos de barra variam os títulos traduzidos.

Cada `/reward` ou `/punish` direcionado a uma persona é contabilizado, mas só se torna uma memória
sobre a qual ela realmente age quando você fornece uma `reason`, que aparece assim no prompt dela:

```text
## Rewarded Behaviors
Here are past things Tomori did that got rewarded for. Strive to do them again:
- [Tomori was fed by Amaori. Reason: `being extra helpful today` with `cookies`] (2 times)

## Punished Behaviors
Here are past things Tomori did that got punished for. Avoid doing them again:
- [Tomori was bonked by Amaori. Reason: `spamming pings after being told to stop`]
```

Sem uma `reason`, a contagem é
registrada mas nunca aparece no prompt dela. Revise ou limpe entradas com `/conditioning remove`.

## Controlando Quando as Memórias São Ativadas

O escopo filtra tudo antes de qualquer outra coisa: uma memória do servidor só chega aos prompts
no seu próprio servidor, uma memória pessoal apenas quando aquele usuário é visível na conversa,
e ambas apenas para a persona que as possui. Dentro desse escopo, **toda memória é enviada
com todo prompt** por padrão. A marcação por tags restringe ainda mais, para que uma memória seja ativada apenas por
uma palavra-chave ou apenas em um canal. Ative com `/config` > Comportamento > Memória Avançada.

### Tags de Palavra-chave
<!-- anchor: keyword-tags -->

- Memórias sem tags de palavra-chave estão sempre ativas (o padrão).
- Memórias com tags de palavra-chave só são ativadas quando a palavra-chave aparece no
  contexto visível.
- Use `/tool prompt snapshot` para ver quais memórias estão ativando no momento.

### Canais

- Uma memória do servidor pode ser limitada aos canais que você escolher em seu formulário de adição ou edição. Ela é
  ativada apenas nesses canais e em suas threads. Deixe a seleção vazia para todos os canais.
- Uma memória pessoal usa uma tag `#canal` em vez disso, ativando-a apenas naquele canal.
- Limites de canais combinam com tags de palavra-chave. Em memórias do servidor, uma tag iniciada com `#` é uma
  palavra-chave comum.
- Memórias do servidor e documentos que usavam tags `#canal` antigas foram convertidos em canais
  automaticamente. Se uma tag antiga indicava um canal que não existe mais, o item permanece ativo em
  todos os canais e `/memories` informa isso; edite-o e escolha os canais para limitá-lo novamente.
- Se você usa a base de conhecimento de documentos (RAG), documentos e históricos extraídos podem ser
  limitados a canais da mesma forma. Com `/learn history`, escolha os canais na janela que abre
  antes de a extração começar.

Em `/help`, escolha `Memória`, depois `Marcação de Memória`, para o mesmo resumo no Discord.

## Memória de curto prazo
<!-- anchor: short-term-memory-stm -->

O TomoriBot lê mensagens recentes no canal ativo. A memória de curto prazo (STM) estende isso mantendo o contexto de trabalho temporário:

- **Contexto do canal:** Reforça o tópico ou a situação em andamento no canal atual.
- **Contexto entre canais:** Recorda conversas recentes de outros canais, e entre servidores quando a recordação entre servidores estiver ativada.

Ela só lembra de conversas das quais participou. Ela atualiza o resumo de um canal quando responde, e em nenhum outro momento, então um canal movimentado onde ninguém fala com ela não deixa memória. A memória de curto prazo de cada canal expira após 24 horas por padrão. Se você optar por não participar em `/personal config`, suas mensagens serão excluídas da memória de curto prazo.

### Exemplo entre canais

- **Canais públicos:** Você discute uma recomendação de álbum com o TomoriBot em `#music`. Alguns minutos depois em `#general`, você pergunta qual álbum ela sugeriu. Como ela respondeu em `#music`, ela lembra desse contexto em `#general`.
- **Canais privados:** Se essa conversa aconteceu em um canal privado, ela não se lembrará dela em `#general`. Os resumos de canais privados permanecem isolados, a menos que um administrador ative o Desvio de privacidade de STM em `/config` > `Permissions`.

### Gerenciando a memória de curto prazo

Você pode visualizar ou corrigir o resumo do canal atual em `/config` > `Persona` > `Memórias`.
Os administradores do servidor podem ajustar parâmetros ou desativar a memória de curto prazo em `/config` > `Comportamento` > `Memória Avançada`, e revisar ou limpar resumos de canais ativos em `/memories` > `Curto Prazo`.
`/refresh` limpa a memória do canal atual.

## Identidades de proxy de mensagens

Os serviços de proxy de mensagens suportados permitem que o TomoriBot mantenha memórias pessoais separadas para identidades com proxy verificadas. A conta do Discord que hospeda controla a privacidade e a autorização. Consulte o [Suporte a proxy de mensagens](/features/integrations/message-proxy-support/) para configuração e limitações.

## Privacidade

Para saber o que o TomoriBot armazena e como exportar ou excluir, consulte [Tratamento de dados](/features/knowledge/data-handling/) e `/legal privacy-policy`. Você pode desativar a memória com `/personal config`.
