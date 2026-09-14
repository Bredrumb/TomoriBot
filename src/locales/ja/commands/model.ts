export default {
  model: {
    description: `このサーバーの既定AIモデルを管理します。`,
    providerPicker: {
      no_providers_title: `保存済みプロバイダーがありません`,
      no_providers_description: `この機能で使える保存済みプロバイダーがありません。先に \`/providers\` で追加してください。`,
    },
    text: {
      no_models_title: `モデルが見つかりません`,
      no_models_description: `データベースから利用可能なAIモデルを読み込めませんでした。`,
      invalid_model_title: `無効なモデル`,
      invalid_model_description: `選択されたモデル名は無効か、利用できません。`,
      success_title: `モデルが更新されました`,
      scope_set_persona_success: `**{persona}** のモデルを **{model}** に設定しました`,
    },
    fallback: {
      custom_provider_label: `カスタム`,
      no_models_description: `選択したプロバイダーで利用可能なモデルがありません。`,
    },
    override: {
      remove: {
        description: `チャンネルとペルソナのモデル上書きを削除します。`,
        modal_title: `モデル上書きの削除`,
        channel_checkbox_label: `チャンネル上書き`,
        channel_checkbox_label_continued: `チャンネル上書き（続き）`,
        channel_checkbox_description: `削除したいチャンネル上書きのチェックを外してください。編集は /config > Channels > Overrides で行えます。`,
        persona_checkbox_label: `ペルソナ上書き`,
        persona_checkbox_label_continued: `ペルソナ上書き（続き）`,
        persona_checkbox_description: `削除したいペルソナ上書きのチェックを外してください。編集は /config > Persona > Overrides で行えます。`,
        none_title: `モデル上書きなし`,
        none_description: `このサーバーにはチャンネルまたはペルソナのモデル上書きが設定されていません。`,
        no_removals_title: `削除されたモデル上書きはありません`,
        no_removals_description: `どの上書きも未チェックになっていません。モデル上書きは変更されていません。`,
        success_title: `モデル上書きを更新しました`,
        success_description: `次のモデル上書きを削除しました。
{removed_overrides}`,
      },
      description: `チャンネルとペルソナのモデル上書きを管理します。`,
    },
  },
};
