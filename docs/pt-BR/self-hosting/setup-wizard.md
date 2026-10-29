---
title: "Assistente de Configuração"
aiGenerated: false
sidebar:
  label: "Assistente de Configuração"
  order: 1
---

:::note
Usuários que desejam usar o Docker Compose devem ignorar este assistente; veja
[Docker Compose](/self-hosting/docker-compose/) para o caminho de instalação em contêineres.
:::

`bun run setup` é o caminho de hospedagem própria recomendado para instalações locais baseadas em Bun. O comando instala as dependências a partir do `bun.lock` antes de carregar o assistente, inclusive em um clone novo. O assistente cria seu `.env`, gera um `CRYPTO_SECRET`, solicita o token do seu bot do Discord e configura o PostgreSQL. É seguro
executá-lo novamente; os valores existentes no `.env` são mantidos, a menos que você opte por reconfigurá-los.

## O que ter em mãos

- **[Bun](https://bun.sh/)** para executar o bot e o próprio assistente.
- **Um token de bot do Discord** com as intents privilegiadas `GuildMembers`, `MessageContent` e `GuildPresences`
  habilitadas.
- **PostgreSQL instalado.** O TomoriBot armazena tudo no PostgreSQL. Você não precisa configurá-lo manualmente,
  pois o assistente faz isso por você: ele usará o PostgreSQL se você já o tiver instalado, ou executará
  um para você no [Docker](https://www.docker.com/) caso não tenha. Apenas certifique-se de que um dos
  dois esteja instalado antes de começar. O TomoriBot inicializa seu esquema, dados iniciais, migrações, `pgcrypto` e o esquema de RAG
  automaticamente na primeira inicialização.

## Obter o código

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## Executar o assistente

Execute o assistente de configuração usando:

```bash
bun run setup
```

Depois de executar o comando, você escolherá um de dois caminhos:

| Caminho | Quando Usar | O Que Ele Faz |
|---|---|---|
| Full Install | Você quer a configuração recomendada com recursos extras leves. | Executa a Base Install e depois tenta instalar os extras abaixo. |
| Base Install | Você quer apenas o mínimo necessário para o bot funcionar. | Cria/configura o `.env`, token do Discord, PostgreSQL e dependências. |

### Extras da Full Install

A Full Install executa a Base Install primeiro e depois tenta instalar os extras abaixo. Se algum deles falhar, ela
exibe o comando ou guia para concluir manualmente e continua:

| Extra | Finalidade |
|---|---|
| `pgvector` | Busca vetorial para memória de documentos/RAG. |
| `pg_cron` | Limpeza opcional agendada de linhas de tempo de recarga e lembretes. |
| Ativos do tokenizador | Ativos locais de tokenizador para viés de logit com base no modelo. |

Para instalar qualquer um deles manualmente, veja os
[Extras da Configuração Manual](/self-hosting/manual-setup/#optional-extras-the-manual-full-install).

## Após a configuração

```bash
bun run dev                          # apenas o bot
bun run launch --searxng --crawl4ai  # bot + servidores locais (consulte bun run launch --help)
```

Quando o bot estiver online, execute `/setup` no Discord. Ele guiará você na conexão com um provedor de IA ou com seu endpoint personalizado.

## Atualizando

Use o comando de atualização com backup prévio: `bun run update`

Isso executa `bun run backup`, depois
`git pull --rebase --autostash` e, em seguida, `bun install --frozen-lockfile`. Adicione `--build` se você executa a partir de `dist/`,
ou `--docker` para uma implantação com Compose. Detalhes completos na
página de [Manutenção & Backups](/self-hosting/maintenance/).
