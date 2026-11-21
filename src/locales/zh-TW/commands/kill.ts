export default {
  kill: {
    description: `立刻停止目前的串流，並清除這個頻道中排隊的回覆。`,
    success_title: `串流已停止`,
    success_description: `已停止使用中的回覆串流（如果有的話），並清除這個頻道中排隊的回覆。`,
    nothing_to_stop_title: `沒有可停止的內容`,
    nothing_to_stop_description: `這個頻道沒有使用中的回覆串流，也沒有排隊的回覆可以清除。`,
    media_generation_billing_footer: `停止時有媒體生成工作正在進行。雖然不會發布，但服務供應商仍可能對其收費。`,
  },
};
