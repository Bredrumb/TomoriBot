---
title: "長期記憶"
sidebar:
  order: 1
aiGenerated: false
---

長期記憶是 TomoriBot 一直保留的簡短事實，直到有人將其移除。它們在 `/refresh` 與重新啟動後依然存在。她也會透過[文件](/features/knowledge/memory/documents/)、[世界書](/features/knowledge/memory/lorebooks/)與[短期記憶](/features/knowledge/memory/short-term-memory/)來記憶；`/memories` 為每一項都提供了專屬分頁。關於性格與行為，請參閱[多個人格](/features/chatting-personality/multiple-personas/)。

## 個人與伺服器記憶
<!-- anchor: personal-vs-server-memories -->

個人記憶是關於你的事實。它們會跟著你跨越各個伺服器，並在你參與對話時使用。伺服器記憶則包含適用於該伺服器中所有人的資訊。

每個人格都有自己的個人記憶與伺服器記憶。在 `/personal memories` 的「全域」頁面中新增的個人記憶適用於每個人格。使用 `/personal memories` 管理個人記憶，使用 `/memories` 管理伺服器記憶。

支援的訊息代理服務讓 TomoriBot 能為經過驗證的代理身分保留獨立的個人記憶。宿主 Discord 帳號掌控隱私與授權。設定與限制請參閱[訊息代理支援](/features/integrations/message-proxy-support/)。

## 儲存記憶

你可以自己儲存記憶，或者 TomoriBot 也可以在對話中自行決定儲存。當她儲存記憶時，會發布一則嵌入訊息確認她學到的內容。如果沒有該確認訊息，該資訊就只會留在對話歷史記錄中，而不會進入長期記憶。

如果你想讓她儲存某些內容，請直接請她記住，或自己動手新增。伺服器管理員可以在 `/config` > `權限` 下停用自動儲存。

## 記憶數量限制
<!-- anchor: how-many-memories -->

預設情況下，每個人格最多可容納 100 則個人記憶與 100 則伺服器記憶。全域個人記憶會計入每個人格的個人上限。自架者可透過 `MAX_PERSONAL_MEMORIES`、`MAX_SERVER_MEMORIES` 與 `MAX_MEMORY_LENGTH` 變更這些限制。

:::tip
偏好更多則簡短記憶，而非更少則冗長記憶。使用較大 `MAX_MEMORY_LENGTH` 的記憶在每次生效時都會完整發送，而在 `MAX_PERSONAL_MEMORIES` 與 `MAX_SERVER_MEMORIES` 中的額外名額在填滿前不會產生任何成本。較長的參考文字適合放在[文件](/features/knowledge/memory/documents/)中，文件會透過搜尋取用，而非完整發送。
:::

### 記憶衰退

在設定了嵌入模型的情況下，一則記憶如果連續 7 個計算對話日都沒有與對話相符，就會進入休眠：它依然會被保留，但會離開日常的提示詞，直到後續的訊息重新將其喚回。當清單已滿時，自動儲存可以遺忘一則休眠記憶以騰出空間，但絕不會遺忘全域個人記憶，或是某人透過 `/memories` 或 `/personal memories` 新增或編輯過的記憶。請參閱[記憶衰退](/features/knowledge/memory/memory-decay/)。

對於應該隨時生效的指示，請使用[人格屬性](/features/chatting-personality/multiple-personas/#attributes)、人格提示詞，或是[常駐（Always On）世界書條目](/features/knowledge/memory/lorebooks/)。

## 控制記憶何時生效
<!-- anchor: controlling-when-memories-activate -->

生效中的記憶會在擁有者與範圍與對話相符時被納入。休眠中的記憶則會在相關時透過搜尋喚回。頻道限制可縮小它們適用的位置，個人記憶也可以使用關鍵詞標籤。

### 個人記憶標籤
<!-- anchor: keyword-tags -->

個人記憶可以帶有關鍵詞或 `#channel` 標籤。在 `/config` > `行為` > `進階記憶` 下開啟標籤功能。開啟後，帶有標籤的個人記憶只有在其關鍵詞之一出現在對話中時才會生效，未帶標籤的記憶則保持生效。`#channel` 標籤會將其限制在該頻道。使用 `/tool prompt snapshot` 查看目前有哪些記憶正在生效。

伺服器記憶不再使用關鍵詞標籤。自訂的背景設定屬於[世界書](/features/knowledge/memory/lorebooks/)，世界書的每個條目都可以個別設定關鍵詞與常駐（Always On）。

### 頻道

伺服器記憶與文件可以限制在所選的頻道及其討論串中。個人記憶使用 `#channel` 標籤。世界書條目同樣接受頻道選擇。

較舊的伺服器記憶與文件 `#channel` 標籤已被轉換為頻道選擇。如果標籤所屬的頻道已不存在，該項目會在所有頻道保持生效；`/memories` 會標示出這些項目，以便你選擇新的頻道。

## 制約
<!-- anchor: conditioning -->

制約用於引導人格在伺服器中的行為。附帶原因給予人格的獎勵與懲罰會成為她可以據以行動的制約。未附帶原因的互動會被計數，但不會出現在她的提示詞中。使用 `/conditioning` 檢視或清除制約。

趣味互動也可以讓人格獎勵或懲罰使用者與其他人格。與使用者的互動不會儲存制約；與人格的互動則會促使她們做出回應。伺服器管理員可以在 `/config` > `外掛` > `可用工具` 下停用此工具。

## 隱私權

關於 TomoriBot 儲存的內容以及如何匯出或刪除，請參閱[資料處理](/features/knowledge/data-handling/)與 `/legal privacy-policy`。你可以使用 `/personal config` 選擇退出記憶。
