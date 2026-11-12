export default {
  respond: {
    description: `手动触发对当前频道最新消息的回复。`,
    prompt_description: `可选，追加在上下文末尾的系统提示词。`,
    prefill_description: `可选，你想让我接着续写的助手预填内容。`,
    prefill_instruction_notice: `这个模型无法接着预填内容续写，因此我改将其作为指令传入。`,
    success_title: `已手动触发回复`,
    success_description: `正在以最后一个人格的身份回复这个频道的最新消息……`,
    no_smart_model_title: `没有找到推理模型`,
    no_smart_model_description: `你当前的 AI 提供方没有推理模型。请用 \`/config\` > 模型 > 切换模型 换成支持推理模型的提供方。`,
    no_messages_title: `没有找到消息`,
    no_messages_description: `这个频道里没有找到消息。使用 \`/respond\` 之前，请先发至少一条消息。`,
    cooldown_active: `这个服务器的管理员设置了冷却。请等 **{seconds}** 秒再使用 \`/respond\`。这个冷却与消息触发共用。`,
    channel_not_whitelisted: `这个服务器开启了白名单限制。\`/respond\` 只能在白名单频道里由拥有白名单身份组的成员使用，而且只能使用这个频道允许的人格。`,
    persona_access_blocked: `按你当前的白名单权限和个人聚焦设置，这个频道里没有可用于 \`/respond\` 的人格。`,
  },
};
