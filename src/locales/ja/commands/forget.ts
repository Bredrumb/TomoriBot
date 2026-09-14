export default {
  forget: {
    sampledialogue: {
      description: `私の記憶からサンプルユーザー/ボットの対話ペアを削除します。`,
    },
    attribute: {
      description: `私の記憶から人格属性を削除します。`,
    },
    document: {
      description: `サーバーの文書を削除します。`,
    },
    personaprompt: {
      description: `ペルソナ専用プロンプトをクリアします`,
      no_prompt_title: `ペルソナプロンプトがありません`,
      no_prompt_description: `クリアできるペルソナ専用プロンプトがありません。\`/config\` > Persona > Advanced で設定できます。`,
      success_title: `ペルソナプロンプトをクリアしました`,
      success_description: `「{persona_name}」のペルソナプロンプトをクリアしました。`,
      success_description_with_prompt: `「{persona_name}」のペルソナプロンプトをクリアしました。控えが必要な場合は以下をコピーしてください：
\`\`\`
{removed_prompt}
\`\`\``,
    },
    memory: {
      personal: {
        description: `個人的な記憶を削除します。`,
      },
      server: {
        description: `私の知識からサーバーの記憶を削除します。`,
      },
    },
  },
};
