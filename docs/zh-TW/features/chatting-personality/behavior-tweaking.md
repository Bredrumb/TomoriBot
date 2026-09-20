---
title: "行為調整"
sidebar:
  order: 3
---

TomoriBot 的行為，也就是**她被允許做什麼以及她如何生成**，是由 `/config` > 權限 與 `/config` 控制的，涵蓋人格（[多個人格](/zh-TW/features/chatting-personality/multiple-personas/)）與知識（[記憶](/zh-TW/features/knowledge/memory/)）之外的部分。這一頁特別挑出高價值的旋鈕；每個指令都收錄在[指令參考](/zh-TW/features/command-reference/)裡。

## 功能：她被允許做什麼
<!-- anchor: capabilities-what-shes-allowed-to-do -->

`/config` > 權限 可以開啟或關閉她的各項功能：圖片生成、貼圖使用、建立討論串、訊息管理、封鎖使用者、自我教導、語音訊息，還有更多。每一個切換項目就是管制對應工具的功能旗標（請看[工具與擴充](/zh-TW/features/capabilities/tools-and-extensions/)）。把某項功能關掉，她就完全做不到，不論使用者怎麼要求。

## 生成調整
<!-- anchor: generation-tuning -->

- `/config` > 模型 > 文字取樣器與參數：取樣參數（temperature、top-p 等等）用來調整創造力與隨機性。temperature 越高，回覆越多變。
- `/config` > 行為 > 一般行為：決定她的回覆讀起來多像真人。選用的 `scope` 選項可以把程度套用到整個伺服器（`Global`，預設值），或套用到單一人格（`Persona`）；當某個人格應該用第 3 級隨性地打字，另一個人格卻該寫得像小說時，這個選項就很好用。人格的「沿用」選項會清除它的覆寫值。
- `/config` > 行為 > 一般行為：每次觸發時，她會抓取多少則最近的訊息當作脈絡。這是個好用的槓桿：調高可以增加對對話的掌握，調低則能減少 token 成本。

## 系統提示詞
<!-- anchor: system-prompt -->

系統提示詞位於人格之上，形塑整體行為：

- `/config` > 行為 > 一般行為：設定自訂的系統指示（最多 16,000 個字元）。
- `/config` > 行為 > 一般行為：從預設的系統提示詞中挑選。
- `/config` > 行為 > 一般行為：重設為預設值。確認訊息會顯示剛剛被移除的提示詞，所以如果不小心清掉，可以把它複製回來。

當 [SillyTavern 預設集](/zh-TW/features/integrations/sillytavern-support/)啟用時，內建的備援系統提示詞會被取代，不過你在這裡設定的自訂提示詞仍然會送出。

## 無審查輸出
<!-- anchor: uncensored-output -->

TomoriBot **本身沒有內容過濾器**：她不是一套審核機制，也不會在模型之上加任何安全護欄。底層供應商回傳什麼，她就說什麼。因此 `/nsfw jailbreaks` 並不是在 TomoriBot 內部「解鎖」任何東西，它純粹是為了繞過比你想的更嚴格的**供應商端**過濾器。

它會切換三種彼此獨立的技術（預設全部關閉）：

- **提示詞注入**：在脈絡中加入一段越獄指示，引導模型避開不必要的拒答。
- **Unicode 空格**：把一般空格換成長得像的 Unicode 空格，讓關鍵字與 token 過濾器對不上詞句，送給模型的文字與她的回覆都會處理。
- **淨化**：基於同樣的理由，把一組敏感詞彙模糊化，請求與回覆兩邊都一樣。

這些都不會改變模型*能力*上的極限，只會降低過度積極的供應商過濾器擋掉正常輸出的頻率。其中有些選項屬於年齡限制內容，請看[年齡限制指令](/zh-TW/features/setup-administration/age-restricted-commands/)。

## 外觀與時間

- `/config` > 人格 > 身分與個性：她怎麼稱呼自己。
- `/config` > 行為 > 一般行為：伺服器時區，用於需要時間資訊的回覆與提醒。

---

你找的是管理與成本控制（額度、白名單、BYOK），而不是行為設定嗎？那些在[伺服器管理](/zh-TW/features/setup-administration/server-moderation/)底下。
