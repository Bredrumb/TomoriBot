---
title: "Configuração: Crawl4AI (Sidecar)"
sidebar:
  order: 4
---
# Configuração: Crawl4AI Sidecar

> **Nota:** Esta tradução é fornecida para conveniência. A versão em inglês é a oficial e controla em caso de divergências.

A ferramenta `fetch_url` usa o motor in-process `safe_http` por padrão. Ela pode opcionalmente tentar um sidecar de renderização de navegador em ambientes de desenvolvimento confiáveis quando você precisa de conteúdo renderizado para páginas pesadas em JS.

A ordem padrão do motor é `safe_http`. Como o Crawl4AI segue redirecionamentos fora do cliente HTTP protegido do TomoriBot, ele só é admitido onde a busca em rede privada é permitida. Fora da produção isso é automático: nenhuma configuração é necessária. Na produção, requer um opt-in explícito `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`, o que não é recomendado.

O Crawl4AI é um sidecar de markdown renderizado por navegador. Ele executa um navegador headless baseado no Playwright e extrai markdown amigável para LLM no lado do servidor usando seus próprios filtros de conteúdo: não é necessário pós-processamento do lado do TomoriBot.

Escolha um caminho de configuração do Crawl4AI:

### A. Docker Compose (quando o TomoriBot roda no Docker)

Use este caminho se você rodar o TomoriBot com a stack Docker Compose do repositório. Primeiro, defina `CRAWL4AI_BASE_URL=http://crawl4ai:11235/` e `FETCH_URL_ENGINE_ORDER=crawl4ai,safe_http` no `.env`. Fora da produção nenhum opt-in de rede privada é necessário; adicione apenas `FETCH_URL_ALLOW_PRIVATE_NETWORK=true` se você rodar essa stack com `RUN_ENV=production`.

Em seguida, inicie com:

```sh
docker compose --profile fetch-crawl4ai up -d
```

Isso inicia a stack Compose com o sidecar do Crawl4AI na rede Docker do TomoriBot.

Se você rodar o TomoriBot diretamente com `bun run dev`, use o caminho standalone abaixo em vez disso.

Se você também quiser o sidecar SearXNG, encadeie os perfis:

```sh
docker compose --profile searxng --profile fetch-crawl4ai up -d
```

Se você ativar a autenticação por token de API do Crawl4AI, defina `CRAWL4AI_TOKEN` no `.env`; o Compose o passa para o contêiner como `CRAWL4AI_API_TOKEN`, e o TomoriBot o envia como um bearer token.

---

### B. Docker Standalone (quando rodar `bun run dev`)

Primeiro, defina `CRAWL4AI_BASE_URL=http://localhost:11235/` e `FETCH_URL_ENGINE_ORDER=crawl4ai,safe_http` no `.env` para que o bot se conecte à porta do contêiner publicada no host. Fora da produção nenhum opt-in de rede privada é necessário; adicione apenas `FETCH_URL_ALLOW_PRIVATE_NETWORK=true` se você rodar com `RUN_ENV=production`.

Então, em vez de rodar o TomoriBot diretamente com `bun run dev`, use `bun run launch --crawl4ai`. Isso gerencia o ciclo de vida do contêiner automaticamente e espera que o sidecar esteja saudável antes de iniciar o bot:

```sh
bun run launch --crawl4ai
```

Se você também quiser o sidecar SearXNG:

```sh
bun run launch --searxng --crawl4ai
```

Se você preferir gerenciar o contêiner você mesmo, mantenha `CRAWL4AI_BASE_URL=http://localhost:11235/` no `.env` e rode:

**PowerShell:**

```powershell
docker run -d --name crawl4ai -p 11235:11235 --shm-size=3g `
  unclecode/crawl4ai:latest
```

**Bash (Linux/macOS):**

```bash
docker run -d --name crawl4ai -p 11235:11235 --shm-size=3g \
  unclecode/crawl4ai:latest
```

Se você proteger o sidecar, passe `-e CRAWL4AI_API_TOKEN=your_token` para `docker run` e defina `CRAWL4AI_TOKEN=your_token` no `.env`.

Então rode `bun run dev` assim que o contêiner estiver saudável (`docker ps` mostra `(healthy)`).

---

### C. Nenhum Sidecar de Navegador

Deixe `CRAWL4AI_BASE_URL` não definido. A ferramenta `fetch_url` usa o motor protegido `safe_http`.

---

## Ordem de Inicialização (Importante)

O TomoriBot sonda a saúde do sidecar na **primeira chamada de `fetch_url` após a inicialização** e armazena o resultado em cache por 60 segundos. Se o contêiner não estiver pronto quando a primeira sondagem for disparada, o bot o trata como indisponível pelo próximo minuto.

Para o Docker standalone, inicie seu contêiner de sidecar antes de iniciar o TomoriBot. `bun run launch --crawl4ai` já faz isso para você.

### Configuração da primeira vez

1. Inicie o contêiner e espere até que ele mostre `(healthy)` em `docker ps`:
   ```powershell
   docker ps
   ```
2. Defina `CRAWL4AI_BASE_URL` no `.env` usando o valor para o seu caminho de configuração acima.
3. Inicie o TomoriBot (`bun run dev` ou `docker compose up`).

### Retornando após um reinício

Se o contêiner já existe de uma execução anterior, use `docker start` em vez de `docker run` para evitar um conflito de nomes:

```powershell
# Inicie um contêiner existente
docker start crawl4ai

# Confirme que está saudável antes de iniciar o TomoriBot
docker ps
```

Então inicie o TomoriBot normalmente. Reiniciar `bun run dev` redefine o cache de saúde na memória, então desde que o contêiner esteja pronto primeiro, o motor correto será escolhido imediatamente.

---

## Injeção de Cookies (Buscas Autenticadas: Opcional)

O Crawl4AI suporta a injeção de cookies a nível de navegador para que o navegador headless pareça já logado ao buscar uma página. Isso é útil para sites que exigem uma sessão para visualizar conteúdo (ex: notícias pagas, fóruns privados, painéis restritos por login).

O fallback `safe_http` **não** suporta a injeção de cookies: os cookies só se aplicam quando o Crawl4AI está ativo.

> **Limitação:** A injeção de cookies contorna paredes de login, mas não a impressão digital de bots (bot fingerprinting). Sites com detecção agressiva de bots (notavelmente Twitter/X) detectam o Playwright headless através de fingerprinting de canvas/WebGL e servem páginas vazias mesmo com cookies de sessão válidos. A injeção de cookies funciona bem para sites que bloqueiam apenas na autenticação.

### Obtendo seus cookies

1. Abra seu navegador e faça login no site de destino.
2. Abra o DevTools (`F12`) → guia **Application** → **Storage** → **Cookies** → selecione o domínio do site.
3. Copie o `Value` de cada cookie necessário (tipicamente um token de sessão: verifique os nomes dos cookies do site).

### Crawl4AI

Defina `CRAWL4AI_COOKIES_JSON` no `.env` como um array JSON:

```dotenv
CRAWL4AI_COOKIES_JSON=[{"name":"session","value":"YOUR_SESSION_TOKEN","domain":".example.com"}]
```

Quando isso é definido, `fetch_url` muda automaticamente do endpoint `/md` para `/crawl` com `browser_config.cookies`: `/md` não suporta injeção de cookies.

### Campos do objeto de cookie

| Campo | Obrigatório | Descrição |
|---|---|---|
| `name` | Sim | Nome do cookie |
| `value` | Sim | Valor do cookie |
| `domain` | Não | Escopo de domínio (ex: `.x.com`). Recomendado para correção. |
| `path` | Não | Escopo de caminho. O padrão é `/` se omitido. |

> **Nota:** Os valores dos cookies são sensíveis: trate-os como senhas. Eles concedem acesso de sessão total à sua conta. Não faça commit do `.env` no controle de versão.

---

## Ordem do Motor & Variáveis de Ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `CRAWL4AI_BASE_URL` | não definido | Ativa o Crawl4AI quando definido. Use `http://crawl4ai:11235/` do Docker Compose, ou `http://localhost:11235/` quando o TomoriBot rodar diretamente na sua máquina. |
| `CRAWL4AI_TOKEN` | não definido | Token bearer opcional. Deve corresponder a `CRAWL4AI_API_TOKEN` no contêiner do Crawl4AI quando ativado. |
| `FETCH_URL_ENGINE_ORDER` | `safe_http` | Lista de motores separados por vírgula. `safe_http` é sempre anexado como o fallback final; o nome legado `mcp_fetch` o apelida. As entradas do Crawl4AI são ignoradas onde a busca em rede privada não é permitida (produção sem um opt-in). |
| `FETCH_URL_TIMEOUT_MS` | `15000` | Timeout de requisição por motor para o Crawl4AI e sidecars de fetch de URL. |
| `FETCH_URL_MAX_CONTENT_LENGTH` | `50000` | Máximo de caracteres retornados por uma chamada de fetch antes que a continuação seja exigida. |
| `FETCH_URL_HEALTHCHECK_CACHE_SEC` | `60` | Por quanto tempo o resultado da sondagem de saúde do Crawl4AI fica em cache antes de verificar novamente. |
| `FETCH_URL_ALLOW_PRIVATE_NETWORK` | `false` | Opt-in apenas para produção. Fora da produção (`RUN_ENV` != `production`) o guarda SSRF relaxa automaticamente, então buscas no localhost/rede privada/interna e o despacho do Crawl4AI funcionam sem configuração. Defina `true` apenas para permitir buscas em rede privada em uma implantação de produção confiável. |
| `FETCH_URL_FILTER_MODE` | `fit` | Modo de filtro `/md` do Crawl4AI. `fit` mantém o markdown mais limpo para uso de LLM; `fetch_url(..., raw=true)` o substitui por requisição. |
