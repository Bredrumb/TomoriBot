---
title: "Manutenção & Backups"
sidebar:
  order: 5
---

Operação diária de uma instância de hospedagem própria: os scripts de manutenção, como atualizar, e como fazer backup e restaurar seu banco de dados. Estas são operações do lado do host — você as executa a partir de um shell, não do Discord. Para os fluxos de exportar/importar/excluir por usuário dentro do Discord, veja [Manuseio de Dados](/pt-BR/features/knowledge/data-handling/) em vez disso.

Se você está prestes a fazer `git pull` de uma nova versão, leia [Migração Segura](/pt-BR/self-hosting/safe-migration/) primeiro — ela cobre a realização de backup *antes* que o executor de migração na inicialização toque no seu esquema.

## Scripts de manutenção

| Comando | Descrição |
|---|---|
| `bun run setup` | Abre o assistente de configuração para a instalação base e módulos opcionais. |
| `bun run update` | Faz backup primeiro, em seguida puxa o código mais recente e instala as dependências. |
| `bun run backup` | Cria um pacote em `backups/` com o dump do seu BD e `.env` — contém todos os seus dados. |
| `bun run restore-backup` | Restaura `.env` e o banco de dados a partir de um pacote (`--latest` ou `--from backups/<dir>`). |
| `bun run backup:personas` | Exporta APENAS personas (com memórias do servidor) em todos os servidores; reimporte via `/persona import`. |
| `bun run nuke-db` | Remove todas as tabelas (inicie o bot depois para reinicializar). |
| `bun run purge-commands` | Limpa todos os comandos de barra registrados do Discord. |
| `bun run rotate-keys` | Recriptografa todos os campos criptografados para a versão atual da chave. |

`bun run backup` e `bun run update` exigem as ferramentas de cliente do PostgreSQL (`pg_dump`, `psql`) no seu PATH.

## Atualizando

Pare o bot em execução primeiro, depois use o atualizador com backup prévio:

```sh
bun run update
```

Isso executa `bun run backup`, seguido de `git pull --rebase --autostash` e então `bun install --frozen-lockfile`. O pacote de backup é gravado em `backups/` e inclui tanto o dump do banco de dados quanto o `.env`. Adicione `--skip-backup` para pular o backup pré-atualização. Alternativa manual:

```sh
bun run backup
git pull --rebase --autostash
bun install --frozen-lockfile
```

Executando a partir de `dist/`? Use `bun run update --build`. Executando via Docker Compose? Use `bun run update --docker`.

## Backups e restauração

`bun run backup` cria um pacote com carimbo de data/hora em `backups/` (ou em seu `TOMORI_BACKUP_DIR` caso tenha sido substituído no `.env`) contendo todo o seu banco de dados PostgreSQL mais o `.env`. Restaure o pacote mais recente com:

```sh
bun run restore-backup --latest
```

Ou restaure um pacote específico:

```sh
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

`bun run backup:personas` é uma exportação mais restrita — apenas predefinições de persona e memórias do servidor por persona, através de todos os servidores. Ele **deve** ser reimportado manualmente via `/persona import` e **não pode** ser usado com `restore-backup` (isso causaria conflitos de chave primária).

O TomoriBot também faz **backups automáticos na inicialização** em ambientes não produtivos, e uma restauração completa requer que a extensão `pgvector` esteja presente no banco de dados de destino. Ambos são abordados em detalhes em [Migração Segura](/pt-BR/self-hosting/safe-migration/), juntamente com um procedimento manual de `pg_dump` / `pg_restore` se você preferir conduzir as ferramentas diretamente.

## Backups com Docker Compose

O Docker Compose suporta backups automáticos na inicialização dentro do contêiner do aplicativo. Os pacotes são gravados no diretório `backups/` do host porque o Compose o monta dentro do contêiner.

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

Scripts do lado do host, como `bun run backup`, `bun run update` e `bun run nuke-db`, não são executados automaticamente através do Docker. Para executar scripts do host no banco de dados do Compose em vez disso, execute-os no host com Bun e as ferramentas de cliente do PostgreSQL instaladas, e defina:

```dotenv
POSTGRES_HOST=localhost
POSTGRES_PORT=15432
POSTGRES_USER=tomori
POSTGRES_PASSWORD=your_password
POSTGRES_DB=tomodb
```

## Reinstalação limpa

`bun run nuke-db` remove todas as tabelas; iniciar o bot depois reinicializa o esquema, os dados iniciais e as migrações do zero. Use-o junto com um `bun run backup` recente quando você quiser começar com a lousa limpa, mas ainda puder reverter — nunca o execute sem um backup atual.

## Veja também

- [Migração Segura](/pt-BR/self-hosting/safe-migration/) — fazendo backup antes de puxar as atualizações, e o pré-requisito de restauração do `pgvector`
- [Manuseio de Dados](/pt-BR/features/knowledge/data-handling/) — fluxos de exportar/importar/excluir por usuário dentro do Discord
- [Assistente de Configuração](/pt-BR/self-hosting/setup-wizard/) — a instalação guiada por `bun run setup`
