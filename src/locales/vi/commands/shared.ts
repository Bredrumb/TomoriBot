export default {
  shared: {
    character_reference: {
      invalid_image_title: `Hình ảnh không hợp lệ`,
      invalid_image_description: `Vui lòng tải lên một tệp hình ảnh đính kèm cho ảnh tham chiếu nhân vật.`,
      download_failed_title: `Tải xuống thất bại`,
      download_failed_description: `Không thể tải xuống tệp hình ảnh đính kèm đã chọn. Vui lòng thử lại.`,
      conversion_failed_title: `Chuyển đổi hình ảnh thất bại`,
      conversion_failed_description: `Mình không thể chuyển đổi hình ảnh đó sang định dạng PNG để lưu trữ. Vui lòng thử một hình ảnh khác.`,
      success_title: `Đã cập nhật ảnh tham chiếu nhân vật`,
      success_me_description: `Đã cập nhật hình ảnh tham chiếu nhân vật của bạn.`,
      success_persona_description: `Đã cập nhật hình ảnh tham chiếu nhân vật cho **{persona_name}**.`,
      cleared_title: `Đã xóa ảnh tham chiếu nhân vật`,
      cleared_me_description: `Đã xóa hình ảnh tham chiếu nhân vật của bạn.`,
      cleared_persona_description: `Đã xóa hình ảnh tham chiếu nhân vật của **{persona_name}**.`,
    },
    rag: {
      disabled_title: `Đã tắt RAG tài liệu`,
      disabled_description: `Tính năng truy xuất tài liệu yêu cầu extension PostgreSQL [pgvector](https://github.com/pgvector/pgvector) trong cơ sở dữ liệu của bạn. Cài đặt pgvector và khởi động lại mình để bật (xem [hướng dẫn thiết lập self-hosting](https://docs.tomoribot.app/vi/self-hosting/manual-setup/)).`,
    },
    persona_select: {
      main_persona_description: `Persona chính`,
      alter_persona_description: `Persona alter`,
    },
    send_blocked: {
      cannot_send_title: `Mình không thể gửi tin nhắn ở đây`,
      cannot_send_description: `Mình cần quyền **Xem kênh** và **Gửi tin nhắn** trong kênh này (hoặc **Gửi tin nhắn trong chủ đề** nếu ở trong chủ đề) để trả lời ở đây, nhưng hiện đang thiếu ít nhất một quyền. Hãy nhờ người quản lý máy chủ cấp cả hai quyền.`,
      missing_permissions_description: `Mình không thể đọc quyền của mình trong kênh này, nên mình không trả lời ở đây. Hãy thử lại sau giây lát, và nếu tình trạng này vẫn tiếp diễn, hãy kiểm tra quyền vai trò của mình.`,
      timed_out_title: `Mình đang bị hạn chế`,
      timed_out_description: `Một điều hành viên đã hạn chế mình trong máy chủ này, nên Discord chặn tin nhắn của mình cho đến {time}. Hãy xóa hạn chế khỏi hồ sơ thành viên của mình nếu bạn muốn mình trả lời sớm hơn.`,
      send_refused_title: `Discord đã từ chối tin nhắn gần nhất của mình`,
      send_refused_description: `Discord đã từ chối tin nhắn gần nhất của mình trong kênh này, thường do quyền hạn thay đổi hoặc mình bị hạn chế. Mình sẽ thử lại ở kênh này {time}.`,
    },
  },
};
