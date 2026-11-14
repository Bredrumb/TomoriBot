---
title: "設定：本機MCP伺服器"
sidebar:
  label: "本機MCP伺服器"
  order: 2
---

將TomoriBot連接到在本機或專用網路上執行的Model Context Protocol（[MCP](https://modelcontextprotocol.io/)）伺服器，以提供自訂本機工具。

對於遠端HTTPS伺服器，請參閱[工具與擴充功能](/features/capabilities/tools-and-extensions/mcp-servers/)。本機MCP端點需要自架執行個體：

:::caution[僅限自架]
僅自架執行個體支援本機MCP伺服器。公開託管bot基於安全考量要求使用HTTPS並封鎖本機/私人位址，因此無法連線到`localhost`或區域網路上的伺服器。
:::

## 1. 執行本機MCP伺服器

啟動在本機連接埠上公開HTTP/SSE傳輸的MCP伺服器。例如，許多MCP伺服器透過Node執行：

```sh
npx -y "<some-mcp-server>" --port 3000
```

確切的指令取決於你正在執行的伺服器。記下它印出的URL與傳輸路徑（通常為`http://localhost:3000/sse`）。

## 2. 在Discord中註冊

開啟`/config` > `外掛` > `MCP 伺服器`，選擇`+ 新增 MCP`，將`伺服器 URL`欄位設定為你的本機端點，並將`伺服器類型`保留為預設的`一般用途`設定：

```text
http://localhost:3000/sse
```

將`驗證權杖（選填）`留空：本機伺服器不需要驗證權杖。

## 3. 管理

開啟設定頁面並在該伺服器的列上選擇`移除`。確認後會取消註冊、立即中斷連線並釋出一個插槽。

## 安全性

:::danger[僅新增你信任的MCP伺服器]
若程式碼不受信任，即使是你自己執行的本機伺服器也可能會出現異常行為。惡意MCP伺服器可能會對模型進行提示詞注入、外洩傳遞給其工具的資料，或傳回TomoriBot會轉送的有害結果。在連接MCP伺服器之前請先檢視它的功能。
:::

有關線上MCP流程與完整的安全詳細資訊，請參閱[工具與擴充功能](/features/capabilities/tools-and-extensions/mcp-servers/)。
