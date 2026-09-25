---
title: "Matrixブリッジ"
sidebar:
  order: 1
---

TomoriBotは、**Matrixルーム**とDiscordチャンネルをブリッジできます。Matrixからチャットすると、そのメッセージはWebhookメッセージとしてDiscordに転送され、彼女はMatrixルームに返信します。
このページはブリッジのユーザー側について説明しています。Appserviceの内部動作については、[Matrixブリッジのアーキテクチャ](/en/architecture/integrations/matrix/bridge/)を参照してください。

## セットアップ

1. 設定されたMatrixボットアカウントを、**暗号化されていない**Matrixルームに招待します。
2. そのルームの**内部ルームID**（Internal Room ID）をコピーします。
3. 連携させたいDiscordチャンネルで `/matrix link` を実行し、ルームIDを貼り付けます。

ボットが招待を承諾すると、Matrixルームに短いリマインダーが投稿されますが、リンクの完了には引き続きDiscordから `/matrix link` を実行する必要があります。

### ルームIDの見つけ方

ほとんどのMatrixクライアントでは、**Room Settings → Advanced → Internal Room ID**（ルーム設定 → 詳細設定 → 内部ルームID）にあります。`!abc:matrix.org` のような形式です。

## Matrixからの使用

- ルームがリンクされた後は通常通り会話してください。MatrixのメッセージはDiscordチャンネルに転送されます。
- 彼女はMatrixルームに返信します。
- Matrix側のテキストコマンドは `/kill` と `/refresh` のみです。

## 現在の制限事項

- Matrixからのスラッシュコマンドは使用できません（`/kill` と `/refresh` を除く）。
- DMや、DM経由のクールダウンリマインダーはありません。
- Matrixのプロフィール画像はTomoriBotから見えません。
- メッセージのピン留めはできません。
- カスタム絵文字やMarkdownは確実にはレンダリングされず、埋め込みはプレーンテキストとして転送されます。
- Matrixユーザーの個人の記憶は、属性付きのサーバーの記憶にフォールバックします。

## 備考

- ボットが自動参加しない場合は、手動でMatrixボットアカウントを招待し、もう一度 `/matrix link` を実行してください。
- **Matrixの暗号化は後から無効にできません**。暗号化されたルームは、新しく暗号化されていないルームに置き換える必要があります。
- 上記に記載されていない制限事項については、正常に動作するはずですので、サポートサーバー（`/support discord`）でバグを報告してください。

`/help` の **連携** から **Matrix** を選択すると、Discord内で同じガイドを確認できます。
