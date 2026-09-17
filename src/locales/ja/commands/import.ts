export default {
  import: {
    description: `設定または記憶をファイルからインポートします。`,
    config: {
      description: `サーバー設定ファイルをインポートします。`,
      file_description: `TomoriBotがエクスポートした設定ファイル。`,
    },
    memories: {
      description: `サーバーの記憶ファイルをインポートします。`,
      file_description: `TomoriBotがエクスポートした記憶ファイル。`,
    },
    personal: {
      description: `自分のアカウントが所有する設定または記憶をインポートします。`,
      config: {
        description: `個人設定ファイルをインポートします。`,
        file_description: `TomoriBotがエクスポートした個人設定ファイル。`,
      },
      memories: {
        description: `個人の記憶ファイルをインポートします。`,
        file_description: `TomoriBotがエクスポートした個人記憶ファイル。`,
      },
    },
  },
};
