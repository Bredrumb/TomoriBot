export default {
  quota: {
    description: `Quản lý đặt lại hạn ngạch tạo sinh.`,
    reset: {
      description: `Đặt lại nhóm hạn ngạch tạo hình ảnh, văn bản hoặc video.`,
      user: {
        description: `Đặt lại mức sử dụng hạn ngạch hàng ngày của người dùng.`,
        member_description: `Thành viên cần đặt lại hạn ngạch hàng ngày.`,
        quota_type_description: `Chọn loại nhóm hạn ngạch cần đặt lại.`,
        image_option: `Tạo hình ảnh`,
        text_option: `Tạo văn bản`,
        video_option: `Tạo video`,
        success_title: `Đã đặt lại hạn ngạch`,
        success_image_description: `Đã đặt lại mức sử dụng hạn ngạch tạo hình ảnh hàng ngày cho {user}.`,
        success_text_description: `Đã đặt lại mức sử dụng hạn ngạch kích hoạt tạo văn bản hàng ngày cho {user}.`,
        success_video_description: `Đã đặt lại mức sử dụng hạn ngạch tạo video hàng ngày cho {user}.`,
      },
      global: {
        description: `Đặt lại nhóm hạn ngạch tạo sinh trên toàn máy chủ.`,
        quota_type_description: `Chọn loại nhóm hạn ngạch cần đặt lại.`,
        image_option: `Tạo hình ảnh`,
        text_option: `Tạo văn bản`,
        video_option: `Tạo video`,
        success_title: `Đã đặt lại hạn ngạch`,
        success_image_description: `Đã đặt lại nhóm hạn ngạch tạo hình ảnh trên toàn máy chủ.`,
        success_text_description: `Đã đặt lại nhóm hạn ngạch kích hoạt tạo văn bản trên toàn máy chủ.`,
        success_video_description: `Đã đặt lại nhóm hạn ngạch tạo video trên toàn máy chủ.`,
      },
    },
  },
};
