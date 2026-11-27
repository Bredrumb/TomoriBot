export default {
  shared: {
    character_reference: {
      invalid_image_title: `圖片無效`,
      invalid_image_description: `請上傳圖片附件作為角色參考。`,
      download_failed_title: `下載失敗`,
      download_failed_description: `下載所選的圖片附件失敗。請再試一次。`,
      conversion_failed_title: `圖片轉換失敗`,
      conversion_failed_description: `無法將該圖片轉換為 PNG 格式以供儲存。請換一張圖片試試。`,
      success_title: `角色參考已更新`,
      success_me_description: `已更新你的角色參考圖片。`,
      success_persona_description: `已更新 **{persona_name}** 的角色參考圖片。`,
      cleared_title: `角色參考已清除`,
      cleared_me_description: `已清除你的角色參考圖片。`,
      cleared_persona_description: `已清除 **{persona_name}** 的角色參考圖片。`,
    },
    rag: {
      disabled_title: `文件 RAG 已停用`,
      disabled_description: `文件檢索需要資料庫裡的 [pgvector](https://github.com/pgvector/pgvector) PostgreSQL 擴充功能。請安裝 pgvector 並重新啟動我就能啟用，詳見 [自架設定指南](https://docs.tomoribot.app/zh-TW/self-hosting/manual-setup/)。`,
    },
    persona_select: {
      main_persona_description: `主要人格`,
      alter_persona_description: `alter`,
    },
    send_blocked: {
      cannot_send_title: `我無法在這裡傳送訊息`,
      cannot_send_description: `我需要在這個頻道擁有 **檢視頻道** 與 **傳送訊息** 權限（若在討論串中，則需要 **在討論串中發送訊息**），才能在這裡回覆對話，但目前至少缺少其中一項。請讓伺服器管理員將兩項權限都授予我。`,
      missing_permissions_description: `我無法讀取自己在這個頻道的權限，因此暫時不會在這裡回覆對話。請稍後再試一次，如果問題持續發生，請檢查我的身分組權限。`,
      timed_out_title: `我被設為超時`,
      timed_out_description: `有版主在這個伺服器將我設為超時，因此 Discord 會封鎖我的訊息直到 {time}。如果你想讓我更早回覆，請到我的成員個人資料中解除超時。`,
      send_refused_title: `Discord 拒絕了我上一則訊息`,
      send_refused_description: `Discord 拒絕了我在這個頻道的上一則訊息，通常是因為權限變更或我被設為超時。我會在 {time} 再次嘗試這個頻道。`,
    },
  },
};
