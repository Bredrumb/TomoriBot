export default {
  respond: {
    description: `Kích hoạt phản hồi thủ công cho tin nhắn mới nhất trong kênh này.`,
    prompt_description: `System prompt tùy chọn để nối vào cuối ngữ cảnh.`,
    prefill_description: `Prefill trợ lý tùy chọn mà bạn muốn mình tiếp tục.`,
    prefill_instruction_notice: `Model này không thể tiếp tục prefill, vì vậy mình đã chuyển nó thành một hướng dẫn thay thế.`,
    success_title: `Đã kích hoạt phản hồi thủ công`,
    success_description: `Đang phản hồi tin nhắn mới nhất trong kênh này bằng persona gần nhất...`,
    no_smart_model_title: `Không tìm thấy model suy luận`,
    no_smart_model_description: `Không tìm thấy model suy luận nào cho nhà cung cấp AI hiện tại. Dùng \`/config\` > Model > Đổi model để chuyển sang nhà cung cấp hỗ trợ model suy luận.`,
    no_messages_title: `Không tìm thấy tin nhắn`,
    no_messages_description: `Không tìm thấy tin nhắn nào trong kênh này. Hãy gửi ít nhất một tin nhắn trước khi dùng \`/respond\`.`,
    cooldown_active: `Quản lý máy chủ đã thiết lập cooldown. Vui lòng chờ **{seconds}** giây trước khi dùng lại \`/respond\`. Cooldown này dùng chung với trigger tin nhắn.`,
    channel_not_whitelisted: `Máy chủ này đang bật giới hạn whitelist. \`/respond\` chỉ có thể được dùng trong kênh whitelist bởi thành viên có vai trò whitelist, và chỉ với persona được phép trong kênh này.`,
    persona_access_blocked: `Quyền whitelist và cài đặt spotlight cá nhân hiện tại không để lại persona nào khả dụng cho \`/respond\` trong kênh này.`,
  },
};
