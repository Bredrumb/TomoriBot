// locales/ja/commands/stats.ts

export default {
  stats: {
    description: `使用統計を表示します`,

    personal: {
      description: `自分の使用統計を表示します。`,
      timeframe_description: `集計する期間。`,
      scope_description: `このサーバーのみ、または全サーバーの活動を集計します。`,
    },
    persona: {
      description: `このサーバーでのペルソナの使用統計を表示します。`,
      timeframe_description: `集計する期間。`,
      picker_title: `ペルソナを選択`,
      picker_description: `統計を表示するペルソナを選んでください。`,
      no_personas_title: `ペルソナがありません`,
      no_personas_description: `このサーバーには統計を表示できるペルソナがまだありません。`,
    },
    server: {
      description: `サーバー全体の使用統計を表示します。`,
      timeframe_description: `集計する期間。`,
    },

    // 共通ダッシュボード文字列
    empty: `—`,
    footer: `トークン数とコストは文字数ベースの概算です。`,
    unknown_persona: `ペルソナ #{id}`,
    days: `{count}日`,
    local_suffix: `現地時間`,
    weekday_names: `日,月,火,水,木,金,土`,

    tabs: {
      overview_label: `概要`,
      overview_title: `概要`,
      personas_label: `ペルソナ`,
      personas_title: `ペルソナ`,
      models_label: `モデル`,
      models_title: `モデルとコスト`,
      tools_label: `ツール`,
      tools_title: `ツールとコマンド`,
      expression_label: `表現`,
      expression_title: `表現`,
      people_label: `ユーザー`,
      people_title: `よく話す相手`,
      leaderboard_label: `ランキング`,
      leaderboard_title: `ランキング`,
    },

    fields: {
      messages: `メッセージ`,
      commands: `コマンド実行回数`,
      current_streak: `現在の連続日数`,
      longest_streak: `最長連続日数`,
      peak_hour: `最も活発な時間帯`,
      peak_weekday: `最も活発な曜日`,
      rewards: `ごほうび`,
      punishments: `おしおき`,
      favorite_persona: `お気に入りペルソナ（忠誠度）`,
      persona_affinity: `ペルソナ親密度`,
      top_models: `トップモデル`,
      model_diversity: `使用モデル数`,
      tokens_in: `入力トークン（概算）`,
      tokens_out: `出力トークン（概算）`,
      est_cost: `推定コスト`,
      top_tools: `トップツール`,
      top_commands: `トップコマンド`,
      top_emoji: `トップ絵文字`,
      top_stickers: `トップスタンプ`,
      top_sprites: `トップスプライト`,
      top_people: `よく話す相手`,
      leaderboard: `トップメンバー`,
      images: `生成画像数`,
      videos: `生成動画数`,
    },
  },
};
