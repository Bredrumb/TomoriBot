---
title: "影片生成"
sidebar:
  order: 2
---

TomoriBot 可以依文字提示詞生成短片，也可以把參考圖片做成動畫。使用 `/generate video`，或直接請她。

## 她可以做什麼

- **文字生影片**：依提示詞生成一段短片。
- **圖片生影片**：把參考圖片做成動畫（被參考訊息中的第一張圖片會成為起始畫面）。
- **循環圖片生影片**：透過聊天要求時，支援的模型可以把起始圖片重複用作結尾畫面。
- **可自訂的長寬比**。

圖片生影片與循環功能取決於所選模型的首格與末格能力。TomoriBot 會在送出付費工作之前檢查 OpenRouter 目前的影片模型目錄，必要時請你移除圖片、關閉循環，或選擇相容的模型。

影片生成採用**非同步輪詢流程**：請求送出後，TomoriBot 會持續輪詢供應商，直到完成的短片就緒，然後在完成時發布。較大的短片可能需要一段時間。

## 設定

1. 用 `/config` > 模型 > 切換模型 設定影片模型。
2. 確認媒體生成已透過 `/config` > 權限 獲得允許。
3. 請她生成，或執行 `/generate video`。

## 供應商支援

原生影片生成可在 **Google、OpenRouter** 與 **Z.ai** 上使用。完整對照表請看[供應商與模型](/zh-TW/features/setup-administration/providers-and-models/#支援的供應商)。

要透過 ComfyUI 做**本機**影片生成（例如 WAN 圖片生影片工作流），請看[設定：ComfyUI](/en/self-hosting/local-endpoints/setup-comfyui/)。

關於內部的生成與輪詢架構，請看[影片生成](/en/architecture/subsystems/video-generation/)的參考。
