---
title: "代理與遠端存取"
sidebar:
  label: "總覽"
  groupLabel: "代理與遠端存取"
  order: 8
aiGenerated: true
---

透過本機 API 代理連線 TomoriBot，或安全地存取在另一台電腦上運行的引擎。

## 選擇指南

1. [ChatMock](/self-hosting/local-endpoints/proxies-and-remote-access/setup-chatmock/)：在你的電腦上連線以 ChatGPT 為後端的橋接工具。
2. [CLIProxyAPI](/self-hosting/local-endpoints/proxies-and-remote-access/setup-cliproxyapi/)：安裝代理並從經授權的後端註冊模型。
3. [Cloudflare Tunnel](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/)：使用 Access 驗證與生產環境中繼，將分開架設的 bot 連線至你的本機引擎。

如果你需要代理，請先從代理指南開始。只有在 bot 運行於另一台電腦時，才需要依照 Cloudflare 指南設定。

## 帳號風險
<!-- anchor: account-risk -->

:::caution[使用 CLI 帳號代理需自行承擔風險]
透過第三方橋接工具使用 Codex、Claude Code、Antigravity 或其他 CLI 帳號，可能會違反供應商條款並導致帳號遭停權或終止。付費訂閱或成功登入並不代表獲得 bot 或一般用途 API 的使用許可。請確認適用於你的供應商、方案與驗證方式的規則。TomoriBot 不提供任何帳號安全保證。
:::

各供應商的規則不盡相同：

- [OpenAI 的條款](https://openai.com/policies/terms-of-use/)適用於個人帳號使用，API 與商業服務另有獨立條款。請檢視適用於你的 Codex 帳號與該橋接工具存取方式的條款。
- [Anthropic 的驗證政策](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use)限制訂閱制 OAuth 的使用以及代表使用者的第三方路由。該政策指示開發服務的開發者改用 API 金鑰或受支援的雲端供應商。
- [Google 的 Antigravity 條款](https://antigravity.google/terms)明確禁止 Antigravity OAuth 橋接工具等第三方存取方式，並允許將帳號停權或終止。本指南不建議採用該存取方式。

請只使用你有權存取的後端。若是供應商支援的整合方案，請在可用時使用 TomoriBot 內建的供應商（例如搭配 [Gemini API 金鑰](https://ai.google.dev/gemini-api/docs/api-key)的 Google），或經授權的 API 端點。CLIProxyAPI、原本的 CLI 或應用程式，以及上游模型服務皆為各自獨立的產品。
