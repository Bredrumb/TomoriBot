export default {
  nuke: {
    description: `Xóa sạch toàn bộ dữ liệu máy chủ. Yêu cầu chạy lại /setup sau đó.`,
    confirmation_description: `Xác nhận bạn muốn xóa vĩnh viễn dữ liệu máy chủ này. Không thể hoàn tác.`,
    confirmation_choice_yes: `Có, xóa sạch`,
    confirmation_choice_no: `Không, hủy bỏ`,
    preserve_personas_description: `Giữ nguyên persona và thuộc tính/cấu hình/bộ nhớ (bỏ qua xóa cây persona).`,
    cancelled_title: `Đã hủy xóa sạch`,
    cancelled_description: `Không có dữ liệu nào bị thay đổi. Dữ liệu máy chủ được giữ nguyên.`,
    success_full_title: `Đã xóa sạch máy chủ`,
    success_full_description: `Toàn bộ dữ liệu máy chủ đã bị xóa, bao gồm cả persona. Webhook phía Discord đã xóa: **{webhooks_deleted}** (thất bại: **{webhooks_failed}**). Chạy \`/setup\` để bắt đầu lại.`,
    success_preserved_title: `Đã xóa sạch máy chủ (Giữ lại persona)`,
    success_preserved_description: `Cài đặt máy chủ, whitelist, hạn ngạch, trigger và tích hợp đã bị xóa. Persona cùng thuộc tính/bộ nhớ được giữ lại. Webhook phía Discord đã xóa: **{webhooks_deleted}** (thất bại: **{webhooks_failed}**). Chạy \`/setup\` để cấu hình lại cài đặt cấp máy chủ.`,
  },
};
