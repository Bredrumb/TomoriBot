export default {
  // The config panel reads several strings from this namespace even though every `/model` leaf but
  // `override remove` is dissolved, so pruning it wholesale breaks the Channels and Models pages.
  model: {
    description: `Quản lý các model AI mặc định của máy chủ này.`,
    providerPicker: {
      no_providers_title: `Không có nhà cung cấp nào được lưu`,
      no_providers_description: `Không có nhà cung cấp đã lưu nào khả dụng cho tính năng này. Hãy thêm một nhà cung cấp bằng \`/providers\` trước.`,
    },
    text: {
      no_models_title: `Không tìm thấy model`,
      no_models_description: `Không thể tải các model AI khả dụng từ cơ sở dữ liệu.`,
      invalid_model_title: `Model không hợp lệ`,
      invalid_model_description: `Tên model đã chọn không hợp lệ hoặc không khả dụng.`,
      success_title: `Đã cập nhật model`,
      scope_set_persona_success: `Model cho **{persona}** đã được đặt thành **{model}**`,
    },
    fallback: {
      custom_provider_label: `Tùy chỉnh`,
      no_models_description: `Không có model nào khả dụng cho nhà cung cấp đã chọn.`,
    },
    override: {
      remove: {
        description: `Xóa các tùy chỉnh model cho kênh và persona.`,
        modal_title: `Xóa tùy chỉnh model`,
        channel_unknown: `Không xác định`,
        channel_checkbox_label: `Tùy chỉnh kênh`,
        channel_checkbox_label_continued: `Tùy chỉnh kênh (tiếp theo)`,
        channel_checkbox_description: `Bỏ chọn bất kỳ tùy chỉnh kênh nào bạn muốn xóa. Chỉnh sửa tại /config > Kênh > Tùy chỉnh.`,
        persona_checkbox_label: `Tùy chỉnh persona`,
        persona_checkbox_label_continued: `Tùy chỉnh persona (tiếp theo)`,
        persona_checkbox_description: `Bỏ chọn bất kỳ tùy chỉnh persona nào bạn muốn xóa. Chỉnh sửa tại /config > Persona > Tùy chỉnh.`,
        mixed_checkbox_label: `Tùy chỉnh kênh & persona`,
        mixed_checkbox_label_continued: `Tùy chỉnh kênh & persona (tiếp theo)`,
        mixed_checkbox_description: `Bỏ chọn bất kỳ tùy chỉnh kênh hoặc persona nào bạn muốn xóa.`,
        none_title: `Không có tùy chỉnh model`,
        none_description: `Máy chủ này chưa cấu hình tùy chỉnh model cho kênh hoặc persona nào.`,
        no_removals_title: `Chưa xóa tùy chỉnh model nào`,
        no_removals_description: `Không có tùy chỉnh nào bị bỏ chọn. Các tùy chỉnh model vẫn giữ nguyên.`,
        success_title: `Đã cập nhật tùy chỉnh model`,
        success_description: `Đã xóa các tùy chỉnh model sau.
{removed_overrides}`,
        page_select_prompt: `Tìm thấy {total} tùy chỉnh model. Chọn một nhóm để xóa:`,
        page_select_prompt_capped: `Tìm thấy {total} tùy chỉnh model. {shown} mục đầu tiên được hiển thị qua 25 nhóm; hãy xóa bớt để xem các mục còn lại.`,
      },
      description: `Quản lý các tùy chỉnh model cho kênh và persona.`,
    },
  },
};
