export default {
  export: {
    description: `設定または記憶をファイルとしてエクスポートします。`,
    config: {
      description: `このサーバーの設定をファイルとしてエクスポートします。`,
    },
    memories: {
      description: `記憶をファイルとしてエクスポートします。`,
      scope_description: `エクスポートする記憶の範囲。`,
      persona_description: `記憶をエクスポートするペルソナ。「選択したペルソナ」の範囲でのみ使用されます。`,
      scope_choice_main: `メインペルソナ`,
      scope_choice_persona: `選択したペルソナ`,
      scope_choice_all: `すべてのペルソナ`,
    },
    personal: {
      description: `自分のアカウントが所有する設定または記憶をエクスポートします。`,
      config: {
        description: `個人設定をファイルとしてエクスポートします。`,
      },
      memories: {
        description: `自分のアカウントが所有する記憶をファイルとしてエクスポートします。`,
        scope_description: `エクスポートする自分の記憶の範囲。`,
        persona_description: `記憶をエクスポートするペルソナ。「選択したペルソナ」の範囲でのみ使用されます。`,
        scope_choice_global: `グローバル`,
        scope_choice_persona: `選択したペルソナ`,
        scope_choice_all: `すべてのペルソナ`,
      },
    },
  },
};
