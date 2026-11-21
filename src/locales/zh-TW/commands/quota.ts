export default {
  quota: {
    description: `管理生成額度的重置。`,
    reset: {
      description: `重置圖片、文字或影片生成的額度池。`,
      user: {
        description: `重置某位使用者的每日額度用量。`,
        member_description: `要重置每日額度的成員。`,
        quota_type_description: `選擇要重置的額度池類型。`,
        image_option: `圖片生成`,
        text_option: `文字生成`,
        video_option: `影片生成`,
        success_title: `額度已重置`,
        success_image_description: `已重置 {user} 的每日圖片生成額度用量。`,
        success_text_description: `已重置 {user} 的每日文字生成觸發額度用量。`,
        success_video_description: `已重置 {user} 的每日影片生成額度用量。`,
      },
      global: {
        description: `重置整個伺服器的生成額度池。`,
        quota_type_description: `選擇要重置的額度池類型。`,
        image_option: `圖片生成`,
        text_option: `文字生成`,
        video_option: `影片生成`,
        success_title: `額度已重置`,
        success_image_description: `已重置整個伺服器的圖片生成額度池。`,
        success_text_description: `已重置整個伺服器的文字生成觸發額度池。`,
        success_video_description: `已重置整個伺服器的影片生成額度池。`,
      },
    },
  },
};
