// locales/ja/commands/provider.ts

export default {
  provider: {
    description: `保存されたプロバイダー設定を管理`,
    add: {
      description: `切り替えずに保存済みプロバイダー設定を追加または更新します。`,
      modal_title: `保存済みプロバイダーを追加`,
      success_title: `プロバイダーを保存しました`,
      success: `**{provider}** の認証情報を保存しました。\`/config model text\`でテキストモデルに選択するか、\`/config model embedding|image|video|vision\`でその他の機能に設定できます。`,
      updated_existing: `**{provider}** の保存済み認証情報を更新しました。`,
      custom_moved_title: `カスタムエンドポイントは移動しました`,
      custom_moved_description: `旧来のカスタムエンドポイント用プロバイダーフローは非推奨です。{custom_models_add_command} でエンドポイントを登録し、{model_text_command} で有効化してください。更新後の案内は {help_custom_models_command} を参照してください。`,
      provider_label: `対象プロバイダー`,
      provider_description: `認証情報を追加またはローテーションするプロバイダーを選択してください。`,
      provider_placeholder: `プロバイダーを選択...`,
      already_existing_suffix: `Already Existing`,
      already_existing_description: `このプロバイダーは既に設定済みです。送信すると認証情報が更新されます。`,
      custom_deprecated_description: `/config custom-endpoint add に移動しました。リダイレクト案内を見るときだけ選択してください。`,
      api_key_description: `このキーは安全に保存されます。カスタムエンドポイントを選んでリダイレクト案内だけ確認したい場合は空欄で構いません。`,
      api_key_label: `APIキー`,
      api_key_placeholder: `このキーは誰とも共有しないでください`,
    },
    remove: {
      description: `保存されたプロバイダー設定を削除します。`,
      no_saved_title: `保存済み設定がありません`,
      no_saved_description: `削除する保存済みプロバイダー設定がありません。先に\`/config provider add\`でプロバイダーを追加してください。`,
      picker_title: `プロバイダー設定を削除`,
      picker_description: `削除するプロバイダーを選択してください。保存されたAPIキーが削除され、依存するモデル選択がリセットされます。`,
      active_provider_note: `**{provider}**は現在のアクティブプロバイダーであるため、使用中は削除できません。先に\`/config model\`で別のプロバイダーに切り替えてください。`,
      custom_endpoint_note: `カスタムエンドポイント（ElevenLabsやローカルサーバーなど）を削除するには、代わりに\`/config custom-endpoint remove\`を使用してください。`,
      success_title: `保存済み設定を削除しました`,
      success_description: `**{provider}**の保存済み設定を削除しました。再度使用するには\`/config provider add\`で登録してください。`,
      auto_reassigned_description: `**{provider}** の保存済み設定を削除しました。

依存していた選択も更新しました:
{reassignments}`,
    },
    "api-key": {
      description: `AIプロバイダーのAPIキーを管理`,
      set: {
        no_providers_title: `利用可能なプロバイダーがありません`,
        no_providers_description: `データベースに利用可能なAIプロバイダーがありません。\`/support discord\` で報告してください。`,
        invalid_key_title: `無効なAPIキー形式`,
        invalid_key_description: `提供されたAPIキーは短すぎるか無効のようです。有効なキーを提供してください。`,
        unsupported_provider_title: `サポートされていないプロバイダー`,
        unsupported_provider_description: `プロバイダー「{provider}」は現在APIキーの検証をサポートしていません。`,
        validation_error_title: `検証エラー`,
        validation_error_description: `APIキーの検証中にエラーが発生しました。もう一度お試しください。`,
        key_validation_failed_title: `APIキーの検証に失敗しました`,
        key_validation_failed_description: `{provider}に対して提供されたAPIキーは無効です。キーを確認してもう一度お試しください。`,
      },
      rotation: {
        description: `負荷分散とフェイルオーバー用のAPIキーローテーションを管理します。`,
        action_description: `アクションを選択：キーを追加するか、すべてのキーを削除`,
        action_add: `キーを追加`,
        action_purge: `すべてのキーを削除`,
        key_description: `ローテーションプールに追加するAPIキー（追加アクションに必要）`,
        no_main_key_title: `メインAPIキーがありません`,
        no_main_key_description: `ローテーションキーを追加する前に、\`/config provider add\`で有効なプロバイダー認証情報を登録する必要があります。`,
        custom_provider_title: `サポートされていません`,
        custom_provider_description: `カスタムプロバイダーではAPIキーローテーションはサポートされていません。`,
        key_required_title: `キーが必要です`,
        key_required_description: `「追加」アクションを使用する場合は、APIキーを入力してください。`,
        add_success_title: `ローテーションキーが追加されました`,
        add_success_description: `新しいAPIキーがローテーションプールに正常に追加されました。現在、{provider}に**{count}**個のローテーションキーがあります。キーはラウンドロビン順序で自動フェイルオーバーとともに使用されます。`,
        purge_success_title: `ローテーションキーが削除されました`,
        purge_success_description: `ローテーションプールから**{count}**個のキーが正常に削除されました。メインAPIキーのみが使用されます。`,
        no_keys_title: `ローテーションキーがありません`,
        no_keys_description: `削除するローテーションキーがありません。メインAPIキーのみが設定されています。`,
      },
    },
    "custom-endpoint": {
      description: `ラベル付きカスタムエンドポイントを管理します。`,
      add: {
        description: `ラベル付きカスタムエンドポイントに1機能を登録します。`,
      },
      edit: {
        description: `登録済みカスタムエンドポイントの項目を置き換えます。`,
      },
      remove: {
        description: `ラベル付きカスタムエンドポイントから選んだ機能を削除します。`,
      },
    },
  },
};
