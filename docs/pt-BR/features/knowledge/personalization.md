---
title: "Personalização"
sidebar:
  order: 3
aiGenerated: true
---

A TomoriBot pode ser configurada **especificamente para você** com os comandos `/personal`: configurações
que acompanham você em todos os servidores que você compartilha com ela, independentemente da
configuração de qualquer servidor.

## Memórias Pessoais

Fatos que ela lembra sobre você acompanham você entre servidores. O gerenciamento deles (adicionar, remover, exportar)
está coberto na página de [Memória](/pt-BR/features/knowledge/memory/#personal-vs-server-memories).

## Perfil e Nomes com Reconhecimento de Persona

`/personal config` armazena três preferências independentes e opcionais: identidade de gênero,
pronomes e estilo de tratamento. A TomoriBot nunca infere um a partir do outro. O estilo de tratamento
seleciona a variante de nomenclatura masculina, feminina ou neutra de uma persona, e Neutra é o
padrão pré-selecionado. Campos em branco são limpos e omitidos do contexto do prompt. Campos brutos
de perfil são expostos apenas no nível de privacidade Minimal.

`/personal config` abre um modal de nomenclatura para escopo global ou por persona. Uma preferência
com escopo de persona segue a linhagem estável daquela persona entre servidores. Apelidos herdam da
preferência da persona para a preferência global e depois para o nome de exibição ativo do Discord. Um apelido
global em branco continua seguindo o Discord, incluindo alterações posteriores do nome de exibição. Salvar um apelido
global congela esse valor personalizado até que seja limpo. Um prefixo ou sufixo em branco herda
da mesma forma, e texto digitado o substitui, então `Master Mirri-san`
pode combinar valores de diferentes níveis sem alterar o alvo de menção subjacente do Discord.
Para remover um título que uma persona fornece por conta própria, peça diretamente à persona ("pare de me chamar
de Master"); isso o suprime para aquela persona enquanto deixa suas outras personas intactas.

Gerentes do servidor podem configurar os padrões da persona com `/config` > Persona > Identity & Personality. Um
termo de tratamento independente como `fam` é separado do nome formatado e está disponível apenas para
texto de prompt escrito pela persona. A capacidade User Info Updates, ativada por padrão, permite que uma persona
aplique alterações estruturadas explícitas solicitadas na conversa. Desabilitá-la interrompe atualizações automáticas
por ferramenta, mas não desabilita `/personal config`.

`/personal config` armazena apenas um deslocamento numérico UTC de -12 a +14. Não armazena
nem infere uma localização geográfica ou timezone IANA.

## Seus Próprios Provedores
<!-- anchor: your-own-providers -->

Provedores pessoais permitem que *suas próprias solicitações* usem *suas próprias* chaves de API e modelos em vez dos
padrões do servidor. Isso é BYOK (traga sua própria chave) no nível individual.

Dois escopos estão em jogo, e vale a pena diferenciá-los:

- **Padrão do servidor**: credenciais e catálogos compartilhados em `/providers`, com roteamento selecionado através de
  `/model` por membros com a permissão de servidor necessária. Aplica-se a todos no servidor.
- **Substituição pessoal**: configuração usada apenas para suas próprias solicitações. Quando habilitada, ela
  substitui o padrão do servidor para aquela capacidade **em todos os servidores** onde você usa
  a TomoriBot, não apenas naquele em que você a configurou.

**Configuração:**

1. `/personal providers` salva um provedor (sua chave é criptografada). Isso também habilita sua
   substituição pessoal de `Texto` imediatamente, usando o modelo de texto padrão daquele provedor.
2. `/personal config` permite selecionar um modelo diferente para sua substituição pessoal de texto.
   Escolher um modelo aqui mantém o Texto habilitado.
3. Volte a `/personal providers` sempre que precisar atualizar credenciais, gerenciar endpoints
   personalizados ou adicionar e editar registros pessoais de modelos.

Selecionar um modelo com `/personal config` ativa aquela capacidade para suas solicitações.

Como as etapas 1 e 2 transferem você para uma substituição entre servidores, a TomoriBot pede que você confirme
antes de salvar sempre que uma capacidade muda do padrão do servidor para uma pessoal. Rotacionar
a chave em um provedor que já atende suas solicitações pula essa confirmação, pois o
roteamento não está mudando.

Logs de pensamentos atribuem esses turnos a você, e você pode ajustá-los com `/personal config`.
Isso afeta suas solicitações em todos os lugares e nunca altera as configurações deste servidor. Você também pode
registrar endpoints personalizados pessoais com `/personal providers`; veja
[Endpoints Personalizados](/pt-BR/features/setup-administration/providers-and-models/#custom-endpoints).

Se uma solicitação falhar enquanto usa seu provedor pessoal, as dicas de "O que você pode fazer" do erro nomeiam
os comandos pessoais que podem realmente corrigir o problema (`/personal providers`, `/personal config`)
em vez dos comandos de gerente do servidor.

Quando todos os modelos da sua rota de texto pessoal falham, a TomoriBot pode responder com o modelo
de texto do próprio servidor em vez de deixar a mensagem sem resposta. Essa resposta usa as credenciais
do servidor e é descontada da cota de texto dele, e é relatada da mesma forma que qualquer outro
fallback de modelo: um botão **Secundário Usado** cujos detalhes nomeiam o modelo que respondeu e as
falhas que vieram antes. Desative isso em `/personal config` > Modelos > Reservas, na seção
**Fallback com o Modelo do Servidor**, para que as falhas do seu provedor continuem sendo suas. A
configuração vale para toda a conta e vem ativada por padrão, então ela acompanha você em todos os
servidores que permitem isso.

:::note[Servidores que exigem BYOK]
Um servidor pode exigir provedores fornecidos pelos membros com o modo User BYOK
([Moderação do Servidor](/pt-BR/features/setup-administration/server-moderation/#user-byok-bring-your-own-key)). Quando isso
está ativado, suas mensagens acionadas por usuário precisam de um provedor pessoal antes que ela possa responder, e uma
rota pessoal que falha continua falhando: um servidor que não cede seus modelos aos membros não empresta nenhum como
fallback. Provedores pessoais se aplicam em todos os servidores em que você a usa.
:::

## Outras Configurações Pessoais

- `/personal config`: mudar como ela chama você.
- `/personal config`: suas próprias tags de aparência (estilo booru), usadas quando uma
  [geração de imagem](/pt-BR/features/capabilities/media-generation/image-generation/#tag-customization)
  referencia você. Envie uma caixa vazia para limpá-las.
- `/personal config`: controlar sua visibilidade para ela, até **invisibilidade total** (optar por sair
  dos recursos de memória inteiramente).
- `/personal config`: sua substituição pessoal para o
  [Modo de Gatilho Deliberado](/pt-BR/features/chatting-personality/chatting-and-triggers/#deliberate-trigger-mode).
- `/personal config`: permitir que o modelo de texto do servidor cubra uma rota de texto pessoal que
  falhou, ou desativar isso.
- `/personal config`: optar pela compartilhamento de memória de curto prazo entre servidores;
  `/personal memories` limpa sua STM.
- `/personal config`: definir um prompt reutilizável para quando ela personifica você via
  `/impersonate user`.

## Destaque Pessoal
<!-- anchor: personal-spotlight -->

**Destaque Pessoal: escolha de personas por canal.** O Destaque permite que *você* restrinja quais personas
pode acionar em um canal; opcionalmente, atribua uma para acionar automaticamente para suas próprias
mensagens lá. Ele é limitado a **você + um canal** e não afeta ninguém mais.

**Configure um** com `/personal config`, escolhendo:

- uma duração em horas (use **0** para manter até que você remova manualmente),
- o canal alvo,
- as personas que você quer no seu destaque.

Após escolher as personas, você pode opcionalmente selecionar uma como sua **persona de auto-acionamento
pessoal**: a respondedora padrão para suas mensagens naquele canal. Acionamentos diretos ainda
miram na persona que você chamou explicitamente. Pressione Finish para pular.

**Regras importantes:**

- O Destaque apenas **restringe** o acesso; ele nunca o expande. As personas selecionadas são as
  *únicas* que você pode acionar lá.
- Ele ainda respeita os limites de personas configurados no servidor através de `/moderation`.
- Cadeias de proxy são bloqueadas: se seu destaque inclui apenas Alice, uma resposta de Alice não pode
  passar para Bob na sua cadeia de mensagens.

Revise ou remova entradas com `/personal config` (desmarque para remover; destaques
com tempo definido expiram sozinhos). Em `/help`, escolha `Comportamento`, depois `Destaque Pessoal`, para o resumo no Discord.
