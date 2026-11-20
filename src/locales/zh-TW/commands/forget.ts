export default {
  forget: {
    sampledialogue: {
      description: `從我的記憶移除一組使用者與 bot 的範例對話。`,
    },
    attribute: {
      description: `從我的記憶移除一項人格屬性。`,
    },
    document: {
      description: `從伺服器知識庫移除一份文件。`,
    },
    personaprompt: {
      description: `清除人格專屬的提示詞`,
      no_prompt_title: `沒有人格提示詞`,
      no_prompt_description: `沒有可以清除的人格專屬提示詞。請用 \`/config\` > 人格 > 進階設定一組。`,
      success_title: `人格提示詞已清除`,
      success_description: `已清除「{persona_name}」的人格提示詞。`,
      success_description_with_prompt: `已清除「{persona_name}」的人格提示詞。如果你想留一份副本，內容如下：
\`\`\`
{removed_prompt}
\`\`\``,
    },
    memory: {
      personal: {
        description: `移除一則個人記憶。`,
      },
      server: {
        description: `從我的知識移除一則伺服器記憶。`,
      },
    },
  },
};
