export default {
  shared: {
    character_reference: {
      invalid_image_title: `图像无效`,
      invalid_image_description: `请上传一张图片附件作为角色参考。`,
      download_failed_title: `下载失败`,
      download_failed_description: `下载所选的图片附件失败，请重试。`,
      conversion_failed_title: `图像转换失败`,
      conversion_failed_description: `无法将该图像转换为 PNG 格式保存，请换一张图片试试。`,
      success_title: `角色参考已更新`,
      success_me_description: `已更新你的角色参考图。`,
      success_persona_description: `已更新 **{persona_name}** 的角色参考图。`,
      cleared_title: `角色参考已清除`,
      cleared_me_description: `已清除你的角色参考图。`,
      cleared_persona_description: `已清除 **{persona_name}** 的角色参考图。`,
    },
    rag: {
      disabled_title: `文档 RAG 已停用`,
      disabled_description: `文档检索需要数据库里有 [pgvector](https://github.com/pgvector/pgvector) PostgreSQL 扩展。安装 pgvector 并重启我之后即可启用（参见[自部署设置指南](https://docs.tomoribot.app/zh-CN/self-hosting/manual-setup/)）。`,
    },
    persona_select: {
      main_persona_description: `主人格`,
      alter_persona_description: `副人格`,
    },
  },
};
