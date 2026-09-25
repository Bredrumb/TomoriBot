export default {
  kill: {
    description: `立即停止当前的流式输出，并清空这个频道里排队的回复。`,
    success_title: `流式输出已停止`,
    success_description: `已停止正在进行的回复流（如果有），并清空了这个频道里排队的回复。`,
    nothing_to_stop_title: `没有可停止的内容`,
    nothing_to_stop_description: `这个频道里没有正在进行的回复流，也没有排队的回复可以清空。`,
    media_generation_billing_footer: `停止时有媒体生成任务正在进行。虽然不会发布，但服务提供商仍可能对其计费。`,
  },
};
