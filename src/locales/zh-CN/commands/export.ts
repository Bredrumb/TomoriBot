export default {
  export: {
    description: "把你的配置或记忆导出成可迁移的文件。",
    config: {
      description: "把这个服务器的配置导出成可迁移的文件。",
    },
    memories: {
      description: "把记忆导出成可迁移的文件。",
      scope_description: "要导出哪些记忆。",
      persona_description: "要导出哪个人格的记忆。只在「选中的人格」范围下使用。",
      scope_choice_main: "主人格",
      scope_choice_persona: "选中的人格",
      scope_choice_all: "所有人格",
    },
    personal: {
      description: "导出你的账号拥有的配置或记忆。",
      config: {
        description: "把你的个人配置导出成可迁移的文件。",
      },
      memories: {
        description: "把你的账号拥有的记忆导出成可迁移的文件。",
        scope_description: "要导出你的哪些记忆。",
        persona_description: "要导出哪个人格的记忆。只在「选中的人格」范围下使用。",
        scope_choice_global: "全局",
        scope_choice_persona: "选中的人格",
        scope_choice_all: "所有人格",
      },
    },
  },
};
