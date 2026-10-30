export default {
  "scheduled-task": {
    description: `Quản lý tác vụ đã lên lịch và lời nhắc.`,
    edit: {
      description: `Chỉnh sửa tác vụ đã lên lịch hoặc lời nhắc.`,
      select_modal_title: `Chỉnh sửa tác vụ đã lên lịch`,
      select_label: `Tác vụ đã lên lịch cần sửa`,
      select_description: `Chọn tác vụ đã lên lịch hoặc lời nhắc cần chỉnh sửa`,
      select_placeholder: `Chọn một tác vụ đã lên lịch...`,
      select_option_description: `[{persona_name}] {reminder_time} ({timezone}) {target_channel} | {reminder_type}{repeat_text}{manager_created_by_text}`,
      select_type_task: `tác vụ`,
      select_type_reminder: `lời nhắc cho {user_nickname}`,
      select_repeat_text: ` | lặp lại mỗi {hours}h`,
      select_repeat_months_text: ` | lặp lại mỗi {months} tháng`,
      select_manager_created_by_text: ` | tạo bởi {creator_name}`,
      no_entries_title: `Không có tác vụ đã lên lịch`,
      no_entries: `Không có tác vụ đã lên lịch hay lời nhắc nào để sửa. Hãy bảo mình nhắc bạn hoặc lên lịch tác vụ.`,
      confirm_title: `Chỉnh sửa tác vụ đã lên lịch này?`,
      confirm_details: `**Nội dung:** {reminder_purpose}
**Lần kích hoạt tiếp theo:** {reminder_time}
**Lặp lại:** {repeat_text}
**Loại:** {reminder_type}
**Người dùng mục tiêu:** {target_user}
**Kênh:** {target_channel}`,
      modal_title: `Chỉnh sửa tác vụ đã lên lịch`,
      purpose_input_label: `Nội dung lời nhắc/tác vụ`,
      purpose_input_description: `Văn bản mình thấy khi mục này được kích hoạt.`,
      purpose_input_placeholder: `Mình nên nhớ hoặc làm gì?`,
      time_input_label: `Thời gian kích hoạt tiếp theo`,
      time_input_description: `Dùng định dạng 24 giờ, ví dụ 14:30 hoặc 1430.`,
      time_input_placeholder: `14:30`,
      interval_input_label: `Khoảng cách lặp lại`,
      interval_input_description: `Số giờ hoặc số tháng giữa các lần chạy. Đặt 0 để tắt lặp lại.`,
      interval_input_placeholder: `0`,
      interval_unit_label: `Đơn vị khoảng thời gian`,
      interval_unit_hours_option: `Giờ`,
      interval_unit_months_option: `Tháng (cùng ngày mỗi tháng)`,
      reminder_checkbox_label: `Là lời nhắc cho bạn`,
      reminder_checkbox_description: `Sẽ nhắc bạn mỗi lần kích hoạt.`,
      type_reminder: `Lời nhắc`,
      type_task: `Tác vụ`,
      target_none: `Không có`,
      invalid_content_title: `Nội dung không hợp lệ`,
      invalid_content_description: `Nội dung tác vụ đã lên lịch không được để trống.`,
      invalid_time_title: `Thời gian kích hoạt không hợp lệ`,
      invalid_time_description: `Nhập thời gian 24 giờ như \`14:30\`, \`1430\`, \`00:00\` hoặc \`2400\`.`,
      invalid_interval_title: `Khoảng thời gian không hợp lệ`,
      invalid_interval_description: `Khoảng thời gian phải là số nguyên. Dùng \`0\` để tắt lặp lại.`,
      no_changes_title: `Không có thay đổi`,
      no_changes_description: `Tác vụ đã lên lịch không thay đổi.`,
      success_title: `Đã cập nhật tác vụ lên lịch`,
      success_details: `**Nội dung:** {reminder_purpose}
**Lần kích hoạt tiếp theo:** {reminder_time}
**Lặp lại:** {repeat_text}
**Loại:** {reminder_type}
**Người dùng mục tiêu:** {target_user}
**Kênh:** {target_channel}`,
    },
    remove: {
      description: `Xóa tác vụ đã lên lịch hoặc lời nhắc.`,
      modal_title: `Xóa tác vụ đã lên lịch`,
      select_label: `Tác vụ đã lên lịch cần xóa`,
      select_description: `Chọn tác vụ đã lên lịch hoặc lời nhắc cần xóa`,
      select_placeholder: `Chọn một tác vụ đã lên lịch...`,
      select_option_description: `[{persona_name}] {reminder_time} ({timezone}) #{target_channel}{repeat_text}{manager_created_by_text}`,
      select_repeat_text: ` | lặp lại mỗi {hours}h`,
      select_repeat_months_text: ` | lặp lại mỗi {months} tháng`,
      select_manager_created_by_text: ` | tạo bởi {creator_name}`,
      no_entries_title: `Không có tác vụ đã lên lịch`,
      no_entries: `Không có tác vụ đã lên lịch hay lời nhắc nào để xóa. Hãy bảo mình nhắc bạn hoặc lên lịch tác vụ.`,
      success_title: `Đã xóa tác vụ lên lịch`,
      success_description: `Đã xóa thành công: "{reminder_purpose}"`,
    },
  },
};
