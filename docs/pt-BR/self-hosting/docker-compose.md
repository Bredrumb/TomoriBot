---
title: "Docker Compose"
sidebar:
  order: 3
---

O Docker Compose compila e executa o TomoriBot **e também** o PostgreSQL como contêineres. Este é o terceiro caminho de instalação ao lado do [assistente de configuração](/pt-BR/self-hosting/setup-wizard/) e da [configuração manual](/pt-BR/self-hosting/manual-setup/): escolha-o se você preferir rodar tudo no Docker em vez de instalar o Bun e o PostgreSQL no host. Ele **não** usa o assistente de configuração; a conexão com o banco de dados é configurada automaticamente para você.

:::caution[Ferramentas do host para atualizações]
`bun run update --docker` precisa de Bun e Git no host para atualizar o código. O backup do banco
de dados é executado na imagem do aplicativo. Backup e restauração manuais também podem ser
executados pelo Compose. Consulte [Manutenção e backups](/pt-BR/self-hosting/maintenance/).
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

Gere um valor aleatório de 32 caracteres para `CRYPTO_SECRET` com o Docker e copie-o para `.env`:

```sh
docker run --rm alpine:3.22 sh -c "head -c 24 /dev/urandom | base64"
```

Gere outro valor para `POSTGRES_PASSWORD`. Você pode copiar configurações opcionais de
`.env.optional.example`.

:::note[A conexão com o banco de dados é automática]
O serviço PostgreSQL do Compose é executado em modo de desenvolvimento (sem SSL) na rede interna do Docker, e a imagem empacotada já possui o `pgvector` e o `pg_cron` configurados, de modo que a memória baseada em documentos/RAG e a limpeza agendada funcionam de fábrica. Não defina `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER` ou `POSTGRES_DB` no Compose; eles são gerenciados para você.
:::

No Linux, crie os diretórios do host e atribua a propriedade ao usuário do contêiner (UID 1001)
antes da primeira inicialização. O Docker cria diretórios ausentes como root; nesse caso, o bot não
consegue gravar backups, logs ou arquivos enviados.

```sh
mkdir -p backups logs data
sudo chown 1001:1001 backups logs data
```

## 3. Compilar e executar

```sh
docker compose build   # primeira vez, ou após alterações de código/dependências
docker compose up      # bot + banco de dados
```

Para inicializações posteriores, apenas `docker compose up` é suficiente, a menos que você tenha alterado código ou dependências. Quando o bot estiver online, execute `/setup` no Discord para adicionar a chave da API do seu provedor de IA: veja o [Início Rápido](/pt-BR/introduction/quickstart/) para a parte do Discord.

O Compose usa `RUN_ENV=development` para aceitar segredos de `.env` e endpoints HTTP locais. A
verificação de saúde do aplicativo informa se o processo está em execução; ela não testa a conexão
com o Discord. `RUN_ENV=production` carrega segredos de um gerenciador ou arquivo JSON montado,
exige HTTPS e restringe URLs de redes privadas. Também altera o registro de comandos e ativa o
servidor HTTP de saúde e o coletor de métricas. O Compose fixa o modo de desenvolvimento.

## 4. Servidores locais opcionais (Perfis do Compose)

Os servidores locais são opcionais (opt-in) por meio dos perfis do Compose, para que você execute apenas o que precisar:

```sh
# SearXNG (busca web privada) + Crawl4AI (busca renderizada por navegador)
docker compose --profile searxng --profile fetch-crawl4ai up
```

Defina `SEARXNG_BASE_URL=http://searxng:8080/` em `.env` ao ativar o perfil SearXNG. Deixe a
variável vazia nos outros casos. Defina `SEARXNG_SECRET` com outro valor aleatório para a chave de
assinatura do SearXNG.

Consulte [SearXNG](/pt-BR/self-hosting/local-endpoints/setup-searxng/), [Crawl4AI](/pt-BR/self-hosting/local-endpoints/setup-crawl4ai/) e [Monitoramento Local](/pt-BR/self-hosting/local-monitoring/) para obter detalhes de cada servidor.

## Manutenção, atualização e backups

Use `bun run update --docker` para o procedimento de atualização (com backup prévio) em uma implantação usando Compose. O backup e a restauração do banco de dados do Compose (incluindo a execução de scripts do host contra ele) são abordados na página de [Manutenção e Backups](/pt-BR/self-hosting/maintenance/). Antes de baixar uma nova versão, comece com a [Migração Segura](/pt-BR/self-hosting/safe-migration/).
