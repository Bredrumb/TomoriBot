---
title: "設定：ComfyUI"
aiGenerated: false
sidebar:
  label: "ComfyUI"
  order: 2
---

TomoriBot 可以透過你自己的
[ComfyUI](https://github.com/comfyanonymous/ComfyUI) 實例生成圖片與影片。它透過提交一份代入你的提示詞與尺寸的 API 格式工作流程來驅動 ComfyUI，接著輪詢
ComfyUI 的 `/history` 端點，直到輸出就緒。

本指南涵蓋安裝、執行 ComfyUI 並註冊它。若要撰寫或編輯與 TomoriBot 相容的工作流程（包含 `{TOMORI_*}` 佔位符），請使用 GitHub 上的
[工作流程 README](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows)。

:::note[不需要環境變數]
ComfyUI 透過 Discord 斜線指令註冊，並加密儲存在資料庫中。
請參閱[本機端點中心](/self-hosting/local-endpoints/)。
:::

## 硬體需求

圖片與影片生成受限於 GPU：主要成本在於 VRAM（顯示卡的記憶體，與系統 RAM 分開），由工作流程載入的模型檢查點決定。強烈建議使用 NVIDIA GPU。TomoriBot 隨附的兩套工作流程都是比 SDXL 更重型的現代模型：

| 隨附工作流程 | 基礎模型 | 實務 VRAM | 說明 |
|---|---|---|---|
| Anima v1（圖片） | Qwen-Image（約 20B），fp8 | 最低約 16 GB · 24 GB 較舒適 | 文字編碼器 + VAE 會增加約 8 到 10 GB 的負擔。低於 16 GB 時，請使用 GGUF 版本搭配 `--lowvram`。 |
| WAN i2v loop（影片） | Wan 2.2 14B，fp8 + 4 步 LightX2V LoRA | 約 16 GB 可運作 · 24 GB 以上較舒適 | 最重的選項，每段片段預計需數分鐘。在較小的顯示卡上，請將 UMT5 文字編碼器卸載到 RAM（`t5_cpu`，需要 24 GB 以上系統 RAM）。 |

兩組隨附的檢查點都已經過 fp8 量化以配合消費級顯示卡。若你的 VRAM 較少，請將 UNET 換成較小的量化版本，並啟用 ComfyUI 的 `--lowvram` / CPU 卸載。純 CPU 擴散不切實際（每張圖片需數分鐘，影片更久），且可能超出 TomoriBot 的輪詢期間，因此一般使用實務上需要 GPU。

:::tip[降低需求：選擇 GGUF 量化]
若要進一步縮減，請從 Hugging Face 下載該模型的 GGUF 版本：像 `Q4_K_M` / `Q5_K_M` 這樣的代號表示每個權重的位元數，而 4-bit（Q4）或 5-bit（Q5）通常是甜蜜點，能保留大部分品質且體積僅佔 fp8/fp16 的一小部分。在 ComfyUI 中載入 GGUF UNET 需要 [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF) 自訂節點。
:::


## 1. 啟用 API 執行 ComfyUI

依[其 README](https://github.com/comfyanonymous/ComfyUI) 安裝 ComfyUI 並啟動它以接聽網路：

```sh
python main.py --listen 0.0.0.0 --port 8188
```

若 TomoriBot 執行在 Docker 中或不同機器上，`--listen 0.0.0.0` 至關重要：預設只會繫結到回送位址。從執行 bot 的機器確認可連線：

```sh
curl http://127.0.0.1:8188/system_stats
```

若要測試，請載入所選工作流程需要的模型檢查點，並在 ComfyUI 網頁介面中手動生成一次，確認端對端正常運作後再連接 TomoriBot。

## 2. 取得 TomoriBot 工作流程

下載立即可用的 API 格式工作流程。可在存放庫的
[`assets/comfyui-workflows/`](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows) 底下找到範例：

| 工作流程 | 模式 |
|----------|-------|
| Anima v1（圖片）：`tomoribot-anima-v1-comfyui.json` | `txt2img`、`img2img`、`inpaint` |
| WAN i2v loop（影片）：`tomoribot-wan-i2v-loop-video.json` | 圖片轉影片 |

這些是 API 格式（ComfyUI 透過 *Save (API Format)* 匯出的 JSON），而非一般的介面儲存格式。若你自行撰寫，其中必須包含 TomoriBot 代入的 `{TOMORI_*}` 佔位符（提示詞、寬度/高度、種子、參考圖片等）。請參閱[工作流程 README](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows) 以及 `/help` 中「供應商」底下的「自訂端點」頁面。

## 3. 在 Discord 中註冊

執行 `/providers`（或 `/personal providers`），選擇 `+ 新增自訂端點`，並輸入：

| 欄位 | ComfyUI 的值 |
|-------|-------------------|
| `endpoint_label` | 你自訂的名稱，例如 `home-comfy` |
| API Compatibility | `ComfyUI` |
| `endpoint_url` | `http://127.0.0.1:8188`（根路徑，不含 `/v1`） |
| `auth_token` | *（留空，除非你的 ComfyUI 位於身分驗證之後）* |

儲存連線後，選取該連線並從模型下拉選單中選擇 `+ 新增 Image 模型` 或 `+ 新增 Video 模型`。輸入檢查點的確切代號，並將步驟 2 下載的工作流程 `.json` 上傳到 `ComfyUI Workflow` 中。模型功能必須與工作流程相符（圖片工作流程 → `image`，影片工作流程 → `video`）。

新增模型會自動讓它成為作用中的 `image`/`video` 模型。直接在聊天中向 Tomori 提出請求即可觸發生成。若因某種原因未處於作用中狀態，請執行 `/config` > 模型 > 切換模型 並選取你已註冊的 ComfyUI 端點。

## 疑難排解

- **新增時無法連線：** ComfyUI 繫結到回送位址，而 bot 位於 Docker 內或另一台主機上。請使用 `--listen 0.0.0.0` 啟動，並使用 `http://host.docker.internal:8188` 或區域網路 IP。
- **生成始終未完成：** TomoriBot 會輪詢 `/history` 直到輸出出現。冷啟動以及在 CPU 上執行大型模型可能會超出輪詢時間範圍。
- **提示詞/尺寸被忽略或輸出尺寸錯誤：** 工作流程缺少必要的 `{TOMORI_*}` 佔位符，或者你上傳了介面格式的匯出而非 API 格式。
- **功能錯誤：** 註冊在 `video` 底下的 `image` 工作流程（或反之）無法執行。請在相符的功能底下重新新增。
