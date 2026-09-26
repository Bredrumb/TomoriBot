---
title: "Configuração: SearXNG"
sidebar:
  order: 3
---

A ferramenta `web_search` é roteada através de uma cadeia de motores: **Brave → SearXNG → DuckDuckGo → IAsk**. Ao executar nossa própria instância do SearXNG, evitamos os limites de taxa de um único motor e quebras de raspagem (scrape), e desbloqueamos categorias exclusivas do SearXNG: `science`, `it`, `files` e `music`.

Escolha um caminho de configuração do SearXNG:

### A. Docker Compose (quando o TomoriBot é executado no Docker)

Use este caminho se você executar o TomoriBot com a pilha do Docker Compose do repositório. Em seguida, execute com o perfil `searxng`:

```sh
docker compose --profile searxng up -d
```
Defina `SEARXNG_BASE_URL=http://searxng:8080/` em `.env` antes de iniciar o perfil. Deixe a variável vazia quando o perfil estiver desativado.

Se você executa o TomoriBot diretamente com `bun run dev`, use o caminho autônomo (standalone) abaixo.

Defina `SEARXNG_SECRET` em `.env` com outro valor aleatório para a chave de assinatura do contêiner.

---

### B. Docker Autônomo (quando executar `bun run dev`)
Primeiro, defina `SEARXNG_BASE_URL=http://localhost:8080/` em `.env` para que o bot saiba onde se conectar.

Então, em vez de executar o TomoriBot diretamente com `bun run dev`, use `bun run launch --searxng`. Isso gerencia o ciclo de vida do contêiner automaticamente e espera que o contêiner esteja íntegro (healthy) antes de iniciar o bot:

```sh
bun run launch --searxng
```

Se preferir gerenciar o contêiner você mesmo, mantenha `SEARXNG_BASE_URL=http://localhost:8080/` em `.env` e execute:

Primeiro, compile a imagem do repositório. Ela carrega as configurações de busca em JSON e define a chave de assinatura.

```sh
docker build -t tomoribot-searxng:latest -f servers/searxng/Dockerfile servers/searxng
```

**PowerShell:**
```powershell
docker run -d --name searxng -p 8080:8080 `
  --tmpfs /etc/searxng `
  tomoribot-searxng:latest
```

**Bash (Linux/macOS):**
```bash
docker run -d --name searxng -p 8080:8080 \
  --tmpfs /etc/searxng \
  tomoribot-searxng:latest
```

Em seguida, execute `bun run dev` assim que o contêiner estiver íntegro (`docker ps` mostra `(healthy)`).
Sem `SEARXNG_SECRET` no ambiente do contêiner, a imagem gera uma chave de assinatura temporária.

---

### C. Sem SearXNG
Deixe `SEARXNG_BASE_URL` não definido. A cadeia recorrerá para `Brave → DuckDuckGo → IAsk`.

Quando nenhum servidor SearXNG está configurado, o esquema `web_search` montado não anuncia mais as categorias exclusivas do SearXNG. As categorias comuns (`text`, `image`, `video`, `news`) ainda aparecem quando o Brave está configurado, e a pesquisa apenas em texto aparece quando somente o fallback MCP do DuckDuckGo/IAsk está disponível.

---

## Ajuste de Resultados de Imagem

Os resultados de imagem do SearXNG são validados com HEAD, opcionalmente compactados e postados como anexos do Discord: uma experiência do usuário (UX) idêntica às imagens do Brave. Se todos os URLs candidatos falharem na validação, o SearXNG retornará uma lista de texto de links de imagens em vez de uma falha grave (hard failure).

| Variável | Padrão | Descrição |
|---|---|---|
| `SEARXNG_IMAGE_COUNT` | `3` (máx. 10) | Quantas imagens válidas são enviadas ao Discord. Substituído pelo argumento `count` do LLM. |
| `SEARXNG_IMAGE_POOL` | `10` | Conjunto de URLs candidatos quando o LLM não especifica `count`. Quando `count` é especificado, o conjunto é `count × 3` (limitado a 30) para absorver falhas de proteção contra hotlink. |
| `WEB_SEARCH_TIMEOUT_MS` | — | Tempo limite de solicitação por motor. |

*(Veja `.env.optional.example` para todas as opções ajustáveis.)*
