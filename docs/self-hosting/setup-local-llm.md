---
title: "Setup: Local LLM"
sidebar:
  order: 4
---

TomoriBot can use any OpenAI-compatible local LLM server for text generation and embeddings.
This guide walks through **Ollama** as the canonical example, then lists the small
differences for KoboldCPP, LM Studio, vLLM, and LiteLLM.

:::note[No env vars needed]
Local models are registered through Discord slash commands and stored encrypted in the
database — there's no `.env` setting for them. See the [local endpoints hub](./local-endpoints).
:::

## 1. Run your model server

Install [Ollama](https://ollama.com), then pull and serve a model:

```sh
ollama pull gemma3
ollama serve            # listens on http://127.0.0.1:11434
```

Confirm it's reachable **from the machine TomoriBot runs on**:

```sh
curl http://127.0.0.1:11434/v1/models
```

Note the exact installed tag — this is the Model Name you'll register:

```sh
ollama list
# NAME              ID            SIZE
# gemma3:latest     a1b2c3d4...   3.3 GB
```

## 2. Register it in Discord

Run **`/provider custom-endpoint add`** (server-wide) or **`/personal custom-endpoint add`**
(just you) with:

| Field | Value for Ollama |
|-------|------------------|
| `endpoint_label` | A name you choose, e.g. `home-ollama` |
| `capability` | `text` |
| `api_style` | `OpenAI-Compatible` (recommended) or `Ollama Native` |
| `endpoint_url` | `http://127.0.0.1:11434/v1` for OpenAI-Compatible · `http://127.0.0.1:11434` for Ollama Native |
| `auth_token` | *(leave blank)* |

:::tip[Pick the URL that matches the API style]
`OpenAI-Compatible` expects the `/v1` root (TomoriBot appends `/chat/completions` itself — do
**not** add it). `Ollama Native` expects the bare root with no `/v1`.
:::

When you submit, a modal opens. Fill in:

- **Model Name (exact API ID):** `gemma3:latest` — the exact tag from `ollama list`.
- **Display Name:** optional; leave blank to reuse the model name.
- **Context Window Override:** optional, **Ollama / KoboldCPP only**. Set this (e.g. `8192`,
  `16384`) to raise Ollama's default `num_ctx`, which is otherwise small enough to truncate
  long TomoriBot context. Leave blank to use the server default.
- **Toggles:** enable **Tools** if the model supports function calling; enable **Image
  Understanding** only for a vision model; **Structured Output** if the model handles JSON
  schemas well.

TomoriBot validates the connection on submit. If it reports the endpoint is unreachable, the
usual cause is a `localhost`/Docker mismatch or a missing/extra `/v1` (see
[gotchas](#notes--gotchas)).

## 3. Make it the active model

```text
/model text
```

Select your newly registered model. Adding an endpoint registers it; `/model` chooses which
registered model is actually used.

## 4. (Optional) Local embeddings for RAG

Repeat step 2 with `capability: embedding` and an embedding model (e.g.
`ollama pull nomic-embed-text`, Model Name `nomic-embed-text:latest`). RAG features also need
pgvector installed in Postgres — see the [manual setup](./manual-setup) guide.

## Other servers

All of these use the same flow — only the URL and a couple of notes change.

### KoboldCPP

- Start with OpenAI-compat enabled (built in). Default: `http://127.0.0.1:5001/v1`.
- `api_style`: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:5001/v1`.
- Honors the **Context Window Override** like Ollama.
- Loads GGUF models; the Model Name is whatever the loaded model reports (often the file
  stem) — check KoboldCPP's `/v1/models` response.

### LM Studio

- In LM Studio, start the **Local Server** (Developer tab). Default: `http://127.0.0.1:1234/v1`.
- `api_style`: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:1234/v1`.
- Model Name is the identifier LM Studio shows for the loaded model.

### vLLM

- Serve with the OpenAI-compatible server: `vllm serve <model>` → `http://127.0.0.1:8000/v1`.
- `api_style`: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:8000/v1`.
- If you launched vLLM with `--api-key`, put that key in `auth_token`.
- Model Name is the served model path/name (matches `/v1/models`).

### LiteLLM (proxy over many backends)

- Run the LiteLLM proxy; default: `http://127.0.0.1:4000/v1`.
- `api_style`: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:4000/v1`.
- Model Name is the model alias you defined in LiteLLM's config.
- If the proxy enforces a master key, set it in `auth_token`.

### ChatMock (ChatGPT account / Codex CLI)

Has its own dedicated guide because of a system-prompt workaround:
**[Setup: ChatMock](./setup-chatmock)**.

## Notes & gotchas

- **One connection per label.** To register several models that share one server, reuse the
  same `endpoint_label` + `capability`; the URL and API style are inherited and you only set
  a new Model Name. Use distinct labels for genuinely different servers.
- **Display Name vs Model Name.** Display Name is cosmetic (what you see in `/model`); Model
  Name is the exact string sent to the server. Getting the Model Name wrong is the most
  common "it connected but responses fail" cause.
- **Running TomoriBot in Docker?** `localhost` inside the container is not your host. Use
  `http://host.docker.internal:<port>` (Windows/macOS) or the host's LAN IP, and bind the
  model server to `0.0.0.0`.
