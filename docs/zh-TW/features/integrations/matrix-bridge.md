---
title: "Matrix 橋接"
sidebar:
  order: 1
---

TomoriBot 可以橋接一個 **Matrix 房間**與一個 Discord 頻道：大家在 Matrix 聊天，他們的訊息以 webhook 訊息的形式轉送到 Discord，而她會回覆到 Matrix 房間裡。這一頁是橋接的使用者端。應用程式服務的內部細節請看 [Matrix 橋接架構](/en/architecture/integrations/matrix/bridge/)。

## 設定

1. 邀請已設定的 Matrix bot 帳號加入一個**未加密**的 Matrix 房間。
2. 複製該房間的 **Internal Room ID**。
3. 在你想橋接的 Discord 頻道執行 `/matrix link`，然後貼上房間 ID。

在 bot 接受邀請之後，它會在 Matrix 房間發布一則簡短提醒，但你仍然要從 Discord 用 `/matrix link` 完成連結。

### 找到房間 ID

在大多數 Matrix 客戶端中：**房間設定 → 進階 → Internal Room ID**。它看起來像 `!abc:matrix.org`。

## 從 Matrix 使用它

- 房間連結之後正常聊天；Matrix 訊息會轉送到 Discord 頻道。
- 她會回覆到 Matrix 房間裡。
- Matrix 唯一的文字指令是 `/kill` 與 `/refresh`。

## 目前的限制

- 無法從 Matrix 使用斜線指令（`/kill` 與 `/refresh` 除外）。
- 沒有私訊，也沒有以私訊為基礎的冷卻提醒。
- Matrix 的個人圖片她看不到。
- 無法釘選訊息。
- 自訂表情符號與 Markdown 無法穩定渲染；embed 會以純文字轉送。
- Matrix 使用者的個人記憶會退回成有標註來源的伺服器記憶。

## 注意事項

- 如果 bot 沒有自動加入，請手動邀請 Matrix bot 帳號，然後重新執行 `/matrix link`。
- **Matrix 加密之後無法停用**：已加密的房間必須換成一個全新的未加密房間。
- 如果某項限制沒有列在上面，就假設它應該可以運作，並在支援伺服器回報問題（`/support discord`）。

在 `/help` 中選擇 **整合**，然後選 **Matrix**，就能在 Discord 裡看到同樣的指南。
