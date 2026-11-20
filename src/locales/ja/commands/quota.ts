export default {
  quota: {
    description: `生成クォータのリセットを管理します。`,
    reset: {
      description: `画像・テキスト・動画生成のクォータプールをリセットします。`,
      user: {
        description: `ユーザーの日次クォータ使用量をリセットします。`,
        member_description: `日次クォータをリセットするメンバー。`,
        quota_type_description: `リセットするクォータプールの種類を選択してください。`,
        image_option: `画像生成`,
        text_option: `テキスト生成`,
        video_option: `動画生成`,
        success_title: `クォータをリセットしました`,
        success_image_description: `{user}の日次画像生成クォータ使用量をリセットしました。`,
        success_text_description: `{user}の日次テキスト生成トリガークォータ使用量をリセットしました。`,
        success_video_description: `{user}の日次動画生成クォータ使用量をリセットしました。`,
      },
      global: {
        description: `サーバー全体の生成クォータプールをリセットします。`,
        quota_type_description: `リセットするクォータプールの種類を選択してください。`,
        image_option: `画像生成`,
        text_option: `テキスト生成`,
        video_option: `動画生成`,
        success_title: `クォータをリセットしました`,
        success_image_description: `サーバー全体の画像生成クォータプールをリセットしました。`,
        success_text_description: `サーバー全体のテキスト生成トリガークォータプールをリセットしました。`,
        success_video_description: `サーバー全体の動画生成クォータプールをリセットしました。`,
      },
    },
  },
};
