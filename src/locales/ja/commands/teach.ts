export default {
  teach: {
    sampledialogue: {
      description: `私がどのように応答すべきかの例として、ユーザー/ボットの対話ペアを追加します。`,
    },
    attribute: {
      description: `このサーバーでの私を表す人格属性を追加します。`,
    },
    document: {
      description: `Retrieval-Augmented Generationで参照できる文書を教えます。`,
      main_persona_description: `メインペルソナ`,
      alter_persona_description: `オルタペルソナ`,
    },
    personaprompt: {
      description: `system-prompt の後ろに追記するペルソナ専用プロンプトを設定します`,
      modal_title: `ペルソナプロンプトを設定`,
      part1_placeholder: `例: ベテラン戦術家のように、簡潔で落ち着いた口調で話して。`,
      part2_placeholder: `追加のペルソナ指示...`,
      part3_placeholder: `さらにペルソナ指示...`,
      part4_placeholder: `最後のペルソナ指示...`,
      success_title: `ペルソナプロンプトを更新しました`,
      success_description: `「{persona_name}」のペルソナプロンプトを更新しました。`,
    },
    memory: {
      description: `私の記憶を管理`,
      personal: {
        description: `どのサーバーでも私が覚えているあなたの個人的な記憶を追加します。`,
      },
      server: {
        description: `私の知識ベースにサーバーの記憶を追加します。`,
      },
    },
  },
};
