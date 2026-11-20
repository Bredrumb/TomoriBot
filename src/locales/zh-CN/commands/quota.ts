export default {
  quota: {
    description: `管理生成配额的重置。`,
    reset: {
      description: `重置图像、文本或视频生成的配额池。`,
      user: {
        description: `重置某个用户的每日配额用量。`,
        member_description: `要重置每日配额的成员。`,
        quota_type_description: `选择要重置哪种配额池。`,
        image_option: `图像生成`,
        text_option: `文本生成`,
        video_option: `视频生成`,
        success_title: `配额已重置`,
        success_image_description: `已重置 {user} 的每日图像生成配额用量。`,
        success_text_description: `已重置 {user} 的每日文本生成触发配额用量。`,
        success_video_description: `已重置 {user} 的每日视频生成配额用量。`,
      },
      global: {
        description: `重置全服务器共用的生成配额池。`,
        quota_type_description: `选择要重置哪种配额池。`,
        image_option: `图像生成`,
        text_option: `文本生成`,
        video_option: `视频生成`,
        success_title: `配额已重置`,
        success_image_description: `已重置全服务器的图像生成配额池。`,
        success_text_description: `已重置全服务器的文本生成触发配额池。`,
        success_video_description: `已重置全服务器的视频生成配额池。`,
      },
    },
  },
};
