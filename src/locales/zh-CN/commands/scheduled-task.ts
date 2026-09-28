export default {
  "scheduled-task": {
    description: `管理定时任务和提醒。`,
    edit: {
      description: `编辑定时任务或提醒。`,
      select_modal_title: `编辑定时任务`,
      select_label: `要编辑的定时任务`,
      select_description: `选择要编辑哪个定时任务或提醒`,
      select_placeholder: `选择一个定时任务……`,
      select_option_description: `[{persona_name}] {reminder_time}（{timezone}）{target_channel} | {reminder_type}{repeat_text}{manager_created_by_text}`,
      select_type_task: `任务`,
      select_type_reminder: `给 {user_nickname} 的提醒`,
      select_repeat_text: ` | 每 {hours} 小时重复`,
      select_manager_created_by_text: ` | 由 {creator_name} 创建`,
      no_entries_title: `没有定时任务`,
      no_entries: `目前没有可以编辑的定时任务或提醒。直接让我提醒你，或者让我安排一个任务，就能建好。`,
      confirm_title: `要编辑这个定时任务吗？`,
      confirm_description: `**内容：** {reminder_purpose}
**下次触发：** {reminder_time}
**间隔小时数：** {repetition_interval_hours}
**类型：** {reminder_type}
**目标用户：** {target_user}
**频道：** {target_channel}`,
      modal_title: `编辑定时任务`,
      purpose_input_label: `提醒／任务内容`,
      purpose_input_description: `触发时 bot 看到的文字。`,
      purpose_input_placeholder: `我应该记住或做什么？`,
      time_input_label: `下次触发时间`,
      time_input_description: `使用 24 小时制，例如 14:30 或 1430。`,
      time_input_placeholder: `14:30`,
      interval_input_label: `间隔小时数`,
      interval_input_description: `填 0 表示不重复。`,
      interval_input_placeholder: `0`,
      reminder_checkbox_label: `这是给我的提醒`,
      reminder_checkbox_description: `每次触发都会提醒你。`,
      type_reminder: `提醒`,
      type_task: `任务`,
      target_none: `无`,
      invalid_content_title: `内容无效`,
      invalid_content_description: `定时任务的内容不能为空。`,
      invalid_time_title: `触发时间无效`,
      invalid_time_description: `请输入 24 小时制时间，例如 \`14:30\`、\`1430\`、\`00:00\` 或 \`2400\`。`,
      invalid_interval_title: `间隔无效`,
      invalid_interval_description: `间隔必须是整数小时。填 \`0\` 表示不重复。`,
      no_changes_title: `没有更改`,
      no_changes_description: `定时任务没有更改。`,
      success_title: `定时任务已更新`,
      success_description: `**内容：** {reminder_purpose}
**下次触发：** {reminder_time}
**间隔小时数：** {repetition_interval_hours}
**类型：** {reminder_type}
**目标用户：** {target_user}
**频道：** {target_channel}`,
    },
    remove: {
      description: `移除定时任务或提醒。`,
      modal_title: `移除定时任务`,
      select_label: `要移除的定时任务`,
      select_description: `选择要移除哪个定时任务或提醒`,
      select_placeholder: `选择一个定时任务……`,
      select_option_description: `[{persona_name}] {reminder_time}（{timezone}）#{target_channel}{repeat_text}{manager_created_by_text}`,
      select_repeat_text: ` | 每 {hours} 小时重复`,
      select_manager_created_by_text: ` | 由 {creator_name} 创建`,
      no_entries_title: `没有定时任务`,
      no_entries: `目前没有可以移除的定时任务或提醒。直接让我提醒你，或者让我安排一个任务，就能建好。`,
      success_title: `定时任务已移除`,
      success_description: `已成功移除：「{reminder_purpose}」`,
    },
  },
};
