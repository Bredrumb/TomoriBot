---
title: "Manuseio de Dados"
sidebar:
  order: 4
---

Exporte, faça backup, importe ou exclua suas configurações, memórias e personas usando comandos de barra Discord. Para termos de serviço e detalhes de privacidade, consulte `/legal terms-of-service` e `/legal privacy-policy`.

:::note
Esta página aborda os controles do usuário no Discord. Em instâncias auto-hospedadas, os backups e restaurações completos do banco de dados são operações do lado do host; consulte [Manutenção e backups](/pt-BR/self-hosting/maintenance/).
:::

## O que ela armazena

### Dados armazenados

- Memórias do servidor e pessoais, seus dados de busca e registros de uso recente, e lorebooks criados
- Perfis de personalidade, características e exemplos de diálogo
- Definições de configuração do servidor
- Chaves API do provedor criptografadas
- Metadados de expressão, regras de acesso de persona e mídia de expressão carregada
- [Gravações de conversa](/features/setup-administration/conversation-recordings/) opcionais, incluindo mensagens ao redor quando selecionado

### Não armazenado

- Bytes de mídia, nomes de arquivos e URLs de anexos de gravações de conversa; apenas os metadados de tipo/quantidade de anexos são salvos.

### Enviado para seus provedores de IA

Sempre que acionado, TomoriBot busca mensagens recentes no canal junto com memórias relevantes como contexto para o modelo. A gravação de conversas opcional também lê mensagens elegíveis independentemente de gatilhos de resposta; ela não faz chamadas automáticas de provedor.

Quando um modelo de embedding está configurado, o provedor dele recebe a mensagem mais recente e o texto de documentos e memórias pesquisado. Este pode ser um provedor diferente daquele que escreve as respostas. Memórias pessoais ocultas por configurações de privacidade ficam fora da busca. Os dados de busca são excluídos junto com a respectiva memória; consulte [Decaimento de memória](/features/knowledge/memory/memory-decay/) para saber mais sobre o repouso e a substituição automáticos.

:::note
O provedor de IA escolhido (Google, OpenRouter, NovelAI,…) processa mensagens de acordo com sua própria política de privacidade. Evite compartilhar credenciais pessoais confidenciais ou dados confidenciais.
:::

### Seleções de Revisão de respostas
<!-- anchor: response-drafting-selections -->

`/config` > `Plugins` > `Revisão de respostas` armazena as escolhas de revisor, modelo de decisões, verificador de regras opcional, prompt e itens de revisão ativados para aquele servidor ou DM. Quando ativada, as respostas são revisadas antes de serem enviadas. Solicitações de ferramentas são revisadas antes da execução apenas com `Chamadas de ferramentas` ativado. Um verificador opcional recebe o texto da resposta pendente e envia conclusões consultivas apenas ao revisor. A dispensa por decisão permanece inativa até que haja validação rotulada, e as seleções de decisões salvas não fazem chamadas pagas enquanto faltar calibração. Desativar mantém respostas e ferramentas normais sem solicitações de revisão.

O revisor selecionado sempre recebe a resposta pendente, a mensagem disparadora e o destino da resposta. `Itens a verificar` controla quais contextos adicionais já admitidos para o autor ele recebe: instruções da persona, diálogos de exemplo, conversa recente, memórias e outro contexto e chamadas de ferramentas. Instruções da persona, diálogos de exemplo e conversa recente começam ativados. Memórias e outro contexto inclui relacionamentos visíveis entre participantes e documentos. Com `Chamadas de ferramentas` ativado, o revisor recebe os resultados concluídos e as definições de ferramentas disponíveis; uma solicitação proposta inclui seu alvo exato e argumentos, incluindo qualquer texto de mensagem. A revisão não adiciona consulta a perfis privados. Credenciais e argumentos de autenticação são ocultados. As evidências necessárias precisam caber; cobertura incompleta de mídia, argumentos de ferramentas ocultos ou limites de modelo ausentes tornam a revisão indisponível. Uma revisão indisponível mantém as verificações normais do aplicativo; uma ação rejeitada anteriormente permanece bloqueada.

A herança usa o modelo e as credenciais que realmente respondem, incluindo roteamento pessoal, rotação de chaves, substituições e fallback. Um revisor fixado usa o registro e a chave do provedor salvos para aquele servidor ou DM. Seu provedor tem sua própria política de privacidade. Escolhê-lo mantém o provedor de respostas principal inalterado. Respostas pendentes e pacotes de correção duram apenas durante o turno. Apenas diálogos aceitos pelo Discord entram na memória de conversa; a contabilidade de tokens inclui tentativas reais sem sucesso quando o provedor relata o uso. Os diagnósticos contêm metadados e contagens, sem rascunhos, evidências, correções, corpos de resposta do provedor ou chaves.

As exportações de configuração incluem essas definições sem chaves de API ou tokens de autenticação MCP. As importações preservam referências de modelo e verificador apenas quando disponíveis no servidor ou DM receptor. Registre um equivalente local ou limpe seleções indisponíveis antes de importar. A redefinição de configuração do servidor restaura o estado desativado, herança de revisor, nenhum modelo de decisões, o prompt padrão e nenhum verificador.

## Exporte Seus Dados

As gravações de conversa usam `/record data` para anexos privados em Markdown ou JSON no servidor atual. As regras de intervalo, retenção e exclusão estão no [guia de gravação](/features/setup-administration/conversation-recordings/).

As exportações de configurações e memórias são entregues em suas DMs como um arquivo JSON, para que suas DMs mantenham uma cópia que você possa restaurar mais tarde. Se o TomoriBot não puder enviar uma DM para você, o arquivo será anexado a uma resposta privada; salve-o antes que a resposta desapareça.

- `/export config`: valores de configuração do servidor (exclui chaves e credenciais API).
- `/export personal config`: configurações de perfil pessoal (privacidade, tags de aparência, nomenclatura).
- `/export memories`: memórias do servidor, com escopo para a persona principal, uma persona ou todas as personas. Os limites de canal não são exportados, então as memórias importadas se aplicam em todos os canais até que você escolha os canais novamente.
- `/export personal memories`: memórias pessoais, com escopo global ou individual.

`/persona export` é feito para compartilhamento, portanto ele posta a definição da persona, incluindo o
lorebook da persona, no canal em vez de nas suas DMs. Escolha `Cartão TomoriBot` ou `JSON Bruto` para
manter todas as configurações da persona. `PNG compatível com SillyTavern` inclui o avatar e os campos de personagem
suportados, excluindo configurações específicas do TomoriBot e limites de canal do lorebook.

Em servidores, `/persona export` exige `Gerenciar Servidor`, a menos que um administrador ative `Exportações de Persona`
em `/moderation` > `Acesso de Membros` > `Editar Permissões`. Isso se aplica a todos os formatos. As recusas são
privadas; as exportações bem-sucedidas são sempre publicadas publicamente. `Exportar Sprites` está disponível para
administradores do servidor através de `/config`.
A configuração do servidor não afeta exportações em DMs.

Escolha `Pacote TomoriBot` para um ZIP com o avatar, sprites, referência de personagem e configurações da persona.
Defina `include_voice:true` para incluir também o áudio de referência de voz atribuído e a transcrição; eles
são compartilhados publicamente com o ZIP. IDs de voz e credenciais de provedores são excluídos. Importe o ZIP
com `/persona import` para restaurar a persona e sua mídia em pacote em um único envio.

As exportações de pacote otimizam cópias de imagem e podem reduzir sua resolução para caber no orçamento por imagem;
os originais armazenados permanecem inalterados. Um pacote que exceda o limite de tamanho de envio ou importação é recusado
sem descartar recursos. Se isso acontecer, exclua o áudio de voz ou use um cartão PNG e `Exportar Sprites`
separadamente. Guarde o ZIP se a importação relatar uma falha na restauração de mídia: as configurações da persona podem
já ter sido salvas, e um alter importado deve ser removido antes de tentar novamente.

A mídia de expressão carregada é armazenada no host do servidor e está fora dessas exportações JSON. Os auto-hosters devem fazer backup do armazenamento de banco de dados e dos ativos de mídia juntos; consulte [backups de mídia personalizados](/self-hosting/maintenance/#database-backups-and-recovery-keys).

## Importe Seus Dados

Anexe um arquivo exportado para restaurá-lo:

- `/import config`: configuração do servidor (requer Gerenciar Servidor). Escolha quais seções aplicar.
- `/import personal config`: configurações pessoais. Escolha quais seções detectadas serão aplicadas.
- `/import memories`: memórias do servidor (requer Gerenciar Servidor). Mesclar ou substituir e mapear personas.
- `/import personal memories`: memórias pessoais. Mesclar ou substituir e mapear personas.
- `/persona import`: restaurar uma persona. Também importa cartões SillyTavern PNG, cartões JSON e arquivos `.charx` (consulte [Suporte SillyTavern](/pt-BR/features/integrations/sillytavern-support/)).

## Exclua Seus Dados

Estas ações removem ou redefinem permanentemente os dados armazenados:

- `/record data`: exclua os trechos de gravação do seu servidor atual após confirmação; interrompa a coleta separadamente com `/record stop`.
- `/personal memories`: gerencie ou remova memórias pessoais.
- `/memories`: gerencie ou remova memórias do servidor, documentos e lorebooks. Documentos e lorebooks
  exigem `Gerenciar Servidor`. Com o ensino por membros ativado, os membros podem ver, editar ou remover
  suas próprias memórias do servidor. Quando desativado, ver e gerenciar memórias do servidor exige `Gerenciar Servidor`.
- `/personal nuke`: exclui permanentemente todos os dados pessoais dos servidores.
- `/nuke`: limpa os dados do servidor, incluindo expressões personalizadas e regras de acesso pessoal. Defina `preserve_personas: true` para manter personas enquanto remove expressões e mídia personalizadas.
- `/reset config`: restaura a configuração do servidor para os padrões do banco de dados.
  - **Preserva**: atribuições de modelos ativos, chaves API, endpoints personalizados, personas, memórias de servidor e integrações.
  - **Limpas**: substituições de canais, regras de acionamento automático, listas negras de usuários e listas brancas de canais.
  - Requer a permissão Gerenciar Servidor em servidores; também disponível em DMs.
- `/reset personal config`: restaura as configurações de perfil pessoal e destaques do canal para os padrões.
  - **Preserva**: identidade do usuário, memórias pessoais, chaves API do provedor salvas, endpoints personalizados e tarefas agendadas.
  - **Clears**: substituições de apelidos, tags de aparência, pronomes, estilo de endereçamento e destaques do canal.
  - Disponível para todos os usuários em servidores e DMs.

Para tabelas exatas de banco de dados e listas de colunas preservadas, consulte [arquitetura de esquema de banco de dados](/en/architecture/subsystems/database-schema/#reset-domain-classifications).

## Optando por Sair

- `/personal config`: controle sua visibilidade, até a invisibilidade total (optando por sair do contexto de memória), e desative as [Menções de Personas](/features/chatting-personality/natural-nudges/#ping-user), os toques ociosos em que uma persona menciona você para iniciar uma conversa.
- `/config` > `Permissões`: os gerenciadores de servidores podem desativar os recursos de autoaprendizado e memória.

Consulte [Memória](/features/knowledge/memory/long-term-memory/) para gerenciamento diário de memória.
