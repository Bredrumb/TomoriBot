---
title: "代理与远程访问"
sidebar:
  label: "总览"
  groupLabel: "代理与远程访问"
  order: 8
aiGenerated: true
---

通过本地 API 代理连接 TomoriBot，或者安全地访问另一台计算机上运行的引擎。

## 选择指南

1. [通过 ChatMock 使用 Codex CLI](/self-hosting/local-endpoints/proxies-and-remote-access/setup-chatmock/)：在本机连接基于 ChatGPT 的桥接服务。
2. [CLIProxyAPI](/self-hosting/local-endpoints/proxies-and-remote-access/setup-cliproxyapi/)：安装代理并从已获授权的后端注册模型。
3. [Cloudflare Tunnel](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/)：使用 Access 身份验证和生产环境中继，将独立托管的 bot 连接到你的本地引擎。

如果你需要代理，请先看对应的代理指南。仅当 bot 运行在另一台计算机上时，才需要遵循 Cloudflare 指南。

## 账号风险
<!-- anchor: account-risk -->

:::caution[使用 CLI 账号代理需自行承担风险]
通过第三方桥接使用 Codex、Claude Code、Antigravity 或其他 CLI 账号可能违反提供方条款，并导致账号被暂停或封禁。付费订阅或成功登录并不代表获得了用于 bot 或通用 API 的授权。请核对你的提供方、套餐以及认证方式对应的规则。TomoriBot 不提供任何账号安全保证。
:::

各提供方的规则有所不同：

- [OpenAI 的服务条款](https://openai.com/policies/terms-of-use/)适用于个人账号使用，而 API 和企业服务另有单独条款。请仔细查阅适用于你的 Codex 账号以及桥接访问方式的条款。
- [Anthropic 的身份验证政策](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use)限制将订阅的 OAuth 用于其他用途以及代表用户进行第三方路由。该政策要求开发服务的开发者使用 API 密钥或受支持的云提供方。
- [Google 的 Antigravity 条款](https://antigravity.google/terms)明确禁止通过第三方访问（例如 Antigravity OAuth 桥接），且允许暂停或终止账号。本指南不建议使用这种访问方式。

请仅使用你有权访问的后端。如果提供方本身支持集成，请尽量使用 TomoriBot 内置的提供方（例如使用 [Gemini API 密钥](https://ai.google.dev/gemini-api/docs/api-key)接入 Google）或已获授权的 API 端点。CLIProxyAPI、原版 CLI/应用程序与上游模型服务属于各自独立的产品。
