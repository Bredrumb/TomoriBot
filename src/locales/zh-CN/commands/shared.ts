export default {
  shared: {
    rag: {
      disabled_title: `文档 RAG 已停用`,
      disabled_description: `文档检索需要数据库里有 [pgvector](https://github.com/pgvector/pgvector) PostgreSQL 扩展。安装 pgvector 并重启我之后即可启用（参见[自部署设置指南](https://docs.tomoribot.app/en/self-hosting/manual-setup/)）。`,
    },
    persona_select: {
      main_persona_description: `主人格`,
      alter_persona_description: `副人格`,
    },
  },
};
