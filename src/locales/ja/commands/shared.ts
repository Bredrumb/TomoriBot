export default {
  shared: {
    character_reference: {
      invalid_image_title: `無効な画像`,
      invalid_image_description: `キャラクターリファレンス用の画像ファイルをアップロードしてください。`,
      download_failed_title: `ダウンロード失敗`,
      download_failed_description: `選択された添付画像のダウンロードに失敗しました。もう一度お試しください。`,
      conversion_failed_title: `画像の変換に失敗しました`,
      conversion_failed_description: `保存用に画像をPNG形式に変換できませんでした。別の画像をお試しください。`,
      success_title: `キャラクターリファレンスを更新しました`,
      success_me_description: `あなたのキャラクターリファレンス画像を更新しました。`,
      success_persona_description: `**{persona_name}** のキャラクターリファレンス画像を更新しました。`,
      cleared_title: `キャラクターリファレンスをクリアしました`,
      cleared_me_description: `あなたのキャラクターリファレンス画像をクリアしました。`,
      cleared_persona_description: `**{persona_name}** のキャラクターリファレンス画像をクリアしました。`,
    },
    rag: {
      disabled_title: `ドキュメントRAGが無効です`,
      disabled_description: `文書の参照にはデータベースに [pgvector](https://github.com/pgvector/pgvector) PostgreSQL拡張が必要です。pgvector をインストールして TomoriBot を再起動してください（[自己ホスト設定ガイド](https://docs.tomoribot.app/ja/self-hosting/manual-setup/)を参照）。`,
    },
    persona_select: {
      main_persona_description: `メインペルソナ`,
      alter_persona_description: `オルタペルソナ`,
    },
  },
};
