---
title: "Docker Compose"
sidebar:
  order: 3
aiGenerated: true
---

Docker Compose executa TomoriBot e PostgreSQL juntos em contêineres. É a terceira opção de instalação junto com o [assistente de configuração](/pt-BR/self-hosting/setup-wizard/) e [configuração manual](/pt-BR/self-hosting/manual-setup/): escolha-a quando quiser executar tudo no Docker sem instalar Bun ou PostgreSQL em seu sistema host. Ele ignora o assistente de configuração interativo e configura a conexão com o banco de dados automaticamente.

:::caution[Host tools for updates]
`bun run update --docker` precisa do host Bun e Git para obter alterações de código. Seu backup de banco de dados é executado dentro do contêiner do aplicativo. Você também pode executar backups e restaurações manuais por meio do Compose; consulte [Manutenção e backups](/pt-BR/self-hosting/maintenance/).
:::

## 1. Obtenha o código

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## 2. Valores `.env` obrigatórios

Comece pelo arquivo de exemplo:

```sh
cp .env.example .env
```

Defina estas variáveis obrigatórias em `.env`:

| Variável | Valor |
|---|---|
| `DISCORD_TOKEN` | Seu token de bot Discord (habilite as intenções privilegiadas `GuildMembers`, `MessageContent` e `GuildPresences`). |
| `CRYPTO_SECRET` | Uma chave de criptografia de 32 caracteres usada para criptografar chaves API armazenadas. |
| `POSTGRES_PASSWORD` | A senha do banco de dados. Todos os outros valores `POSTGRES_*` são configurados automaticamente. |

Gere um valor aleatório de 32 caracteres para `CRYPTO_SECRET` usando Docker e copie-o para `.env`:

```sh
docker run --rm alpine:3.22 sh -c "head -c 24 /dev/urandom | base64"
```

Gere uma senha separada para `POSTGRES_PASSWORD`. Você pode copiar configurações de ajuste opcionais do `.env.optional.example`.

:::note[Database connection is automatic]
Não defina `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER` ou `POSTGRES_DB` em `.env`; O Compose os configura automaticamente.
:::

No Linux, crie os diretórios bind-mount no host e atribua propriedade ao UID 1001 antes de iniciar os contêineres. Docker cria pontos de montagem ausentes como raiz, o que impede que o contêiner do bot salve backups, logs ou uploads:

```sh
mkdir -p backups logs data
sudo chown 1001:1001 backups logs data
```

## 3. Compilar e executar

```sh
docker compose build   # first time, or after code/dependency changes
docker compose up      # bot + database
```

Para inícios posteriores, apenas `docker compose up` é suficiente, a menos que você altere o código ou as dependências. Assim que o bot se conectar ao Discord, execute `/setup` em qualquer canal do servidor para adicionar sua chave de provedor de IA. Consulte o [Início rápido](/pt-BR/introduction/quickstart/) para opções de configuração em Discord.

Componha os pinos `RUN_ENV=development` em sua definição de serviço para que os segredos `.env` e os terminais HTTP locais funcionem. A verificação de integridade do contêiner informa se o processo do bot está em execução; ele não testa a conectividade do gateway Discord. Para diferenças no modo de produção (`RUN_ENV=production`) (gerenciadores secretos, restrições de rede e métricas), consulte [Arquitetura de segurança](/en/architecture/subsystems/security/).

## Configuração opcional de shards em um único host

Deixe `SHARD_COUNT` e `SHARD_IDS` indefinidos para o comportamento padrão: um único processo assume todos os shards recomendados pelo Discord na inicialização. Instalações pequenas normalmente recebem um shard. Este modo não usa concessões de shards (leases) nem ouvinte de invalidação de cache. Vários shards podem compartilhar o mesmo processo.

Para executar quatro shards no serviço existente, adicione `SHARD_COUNT=4` ao `.env` e deixe `SHARD_IDS` indefinido. Adicione esta sobreposição de serviço no `compose.override.yaml` para permitir que o encerramento ordenado termine:

```yaml
services:
  tomoribot:
    stop_grace_period: 40s
```

Recrie o serviço com `docker compose up -d --build tomoribot`. Se um script chamar `docker stop` ou definir seu próprio tempo limite de parada do Compose, permita pelo menos 40 segundos lá também. A seleção automática não altera o número de shards durante a execução; alterar o total exige uma reinicialização coordenada.

Subconjuntos estáticos opcionais exigem um serviço separado por grupo com o mesmo `SHARD_COUNT` explícito e `SHARD_IDS` disjuntos, por exemplo `0,1` e `2,3` com um total de `4`. Dê aos serviços nomes estáveis distintos, nomes de contêiner e quaisquer portas de integridade publicadas. O aplicativo deriva rótulos de métricas estáveis a partir de cada grupo. Mantenha um único banco de dados, execute a inicialização única existente `bun run src/db/initializeCli.ts` com credenciais de gerenciamento de esquema antes da inicialização do gateway e configure `DATABASE_SCHEMA_MANAGEMENT_ENABLED=false` em cada processo do gateway. Não inicie o serviço original com todos os shards junto a esses grupos. Interrompa os processos antigos antes de alterar o total ou a partição.

O modo de subconjunto recusa uma ponte Matrix totalmente configurada. Os limites de turnos e envios por usuário permanecem por processo; portanto, avalie se esse limite multiplicado é aceitável antes de ativar um segundo processo. Instalações que utilizam a cobrança de apoiadores exclusiva da versão de release também exigem admissão de gastos compartilhada e coordenação de conciliação antes de atender a solicitações financiadas a partir de múltiplos processos. Consulte [sharding e propriedade de processos](/architecture/subsystems/sharding/) para conhecer os limites de segurança e integridade.

## 4. Servidores locais opcionais (Perfis do Compose)

Execute servidores auxiliares locais opcionais com perfis do Compose para iniciar apenas o que precisa:

```sh
# SearXNG (private web search) + Crawl4AI (browser-rendered fetch)
docker compose --profile searxng --profile fetch-crawl4ai up
```

Ao ativar SearXNG, defina `SEARXNG_BASE_URL=http://searxng:8080/` em `.env`. Caso contrário, deixe-o sem definição. Defina `SEARXNG_SECRET` com um valor aleatório separado para assinatura de solicitação SearXNG.

Consulte [SearXNG](/pt-BR/self-hosting/local-endpoints/setup-searxng/), [Crawl4AI](/pt-BR/self-hosting/local-endpoints/setup-crawl4ai/) e [Monitoramento local](/pt-BR/self-hosting/local-monitoring/) para configuração específica do servidor.

## Manutenção, atualização e backups

Use `bun run update --docker` para atualizações de backup inicial em implantações do Compose. Para fazer backup ou restaurar seu banco de dados Compose, consulte [Manutenção e backups](/pt-BR/self-hosting/maintenance/).
