---
title: "ローカルのGrafanaモニタリング"
sidebar:
  order: 7
---

提供されているDocker Composeプロファイルを使用すると、GrafanaダッシュボードでローカルのTomoriBotインスタンスを監視できます。

お使いのマシンでTomoriBotとGrafanaを一緒に起動するには、以下のコマンドを実行します。

```sh
docker compose -f docker-compose.yaml -f docker/compose.monitor.yaml up -d
```

これにより、以下の処理が行われます。
- PostgreSQLを使用してTomoriBotを起動（DBはポート15432）
- 自動設定されたPostgreSQLデータソースを使用してポート3000でGrafanaを起動
- 同じDockerネットワーク上で両方のサービスを接続

[http://localhost:3000](http://localhost:3000) でGrafanaにアクセスします。
- **Username**: `admin`
- **Password**: `.env` の `GRAFANA_PASSWORD` で設定（未設定の場合はデフォルトで `admin`）

PostgreSQLデータソースは自動的に設定されており、ボットのメトリクス、データベースクエリ、パフォーマンスを監視するためのダッシュボードを作成する準備ができています。
