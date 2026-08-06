export default {
  "scheduled-task": {
    description: `Manage scheduled tasks and reminders.`,
    edit: {
      description: `Edit a scheduled task or reminder.`,
      select_modal_title: `Edit Scheduled Task`,
      select_label: `Scheduled Task to Edit`,
      select_description: `Choose which scheduled task or reminder to edit`,
      select_placeholder: `Select a scheduled task...`,
      select_option_description: `[{persona_name}] {reminder_time} ({timezone}) {target_channel} | {reminder_type}{repeat_text}{manager_created_by_text}`,
      select_type_task: `task`,
      select_type_reminder: `reminder for {user_nickname}`,
      select_repeat_text: ` | repeats every {hours}h`,
      select_manager_created_by_text: ` | created by {creator_name}`,
      no_entries_title: `No Scheduled Tasks`,
      no_entries: `There are no scheduled tasks or reminders to edit. Set one by asking me to remind you or schedule a task.`,
      confirm_title: `Edit This Scheduled Task?`,
      confirm_description: `**Content:** {reminder_purpose}
**Next Trigger:** {reminder_time}
**Interval Hours:** {repetition_interval_hours}
**Type:** {reminder_type}
**Target User:** {target_user}
**Channel:** {target_channel}`,
      modal_title: `Edit Scheduled Task`,
      purpose_input_label: `Reminder/Task Content`,
      purpose_input_description: `The text the bot sees when this triggers.`,
      purpose_input_placeholder: `What should I remember or do?`,
      time_input_label: `Next Trigger Time`,
      time_input_description: `Use 24-hour time, such as 14:30 or 1430.`,
      time_input_placeholder: `14:30`,
      interval_input_label: `Interval in Hours`,
      interval_input_description: `Set 0 to disable recurrence.`,
      interval_input_placeholder: `0`,
      reminder_checkbox_label: `Is a reminder for me`,
      reminder_checkbox_description: `Will ping you every trigger.`,
      type_reminder: `Reminder`,
      type_task: `Task`,
      target_none: `None`,
      invalid_content_title: `Invalid Content`,
      invalid_content_description: `The scheduled task content cannot be empty.`,
      invalid_time_title: `Invalid Trigger Time`,
      invalid_time_description: `Enter a 24-hour time like \`14:30\`, \`1430\`, \`00:00\`, or \`2400\`.`,
      invalid_interval_title: `Invalid Interval`,
      invalid_interval_description: `Interval must be a whole number of hours. Use \`0\` to disable recurrence.`,
      no_changes_title: `No Changes`,
      no_changes_description: `The scheduled task was not changed.`,
      success_title: `Scheduled Task Updated`,
      success_description: `**Content:** {reminder_purpose}
**Next Trigger:** {reminder_time}
**Interval Hours:** {repetition_interval_hours}
**Type:** {reminder_type}
**Target User:** {target_user}
**Channel:** {target_channel}`,
    },
    remove: {
      description: `Remove a scheduled task or reminder.`,
      modal_title: `Remove Scheduled Task`,
      select_label: `Scheduled Task to Remove`,
      select_description: `Choose which scheduled task or reminder to remove`,
      select_placeholder: `Select a scheduled task...`,
      select_option_description: `[{persona_name}] {reminder_time} ({timezone}) #{target_channel}{repeat_text}{manager_created_by_text}`,
      select_repeat_text: ` | repeats every {hours}h`,
      select_manager_created_by_text: ` | created by {creator_name}`,
      no_entries_title: `No Scheduled Tasks`,
      no_entries: `There are no scheduled tasks or reminders to remove. Set one by asking me to remind you or schedule a task.`,
      success_title: `Scheduled Task Removed`,
      success_description: `Successfully removed: "{reminder_purpose}"`,
    },
  },
};
