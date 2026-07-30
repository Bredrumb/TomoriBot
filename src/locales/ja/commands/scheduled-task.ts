export default {
  "scheduled-task": {
    description: `スケジュール済みタスクとリマインダーを管理します。`,
    edit: {
      description: `スケジュール済みタスクまたはリマインダーを編集します。`,
      select_modal_title: `スケジュール済みタスクの編集`,
      select_label: `編集するスケジュール済みタスク`,
      select_description: `編集するスケジュール済みタスクまたはリマインダーを選択してください`,
      select_placeholder: `スケジュール済みタスクを選択...`,
      select_option_description: `[{persona_name}] {reminder_time} ({timezone}) {target_channel} | {reminder_type}{repeat_text}{manager_created_by_text}`,
      select_type_task: `タスク`,
      select_type_reminder: `{user_nickname}さんへのリマインダー`,
      select_repeat_text: ` | {hours}時間ごとに繰り返し`,
      select_manager_created_by_text: ` | 作成者: {creator_name}`,
      no_entries_title: `スケジュール済みタスクがありません`,
      no_entries: `編集するスケジュール済みタスクやリマインダーがありません。リマインドしてほしい内容を私に伝えるか、タスクを予定してください。`,
      confirm_title: `このスケジュール済みタスクを編集しますか？`,
      confirm_description: `**内容:** {reminder_purpose}
**次回実行:** {reminder_time}
**間隔（時間）:** {repetition_interval_hours}
**種類:** {reminder_type}
**対象ユーザー:** {target_user}
**チャンネル:** {target_channel}`,
      modal_title: `スケジュール済みタスクの編集`,
      purpose_input_label: `リマインダー/タスク内容`,
      purpose_input_description: `実行時にボットが見るテキストです。`,
      purpose_input_placeholder: `何を覚える、または実行しますか？`,
      time_input_label: `次回実行時刻`,
      time_input_description: `14:30 または 1430 のような24時間表記を使います。`,
      time_input_placeholder: `14:30`,
      interval_input_label: `間隔（時間）`,
      interval_input_description: `繰り返しを無効にするには0を設定します。`,
      interval_input_placeholder: `0`,
      reminder_checkbox_label: `自分宛てのリマインダーにする`,
      reminder_checkbox_description: `実行されるたびにあなたをメンションします。`,
      type_reminder: `リマインダー`,
      type_task: `タスク`,
      target_none: `なし`,
      invalid_content_title: `内容が無効です`,
      invalid_content_description: `スケジュール済みタスクの内容は空にできません。`,
      invalid_time_title: `実行時刻が無効です`,
      invalid_time_description: `\`14:30\`、\`1430\`、\`00:00\`、\`2400\` のような24時間表記を入力してください。`,
      invalid_interval_title: `間隔が無効です`,
      invalid_interval_description: `間隔は時間単位の整数である必要があります。繰り返しを無効にするには \`0\` を使ってください。`,
      no_changes_title: `変更はありません`,
      no_changes_description: `スケジュール済みタスクは変更されませんでした。`,
      success_title: `スケジュール済みタスクを更新しました`,
      success_description: `**内容:** {reminder_purpose}
**次回実行:** {reminder_time}
**間隔（時間）:** {repetition_interval_hours}
**種類:** {reminder_type}
**対象ユーザー:** {target_user}
**チャンネル:** {target_channel}`,
    },
    remove: {
      description: `スケジュール済みタスクまたはリマインダーを削除します。`,
      modal_title: `スケジュール済みタスクの削除`,
      select_label: `削除するスケジュール済みタスク`,
      select_description: `削除するスケジュール済みタスクまたはリマインダーを選択してください`,
      select_placeholder: `スケジュール済みタスクを選択...`,
      select_option_description: `[{persona_name}] {reminder_time} ({timezone}) #{target_channel}{repeat_text}{manager_created_by_text}`,
      select_repeat_text: ` | {hours}時間ごとに繰り返し`,
      select_manager_created_by_text: ` | 作成者: {creator_name}`,
      no_entries_title: `スケジュール済みタスクがありません`,
      no_entries: `削除するスケジュール済みタスクやリマインダーがありません。リマインドしてほしい内容を私に伝えるか、タスクを予定してください。`,
      success_title: `スケジュール済みタスクが削除されました`,
      success_description: `正常に削除しました: "{reminder_purpose}"`,
    },
  },
};
