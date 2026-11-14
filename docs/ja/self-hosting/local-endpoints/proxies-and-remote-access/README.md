---
title: "プロキシとリモートアクセス"
sidebar:
  label: "概要"
  groupLabel: "プロキシとリモートアクセス"
  order: 8
aiGenerated: true
---

TomoriBotをローカルAPIプロキシ経由で接続するか、別のコンピューターで実行されているエンジンへ安全に接続します。

## ガイドを選択

1. [ChatMock経由のCodex CLI](/self-hosting/local-endpoints/proxies-and-remote-access/setup-chatmock/)：お使いのマシン上でChatGPTを利用したブリッジを接続します。
2. [CLIProxyAPI](/self-hosting/local-endpoints/proxies-and-remote-access/setup-cliproxyapi/)：プロキシをインストールし、認可されたバックエンドからモデルを登録します。
3. [Cloudflare Tunnel](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/)：Access認証と本番リレーを使用して、別ホストで稼働するボットをローカルエンジンに接続します。

プロキシが必要な場合は、まずプロキシのガイドから始めてください。Cloudflareガイドは、ボットが別のマシンで実行されている場合にのみ参照してください。

## アカウントのリスク
<!-- anchor: account-risk -->

:::caution[CLIアカウントプロキシの使用は自己責任で行ってください]
Codex、Claude Code、Antigravity、またはその他のCLIアカウントをサードパーティ製ブリッジ経由で使用すると、プロバイダーの利用規約に違反し、アカウントの停止や終了につながる可能性があります。有料サブスクリプションやログインの成功は、ボットや汎用APIとしての利用許可を意味しません。ご利用のプロバイダー、プラン、および認証方法に関するルールを確認してください。TomoriBotはアカウントの安全性について一切保証しません。
:::

プロバイダーによってルールが異なります：

- [OpenAIの利用規約](https://openai.com/policies/terms-of-use/)は個人アカウントの利用に適用され、APIおよびビジネスサービスには別の規約が適用されます。ご自身のCodexアカウントおよびブリッジのアクセス方法に適用される規約を確認してください。
- [Anthropicの認証ポリシー](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use)は、サブスクリプションOAuthの利用やユーザーに代わって行うサードパーティ経由のルーティングを制限しています。サービスを構築する開発者には、APIキーまたはサポートされているクラウドプロバイダーの利用を案内しています。
- [GoogleのAntigravity利用規約](https://antigravity.google/terms)は、Antigravity OAuthブリッジなどのサードパーティによるアクセスを明示的に禁止しており、アカウントの停止または終了を認めています。このガイドではそのアクセス方法を推奨していません。

アクセス権限のあるバックエンドのみを使用してください。プロバイダーがサポートする統合については、可能な場合は[Gemini APIキー](https://ai.google.dev/gemini-api/docs/api-key)を使用するGoogleなどのTomoriBot組み込みプロバイダー、または認可されたAPIエンドポイントを使用してください。CLIProxyAPI、元のCLIまたはアプリケーション、およびアップストリームのモデルサービスはそれぞれ別個の製品です。
