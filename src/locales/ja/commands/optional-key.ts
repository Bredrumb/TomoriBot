// locales/ja/commands/optional-key.ts

export default {
  "optional-key": {
    description: `オプションのサービスAPIキーを管理`,
    brave: {
      description: `Brave Search APIキーを管理`,
      set: {
        description: `このサーバーのBrave Search APIキーを設定します。`,
        key_description: `あなたのBrave Search APIキー。`,
        invalid_key_title: `無効なAPIキー形式`,
        invalid_key_description: `提供されたAPIキーは短すぎるか無効のようです。有効なキーを提供してください。`,
        key_validation_failed_title: `Brave APIキーの検証に失敗しました`,
        key_validation_failed_description: `提供されたBrave Search APIキーは無効です。キーを確認してもう一度お試しください。`,
        success_title: `Brave APIキーが設定されました`,
        success_description: `Brave Search APIキーが正常に検証、暗号化、保存されました。

⚠️ **重要：** Braveでは毎月5ドル分の無料クレジットが提供され、それを超えると課金されます。予期しない課金を防ぐため、[Braveの使用量上限ダッシュボード](https://api-dashboard.search.brave.com/app/subscriptions/usage-limits)で使用量上限を5ドルに設定してください。`,
      },
      remove: {
        description: `現在設定されているBrave Search APIキーを削除します。`,
        no_key_title: `Brave APIキーが設定されていません`,
        no_key_description: `現在削除するBrave Search APIキーが設定されていません。`,
        success_title: `Brave APIキーが削除されました`,
        success_description: `Brave Search APIキーが正常に削除されました。`,
      },
    },
    google: {
      description: `補助Google APIキーを管理（画像インペインティング用）`,
      set: {
        description: `画像セグメンテーション用Google APIキー。Googleがメインプロバイダーの場合は不要。`,
        key_description: `あなたのGoogle APIキー。`,
        invalid_key_title: `無効なAPIキー形式`,
        invalid_key_description: `提供されたAPIキーは短すぎるか無効のようです。有効なGoogle APIキーを提供してください。`,
        key_validation_failed_title: `Google APIキーの検証に失敗しました`,
        key_validation_failed_description: `提供されたGoogle APIキーは無効です。キーを確認してもう一度お試しください。`,
        success_title: `Google APIキーが設定されました`,
        success_description: `Google APIキーが正常に検証、暗号化、保存されました。AIの画像セグメンテーション（インペインティング）に使用されます。メインプロバイダーがすでにGoogleの場合、このキーがセグメンテーションで優先されます。`,
      },
      remove: {
        description: `現在設定されているGoogle APIキーを削除します。`,
        no_key_title: `Google APIキーが設定されていません`,
        no_key_description: `現在削除するGoogle APIキーが設定されていません。`,
        success_title: `Google APIキーが削除されました`,
        success_description: `Google APIキーが正常に削除されました。`,
      },
    },
    novelai: {
      description: `補助NovelAI APIキーを管理（画像生成用）`,
      set: {
        description: `画像生成用NovelAI APIキー。NovelAIがメインプロバイダーの場合は不要。`,
        key_description: `あなたのNovelAI APIキー。`,
        disable_other_imggen_description: `trueの場合、標準の画像生成ツールを非表示にし、NovelAI画像生成のみを利用可能にします。`,
        invalid_key_title: `無効なAPIキー形式`,
        invalid_key_description: `提供されたAPIキーは短すぎるか無効のようです。有効なNovelAI APIキーを提供してください。`,
        key_validation_failed_title: `NovelAI APIキーの検証に失敗しました`,
        key_validation_failed_description: `提供されたNovelAI APIキーは無効です。キーを確認し、有効なサブスクリプションがあることを確認してください。`,
        success_title: `NovelAI APIキーが設定されました`,
        success_description: `NovelAI APIキーが正常に検証、暗号化、保存されました。アクティブなLLMプロバイダーに関係なく、NovelAI画像生成が利用可能になりました。`,
        success_exclusive_description: `NovelAI APIキーが正常に検証、暗号化、保存されました。NovelAI画像生成がこのサーバーの唯一の画像生成ツールになりました。`,
      },
      remove: {
        description: `現在設定されているNovelAI APIキーを削除します。`,
        no_key_title: `NovelAI APIキーが設定されていません`,
        no_key_description: `現在削除するNovelAI APIキーが設定されていません。`,
        success_title: `NovelAI APIキーが削除されました`,
        success_description: `NovelAI APIキーと排他的画像生成設定が削除されました。`,
      },
    },
    elevenlabs: {
      description: `補助ElevenLabs APIキーを管理（音声認識・音声出力用）`,
      set: {
        description: `音声文字起こしとペルソナの音声出力に使うElevenLabs APIキーを設定します。`,
        key_description: `あなたのElevenLabs APIキー。`,
        invalid_key_title: `無効なAPIキー形式`,
        invalid_key_description: `提供されたAPIキーは短すぎるか無効のようです。有効なElevenLabs APIキーを入力してください。`,
        key_validation_failed_title: `ElevenLabs APIキーの検証に失敗しました`,
        key_validation_failed_description: `提供されたElevenLabs APIキーは無効です。キーを確認してもう一度お試しください。`,
        success_title: `ElevenLabs APIキーが設定されました`,
        success_description: `ElevenLabs APIキーが正常に検証、暗号化、保存されました。設定されている場所では音声文字起こしとペルソナの音声出力が利用可能になります。`,
        success_voices_title: `プリメイド音声（無料プラン対応）`,
        success_voices_description: `プリメイド音声は無料プランでも利用できます。一覧は [ElevenLabs Premade Voices](https://elevenlabs-sdk.mintlify.app/voices/premade-voices) で確認し、/speech voice-assign で各ペルソナに割り当てましょう。`,
        success_custom_voices_title: `ライブラリ音声・カスタム音声（有料プラン必須）`,
        success_custom_voices_description: `ライブラリ音声とカスタム（クローン・生成）音声はどちらもElevenLabsの有料プランが必要です。アカウントに追加した音声は /speech voice-assign に自動で表示されます。`,
        success_transcript_mode_title: `音声トランスクリプトモード`,
        success_transcript_mode_description: `/speech transcripts を使うと、音声メッセージのトランスクリプトをWebhook経由でチャットメッセージとして投稿できます。`,
      },
      remove: {
        description: `現在設定されているElevenLabs APIキーを削除します。`,
        no_key_title: `ElevenLabs APIキーが設定されていません`,
        no_key_description: `現在削除するElevenLabs APIキーは設定されていません。`,
        success_title: `ElevenLabs APIキーが削除されました`,
        success_description: `ElevenLabs APIキーが正常に削除されました。`,
      },
    },
  },
};
