export default {
  nuke: {
    description: `完全清空所有伺服器資料。之後需要重新執行 /setup。`,
    confirmation_description: `確認你要永久刪除這個伺服器的資料。這個動作無法復原。`,
    confirmation_choice_yes: `是，清空它`,
    confirmation_choice_no: `不，取消`,
    preserve_personas_description: `保留人格與其屬性、設定、記憶（略過人格樹狀資料的刪除）。`,
    cancelled_title: `已取消清空`,
    cancelled_description: `沒有變更任何資料。伺服器資料維持原狀。`,
    success_full_title: `伺服器已清空`,
    success_full_description: `所有伺服器資料都已清空，包括人格。Discord 端的網路鉤子已刪除：**{webhooks_deleted}**（失敗：**{webhooks_failed}**）。請執行 \`/setup\` 重新開始。`,
    success_preserved_title: `伺服器已清空（保留人格）`,
    success_preserved_description: `伺服器設定、白名單、額度、觸發與整合都已清空。人格與其屬性、記憶則保留。Discord 端的網路鉤子已刪除：**{webhooks_deleted}**（失敗：**{webhooks_failed}**）。請執行 \`/setup\` 重新設定伺服器層級的選項。`,
  },
};
