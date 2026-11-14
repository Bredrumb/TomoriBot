---
title: "ChatMock"
sidebar:
  label: "ChatMock"
  order: 1
---

Connect TomoriBot to a local Chat Completions bridge using [ChatMock](https://github.com/RayBytes/ChatMock).

:::danger[Use CLI account proxies at your own risk]
Third-party access through a CLI account may violate provider terms and risk account suspension. A subscription does not establish permission for bot/API use. Review the [account-risk guidance](/self-hosting/local-endpoints/proxies-and-remote-access/#account-risk) before signing in; TomoriBot provides no account-safety guarantee.
:::

## 1. Start ChatMock

1. Install ChatMock using its [repository instructions](https://github.com/RayBytes/ChatMock).
2. If your account and access method permit this use, authenticate and start the server:

```sh
chatmock login
chatmock serve
```

3. Confirm the local API is reachable at `http://127.0.0.1:8000/v1`.

## 2. Configure TomoriBot

1. Run `/providers` or `/personal providers` and add an `OpenAI-Compatible` custom endpoint.
2. Enter the connection settings:

| Field | Value |
|---|---|
| Endpoint URL | `http://127.0.0.1:8000/v1` when the bot runs on this machine outside production |
| Auth token | The bridge's client key if authentication is enabled |

3. Select the saved endpoint and add a Text Model with the exact API ID ChatMock exposes. Register more IDs under the same connection to switch models.

- A bare `http://127.0.0.1:8000` normalizes to `/v1`; do not append `/chat/completions`.
- Allow `127.0.0.1:8000` in TomoriBot's development `ALLOW_PRIVATE_NETWORK` setting. Docker's loopback refers to the container.
- Enable tools, images, or structured output only after testing the bridge and selected model. Keep video off.
- For a separately hosted production bot, follow [Cloudflare Tunnel](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/). Production requires public HTTPS. Direct loopback/port-based ChatMock prompt detection does not apply to the tunnel's public hostname, so validate system-instruction behavior separately. Account login authorizes ChatMock's upstream requests; it does not authenticate clients of your public endpoint. Review the tunnel guide's [known risks](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/#known-risks) before sharing.

:::note[System prompt handling and port configuration]
TomoriBot detects a loopback endpoint on `CHATMOCK_PORT` (default `8000`) and converts system instructions into an initial user turn for ChatMock compatibility. Set `CHATMOCK_PORT` to match a different local ChatMock port.
:::
