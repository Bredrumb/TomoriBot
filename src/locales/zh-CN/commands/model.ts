export default {
  // The config panel reads several strings from this namespace even though every `/model` leaf but
  // `override remove` is dissolved, so pruning it wholesale breaks the Channels and Models pages.
  model: {
    description: `管理这个服务器的默认 AI 模型。`,
    providerPicker: {
      no_providers_title: `没有已保存的提供方`,
      no_providers_description: `这个能力还没有已保存的提供方可用。请先用 \`/providers\` 添加一个。`,
    },
    text: {
      no_models_title: `没有找到模型`,
      no_models_description: `无法从数据库加载可用的 AI 模型。`,
      invalid_model_title: `模型无效`,
      invalid_model_description: `所选的模型名称无效或不可用。`,
      success_title: `模型已更新`,
      scope_set_persona_success: `**{persona}** 的模型已设为 **{model}**`,
    },
    fallback: {
      custom_provider_label: `自定义`,
      no_models_description: `所选的提供方没有可用的模型。`,
    },
    override: {
      remove: {
        description: `移除频道和人格的模型覆盖。`,
        modal_title: `移除模型覆盖`,
        channel_unknown: `未知`,
        channel_checkbox_label: `频道覆盖`,
        channel_checkbox_label_continued: `频道覆盖（续）`,
        channel_checkbox_description: `取消勾选你想移除的频道覆盖。可在 /config > 频道 > 覆盖 里编辑。`,
        persona_checkbox_label: `人格覆盖`,
        persona_checkbox_label_continued: `人格覆盖（续）`,
        persona_checkbox_description: `取消勾选你想移除的人格覆盖。可在 /config > 人格 > 覆盖 里编辑。`,
        mixed_checkbox_label: `频道与人格覆盖`,
        mixed_checkbox_label_continued: `频道与人格覆盖（续）`,
        mixed_checkbox_description: `取消勾选你想移除的频道或人格覆盖。`,
        none_title: `没有模型覆盖`,
        none_description: `这个服务器没有配置任何频道或人格的模型覆盖。`,
        no_removals_title: `没有移除模型覆盖`,
        no_removals_description: `没有取消勾选任何覆盖。模型覆盖保持不变。`,
        success_title: `模型覆盖已更新`,
        success_description: `已移除以下模型覆盖。
{removed_overrides}`,
        page_select_prompt: `找到 {total} 条模型覆盖。选择要移除的一批：`,
        page_select_prompt_capped: `找到 {total} 条模型覆盖。前 {shown} 条分成 25 批显示；移除一部分就能看到后面的。`,
      },
      description: `管理频道和人格的模型覆盖。`,
    },
  },
};
