---
title: "PluralBuddy OAuth 設定"
description: "授權你的自架 TomoriBot 驗證來自已核准 PluralBuddy 實例的訊息。"
sidebar:
  order: 8
---

自架的 TomoriBot 需要為官方服務以及每個已核准的自訂實例建立授權的 PluralBuddy 應用程式。

若你使用的是[公開部署的 bot](https://discord.com/oauth2/authorize?client_id=841644102059556915)，則不需要完成這項主機端設定。直接透過 `/personal message-proxy service:pluralbuddy` 選取 PluralBuddy 即可；請參閱[訊息代理支援](/features/integrations/message-proxy-support/#pluralbuddy)。

## 開始之前

- 對已完成遷移的 PostgreSQL 資料庫執行目前的 TomoriBot 版本。
- 使用配有瀏覽器且能夠存取該資料庫與 TomoriBot 加密金鑰的電腦。授權輔助程式會接聽該電腦的 loopback（回送）位址。若資料庫位於遠端，請安排從此電腦進行受限的暫時存取。
- 選擇一個未使用的本機連接埠，並在開發者入口網站中註冊一個確切的回呼 URL，例如 `http://127.0.0.1:<port>/oauth/callback`。記錄此 URL；你在底下的每個步驟中都會用到它。

## 授權官方實例

1. 登入 [PluralBuddy 開發者入口網站](https://pluralbuddy.app/developers/applications)並建立一個 OAuth 應用程式。測試時請使用獨立的應用程式。勾選 `profile` 與 `offline_access`。如上方所選確切註冊你的回呼 URL。請妥善保密客戶端 ID 與密鑰。
2. 從 TomoriBot 存放庫中，以官方實例 ID 與相同的回呼 URL 執行輔助程式：

   ```sh
   bun scripts/db/authorize-pluralbuddy-instance.ts pluralbuddy:official <callback-url>
   ```

3. 在終端機提示符號處輸入客戶端 ID 與密鑰。在該電腦的瀏覽器中開啟印出的授權 URL、登入 PluralBuddy，並同意授權畫面。輔助程式會在收到一次回呼或三分鐘後關閉，並將連線存放在 PostgreSQL 中。
4. 使用相同的資料庫與加密金鑰啟動 TomoriBot。在有使用 PluralBuddy 的 Discord 帳號上選取 `/personal message-proxy service:pluralbuddy`，接著發送網路鉤子轉貼訊息以確認 TomoriBot 能夠識別該 alter。

輔助程式會從 `.env` 或 `SECRET_FILE` JSON 套件讀取資料庫設定與加密金鑰。請將套件存放在存放庫之外並備份加密金鑰。請在提示符號處輸入客戶端密鑰，而不是將其存放在 `.env` 或作為引數傳遞。若 PluralBuddy 撤銷了連線，請使用相同的實例 ID 重新進行授權。

## 新增已核准的實例

使用不含路徑、查詢字串或片段（fragment）的公開 HTTPS 來源。該實例必須同時執行代理 bot 及其對應的 API。

1. 在可存取部署資料庫的電腦上，註冊一個停用的實例：

   ```sh
   bun scripts/db/register-message-proxy-instance.ts register pluralbuddy https://<instance-host> "<display-name>" <bot-user-id>
   bun scripts/db/register-message-proxy-instance.ts inspect
   ```

   對於 PluralKit，服務名稱請使用 `pluralkit`。提供 bot 使用者 ID 可避免在該 bot 不存在的伺服器中產生不必要的查詢等待。
2. 對於 PluralBuddy，請在該實例上註冊獨立的 OAuth 應用程式，並使用與上方相同的 loopback 回呼模式。使用註冊時返回的實例 ID 進行授權：

   ```sh
   bun scripts/db/authorize-pluralbuddy-instance.ts <instance-id> <callback-url>
   ```

   重複授權可用於替換憑證，或在重新整理權杖遭撤銷時進行復原。PluralKit 不需要此步驟。
3. 從對應代理 bot 發送的訊息中，記錄其 Discord 轉貼 ID 與寄件者帳號 ID。檢查該實例 API 是否能解析該筆轉貼，然後啟用它：

   ```sh
   bun scripts/db/register-message-proxy-instance.ts enable <instance-id> <repost-id> <sender-id>
   ```

   對於新的分支版本（fork），請先在一次性部署中測試 bot、OAuth 交換與重新整理以及 TomoriBot 查詢，再開放給使用者。
4. 使用者可透過 `/personal message-proxy service:pluralbuddy instance:<name>` 選取已啟用的實例。若將 `instance` 保留為空則會選取官方實例。停用實例會停止新的查詢，但不會變更已儲存的個人檔案。

若替換了自訂代理 bot，請在重新提供該實例前更新其 Discord bot 使用者 ID：

```sh
bun scripts/db/register-message-proxy-instance.ts set-bot <instance-id> <bot-user-id>
```

使用以下指令停用或移除自訂實例：

```sh
bun scripts/db/register-message-proxy-instance.ts disable <instance-id>
bun scripts/db/register-message-proxy-instance.ts remove <instance-id>
```

移除會刪除 OAuth 連線，並永久防止該來源被再次註冊。若日後可能恢復該實例，請使用 `disable`。現有的身分與記憶仍可使用，且變更無需重新啟動即可生效。

關於使用者設定請參閱[訊息代理支援](/features/integrations/message-proxy-support/#pluralbuddy)，關於權杖儲存與重新整理行為請參閱[訊息代理架構](/architecture/integrations/message-proxy/)。
