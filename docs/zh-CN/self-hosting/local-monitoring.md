---
title: "本地 Grafana 监控"
sidebar:
  order: 7
---

你可以用配套的 Docker Compose profile，通过 Grafana 面板监控你本地的 TomoriBot 实例。

要在你的机器上同时启动 TomoriBot 和 Grafana：

```sh
docker compose -f docker-compose.yaml -f docker/compose.monitor.yaml up -d
```

这会：
- 启动 TomoriBot 与 PostgreSQL（数据库端口 15432）
- 在 3000 端口启动 Grafana，并自动配置好 PostgreSQL 数据源
- 自动置备 **TomoriBot Overview** 面板
- 把两个服务接到同一个 Docker 网络

在 [http://localhost:3000](http://localhost:3000) 访问 Grafana：
- **用户名**：`admin`
- **密码**：通过 `.env` 里的 `GRAFANA_PASSWORD` 设置（未设置时默认为 `admin`）

## 自动置备的面板

**TomoriBot Overview** 会自动出现，无需任何设置。它的面板覆盖进程内存、缓存条目数、每小时错误数、按模型统计的词元用量、按小时统计的活动量、最常用指令、用户语言、情绪云，以及正在使用哪些预设集与模型。

每个面板都只读取任何安装中都存在的表，所以同一份面板在自部署实例和云端部署里都能用。

有些面板在对应的数据来源开启之前会一直为空：

| 面板 | 需要什么 |
|---|---|
| 进程内存、缓存条目 | `metric_samples` 数据行，每 `CACHE_METRICS_INTERVAL_MS` 写入一次。采集器只在 `RUN_ENV=production` 时运行，所以开发实例这里什么都不显示。 |
| 每小时按类型统计的错误数 | `ERROR_DB_LOGGING_ENABLED`（默认开启）。在疑似故障期间看到一条平线，也可能意味着本仓库的熔断器已打开，而不是错误停止了。 |
| 主机内存与交换分区层级、主机压力（PSI）与换入速率 | 一台 Linux 主机。这些面板读取 `/proc/meminfo`、`/proc/pressure/*`、`/proc/swaps` 和 `/sys/block/zram0`，所以它们在 macOS 和 Windows 上会一直为空。zram 系列还需要一个 zram 交换设备；没有它的主机仍然会报告内存和 PSI。 |

## 修改与保留改动

面板在界面上始终可编辑，这在故障处理期间很重要。改动只存在于容器里，并会在下次重启时被磁盘上的内容替换掉，所以要把面板的 JSON 导出，并提交到 `docker/grafana/dashboards/` 才能保住改动。

添加你自己的面板，就是把一个 JSON 文件放进同一个目录。请通过固定 uid `tomoribot-postgres` 引用数据源：当数据源没有声明 uid 时 Grafana 会随机分配一个，而指向随机 uid 的面板会渲染出空面板，而不是报错。
