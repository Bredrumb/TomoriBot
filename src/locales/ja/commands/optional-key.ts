// locales/ja/commands/optional-key.ts

export default {
  "optional-key": {
    description: `オプションのサービスAPIキーを管理`,
    brave: {
      description: `Brave Search APIキーを管理`,
      set: {
        description: `このサーバーのBrave Search APIキーを設定します。`,
        key_description: `あなたのBrave Search APIキー。`,
        invalid_key_title: `無効なAPIキー形式`,
        invalid_key_description: `提供されたAPIキーは短すぎるか無効のようです。有効なキーを提供してください。`,
        key_validation_failed_title: `Brave APIキーの検証に失敗しました`,
        key_validation_failed_description: `提供されたBrave Search APIキーは無効です。キーを確認してもう一度お試しください。`,
        success_title: `Brave APIキーが設定されました`,
        success_description: `Brave Search APIキーが正常に検証、暗号化、保存されました。

⚠️ **重要：** Braveでは毎月5ドル分の無料クレジットが提供され、それを超えると課金されます。予期しない課金を防ぐため、[Braveの使用量上限ダッシュボード](https://api-dashboard.search.brave.com/app/subscriptions/usage-limits)で使用量上限を5ドルに設定してください。`,
      },
      remove: {
        description: `現在設定されているBrave Search APIキーを削除します。`,
        no_key_title: `Brave APIキーが設定されていません`,
        no_key_description: `現在削除するBrave Search APIキーが設定されていません。`,
        success_title: `Brave APIキーが削除されました`,
        success_description: `Brave Search APIキーが正常に削除されました。`,
      },
    },
  },
};
