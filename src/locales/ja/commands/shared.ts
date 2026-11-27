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
    send_blocked: {
      cannot_send_title: `ここではメッセージを送信できません`,
      cannot_send_description: `このチャンネルのチャットに返信するには、**チャンネルを見る**と**メッセージを送信**（スレッドの場合は**スレッドでメッセージを送信**）の権限が必要ですが、少なくとも一方が不足しています。サーバー管理者に両方の権限を付与してもらってください。`,
      missing_permissions_description: `このチャンネルでの自身の権限を読み取れなかったため、ここではチャットに返信しません。しばらくしてからもう一度お試しいただき、同じ状況が続く場合は私のロールの権限を確認してください。`,
      timed_out_title: `タイムアウトされています`,
      timed_out_description: `このサーバーのモデレーターによってタイムアウトされたため、{time}までDiscordによってメッセージがブロックされています。すぐに返信させたい場合は、私のメンバープロフィールからタイムアウトを解除してください。`,
      send_refused_title: `Discordが前回のメッセージを拒否しました`,
      send_refused_description: `このチャンネルへの前回のメッセージがDiscordによって拒否されました。通常、権限が変更されたかタイムアウトされたことが原因です。{time}にこのチャンネルで再度送信を試みます。`,
    },
  },
};
