---
title: "Assistente de Configuração"
sidebar:
  label: "Assistente de Configuração"
  order: 1
aiGenerated: false
---

:::note
Usuários que desejam usar Docker Compose devem pular este assistente, veja
[Docker Compose](/pt-BR/self-hosting/docker-compose/) para o caminho de instalação em contêineres.
:::

`bun run setup` é o caminho de hospedagem própria (self-hosting) recomendado para instalações locais baseadas no Bun. Ele cria seu `.env`, gera um `CRYPTO_SECRET`, pede o token do seu bot do Discord, configura o PostgreSQL e instala as dependências exatas do `bun.lock` interativamente, então apenas siga os comandos. É seguro
executar novamente; os valores do `.env` existentes são mantidos, a menos que você escolha reconfigurá-los.

Execute o assistente em um terminal interativo. Se a entrada padrão vier de um pipe ou o terminal
não aceitar perguntas, o assistente avisa que usará os valores padrão disponíveis. Uma pergunta
obrigatória sem valor padrão interrompe a configuração com um erro.

## Obter o código

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## Escolha um caminho

Depois de executar o comando, você escolherá um de dois caminhos:

```bash
bun run setup
```

| Caminho | Usar Quando | O Que Ele Faz |
|---|---|---|
| Full Install | Você deseja a configuração recomendada com extras leves. | Executa Base Install e depois tenta os quatro extras abaixo. |
| Base Install | Você deseja apenas o bot funcionando com o mínimo. | Cria/configura `.env`, token do Discord, PostgreSQL e dependências. |

## O que ter pronto

- [Bun](https://bun.sh/) para rodar o bot e o próprio assistente.
- Um token de bot do Discord com as intents privilegiadas `GuildMembers`, `MessageContent` e `GuildPresences`
  habilitadas.
- Um banco de dados. O TomoriBot armazena tudo no PostgreSQL. Você não precisa configurá-lo manualmente pois
  o assistente faz isso por você: ele usará o PostgreSQL se você já o tiver instalado, ou executará
  um para você no [Docker](https://www.docker.com/) se não tiver. Apenas certifique-se de que um dos
  dois está instalado antes de começar.

:::caution
- O PostgreSQL embutido no Docker roda apenas o banco de dados no Docker. O bot em si, os backups na inicialização, `bun run backup` e `restore-backup` ainda rodam através do Bun no host e das ferramentas de cliente PostgreSQL no host. Se você preferir rodar tudo no Docker, use o
  [Docker Compose](/pt-BR/self-hosting/docker-compose/) em vez disso.
:::

Se o `psql` estiver ausente ou o provisionamento falhar, o assistente imprime o SQL para executar manualmente. De qualquer
forma, o TomoriBot inicializa seu esquema (schema), seeds, migrações, `pgcrypto` e o esquema RAG
automaticamente na primeira inicialização.

## Extras da Full Install

O Full Install executa o Base Install primeiro, depois tenta instalar os extras abaixo. Se algum falhar, ele
imprime o comando ou guia para terminar manualmente e continua:

| Extra | Propósito |
|---|---|
| `pgvector` | Busca vetorial para a memória pessoal/RAG. |
| `pg_cron` | Limpeza opcional e agendada de linhas de tempo de recarga/lembretes. |
| Ativos de tokenizador | Ativos locais de tokenizador para bias logit com base no modelo. |

Para instalar qualquer um deles manualmente, veja os
[Extras da Instalação Manual](/pt-BR/self-hosting/manual-setup/#optional-extras-the-manual-full-install).

## Após a configuração

```bash
bun run dev                          # apenas o bot
bun run launch --searxng --crawl4ai  # bot + servidores locais (veja bun run launch --help)
```

Quando o bot estiver online, execute `/setup` no Discord. Ele guiará você na conexão com um provedor de IA;
veja o [Início Rápido](/introduction/quickstart/) para o que cada passo solicita.

## Atualizando

Use o comando de atualização com backup primeiro: `bun run update`

Isso executa `bun run backup`, em seguida
`git pull --rebase --autostash`, depois `bun install --frozen-lockfile`. Adicione `--build` se você rodar a partir de `dist/`,
ou `--docker` para uma implantação Compose. Detalhes completos na
página [Manutenção & Backups](/pt-BR/self-hosting/maintenance/).
