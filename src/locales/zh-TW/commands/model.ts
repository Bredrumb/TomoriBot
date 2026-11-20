export default {
  // The config panel reads several strings from this namespace even though every `/model` leaf but
  // `override remove` is dissolved, so pruning it wholesale breaks the Channels and Models pages.
  model: {
    description: `管理這個伺服器的預設 AI 模型。`,
    providerPicker: {
      no_providers_title: `沒有已儲存的供應商`,
      no_providers_description: `這項功能沒有已儲存的供應商可用。請先用 \`/providers\` 新增一個。`,
    },
    text: {
      no_models_title: `找不到模型`,
      no_models_description: `無法從資料庫載入可用的 AI 模型。`,
      invalid_model_title: `模型無效`,
      invalid_model_description: `選取的模型名稱無效或無法使用。`,
      success_title: `模型已更新`,
      scope_set_persona_success: `**{persona}** 的模型已設為 **{model}**`,
    },
    fallback: {
      custom_provider_label: `Custom`,
      no_models_description: `選取的供應商沒有可用的模型。`,
    },
    override: {
      remove: {
        description: `移除頻道與人格的模型覆寫。`,
        modal_title: `移除模型覆寫`,
        channel_unknown: `未知`,
        channel_checkbox_label: `頻道覆寫`,
        channel_checkbox_label_continued: `頻道覆寫（續）`,
        channel_checkbox_description: `取消勾選你想移除的頻道覆寫。在 /config > 頻道 > 覆寫中編輯。`,
        persona_checkbox_label: `人格覆寫`,
        persona_checkbox_label_continued: `人格覆寫（續）`,
        persona_checkbox_description: `取消勾選你想移除的人格覆寫。在 /config > 人格 > 覆寫中編輯。`,
        mixed_checkbox_label: `頻道與人格覆寫`,
        mixed_checkbox_label_continued: `頻道與人格覆寫（續）`,
        mixed_checkbox_description: `取消勾選你想移除的頻道或人格覆寫。`,
        none_title: `沒有模型覆寫`,
        none_description: `這個伺服器沒有設定任何頻道或人格的模型覆寫。`,
        no_removals_title: `沒有移除任何模型覆寫`,
        no_removals_description: `沒有取消勾選任何覆寫。模型覆寫維持不變。`,
        success_title: `模型覆寫已更新`,
        success_description: `已移除下列模型覆寫。
{removed_overrides}`,
        page_select_prompt: `找到 {total} 個模型覆寫。請選擇要移除的批次：`,
        page_select_prompt_capped: `找到 {total} 個模型覆寫。目前分成 25 個批次顯示前 {shown} 個，移除一些才能看到其餘項目。`,
      },
      description: `管理頻道與人格的模型覆寫。`,
    },
  },
};
