---
title: "Docker Compose"
sidebar:
  order: 3
---

O Docker Compose compila e executa o TomoriBot **e também** o PostgreSQL como contêineres. Este é o terceiro caminho de instalação ao lado do [assistente de configuração](/pt-BR/self-hosting/setup-wizard/) e da [configuração manual](/pt-BR/self-hosting/manual-setup/): escolha-o se você preferir rodar tudo no Docker em vez de instalar o Bun e o PostgreSQL no host. Ele **não** usa o assistente de configuração; a conexão com o banco de dados é configurada automaticamente para você.

:::caution[Scripts do host ainda precisam das ferramentas do host]
Executar o bot e o banco de dados no Docker não conteineriza os scripts de manutenção.
`bun run backup`, `bun run restore-backup`, `bun run update`, `bun run rotate-keys` e
outros ainda são executados pelo Bun no host e pelas ferramentas de cliente do PostgreSQL no host. Consulte
[Manutenção e Backups](/pt-BR/self-hosting/maintenance/) para os procedimentos específicos do Compose.
:::

## 1. Obtenha o código

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## 2. Valores `.env` obrigatórios

Comece a partir do arquivo de exemplo:

```sh
cp .env.example .env
```

Em seguida, defina no mínimo:

| Variável | Valor |
|---|---|
| `DISCORD_TOKEN` | O token do seu bot do Discord (habilite as intents privilegiadas `GuildMembers`, `MessageContent` e `GuildPresences`). |
| `CRYPTO_SECRET` | Uma chave de criptografia de 32 caracteres usada para criptografar as chaves de API armazenadas. |
| `POSTGRES_PASSWORD` | A senha do banco de dados. Todos os outros valores `POSTGRES_*` são configurados automaticamente. |

Diferente do assistente de configuração, o Compose não gerará a `CRYPTO_SECRET` para você: defina-a você mesmo (qualquer string de 32 caracteres). Valores opcionais de ajuste podem ser copiados de `.env.optional.example`.

:::note[A conexão com o banco de dados é automática]
O serviço PostgreSQL do Compose é executado em modo de desenvolvimento (sem SSL) na rede interna do Docker, e a imagem empacotada já possui o `pgvector` e o `pg_cron` configurados, de modo que a memória baseada em documentos/RAG e a limpeza agendada funcionam de fábrica. Não defina `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER` ou `POSTGRES_DB` no Compose; eles são gerenciados para você.
:::

## 3. Compilar e executar

```sh
docker compose build   # primeira vez, ou após alterações de código/dependências
docker compose up      # bot + banco de dados
```

Para inicializações posteriores, apenas `docker compose up` é suficiente, a menos que você tenha alterado código ou dependências. Quando o bot estiver online, execute `/setup` no Discord para adicionar a chave da API do seu provedor de IA: veja o [Início Rápido](/pt-BR/introduction/quickstart/) para a parte do Discord.

## 4. Sidecars opcionais (Perfis do Compose)

Os sidecars são opcionais (opt-in) por meio dos perfis do Compose, para que você execute apenas o que precisar:

```sh
# SearXNG (busca web privada) + Crawl4AI (busca renderizada por navegador)
docker compose --profile searxng --profile fetch-crawl4ai up
```

Consulte [SearXNG](/pt-BR/self-hosting/local-endpoints/setup-searxng/), [Crawl4AI](/pt-BR/self-hosting/local-endpoints/setup-crawl4ai/) e [Monitoramento Local](/pt-BR/self-hosting/local-monitoring/) para obter detalhes de cada sidecar.

## Manutenção, atualização e backups

Use `bun run update --docker` para o procedimento de atualização (com backup prévio) em uma implantação usando Compose. O backup e a restauração do banco de dados do Compose (incluindo a execução de scripts do host contra ele) são abordados na página de [Manutenção e Backups](/pt-BR/self-hosting/maintenance/). Antes de baixar uma nova versão, comece com a [Migração Segura](/pt-BR/self-hosting/safe-migration/).
