---
title: "設定：本機 MCP 伺服器"
sidebar:
  order: 6
---

[MCP](https://modelcontextprotocol.io/) 伺服器用外部工具擴充 TomoriBot。線上
（HTTPS）MCP 伺服器在任何執行個體都能用，請看
[工具與擴充](/zh-TW/features/capabilities/tools-and-extensions/#mcp-servers)。**本機** MCP 伺服器則
不同：

:::caution[僅限自架]
本機 MCP 伺服器**只支援自架執行個體**。公開的託管 bot
要求 HTTPS，並基於安全理由封鎖本機與私有位址，所以它連不到 `localhost` 或你區網上的伺服器。
:::

## 1. 運行本機 MCP 伺服器

啟動任何在本機連接埠上提供 HTTP 或 SSE 傳輸的 MCP 伺服器。例如，許多
MCP 伺服器透過 Node 運行：

```sh
npx -y <some-mcp-server> --port 3000
```

確切指令取決於你運行的伺服器。記下它印出的 URL 與傳輸路徑，常見的會像 `http://localhost:3000/sse`。

TomoriBot 自己的工具預期主機上有 **Node.js v20+** 可供 MCP 工具使用。

## 2. 在 Discord 註冊它

開啟 `/config` > 外掛 > MCP 伺服器，選擇 `新增 MCP`，把 **URL** 欄位指向你的本機伺服器，並讓必填的 `伺服器類型` 維持在預設的 `一般用途`：

```text
http://localhost:3000/sse
```

將 `驗證權杖` 欄位留空，本機伺服器不需要驗證權杖。

## 3. 管理它

- 開啟 Config 頁面，並在該伺服器那一列選擇 `移除`。確認之後會取消註冊、立即中斷連線，並釋出一個名額。

## 安全性

:::danger[只新增你信任的 MCP 伺服器]
即使是自己運行的本機伺服器，只要它的程式碼不受信任就可能出問題。惡意的 MCP
伺服器可以對模型做提示詞注入、竊取傳給它工具的資料，或回傳 TomoriBot 會轉述的有害
結果。接上之前請先了解一個 MCP 伺服器實際做了什麼。
:::

線上 MCP 的流程與完整的安全理由，請看
[工具與擴充 → MCP 伺服器](/zh-TW/features/capabilities/tools-and-extensions/#mcp-servers)。
