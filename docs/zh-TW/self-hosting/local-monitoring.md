---
title: 本機 Grafana 監控
sidebar:
  order: 7
---

你可以用內附的 Docker Compose profile 搭配 Grafana 儀表板，監控本機的 TomoriBot 執行個體。

要在你的機器上同時啟動 TomoriBot 與 Grafana：

```sh
docker compose -f docker-compose.yaml -f docker/compose.monitor.yaml up -d
```

這會：
- 啟動 TomoriBot 與 PostgreSQL（資料庫連接埠為 15432）
- 在連接埠 3000 啟動 Grafana，並自動設定好 PostgreSQL 資料來源
- 佈建 **TomoriBot Overview** 儀表板
- 讓兩個服務連上同一個 Docker 網路

從 [http://localhost:3000](http://localhost:3000) 存取 Grafana：
- **使用者名稱**：`admin`
- **密碼**：透過 `.env` 的 `GRAFANA_PASSWORD` 設定（未設定時預設為 `admin`）

## 佈建好的儀表板

**TomoriBot Overview** 會自動出現，不需要任何設定。它的面板涵蓋行程記憶體、快取項目數、每小時錯誤數、依模型劃分的 token 用量、依小時劃分的活動量、熱門指令、使用者語系、情緒雲，以及目前使用中的預設集與模型。

每個面板都只讀取任何安裝都存在的資料表，所以同一份儀表板在自架與雲端部署都能用。

有些面板要等到來源開啟才會有資料：

| 面板 | 需要什麼 |
|---|---|
| Process Memory、Cache Entries | `metric_samples` 資料列，每隔 `CACHE_METRICS_INTERVAL_MS` 寫入一次。收集器只在 `RUN_ENV=production` 時執行，所以開發用的執行個體在這裡不會顯示任何東西。 |
| Errors per Hour by Type | `ERROR_DB_LOGGING_ENABLED`（預設開啟）。懷疑發生事故期間看到平線，也可能代表本 repo 的斷路器是開啟的，而不是錯誤停止了。 |
| Host Memory and Swap Tiers、Host Pressure (PSI) 與 Swap-In Rate | Linux 主機。這些面板會讀取 `/proc/meminfo`、`/proc/pressure/*`、`/proc/swaps` 與 `/sys/block/zram0`，所以在 macOS 與 Windows 上會維持空白。zram 系列還需要一個 zram 交換裝置；沒有這個裝置的主機仍然會回報記憶體與 PSI。 |

## 編輯與保留變更

儀表板在介面上維持可編輯，這在事故期間很重要。編輯只存在容器內，並會在下次重新啟動時被磁碟上的版本取代，所以想保留變更就要匯出儀表板的 JSON，並提交到 `docker/grafana/dashboards/`。

要新增自己的儀表板，就是把 JSON 檔丟進同一個目錄。資料來源請以它固定的 uid `tomoribot-postgres` 引用：當資料來源沒有宣告 uid 時 Grafana 會隨機指派一個，而指向隨機 uid 的儀表板會渲染出空白面板，而不是顯示錯誤。
