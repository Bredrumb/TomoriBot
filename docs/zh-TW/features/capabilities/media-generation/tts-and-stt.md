---
title: "語音：TTS與STT"
sidebar:
  order: 3
---

TomoriBot可以在Discord中說和聽：透過文字轉語音 (TTS) 發送語音回复，並透過語音轉文字 (STT) 將音訊訊息轉錄到對話上下文中。

在 `/providers` 中選擇語音供應商，或用 `/personal providers` 使用你自己的 Google 或 OpenRouter 語音模型。你也可以在自己的硬體上執行本機語音模型。

## 文字轉語音
<!-- anchor: text-to-speech -->

### Google 與 OpenRouter 語音

新增 Google 會將 Gemini Flash TTS 選為 `TTS（語音設計）`。新增 OpenRouter 會將付費的 Fish S2.1 Pro 選為 `TTS（語音複製）`，並在該位置為空時將 Seed Audio 1.0 填入 `TTS（語音設計）`。OpenRouter 絕不會取代你已經選好的 Gemini 或 Vertex 語音設計，因此兩家供應商可以同時保持啟用。如果你在 Seed 提供前新增了 OpenRouter，你的語音設計位置會保持為空，直到你手動選擇 Seed。再次新增 OpenRouter 金鑰也會將 Seed 填入空的語音設計位置，包括你特意清空的位置。Flash-Lite 與免費版 Fish 需要明確手動選擇模型；可用性與供應商額度仍然適用。用 `/config` > 模型 > 切換模型 變更或清空任一位置。
個人選擇及其開關位於 `/personal config` > 模型 > 切換模型。關閉某項個人模式後，該模式會轉為使用伺服器設定，而另一項仍保持啟用。

在所選範圍相同的範圍內使用對應供應商的 API 金鑰。僅有交談訂閱並不能獲得 API 存取權限。Gemini 的[免費 API 方案](https://ai.google.dev/gemini-api/docs/pricing)有專案額度與資格限制；請在 AI Studio 中確認存取權。免費版 Fish 是獨立的模型代碼 `fish-audio/s2.1-pro-free:free`，必須明確選擇。開啟「伺服器模型備援」後，個人免費模型調用失敗時仍可退回至伺服器設定的付費模型。

在 `/config` > 人格 > 語音 中，選擇`描述語音`可以儲存最多 1,000 個字元的描述。你可以在挑選模型之前先撰寫描述。若要使用 Fish 或本機複製模型，請在 `/config` > 模型 > TTS 參數與語音 中新增參考音訊，並在對應人格的語音頁面中指派。更換供應商後，兩項輸入內容都會保留。選擇`語音設計`或`語音複製`來設定優先順序；偏好的輸入若沒有相符的模型或可用的語音，就可以改用另一項已儲存的輸入。頁面會說明目前伺服器選擇下實際生效的是哪種來源。

執行 `/generate voice-message` 輸入一段簡短台詞，或者讓人格傳送語音訊息。該指令也接受單次生效的聲音描述或參考音訊上傳。

可選的 `model` 參數可為此訊息選擇相容的語音模型或伺服器端點。個人項目會顯示 `（透過個人供應商）`。它會保留你已儲存的預設設定，且明確選擇的模型若生成失敗不會退回至其他模型。留空則使用正常路由。

儲存的描述會重複使用 Gemini 語音身分；修改描述會淘汰舊身分。單次生效的描述會建立暫時身分，bot 會在生成後將其刪除。清理失敗會在再次使用該憑證時重試；當機或出現不明確的逾時後，管理員可能需要在供應商控制台中手動移除這些聲音。
匯出的 PNG 與 JSON 格式人格卡會包含聲音描述；遠端語音身分與參考音訊指派不會匯出。Google 會將設計好的語音身分儲存在其 API 專案中。Gemini 基於參考音訊複製語音的功能已暫緩，直到 bot 能收集到同意錄音。

Seed Audio 的運作方式與 Gemini 不同。它每次發聲都會根據描述重新構建聲音，因此同一段描述在不同訊息之間聽起來可能會略有差異。如果你需要保持穩定不變的聲音，請使用 Gemini 或參考樣本。Seed 在英語與中文上的表現最佳，單則訊息最多生成兩分鐘音訊，因此台詞上限為 1,100 個字元。此外，聲音描述、語氣指示與台詞共用 2,048 個字元，因此描述過長就會壓縮台詞的空間。如果台詞超出限制，在傳送任何內容前就會被拒絕，bot 會提示你縮短台詞。
OpenRouter 按音訊秒數對 Seed 計費，折合每分鐘費用約為 Fish 的十倍左右。要切換到 Gemini 或清空該位置，請使用 `/config` > 模型 > 切換模型。

個人語音生成失敗遵循「伺服器模型備援」設定及伺服器權限。成功備援會呈現在指令回執中。供應商可能會對失敗或取消的工作計費；台詞與音訊長度限制並不代表費用上限。

### ElevenLabs（雲端，最簡單）

1. 從 [ElevenLabs](https://elevenlabs.io/app/settings/api-keys) 取得API金鑰。
2. 運行`/providers`，選擇`新增供應商`，選擇`ElevenLabs`，然後貼上金鑰。這個流程：
   - 註冊ElevenLabs語音端點和轉錄端點，
   - 啟動兩個端點，
   - （可選）立即將聲音指派給一個人格。
3. 在`/config` > `人格` > 語音中將語音指派給其他人格。在[ElevenLabs語音庫](https://elevenlabs.io/app/voice-library)中瀏覽語音，你也可以在其中複製自己的語音。

在`/providers`中選擇ElevenLabs，然後每當需要更新金鑰時選擇`編輯端點`。

筆記：

- 在免費方案中，只有預製聲音有效。瀏覽[預製語音清單](https://elevenlabs-sdk.mintlify.app/voices/premade-voices)。
- 當她產生語音訊息時，字元數就會被計算在內。免費套餐有每月限制，因此請監控你的ElevenLabs儀表板。
- 語音回覆需要`/config` > `權限`中的`voice_message_enabled`，且活動人格必須指派語音。
- 更改`/config` > `人格` > 語音需要伺服器中的「管理伺服器」權限，並且在DM中仍可供擁有者使用。

在`/help`中，選擇`功能`，然後選擇`語音`，以進行Discord中的互動式演練。

### 本機語音複製引擎（自架）

在自架執行個體上，你可以執行本機語音克隆伺服器。工作流程：啟動伺服器，在`/providers`中註冊其連接和型號，在`/providers`中選擇它，在`/config` > `模型` > TTS參數和語音中上傳參考樣本，然後在`/config` > `人格` >語音中分配它。接受任何音訊格式（自動轉換為單聲道WAV）；沒有背景音樂的10到20秒剪輯效果最佳。

每個引擎都有自己的設定指南：

- [Chatterbox-Turbo/Nano](/zh-TW/self-hosting/local-endpoints/text-to-speech/chatterbox/)：快速英語語音克隆，帶有`[laugh]`等情緒標籤。
- [Qwen3-TTS](/zh-TW/self-hosting/local-endpoints/text-to-speech/qwen3tts/)：多語言（10種語言）加上自然語言VoiceDesign模式。
- [MOSS-TTS](/zh-TW/self-hosting/local-endpoints/text-to-speech/moss/)：多語言克隆和英文或中文語音設計。
- [IrodoriTTS](/zh-TW/self-hosting/local-endpoints/text-to-speech/irodoritts/)：日本專用引擎，將表情符號讀取為情緒線索。

有關硬體指南和完整引擎列表，請參閱[文字轉語音比較表](/zh-TW/self-hosting/local-endpoints/text-to-speech/)。

## 語音轉文字
<!-- anchor: speech-to-text -->

轉錄模型會將音訊附件轉換為 TomoriBot 可在對話中使用的文字。在 `/config` > `模型` > `切換模型` 中，你可以先選擇供應商再選取模型，獨立於 TTS 進行設定。選取 `- 無模型` 即可停止使用伺服器的金鑰進行轉錄。Google、Vertex AI 和 OpenRouter 提供託管轉錄模型，若尚未設定其他轉錄模型，新增其中一家的金鑰便會自動選取其預設模型。OpenRouter 列出了許多轉錄模型，只要在 `/providers` 中輸入模型 ID 即可註冊。新增 ElevenLabs 也會同時註冊轉錄端點。如需自架選項，請參閱[語音轉文字指南](/self-hosting/local-endpoints/speech-to-text/)。

你也可以在 `/personal config` 中選取個人轉錄模型。你自己的語音訊息將優先使用你自己的金鑰，並在開啟伺服器備援時退回使用伺服器的模型。託管轉錄服務會由供應商針對每次轉錄的語音訊息計費。

你可以在 `/config` > `行為` > `通知行為` > `語音逐字稿` 中隱藏顯示的逐字稿。轉換後的文字仍會送入對話脈絡。
