---
title: Política de Privacidade
description: Como o TomoriBot oficial hospedado coleta, usa e exclui seus dados.
aiGenerated: false
---

*Aviso: Esta é uma tradução fornecida por conveniência. Em caso de conflito, a versão em inglês prevalece.*

Última atualização: 2026-10-22

Esta política se aplica ao TomoriBot oficial hospedado no Discord, incluindo uso pessoal, uso em Servidores e solicitações patrocinadas. Se você usar hospedagem própria, você controla seus dados; esta política não se aplica à sua cópia.

## Privacidade em resumo

- O TomoriBot lê mensagens recentes para responder e envia o contexto relevante ao provedor de IA selecionado. As gravações de conversa opcionais salvam trechos de mensagens após a confirmação do proprietário da gravação; o modo de mensagens ao redor pode incluir outros participantes. A memória de curto prazo opcional salva resumos.
- Mantemos as configurações, memórias e arquivos que você ou seu Servidor escolhem salvar. Algumas memórias do Servidor podem descrever membros que não forneceram essas informações.
- Assinaturas pagas acrescentam vínculos de conta, patrocínios e registros de uso para fornecer benefícios e acompanhar a franquia compartilhada. Não coletamos sua senha do Patreon nem dados de cartão.
- Você pode consultar ou excluir a maioria dos dados salvos por comandos. Registros de assinatura exigem uma solicitação separada ao suporte. Excluir dados do bot não cancela a cobrança do Patreon.

## 1) A quem esta política se aplica

Isso inclui membros cujas mensagens o TomoriBot lê, mesmo que nunca usem um comando. Os gerenciadores do Servidor devem informar os membros sobre o bot e esta política. Consulte os documentos atuais com `/legal privacy-policy` e `/legal terms-of-service`, ou veja os [Termos de Serviço](/legal/terms-of-service/).

## 2) O que armazenamos e por quê

Usamos dados salvos para fornecer os recursos que você escolhe, lembrar suas preferências, gerenciar acesso pago e manter o serviço funcionando.

### 2.1) Sua conta e preferências

Armazenamos seu ID de usuário do Discord, escolhas de privacidade e as informações de perfil e preferências que você escolhe salvar. Também mantemos totais de uso para você consultar estatísticas suas, do Servidor e de suas personas. Suas preferências salvas incluem se as personas podem mencionar você para iniciar uma conversa (Menções de Personas).

### 2.2) Memórias e configurações do Servidor

Mantemos memórias pessoais e do Servidor, personalizações de personas, lembretes e configurações do Servidor para fornecer os recursos configurados.

Quando uma persona inicia uma conversa por conta própria (Natural Nudges), registramos qual persona falou, o canal, se alguém respondeu e o membro mencionado. Também salvamos o objetivo privado da persona para aquela conversa, que pode mencionar esse membro.

A memória de curto prazo opcional salva resumos de conversas. Outras memórias salvas podem descrever pessoas que não as escreveram. Elas permanecem até serem excluídas, com a exceção de que o decaimento de memória pode remover uma memória não utilizada para abrir espaço quando o bot salva uma nova. Memórias que alguém adicionou ou editou com `/memories` ou `/personal memories` nunca são removidas dessa forma.

O decaimento de memória se aplica a memórias do Servidor e pessoais. Se um modelo de embedding estiver configurado, armazenamos dados de busca calculados a partir de cada memória e registramos quão recentemente cada uma surgiu em conversa, para que o bot possa recordar memórias relevantes. Os dados de busca são excluídos junto com a respectiva memória. Configurações de privacidade que impedem o uso de memória pessoal também mantêm essas memórias fora da busca.

### 2.3) Chaves de API e serviços conectados

Armazenamos chaves de API, endereços de serviço e dados de autenticação fornecidos para provedores de IA, endpoints personalizados e servidores MCP, além dos vínculos entre canais do Discord e salas do Matrix. O serviço hospedado também gerencia credenciais de acesso por assinatura. As credenciais armazenadas são criptografadas.

### 2.4) Arquivos que você salva

Mantemos o texto e as informações dos arquivos da base de conhecimento para o bot pesquisá-los. Também armazenamos imagens de personas e, para clonagem de voz, amostras de voz e transcrições.

### 2.5) Registros do serviço

Registros de erros e desempenho ajudam a investigar problemas. Podem incluir IDs do Discord, nomes de comandos e detalhes de erros, mas não conversas nem conteúdo de mensagens. Também mantemos identificadores de mensagens para gerenciar as mensagens enviadas pelo bot.

### 2.6) Associações e uso da assinatura

Vincular o Patreon conecta sua conta do Discord à sua associação no Patreon. Recebemos do Patreon seu nível, status de pagamento e datas de cobrança para determinar seus benefícios.

Mantemos patrocínios, suas autorizações, totais de franquia e gastos e detalhes de solicitações, como modelo, recurso, custo, quantidade de tokens, horário e identificadores. O uso em um Servidor patrocinado é associado a esse Servidor e descontado da franquia do patrocinador.

Registros temporários de login e atualização de associação ajudam a proteger o vínculo de contas e evitar atualizações duplicadas. Seus próprios tokens de login do Patreon não são mantidos após a vinculação.

### 2.7) Gravações de conversa

As [gravações de conversa](/features/setup-administration/conversation-recordings/) são opcionais e têm escopo limitado ao proprietário da gravação e ao Servidor. Após a confirmação, uma nova mensagem real do proprietário pode salvar essa mensagem e até dez mensagens elegíveis anteriores no mesmo canal ou tópico, mesmo sem uma resposta do bot. O contexto pode ser anterior à ativação. O modo de mensagens ao redor pode incluir outros membros, bots e webhooks cujos participantes não iniciaram uma gravação.

Armazenamos texto normalizado de mensagens e embeds, carimbos de data/hora, limites ordenados de trechos, rótulos de quem fala, relações de resposta elegíveis e metadados de tipo/quantidade de anexos. Não salvamos bytes de anexos, nomes de arquivos, URLs de anexos, OCR ou descrições de mídia geradas por meio deste recurso. O texto de embeds inclui títulos, descrições, campos, nomes de autores e rodapés, com a mesma substituição de identidade do texto das mensagens. Identificadores de origem restritos oferecem suporte a propriedade, desduplicação, exclusões de privacidade e edições/exclusões observadas.

Antes de armazenar o corpo das mensagens, identidades estruturadas do Discord e nomes/apelidos conhecidos únicos e exatos se tornam marcadores legíveis, como `[SELF]` e `[PARTICIPANT_1]`. Nomes compartilhados ambíguos são ignorados; palavras comuns usadas como nomes podem ser substituídas mesmo quando significam outra coisa. Emojis personalizados perdem seus IDs numéricos e links de mensagens do Discord se tornam um marcador genérico. Texto livre e URLs externas comuns ainda podem identificar pessoas. A substituição é feita da melhor forma possível e não torna as gravações anônimas.

O operador do bot armazena esses registros e pode ter acesso à infraestrutura. Os controles do Discord permitem que apenas o proprietário no Servidor atual os exporte ou exclua, sem substituição por gerentes. A gravação não faz chamadas automáticas a provedores de IA e não inicia nenhum pipeline de treinamento.

## 3) O que lemos sem salvar

O TomoriBot lê temporariamente mensagens recentes, mídia relevante, informações do Servidor e canal e dados de presença disponíveis para responder. O processamento comum de respostas em si não arquiva o histórico de chat. Gravações opcionais, resumos de memória de curto prazo e arquivos salvos deliberadamente são tratados na Seção 2.

## 4) Quem recebe seus dados

- **Provedores de IA:** o provedor selecionado recebe o prompt, contexto relevante da conversa, informações da persona e mídia necessários para texto, imagens, vídeo, voz ou pesquisa em documentos. Antes de uma persona mencionar alguém, o modelo do Servidor também recebe o nome desse membro, a atividade atual e memórias pessoais recentes, a menos que o nível de privacidade dele oculte essas informações. Solicitações por assinatura usam o OpenRouter e os provedores do modelo selecionado. Consultamos gastos com o OpenRouter para aplicar a franquia.
- **Patreon:** a vinculação nos autoriza a verificar sua associação. O Patreon fornece atualizações de conta e associação; o Patreon e seus provedores de pagamento tratam pagamentos e dados de pagamento.
- **Provedores de pesquisa:** quando a pesquisa na web é usada, o provedor recebe consultas e contexto relevante.
- **Matrix:** quando uma ponte está configurada, mensagens são compartilhadas entre o canal do Discord e a sala do Matrix vinculados.
- **Provedores de hospedagem e armazenamento:** processam e armazenam os dados necessários para executar o TomoriBot.

Esses serviços podem processar dados fora do seu país e têm suas próprias políticas de privacidade e retenção. Não vendemos dados pessoais; compartilhamos para fornecer os recursos que você usa ou quando exigido por lei.

## 5) Por quanto tempo mantemos os dados

| Dados | Retenção |
|---|---|
| Trechos de gravações de conversa | 90 dias após a mensagem que iniciou o trecho. A cota lógica de 100 MiB por proprietário entre Servidores pode remover os trechos completos mais antigos mais cedo. |
| Chaves de API de provedores e serviços opcionais fornecidas pelo usuário, incluindo as de rotação | 90 dias sem tentativas de requisições autenticadas |
| Resumos da memória de curto prazo | 90 dias após a última atividade, por padrão |
| Registros de erros | 90 dias |
| Registros de desempenho e identificadores de mensagens do bot | 30 dias |
| Registros do Natural Nudges | 30 dias; o objetivo privado da persona por até 90 dias |
| Registros de atualização de associação do Patreon | 30 dias, por padrão |
| Registros de login do Patreon concluídos ou expirados | Elegíveis para exclusão após uma hora, por padrão |
| Uso detalhado da assinatura | 90 dias; registros do período atual ficam até seu fim, se for posterior |
| Backups de recuperação do banco de dados | Sete dias |
| Backups automáticos na inicialização | Até cinco cópias; cópias antigas são removidas quando novas são criadas |
| Vínculos de associação, status de acesso, patrocínios e chaves gerenciadas | Enquanto houver vínculo; solicite desvinculação ou exclusão ao suporte |
| Identificadores de associação e totais de franquia/gastos mantidos após desvinculação | 90 dias após o último destes eventos: desvinculação, fim do período pago e conclusão da exclusão da chave do provedor |
| Outras configurações, memórias, credenciais e arquivos salvos | Até serem excluídos pelos controles da Seção 6 |

Respostas de erro do provedor contam como atividade da chave. Chaves nunca usadas contam a partir da inclusão ou substituição; chaves já salvas quando o rastreamento é introduzido recebem 90 dias completos de carência. Cadastre novamente uma chave removida em `/providers` ou `/personal providers` para restaurar o serviço. A remoção do banco não revoga a chave no provedor nem apaga backups retidos.

Registros expirados são removidos na limpeza agendada. Podemos manter registros contábeis relevantes por mais tempo para uma disputa específica não resolvida ou obrigação legal, removendo-os quando essa necessidade terminar. Totais de gastos podem sobreviver à exclusão do uso detalhado. Dados excluídos podem permanecer em backups retidos: os de recuperação do banco expiram após sete dias, enquanto os da inicialização ficam até serem substituídos. Cópias separadas para recuperação ou migração são excluídas quando esse trabalho termina.

Remover o bot mantém os dados do Servidor para um novo convite; execute `/nuke` antes para excluí-los. Cancelar a cobrança não exclui registros de associação.

## 6) Consultar, exportar ou excluir seus dados

| O que você quer fazer | Onde fazer |
|---|---|
| Controlar a visibilidade de mensagens e o uso da memória pessoal | `/personal config` |
| Impedir que as personas mencionem você para iniciar uma conversa | `/personal config` > `Privacidade` > `Menções de Personas` |
| Consultar ou remover memórias pessoais | `/personal memories` |
| Consultar ou remover memórias e documentos do Servidor | `/memories` |
| Exportar ou excluir suas gravações do Servidor atual | `/record data`; Markdown ou JSON versionado, anexos de interação privada, exclusão confirmada por intervalo ou de todos os registros |
| Parar de coletar novos trechos sem excluir os salvos | `/record stop` |
| Exportar configurações ou memórias pessoais | `/export personal config`, `/export personal memories` |
| Exportar configurações ou memórias do Servidor | `/export config`, `/export memories` |
| Redefinir configurações pessoais | `/reset personal config` |
| Apagar os dados pessoais descritos abaixo em todos os Servidores | `/personal nuke` |
| Apagar dados de um Servidor (somente gerenciadores) | `/nuke` |

`/personal nuke` exclui suas configurações pessoais, memórias, credenciais e configurações de provedores salvas, contagens de uso e lembretes criados por você ou definidos para você. Excluir seu feedback também pode afetar o comportamento de uma persona para outros membros.

Suas memórias e documentos do Servidor ficam, sem a associação de autoria; peça a um gerenciador para excluí-los com `/memories`. Se uma memória ou documento compartilhado contém seus dados pessoais e você não consegue a remoção, contate-nos diretamente pela Seção 9. Não é necessária a permissão de um gerenciador para solicitar análise e remoção.

As configurações de privacidade limitam a visibilidade de mensagens e a personalização; não apagam memórias existentes. Suas escolhas de não participar da coleta permanecem após a exclusão para que ela não seja reativada silenciosamente. Sua escolha para Menções de Personas é uma configuração de personalização, portanto o `/personal nuke` a apaga; desative as Menções de Personas novamente depois se ainda quiser mantê-las desativadas.

As exportações de gravações continuam disponíveis após a perda de acesso ao canal de origem, sujeitas às exclusões de privacidade e retenção atuais. Os intervalos de datas selecionam trechos pelo horário de acionamento à meia-noite UTC, com o início incluído e o fim excluído. Edições observadas reaplicam a substituição de identidade; exclusões de origem únicas e em massa observadas removem as cópias armazenadas. Exclusões de privacidade posteriores removem os dados armazenados afetados. Não podemos garantir o recebimento de eventos enquanto estivermos offline ou após alterações de acesso. A exclusão em tempo real não revoga exportações baixadas nem reescreve backups, que seguem os ciclos de vida separados na Seção 5. Excluir gravações mantém a coleta ativada a menos que você também a interrompa.

Para assinaturas, use o painel de assinatura para consultar sua franquia e patrocínios ou parar de patrocinar um Servidor. Cancele a renovação pelo Patreon; parar um patrocínio ou excluir dados do bot não interrompe a cobrança.

Contate-nos pela Seção 9 para acessar, desvincular ou apagar registros de assinatura; exportações comuns e `/personal nuke` não os incluem. A desvinculação remove o vínculo de conta, acesso, patrocínios e uso local detalhado, e solicita a exclusão da chave gerenciada do provedor. Registros contábeis limitados podem permanecer conforme a Seção 5.

## 7) Como protegemos seus dados

Credenciais de acesso armazenadas são criptografadas. As conexões com o banco de dados são criptografadas e verificam a identidade do servidor. O acesso é restrito ao ambiente de execução do bot e aos operadores com acesso à infraestrutura.

Nenhum sistema é completamente seguro. Evite fornecer informações altamente sensíveis ou dados que exijam tratamento especial.

## 8) Dados de crianças

O TomoriBot não se destina a pessoas abaixo da idade mínima do Discord em seu país, que é de pelo menos 13 anos. Não coletamos conscientemente dados de pessoas abaixo dessa idade. Contate-nos se acreditar que mantemos esses dados, e nós os excluiremos. Alguns provedores e recursos de assinatura têm exigências de idade maiores, conforme os Termos de Serviço.

## 9) Contato

Para questões de privacidade ou solicitações que os comandos não atendem, envie um e-mail para `bredrumb@gmail.com` ou contate-nos no [servidor oficial de suporte do TomoriBot no Discord](https://discord.gg/bjCfHm9QsB). Use e-mail ou mensagem direta para dados pessoais ou questões de segurança, em vez de uma issue pública no GitHub.

## 10) Alterações

Anunciamos alterações relevantes pelo Discord de suporte ou repositório do projeto e atualizamos a data no topo desta política.

## 11) Usuários internacionais e GDPR

Se você está no EEE, Reino Unido ou Suíça, a legislação de proteção de dados aplicável lhe dá direitos de acessar, corrigir, apagar, restringir e receber uma cópia portátil de seus dados, além de se opor ao processamento. Use os controles acima ou contate-nos.

Processamos dados para cumprir nosso acordo com você, incluindo fornecer recursos solicitados e benefícios pagos. Baseamo-nos em interesses legítimos para fornecer conversas em grupo configuradas pelo Servidor, proteger o serviço, evitar abuso e concessões duplicadas de franquia e manter a confiabilidade, considerando os direitos e escolhas de privacidade dos membros. Um gerenciador ativar um recurso não significa que todos os membros consentiram. Você pode usar os controles de privacidade acima ou contatar-nos para se opor ao processamento.
