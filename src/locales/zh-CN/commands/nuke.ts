export default {
  nuke: {
    description: `彻底清空所有服务器数据。之后需要重新运行 /setup。`,
    confirmation_description: `确认要永久删除这个服务器的数据。此操作无法撤销。`,
    confirmation_choice_yes: `是，清空它`,
    confirmation_choice_no: `不，取消`,
    preserve_personas_description: `保留人格及其属性、配置和记忆（跳过人格树的删除）。`,
    cancelled_title: `已取消清空`,
    cancelled_description: `没有更改任何数据。服务器数据保持原样。`,
    success_full_title: `服务器已清空`,
    success_full_description: `所有服务器数据都已清空，包括人格。Discord 侧的 Webhook 已删除：**{webhooks_deleted}**（失败：**{webhooks_failed}**）。运行 \`/setup\` 重新开始。`,
    success_preserved_title: `服务器已清空（保留人格）`,
    success_preserved_description: `服务器设置、白名单、配额、触发和集成都已清空。人格及其属性和记忆都保留。Discord 侧的 Webhook 已删除：**{webhooks_deleted}**（失败：**{webhooks_failed}**）。运行 \`/setup\` 重新配置服务器级设置。`,
  },
};
