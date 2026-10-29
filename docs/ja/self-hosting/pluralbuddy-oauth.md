---
title: "PluralBuddy OAuth設定"
description: "承認されたPluralBuddyインスタンスからのメッセージを検証するように、セルフホストのTomoriBotを認証します。"
sidebar:
  order: 8
---

セルフホストのTomoriBotは、公式サービスおよび承認された各カスタムインスタンスに対して認証済みのPluralBuddyアプリケーションを必要とします。

[公開デプロイ済みボット](https://discord.com/oauth2/authorize?client_id=841644102059556915) を使用している場合、このホスト側のセットアップを完了する必要はありません。`/personal message-proxy service:pluralbuddy` でPluralBuddyを選択してください。詳細は [メッセージプロキシのサポート](/features/integrations/message-proxy-support/#pluralbuddy) を参照してください。

## 開始する前に

- 移行済みのPostgreSQLデータベースに対して、最新のTomoriBotバージョンを実行します。
- ブラウザがあり、そのデータベースおよびTomoriBotの暗号化キーにアクセスできるコンピューターを使用します。認証ヘルパーはそのコンピューターのループバックアドレスでリッスンします。データベースがリモートにある場合は、このコンピューターからの一時的かつ制限されたアクセスを手配してください。
- 未使用のローカルポートを選択し、開発者ポータルで正確なコールバックURLを1つ登録します（例：`http://127.0.0.1:<port>/oauth/callback`）。このURLを記録しておきます。以下のすべてのステップで使用します。

## 公式インスタンスの認証

1. [PluralBuddy開発者ポータル](https://pluralbuddy.app/developers/applications) にサインインし、OAuthアプリケーションを作成します。テストには別のアプリケーションを使用してください。`profile` と `offline_access` を選択します。上記で選択したとおりにコールバックを登録します。クライアントIDとシークレットは秘密にしておきます。
2. TomoriBotリポジトリから、公式インスタンスIDと同じコールバックを指定してヘルパーを実行します：

   ```sh
   bun scripts/db/authorize-pluralbuddy-instance.ts pluralbuddy:official <callback-url>
   ```

3. ターミナルのプロンプトでクライアントIDとシークレットを入力します。出力された認証URLをそのコンピューターのブラウザで開き、PluralBuddyにサインインして同意画面を承認します。ヘルパーは1回のコールバックまたは3分後に終了し、PostgreSQLに接続を保存します。
4. 同じデータベースと暗号化キーでTomoriBotを起動します。PluralBuddyを使用しているDiscordアカウントで `/personal message-proxy service:pluralbuddy` を選択し、Webhookの再投稿を送信してTomoriBotがオルタを認識することを確認します。

ヘルパーはデータベース設定と暗号化キーを `.env` または `SECRET_FILE` JSONバンドルから読み取ります。バンドルはリポジトリの外部に保管し、暗号化キーをバックアップしてください。クライアントシークレットは `.env` に保存したり引数として渡したりせず、プロンプトで入力してください。PluralBuddyが接続を取り消した場合は、同じインスタンスIDで認証をやり直してください。

## 承認済みインスタンスの追加

パス、クエリ、またはフラグメントのない公開HTTPSオリジンを使用します。インスタンスはプロキシボットと対応するAPIの両方を実行している必要があります。

1. デプロイデータベースへのアクセス権を持つコンピューターで、無効化されたインスタンスを登録します：

   ```sh
   bun scripts/db/register-message-proxy-instance.ts register pluralbuddy https://<instance-host> "<display-name>" <bot-user-id>
   bun scripts/db/register-message-proxy-instance.ts inspect
   ```

   PluralKitの場合は、サービスとして `pluralkit` を使用します。ボットユーザーIDを指定することで、そのボットが存在しないサーバーでの不要なルックアップ待機を回避できます。
2. PluralBuddyの場合は、上記と同じループバックコールバックパターンを使用して、そのインスタンスで個別のOAuthアプリケーションを登録します。登録によって返されたインスタンスIDを使用して認証します：

   ```sh
   bun scripts/db/authorize-pluralbuddy-instance.ts <instance-id> <callback-url>
   ```

   認証情報を置き換える場合や、取り消されたリフレッシュトークンから回復する場合は、認証をやり直してください。PluralKitではこの手順は不要です。
3. 一致するプロキシボットによって書き込まれたメッセージから、そのDiscord再投稿IDと送信者アカウントIDを記録します。インスタンスAPIがその再投稿を解決することを確認してから、有効化します：

   ```sh
   bun scripts/db/register-message-proxy-instance.ts enable <instance-id> <repost-id> <sender-id>
   ```

   新しいフォークの場合は、ユーザー向けに有効化する前に、使い捨てのデプロイ環境でボット、OAuthの交換と更新、およびTomoriBotのルックアップをテストしてください。
4. ユーザーは `/personal message-proxy service:pluralbuddy instance:<name>` で有効化されたインスタンスを選択します。`instance` を空のままにすると公式インスタンスが選択されます。インスタンスを無効化すると、保存されているプロファイルを変更することなく新しいルックアップが停止します。

カスタムプロキシボットが置き換えられた場合は、インスタンスを再度提供する前にDiscordボットユーザーIDを更新してください：

```sh
bun scripts/db/register-message-proxy-instance.ts set-bot <instance-id> <bot-user-id>
```

カスタムインスタンスを無効化または削除するには：

```sh
bun scripts/db/register-message-proxy-instance.ts disable <instance-id>
bun scripts/db/register-message-proxy-instance.ts remove <instance-id>
```

削除するとOAuth接続が削除され、そのオリジンが二度と登録できなくなります。インスタンスを再開する可能性がある場合は `disable` を使用してください。既存のアイデンティティと記憶は引き続き利用可能であり、再起動なしで変更が有効になります。

ユーザーのセットアップについては [メッセージプロキシのサポート](/features/integrations/message-proxy-support/#pluralbuddy) を、トークンの保存とリフレッシュの動作については [メッセージプロキシのアーキテクチャ](/architecture/integrations/message-proxy/) を参照してください。
