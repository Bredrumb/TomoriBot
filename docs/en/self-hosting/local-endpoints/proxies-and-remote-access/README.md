---
title: "Proxies & Remote Access"
sidebar:
  label: "Overview"
  groupLabel: "Proxies & Remote Access"
  order: 8
---

Connect TomoriBot through a local API proxy, or securely reach an engine running on another computer.

## Choose a guide

1. [ChatMock](/self-hosting/local-endpoints/proxies-and-remote-access/setup-chatmock/): connect a ChatGPT-backed bridge on your machine.
2. [CLIProxyAPI](/self-hosting/local-endpoints/proxies-and-remote-access/setup-cliproxyapi/): install a proxy and register models from an authorized backend.
3. [Cloudflare Tunnel](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/): give a local engine an HTTPS URL for a separately hosted bot.
4. [Optional: Access and Caddy](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-access-and-caddy/): add a separate authentication check and stricter API routing.

Start with the proxy guide if you need one. Follow the Cloudflare guide only when the bot runs on another machine.

## Account risk
<!-- anchor: account-risk -->

:::danger[Use CLI account proxies at your own risk]
Using Codex, Claude Code, Antigravity, or another CLI account through a third-party bridge may violate the provider's terms and lead to account suspension or termination. A paid subscription or successful login does not establish permission for bot or general-purpose API use. Check the rules for your provider, plan, and authentication method. TomoriBot provides no account-safety guarantee.
:::

Provider rules differ:

- [OpenAI's terms](https://openai.com/policies/terms-of-use/) apply to individual account use, with separate terms for API and business services. Review the terms that apply to your Codex account and the bridge's access method.
- [Anthropic's authentication policy](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use) restricts subscription OAuth use and third-party routing on behalf of users. It directs developers building services to API keys or supported cloud providers.
- [Google's Antigravity terms](https://antigravity.google/terms) explicitly prohibit third-party access such as Antigravity OAuth bridges and allow suspension or termination. This guide does not recommend that access method.

Use only backends you are authorized to access. For provider-supported integrations, use TomoriBot's built-in provider where available, such as Google with a [Gemini API key](https://ai.google.dev/gemini-api/docs/api-key), or an authorized API endpoint. CLIProxyAPI, the original CLI/application, and the upstream model service are separate products.
