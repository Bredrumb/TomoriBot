export default {
  forget: {
    sampledialogue: {
      description: `从我的记忆里移除一对用户／bot 的示例对话。`,
    },
    attribute: {
      description: `从我的记忆里移除一条性格属性。`,
    },
    document: {
      description: `从服务器知识库里移除一份文档。`,
    },
    personaprompt: {
      description: `清除只对某个人格生效的提示词`,
      no_prompt_title: `没有人格提示词`,
      no_prompt_description: `没有可以清除的人格提示词。可在 \`/config\` > 人格 > 高级 里设置。`,
      success_title: `人格提示词已清除`,
      success_description: `已清除「{persona_name}」的人格提示词。`,
      success_description_with_prompt: `已清除「{persona_name}」的人格提示词。如果你想留个备份，内容如下：
\`\`\`
{removed_prompt}
\`\`\``,
    },
    memory: {
      personal: {
        description: `移除一条个人记忆。`,
      },
      server: {
        description: `从我的知识里移除一条服务器记忆。`,
      },
    },
  },
};
