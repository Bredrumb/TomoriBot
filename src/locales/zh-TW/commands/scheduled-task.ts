export default {
  "scheduled-task": {
    description: `管理排程任務與提醒。`,
    edit: {
      description: `編輯排程任務或提醒。`,
      select_modal_title: `編輯排程任務`,
      select_label: `要編輯的排程任務`,
      select_description: `選擇要編輯的排程任務或提醒`,
      select_placeholder: `選擇一個排程任務...`,
      select_option_description: `[{persona_name}] {reminder_time} ({timezone}) {target_channel} | {reminder_type}{repeat_text}{manager_created_by_text}`,
      select_type_task: `任務`,
      select_type_reminder: `{user_nickname} 的提醒`,
      select_repeat_text: ` | 每 {hours} 小時重複一次`,
      select_manager_created_by_text: ` | 由 {creator_name} 建立`,
      no_entries_title: `沒有排程任務`,
      no_entries: `沒有可以編輯的排程任務或提醒。請叫我提醒你，或請我排一項任務來建立。`,
      confirm_title: `要編輯這項排程任務嗎？`,
      confirm_description: `**內容：** {reminder_purpose}
**下次觸發：** {reminder_time}
**間隔時數：** {repetition_interval_hours}
**類型：** {reminder_type}
**目標使用者：** {target_user}
**頻道：** {target_channel}`,
      modal_title: `編輯排程任務`,
      purpose_input_label: `提醒／任務內容`,
      purpose_input_description: `觸發時 bot 會看到的文字。`,
      purpose_input_placeholder: `我該記得或做什麼？`,
      time_input_label: `下次觸發時間`,
      time_input_description: `請使用 24 小時制，例如 14:30 或 1430。`,
      time_input_placeholder: `14:30`,
      interval_input_label: `間隔時數`,
      interval_input_description: `設為 0 即可停用重複。`,
      interval_input_placeholder: `0`,
      reminder_checkbox_label: `這是給我的提醒`,
      reminder_checkbox_description: `每次觸發都會標註你。`,
      type_reminder: `提醒`,
      type_task: `任務`,
      target_none: `無`,
      invalid_content_title: `內容無效`,
      invalid_content_description: `排程任務的內容不能留空。`,
      invalid_time_title: `觸發時間無效`,
      invalid_time_description: `請輸入 24 小時制時間，例如 \`14:30\`、\`1430\`、\`00:00\` 或 \`2400\`。`,
      invalid_interval_title: `間隔無效`,
      invalid_interval_description: `間隔必須是整數小時。設為 \`0\` 即可停用重複。`,
      no_changes_title: `沒有變更`,
      no_changes_description: `排程任務沒有變更。`,
      success_title: `排程任務已更新`,
      success_description: `**內容：** {reminder_purpose}
**下次觸發：** {reminder_time}
**間隔時數：** {repetition_interval_hours}
**類型：** {reminder_type}
**目標使用者：** {target_user}
**頻道：** {target_channel}`,
    },
    remove: {
      description: `移除排程任務或提醒。`,
      modal_title: `移除排程任務`,
      select_label: `要移除的排程任務`,
      select_description: `選擇要移除的排程任務或提醒`,
      select_placeholder: `選擇一個排程任務...`,
      select_option_description: `[{persona_name}] {reminder_time} ({timezone}) #{target_channel}{repeat_text}{manager_created_by_text}`,
      select_repeat_text: ` | 每 {hours} 小時重複一次`,
      select_manager_created_by_text: ` | 由 {creator_name} 建立`,
      no_entries_title: `沒有排程任務`,
      no_entries: `沒有可以移除的排程任務或提醒。請叫我提醒你，或請我排一項任務來建立。`,
      success_title: `排程任務已移除`,
      success_description: `已成功移除：「{reminder_purpose}」`,
    },
  },
};
