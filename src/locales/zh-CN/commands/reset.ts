export default {
  reset: {
    description: "把服务器或个人配置重置为默认值。",
    config: {
      description: "把这个服务器的配置重置为数据库默认值。",
      confirm_title: "重置服务器配置",
      confirm_description:
        "> 这会把服务器设置恢复成数据库默认值。\n> 已编写的提示词、备注和标签列表都会被重置。\n\n**受影响的区块：**\n> • 人格：0 项设置（所有人格都会保留）\n> • 行为：9 项设置（系统提示词、备注、触发）\n> • 频道：6 项设置（频道规则、自动触发）\n> • 权限：11 项设置（功能、权限）\n> • 模型：3 项设置（采样器、备用模型；ID 保留）\n\n**不受影响：**\n> 人格：{persona_remove}\n> 记忆：{memories} 或 {personal_memories}\n> 提供方：{providers} 或 {personal_providers}\n> 定时任务：{scheduled_task_remove}\n> 整个服务器清空：{nuke}\n已记录的配额用量和外部集成都原样保留。",
      confirm_button: "重置配置",
      no_permission_title: "权限不足",
      no_permission_description: "重置这个服务器的配置需要管理服务器权限。",
      no_server_data_title: "没有服务器数据",
      no_server_data_description: "没有找到这个服务器的配置。",
      success_title: "配置已重置",
      success_description: "服务器配置已重置为数据库默认值。",
    },
    personal: {
      description: "个人配置指令。",
      config: {
        description: "把你的个人配置重置为数据库默认值。",
        confirm_title: "重置个人配置",
        confirm_description:
          "> 这会把个人设置恢复成数据库默认值。\n\n**受影响的区块：**\n> • 个人资料：昵称、外观、性别、人称代词\n> • 隐私：隐私级别、跨服务器选择加入\n> • 高级：回复模式、扮演、个人聚焦\n> • 模型：0 项设置（所有提供方设置都会保留）\n\n**不受影响：**\n> 提供方：{personal_providers}\n> 记忆：{personal_memories}\n> 定时任务：{scheduled_task_remove}\n已保存的提供方配置、自定义端点和其他个人数据都原样保留。",
        confirm_button: "重置配置",
        success_title: "个人配置已重置",
        success_description: "个人配置和频道个人聚焦已重置为数据库默认值。",
      },
    },
  },
};
