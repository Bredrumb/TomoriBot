export default {
  reward: {
    description: `私へのご褒美インタラクション。`,
    headpat: {
      description: `ヘッドパットして応答をトリガーします。`,
      reason_description: `どうしてご褒美をくれるの？`,
      embed_title: `🫳 ヘッドパット・タイム！`,
      embed_description: `{user}は現在{bot}をなでています。`,
      history_label: `ヘッドパット`,
    },
    hug: {
      description: `ハグして応答をトリガーします。`,
      reason_description: `どうしてご褒美をくれるの？`,
      embed_title: `🤗 ハグ・タイム！`,
      embed_description: `{user}は{bot}をぎゅっと抱きしめています。`,
      history_label: `ハグ`,
    },
    kiss: {
      description: `キスして応答をトリガーします。`,
      reason_description: `どうしてご褒美をくれるの？`,
      embed_title: `💋 キス・タイム！`,
      embed_description: `{user}は{bot}にキスしました。`,
      history_label: `キス`,
    },
    tickle: {
      description: `くすぐって応答をトリガーします。`,
      reason_description: `どうしてご褒美をくれるの？`,
      embed_title: `🤭 くすぐり・タイム！`,
      embed_description: `{user}は{bot}をくすぐっています。`,
      history_label: `くすぐり`,
    },
    feed: {
      description: `美味しいものを食べさせて応答をトリガーします。`,
      reason_description: `どうしてご褒美をくれるの？`,
      food_description: `何を食べさせますか？`,
      embed_title: `🍴 スナック・タイム！`,
      embed_description: `{user}は{bot}に{food_text}を与えました。`,
      history_label: `食べさせる`,
    },
  },
};
