export default {
  import: {
    description: "从可迁移的文件导入配置或记忆。",
    config: {
      description: "导入一个服务器配置文件。",
      file_description: "由 TomoriBot 导出的配置文件。",
    },
    memories: {
      description: "导入一个服务器记忆文件。",
      file_description: "由 TomoriBot 导出的记忆文件。",
    },
    personal: {
      description: "导入你的账号拥有的配置或记忆。",
      config: {
        description: "导入一个个人配置文件。",
        file_description: "由 TomoriBot 导出的个人配置文件。",
      },
      memories: {
        description: "导入一个个人记忆文件。",
        file_description: "由 TomoriBot 导出的个人记忆文件。",
      },
    },
  },
};
