---
title: "Manutenção & Backups"
sidebar:
  order: 5
aiGenerated: true
---

Gerencie sua instância autohospedada do TomoriBot usando scripts de manutenção CLI para atualizar código, fazer backup ou restaurar dados, rotacionar chaves de criptografia e inspecionar variáveis de ambiente. Execute esses comandos no terminal do seu host ou ambiente Docker. Para exportações e exclusões de dados no Discord, consulte [Manipulação de dados](/features/knowledge/data-handling/).

O TomoriBot aplica migrações de banco de dados pendentes na inicialização. Algumas podem remover dados e não são revertidas automaticamente, portanto faça backup antes de atualizar ou alternar entre branches.

## Scripts de manutenção

| Comando | Descrição |
|---|---|
| `bun run setup` | Abre o assistente de configuração para instalação base e módulos opcionais. |
| `bun run update` | Faz backup primeiro, depois puxa o código mais recente e instala as dependências. |
| `bun run backup` | Cria um pacote em `backups/` com o dump do seu banco de dados e os metadatos de versão de criptografia necessários. Os segredos ficam separados. |
| `bun run restore-backup` | Restaura o banco de dados usando chaves de criptografia provisionadas separadamente (`--latest` ou `--from backups/<dir>`). |
| `bun run backup:personas` | Exporta APENAS personas (com memórias do servidor) em todos os servidores; reimporte via `/persona import`. |
| `bun run nuke-db` | Remove todas as tabelas (inicie o bot depois para reinicializar). |
| `bun run purge-commands` | Limpa todos os comandos de barra registrados no Discord. |
| `bun run rotate-keys --bot-stopped` | Recriptografa todos os campos criptografados para a versão atual da chave. |
| `bun run env-doctor` | Verificação somente leitura da sua configuração: lista as entradas do `.env` que nada lê (apenas nomes, nunca valores) e onde cada variável é usada. |

No host, `bun run backup` precisa de `pg_dump`, e `bun run restore-backup` precisa de `psql` no seu PATH. `bun run update` precisa de `pg_dump` para seu backup. O caminho de atualização com `--docker` executa o backup dentro do contêiner, portanto precisa de Bun, Git e Docker no host, mas dispensa ferramentas do PostgreSQL no host.

Para avatares locais, mantenha os webhooks gerenciados do TomoriBot: excluí-los impede que o bot edite mensagens de webhook mais antigas.

## Limpeza de chaves de API inativas

Defina `API_KEY_INACTIVITY_DAYS` com um número inteiro positivo e reinicie o bot para ativar a limpeza
de credenciais do banco de dados. Deixe a variável indefinida para desativar a exclusão. Por exemplo:

```dotenv
API_KEY_INACTIVITY_DAYS=90
```

As chaves expiram após essa quantidade de dias sem nenhuma requisição autenticada. Respostas de falha do provedor contam
como atividade. Chaves nunca utilizadas envelhecem a partir da inserção ou substituição; chaves existentes recebem um período de carência completo
quando o rastreamento de atividade é instalado pela primeira vez. O rastreamento continua com a exclusão desativada, então ativar a
política mais tarde pode remover imediatamente chaves que já estejam inativas. A limpeza é executada na inicialização e a cada hora em lotes
limitados no processo principal.

A política abrange chaves de API do servidor, pessoais, de rotação adicional e de serviços opcionais. As configurações de modelos
salvas permanecem. Uma chave de rotação adicional elegível pode substituir uma chave primária expirada automaticamente. Insira novamente uma chave removida por meio de `/providers` ou `/personal providers` para restaurar o serviço;
as seleções de fala também podem precisar ser escolhidas novamente. Credenciais do host, incluindo Vertex ADC, permanecem
sob o controle do operador.

A remoção do banco de dados não revoga a chave no provedor nem apaga backups retidos. Revogue chaves
comprometidas pelo console do provedor. Recursos do lado do provedor, como vozes criadas, também podem exigir
remoção manual após a limpeza da chave armazenada. Configure a retenção de backup separadamente.

## Backups de banco de dados e chaves de recuperação
<!-- anchor: database-backups-and-recovery-keys -->

Os pacotes de banco de dados contêm dados privados e um inventário das versões de criptografia necessárias. Eles não contêm `.env` nem arquivos de mídia. Proteja o pacote e guarde cada chave de criptografia necessária separadamente; sem uma chave antiga, credenciais criptografadas com ela não poderão ser recuperadas.

Para restaurar um backup confiável:

1. Pare todas as instâncias do bot. Configure o banco de dados de destino, o token do Discord e as chaves de criptografia originais.
2. Instale o `psql` e as extensões de banco de dados necessárias, incluindo `pgvector`. A conta do banco de dados deve ter permissão para habilitar `pgcrypto`, ou um administrador deve habilitá-lo primeiro.
3. Execute `bun run restore-backup --latest` ou `bun run restore-backup --from backups/<diretorio-do-pacote>`. Verifique o destino e confirme as solicitações. A restauração verifica as chaves antes de qualquer comando SQL destrutivo.
4. Execute `bun run audit-keys` e `bun run rotate-keys --dry-run` antes de reiniciar. Se as credenciais precisarem de migração, execute `bun run rotate-keys --bot-stopped` e audite novamente. Se a restauração falhar, mantenha o bot parado: instruções SQL anteriores já podem ter alterado o banco de dados.

Faça backup do diretório local `data/` separadamente, incluindo avatares, amostras de voz e `data/custom-expressions/`. Restaure os arquivos nos mesmos caminhos. Para expressões no GCS ou S3, faça backup dos objetos de `custom-expressions/` e restaure suas chaves no mesmo bucket configurado. Expressões vinculadas dependem de seus hosts externos.

Em ambientes que não sejam de produção, a inicialização cria um backup do banco de dados quando a versão do bot muda ou o backup mais recente tem pelo menos `TOMORI_AUTO_BACKUP_INTERVAL_HOURS` de idade (24 horas por padrão). O sistema retém `TOMORI_AUTO_BACKUP_MAX` backups (5 por padrão); defina `TOMORI_AUTO_BACKUP_ENABLED=false` para desativar isso. Esses backups não incluem mídia nem chaves de criptografia.

Pacotes mais antigos podem conter segredos em `config.env`. A restauração não o carrega; revise-o em ambiente privado e forneça as chaves necessárias por meio da sua fonte normal de segredos.

## Armazenamento de gravações de conversa
<!-- anchor: conversation-recording-storage -->

As [gravações de conversa](/features/setup-administration/conversation-recordings/) armazenam trechos do servidor autorizados no seu
banco de dados. O modo de mensagens ao redor pode incluir outros participantes. Proteja o acesso ao banco de dados e aos
backups como dados de conversa privados; a substituição de identidade não torna o texto anônimo.

Para expirar trechos salvos por idade, defina `RECORD_RETENTION_DAYS` como um número inteiro positivo, por exemplo
`RECORD_RETENTION_DAYS=30`, no ambiente do bot e reinicie todas as instâncias. Deixe a variável ausente
para não expirar por idade. Valores vazios, zero, negativos, fracionários ou de outra forma inválidos falham na validação
de inicialização. Use o mesmo valor em todas as instâncias que compartilham um banco de dados.

O limite se aplica a trechos existentes bem como a novos, medido a partir do carimbo de data/hora do acionamento.
Leituras e gravações impõem a expiração; a limpeza no processo principal executa lotes limitados a cada minuto.
A limpeza física pode levar vários lotes. A duração da coleta apenas controla quando a captura é interrompida.
A cota lógica de 100 MiB por proprietário entre servidores ainda se aplica quando a expiração por idade está desativada e pode
remover trechos completos mais antigos mais cedo. O uso físico do banco de dados/índices pode diferir dessa cota.

Os backups do banco de dados incluem dados de gravação. A retenção em tempo real, a poda de privacidade e a exclusão não reescrevem
pacotes de backup ou exportações baixadas. Defina um ciclo de vida de backup separado, proteja cópias de recuperação e
revise os dados restaurados antes de reabrir o bot: exclusões de origem perdidas não podem ser reconstruídas a partir de
eventos de gateway. As exportações de gravações são trechos de origem e não podem restaurar o banco de dados. Consulte o
[contrato de arquitetura](/architecture/subsystems/conversation-recording/) para a propriedade do ciclo de vida.

## Rotacionando chaves de criptografia
<!-- anchor: rotating-encryption-keys -->

1. Faça backup do banco de dados e mantenha todas as chaves existentes em armazenamento protegido. Teste a recuperação em um banco de dados descartável antes de desativar qualquer chave.
2. Gere uma nova chave com `openssl rand -base64 32`. Adicione-a à fonte de segredos do bot como `CRYPTO_SECRET_V<version>` e selecione-a com `CRYPTO_SECRET_CURRENT`. Mantenha as versões mais antigas; `CRYPTO_SECRET` é a V1.
3. Pare todas as instâncias do bot e processos que gravam credenciais. Use a mesma fonte de segredos e configurações de banco de dados do bot; scripts de produção também precisam de `RUN_ENV=production`.
4. Execute `bun run audit-keys` e `bun run rotate-keys --dry-run`. Ambos devem ter êxito antes de prosseguir.
5. Execute `bun run rotate-keys --bot-stopped`, depois `bun run audit-keys`. Se algum deles falhar, mantenha o bot parado e todas as versões de chave disponíveis enquanto você corrige a falha.
6. Teste um banco de dados descartável restaurado com a chave atual retida. Teste backups mais antigos com suas chaves arquivadas antes de remover versões antigas da fonte de segredos ativa. Mantenha as chaves arquivadas enquanto seus backups existirem e, em seguida, reinicie o bot.

`--bot-stopped` registra sua confirmação; ela não pode detectar outra instância em execução nem limpar seu cache de credenciais.

## Atualizando

Pare o bot em execução primeiro e depois use o atualizador com backup prévio:

```sh
bun run update
```

O atualizador faz backup do banco de dados, puxa o código e instala dependências. Use `--build` se você executar a partir de `dist/`. Para o Compose, consulte [Docker Compose](/self-hosting/docker-compose/#maintenance-updating-and-backups). Faça backup de mídias e chaves de criptografia separadamente.

Use um banco de dados separado para testar branches: alternar de volta não desfaz migrações. Se uma migração falhar, mantenha o bot parado, verifique os logs e siga as etapas de recuperação acima antes de retornar à versão anterior. Registre o commit atual com `git rev-parse HEAD` antes de atualizar para ajudar na recuperação.

### Alterações de ambiente

Execute `bun run env-doctor` para encontrar configurações não utilizadas no `.env`. Os tempos de recarga de comandos usam `COMMAND_COOLDOWN_SCALE` (padrão `1`; `0` desativa os tempos de recarga).

Servidores locais de TTS não autenticam mais solicitações com as antigas configurações de token de portador. Revise [Acesso à rede](/self-hosting/local-endpoints/text-to-speech/#network-access) antes de expô-los além da sua máquina. Cada mecanismo usa sua própria configuração de porta.

## Backups e restauração

```sh
bun run backup
bun run restore-backup --latest
# Ou escolha um pacote:
bun run restore-backup --from "backups/<diretorio-do-pacote>"
```

Os pacotes são armazenados em `backups/` ou `TOMORI_BACKUP_DIR`. Siga as [etapas de recuperação](#database-backups-and-recovery-keys) antes de restaurar. `bun run backup:personas` exporta personas e memórias do servidor para `/persona import`; ele não pode restaurar um banco de dados.

## Backups com Docker Compose

O Docker Compose suporta backups automáticos na inicialização dentro do contêiner do aplicativo. Os pacotes são gravados no diretório `backups/` do host porque o Compose o monta no contêiner.

Para um backup manual no Docker:

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run backup
docker compose start tomoribot
```

Para uma restauração no Docker:

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run restore-backup --latest
docker compose up -d
```

## Reinstalação limpa

`bun run nuke-db` remove todas as tabelas; iniciar o bot depois reinicializa o esquema, dados iniciais e migrações do zero. Use-o junto com um `bun run backup` recente quando você quiser começar com uma base limpa, mas ainda puder reverter: nunca o execute sem um backup atual.
