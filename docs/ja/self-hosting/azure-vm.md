---
title: "Azure VMのデプロイ"
sidebar:
  order: 4
---

TomoriBotのAzure VMデプロイパスは、公開されているボットイメージを `deploy/azure/docker-compose.yml` とともに実行します。このComposeファイルは意図的に小さく保たれており、Azureリソースのプロビジョニング、イメージのビルド、シークレットの作成は行いません。これらの部分はTerraformとCIによって提供されます。

## ランタイムの契約

| 項目 | 値 |
|---|---|
| Composeファイル | `deploy/azure/docker-compose.yml` |
| サービス名 | `tomoribot` |
| イメージ入力 | `TOMORIBOT_IMAGE` |
| ホストのシークレットファイル | `/etc/tomoribot/secrets.json` |
| コンテナのシークレットファイル | `/run/secrets/tomoribot.json` |
| シークレットの環境変数 | `SECRET_FILE=/run/secrets/tomoribot.json` |
| ヘルスチェック | `curl -f http://localhost:8081/healthz` |

ヘルスポートはVM上の `127.0.0.1:8081` にバインドされています。これはSSH経由でのデプロイ検証用であり、パブリックな受信アクセス用ではありません。

## シークレットファイル

VMのシークレットファイルは、既存のAWSやGCPの本番環境シークレットBLOBと同じJSONの形状を使用します。最初に `SECRET_FILE` が読み込まれます。現在のCloud Runデプロイのフォールバックとして `GCP_SECRET_FILE` は残されています。

Cloudflare R2の場合、JSONに以下のストレージフィールドを含めてください。

```json
{
  "S3_ENDPOINT": "https://<account_id>.r2.cloudflarestorage.com",
  "AWS_ACCESS_KEY_ID": "<r2-access-key-id>",
  "AWS_SECRET_ACCESS_KEY": "<r2-secret-access-key>",
  "AVATAR_S3_BUCKET": "tomoribot-assets",
  "AVATAR_S3_REGION": "auto",
  "AVATAR_S3_PREFIX": "avatars",
  "AVATAR_PUBLIC_BASE_URL": "https://assets.example.com",
  "VOICE_SAMPLE_S3_BUCKET": "tomoribot-assets",
  "VOICE_SAMPLE_S3_REGION": "auto",
  "VOICE_SAMPLE_S3_PREFIX": "voice-samples",
  "VOICE_SAMPLE_PUBLIC_BASE_URL": "https://assets.example.com",
  "CHARREF_S3_BUCKET": "tomoribot-assets",
  "CHARREF_S3_REGION": "auto",
  "CHARREF_S3_PREFIX": "charreferences",
  "CHARREF_PUBLIC_BASE_URL": "https://assets.example.com"
}
```

TomoriBotがJSONを読み込んだ後、AWS SDKは `process.env` から `AWS_ACCESS_KEY_ID` と `AWS_SECRET_ACCESS_KEY` を読み取ります。 `S3_ENDPOINT` により、S3クライアントはR2に対してパス形式のインクエストを使用するようになります。

## アセットURLの書き換え

切り替え前に、本番環境のデータベースに対してドライランを実行します。

```sh
bun run scripts/devtools/migrateAssetUrls.ts --from https://old-assets.example.com --to https://assets.example.com --dry-run
```

ペルソナのアバター、ペルソナとプリセットのスプライト、共有プリセットのアバター、音声サンプル、NovelAIのキャラクター参照URLに保存されている一致するプレフィックスを書き換えるには、`--dry-run` を削除します。

## オプションのSearXNG

Composeファイルには `searxng` プロファイルが含まれていますが、デフォルトでは有効になっていません。後で有効にする場合は、`SEARXNG_IMAGE` を承認済みのイメージに設定し、`SEARXNG_BASE_URL=http://searxng:8080/` を指定してボットに公開します。
