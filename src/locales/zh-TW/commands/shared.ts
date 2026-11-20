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
  },
};
