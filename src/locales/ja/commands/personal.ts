export default {
  personal: {
    description: `あなたの個人的な設定を管理します`,
    nuke: {
      description: `TomoriBotが保存しているあなたの情報を、すべてのサーバーから消去します。`,
      confirmation_description: `個人データを完全に消去することを確認してください。取り消せません。`,
      confirmation_choice_yes: `はい、消去します`,
      confirmation_choice_no: `いいえ、中止します`,
      cancelled_title: `消去を中止しました`,
      cancelled_description: `何も変更されていません。データはそのままです。`,
      no_data_title: `消去するものがありません`,
      no_data_description: `TomoriBotにあなたの記録は保存されていません。`,
      success_title: `個人データを消去しました`,
      success_description: `すべてのサーバーで消去しました：個人メモリー、パーソナライズ設定と呼び名の設定、スポットライト、保存済みのプロバイダーキー、個人用エンドポイントと登録モデル、利用統計、およびあなたが作成した、またはあなた宛てのリマインダー**{reminders_deleted}**件。

\`/reward\`と\`/punish\`で与えた人格の条件付けも削除されたため、該当サーバーの人格の振る舞いが全員にとって変わる場合があります。

あなたが教えたサーバーメモリーとアップロードした資料はサーバーに属するため、作成者情報だけを外して保持されます。あなたに関する記述は\`/memories\`から削除してください。設定したオプトアウトはそのまま残ります。

次のメッセージから、TomoriBotはあなたを新規ユーザーとして扱います。`,
    },
    custom_models: {
      remove: {
        checkbox_description: `登録を残すエンドポイントはチェックしたままにし、削除したいエンドポイントだけチェックを外してください。`,
        checkbox_text_label: `登録済みテキストエンドポイント`,
        checkbox_text_label_continued: `登録済みテキストエンドポイント（続き）`,
        checkbox_embedding_label: `登録済み埋め込みエンドポイント`,
        checkbox_embedding_label_continued: `登録済み埋め込みエンドポイント（続き）`,
        checkbox_image_label: `登録済み画像エンドポイント`,
        checkbox_image_label_continued: `登録済み画像エンドポイント（続き）`,
        checkbox_video_label: `登録済み動画エンドポイント`,
        checkbox_video_label_continued: `登録済み動画エンドポイント（続き）`,
        checkbox_speech_label: `登録済み音声エンドポイント`,
        checkbox_speech_label_continued: `登録済み音声エンドポイント（続き）`,
        checkbox_transcription_label: `登録済み文字起こしエンドポイント`,
        checkbox_transcription_label_continued: `登録済み文字起こしエンドポイント（続き）`,
      },
    },
    provider: {
      capability_text: `テキスト`,
      capability_embedding: `埋め込み`,
      capability_image: `画像`,
      capability_video: `動画`,
      capability_vision: `ビジョン`,
    },
    config: {
      character_reference_uploaded: `アップロードして保存済み`,
      description: `個人設定データを管理します。`,
    },
    privacy: {
      choice_minimal: `なし`,
      choice_partial: `部分的`,
      choice_full: `完全`,
    },
    profile: {
      about: {
        style_label: `希望する呼び方`,
        style_description: `ペルソナの呼称バリエーションを選択します。他の項目から推測しません。`,
        style_masculine: `男性的`,
        style_feminine: `女性的`,
        style_neutral: `中立`,
      },
    },
    deliberatetriggermode: {
      description: `個人の明示的トリガーモード（DTM）設定を変更します。`,
      mode_description: `DTMを個人的にどのように適用するか選択します。`,
      off_option: `オフ`,
      follow_option: `サーバーに従う`,
      on_option: `オン`,
      off_title: `個人明示的トリガーモード：オフ`,
      off_description: `サーバー設定に関わらず、あなたのDTMは**無効**です。あなたのメッセージでは通常のトリガーワードが常に機能します。`,
      follow_title: `個人明示的トリガーモード：サーバーに従う`,
      follow_description: `DTMの動作が**サーバー設定に従う**ようになりました。`,
      on_title: `個人明示的トリガーモード：オン`,
      on_description: `サーバー設定に関わらず、DTMが**常に有効**です。\`@trigger\`、メンション、リプライ、または\`/respond\`でBotを呼び出してください。`,
    },
    deliberatetoolmode: {
      description: `個人の明示的ツールモード設定を変更します。`,
      mode_description: `明示的ツールモードを個人的にどのように適用するか選択します。`,
      off_option: `オフ`,
      follow_option: `サーバーに従う`,
      on_option: `オン`,
      off_title: `個人明示的ツールモード：オフ`,
      off_description: `サーバー設定に関わらず、あなたの明示的ツールモードは**無効**です。対応モデルではツールが通常どおり利用可能です。`,
      follow_title: `個人明示的ツールモード：サーバーに従う`,
      follow_description: `明示的ツールモードの動作が**サーバー設定に従う**ようになりました。`,
      on_title: `個人明示的ツールモード：オン`,
      on_description: `サーバー設定に関わらず、明示的ツールモードが**常に有効**です。ツールが必要だと明示されたメッセージ以外ではツールを省略します。`,
    },
    "deliberate-tool-mode": {
      description: `個人の明示的ツールモード設定を変更します。`,
    },
  },
};
