export default {
  teach: {
    sampledialogue: {
      description: `添加一对用户／bot 的示例对话，作为我该怎么回复的参考。`,
    },
    attribute: {
      description: `添加一条描述我在这台服务器上性格的属性。`,
    },
    document: {
      description: `上传一份文档，让我用检索增强生成（RAG）来参考。`,
      main_persona_description: `主人格`,
      alter_persona_description: `副人格`,
    },
    personaprompt: {
      description: `设置追加在系统提示词之后、只对某个人格生效的提示词`,
      modal_title: `设置人格提示词`,
      part1_placeholder: `例如：像一位老兵那样说话，简洁冷静。`,
      part2_placeholder: `其他人格指令……`,
      part3_placeholder: `更多人格指令……`,
      part4_placeholder: `最后的人格指令……`,
      success_title: `人格提示词已更新`,
      success_description: `已更新「{persona_name}」的人格提示词。`,
    },
    memory: {
      description: `管理我的记忆`,
      personal: {
        description: `添加一条关于你、在任何服务器上都能记住的个人记忆。`,
      },
      server: {
        description: `往我的知识库添加一条服务器记忆。`,
      },
    },
  },
};
