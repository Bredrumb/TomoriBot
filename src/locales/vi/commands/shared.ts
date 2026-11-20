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
  },
};
