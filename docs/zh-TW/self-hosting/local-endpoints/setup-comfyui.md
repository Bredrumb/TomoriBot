---
title: "設定：ComfyUI"
aiGenerated: false
sidebar:
  label: "ComfyUI"
  order: 3
---

TomoriBot可以透過你自己的[ComfyUI](https://github.com/comfyanonymous/ComfyUI)執行個體生成圖片與影片。它透過提交一份代入你的提示詞與尺寸的API格式工作流來驅動ComfyUI，接著輪詢ComfyUI的`/history`端點，直到輸出就緒。

本指南涵蓋安裝、執行ComfyUI並註冊它。若要撰寫或編輯與TomoriBot相容的工作流（包含`{TOMORI_*}`佔位符），請使用GitHub上的[工作流README](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows)。

:::note[不需要環境變數]
ComfyUI透過Discord斜線指令註冊，並加密儲存在資料庫中。請參閱[本機端點中心](/self-hosting/local-endpoints/)。
:::

## 硬體需求

圖片與影片生成受限於GPU：主要成本在於VRAM（顯示卡的記憶體，與系統RAM分開），由工作流載入的模型檢查點決定。強烈建議使用NVIDIA GPU。TomoriBot隨附的兩套工作流需要：

| 隨附工作流 | 基礎模型 | 實務VRAM | 說明 |
|---|---|---|---|
| Anima turbo（圖片） | Anima Turbo v1.1 (2B), bf16 | 約8 GB可運作 · 12 GB+較舒適 | 4.2 GB模型加上1.2 GB文字編碼器，採10步加上短暫的2倍放大流程。加入角色參考圖片會增加約一半的生成時間。 |
| Anima detailed（圖片） | Anima Aesthetic v1.1 (2B), bf16 | 約8 GB可運作 · 12 GB+較舒適 | 記憶體需求與turbo相同，但採30步並加上臉部與手部細節修復，因此每張圖片會慢數倍。其他Anima模型位於[模型資料夾](https://huggingface.co/circlestone-labs/Anima/tree/main/split_files/diffusion_models)；工作流README說明了如何切換。 |
| WAN i2v loop（影片） | Wan 2.2 14B, fp8 + 4步LightX2V LoRA | 約16 GB可運作 · 24 GB+較舒適 | 最重的選項，每段影片預計需數分鐘。在較小的顯示卡上，請將UMT5文字編碼器卸載到RAM（`t5_cpu`，需要24 GB以上系統RAM）。 |

Wan檢查點已經過fp8量化以配合消費級顯示卡。若你的VRAM較少，請將UNET換成較小的量化版本，並啟用ComfyUI的`--lowvram`或CPU卸載。純CPU擴散不切實際（每張圖片需數分鐘，影片更久），且可能超出TomoriBot的輪詢時間範圍，因此一般使用實務上需要GPU。

:::tip[降低需求：選擇GGUF量化]
若要進一步縮減，請從Hugging Face下載該模型的GGUF版本：像`Q4_K_M`或`Q5_K_M`這樣的代號表示每個權重的位元數，而4-bit（Q4）或5-bit（Q5）通常是甜蜜點，能保留大部分品質且體積僅佔fp8/fp16的一小部分。在ComfyUI中載入GGUF UNET需要[ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF)自訂節點。
:::

## 1.啟用API執行ComfyUI

依[其README](https://github.com/comfyanonymous/ComfyUI)安裝ComfyUI。若bot在同一台機器上，或Cloudflare Tunnel連接器在此電腦上，請將其保留在回環位址：

```sh
python main.py --listen 127.0.0.1 --port 8188
```

若使用分開架設的生產環境bot，請依照[Cloudflare Tunnel指南的ComfyUI設定檔](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/)操作。它會提供公開的HTTPS端點，同時讓ComfyUI保留在回環位址。在下方註冊時請使用其通道URL；若你在沒有驗證的情況下分享它，請先檢視指南中的[已知風險](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/#known-risks)。

若bot位於Docker或受信任的區域網路中，繫結到`0.0.0.0`可讓bot連線至主機的連接埠。請透過主機防火牆限制存取；任何能連上未經驗證ComfyUI的人都可以提交工作流。非生產環境的TomoriBot還需要`ALLOW_PRIVATE_NETWORK`來允許該端點的主機與連接埠。確認本機API有回應：

```sh
curl http://127.0.0.1:8188/system_stats
```

若要測試，請載入所選工作流需要的模型檢查點，並在ComfyUI網頁介面中手動生成一次，確認端對端正常運作後再連接TomoriBot。

## 2.取得TomoriBot工作流

下載立即可用的API格式工作流。可在存放庫的[`assets/comfyui-workflows/`](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows)底下找到範例：

| 工作流 | 模式 |
|----------|-------|
| Anima turbo（圖片，快速）：`tomoribot-anima-image-turbo.json` | 文字生圖、角色參考、局部重繪／擴圖 |
| Anima detailed（圖片，較慢，含臉部與手部細節修復）：`tomoribot-anima-image-detailed.json` | 文字生圖、角色參考、局部重繪／擴圖 |
| MOSS standard（圖片，由多模態編碼器重寫提示詞）：`tomoribot-moss-image.json` | 文字生圖、角色參考 |
| MOSS detailed（圖片，較慢，2倍放大含臉部與手部細節修復）：`tomoribot-moss-image-detailed.json` | 文字生圖、角色參考 |
| WAN i2v loop（影片）：`tomoribot-wan-i2v-loop-video.json` | 圖片轉影片 |

每個工作流都需要特定的自訂節點以及位於特定ComfyUI資料夾中的模型檔案。[工作流README](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows)列出了Anima與MOSS工作流的所需項目，附帶下載連結與每個檔案應放置的資料夾。請先安裝這些項目再進行註冊，否則生成會失敗並出現缺少節點或`Value not in list`錯誤。

這些是API格式（ComfyUI透過*Save (API Format)*匯出的JSON），而非一般的介面儲存格式。若你自行撰寫，其中必須包含TomoriBot代入的`{TOMORI_*}`佔位符（提示詞、寬度與高度、種子、參考圖片等）。請參閱[工作流README](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows)以及`/help`中`供應商`底下的`自訂端點`頁面。

## 3.在Discord中註冊

執行`/providers`（或`/personal providers`），選擇`+ 新增自訂端點`，並輸入：

| 欄位 | ComfyUI的值 |
|-------|-------------------|
| `endpoint_label` | 你自訂的名稱，例如`home-comfy` |
| API相容性 | `ComfyUI` |
| `endpoint_url` | 同機bot：`http://127.0.0.1:8188`；生產環境通道：`https://engine.example.com`（根路徑，不含`/v1`） |
| `auth_token` | 除非你的端點閘道需要用戶端金鑰，否則請留空 |

儲存連線後，選取該連線並從模型下拉選單中選擇`+ 新增圖片模型`或`+ 新增影片模型`。輸入檢查點的確切代號，並將步驟2下載的工作流`.json`上傳到`ComfyUI 工作流`中。模型功能必須與工作流相符（圖片工作流對應`圖片`，影片工作流對應`影片`）。

對於Anima工作流，請在`圖片功能`底下勾選`文字生圖`、`參考圖片`與`局部重繪`。`參考圖片`可讓Tomori依據使用者或人格的角色參考圖片進行繪製。

新增模型會自動讓它成為使用中的`圖片`／`影片`模型。直接在聊天中向Tomori提出請求即可觸發生成。若因某種原因未處於使用中狀態，請執行`/config` > `模型` > `切換模型`並選取你已註冊的ComfyUI端點。

## 疑難排解

- **新增時無法連線：**若是生產環境，請檢查通道、`/system_stats`路由，以及閘道所需的用戶端金鑰（如有）。若是Docker或受信任的區域網路，請檢查接聽程式、防火牆、主機位址，以及TomoriBot的私人網路允許設定。
- **生成始終未完成：**TomoriBot會輪詢`/history`直到輸出出現。冷啟動以及在CPU上執行大型模型可能會超出輪詢時間範圍。
- **提示詞或尺寸被忽略，或輸出尺寸錯誤：**工作流缺少必要的`{TOMORI_*}`佔位符，或者你上傳了介面格式的匯出而非API格式。
- **缺少節點或`Value not in list`：**尚未安裝工作流README中所需的自訂節點套件或模型檔案，或模型檔案遭到重新命名。請安裝它、重新啟動ComfyUI，然後再試一次。不需要重新上傳工作流。
- **功能錯誤：**註冊在`影片`底下的`圖片`工作流（或反之）無法執行。請在相符的功能底下重新新增。
