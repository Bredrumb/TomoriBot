export default {
  memory: {
    description: `管理保存的记忆和文档。`,
    document: {
      description: `管理文档记忆。`,
      add: {
        description: `往记忆里添加一份文档。`,
      },
      remove: {
        description: `从记忆里移除一份文档。`,
      },
    },
    personal: {
      description: `管理个人记忆。`,
      add: {
        description: `添加一条个人记忆。`,
      },
      remove: {
        description: `移除一条个人记忆。`,
      },
    },
    server: {
      description: `管理服务器记忆。`,
      add: {
        description: `添加一条服务器记忆。`,
      },
      remove: {
        description: `移除一条服务器记忆。`,
      },
    },
  },
};
