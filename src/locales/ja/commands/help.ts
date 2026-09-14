export default {
  help: {
    description: `セットアップ、機能、プロバイダー、メモリ、動作、ツール、メディア、連携のガイドを表示します。`,
    dashboard: {
      categories: {
        setup: `セットアップ`,
        features: `機能`,
      },
      pages: {
        custom_endpoints: `カスタムエンドポイント`,
      },
      page_reference: `\`/help\`内の **{page}** ページ`,
      page_select_placeholder: `ページを選択`,
      provider_select_placeholder: `プロバイダーを選択`,
      previous_button: `< 前へ`,
      next_button: `次へ >`,
      docs_link_label: `ウェブ版を読む`,
      support_link_label: `技術サポートを受ける`,
    },
    features: {
      title: `TomoriBotの機能（バージョン {version}）`,
    },
    matrix: {
      bot_user_fallback: `設定されているMatrixボットアカウント`,
    },
    "api-key": {
      description: `AIプロバイダーのAPIキー設定方法を学ぶ`,
      provider_description: `AIプロバイダーを選択`,
      provider_choice_brave: `Brave Search`,
      provider_choice_google: `Google Gemini（おすすめ）`,
      provider_choice_deepseek: `DeepSeek`,
      provider_choice_custom: `カスタムエンドポイント`,
      provider_choice_nvidia: `NVIDIA NIM`,
      provider_choice_novelai: `NovelAI`,
      provider_choice_openrouter: `OpenRouter（おすすめ）`,
      provider_description_google: `汎用性が高く、無料利用枠も充実`,
      provider_description_openrouter: `有料ながら安定性と柔軟性が高く、画像・動画・音声も生成可能`,
      provider_description_deepseek: `比較的検閲が少ない、より安価な有料の選択肢`,
      provider_description_novelai: `無検閲のロールプレイ、物語、画像生成向け`,
      provider_description_nvidia: `ホスト型のテキスト、埋め込み、画像モデル`,
      provider_description_zai: `GLMのテキスト・画像モデル。コーディング用途の規約制限あり`,
      provider_description_vertexexpress: `APIキー認証でGoogle CloudのGeminiを利用`,
      provider_description_vertex: `Google Cloud認証情報で企業向けGeminiを利用`,
      provider_description_custom: `セルフホストやプロキシ用。認証は任意の場合あり`,
      provider_description_brave: `任意のウェブ、画像、動画、ニュース検索`,
      provider_description_elevenlabs: `音声生成・文字起こし用。テキストモデルではありません`,
      brave_title: `Brave Search APIキーの設定`,
      brave_description: `Brave Searchはオプションで、検索機能を強化するだけです。これは私のAIを動かすものではありません（それはメインプロバイダーが担当します）。
- 画像、動画、ニュース検索を有効化
- インターネットからリアルタイム情報を提供
- 最新の質問に答える能力を強化`,
      brave_getting_key_title: `APIキーの取得：`,
      brave_getting_key_description: `1. [Brave Search API](https://brave.com/search/api/)にアクセス
2. 無料アカウントに登録
3. ダッシュボードの[APIキー](https://api-dashboard.search.brave.com/app/keys)セクションに移動
4. 新しいAPIキーを作成
5. {configBraveapiSet}コマンドでAPIキーをコピーして入力`,
      brave_important_title: `重要な注意事項：`,
      brave_important_description: `- これはメインAIプロバイダーとは別です
- Brave APIキーがなくても、組み込みウェブ検索で機能します
- Braveでは毎月5ドル分の無料クレジットが含まれますが、それを超えると課金される場合があります。無料枠だけ使いたい場合は、[Braveの使用量上限ダッシュボード](https://api-dashboard.search.brave.com/app/subscriptions/usage-limits)で使用量上限を5ドルに設定してください`,
      brave_footer: `メインAIプロバイダーについては、\`/help\`のAPIキーページで別のプロバイダーを選んでください`,
      google_title: `Google Gemini APIキーの設定`,
      google_description: `Google Geminiは強力なAIモデルを備えた無料および有料プランを提供します。
- 無料プランで十分な制限あり
- ビジョンやペルソナ生成などTomoriBotの全機能をサポート
- [Geminiプライバシーポリシー](https://ai.google.dev/gemini-api/terms)`,
      google_getting_key_title: `APIキーの取得：`,
      google_getting_key_description: `1. [Google AI Studio](https://aistudio.google.com/apikey)にアクセス
2. 右上の\`APIキーを作成\`をクリック（必要に応じて新しいプロジェクトを作成）
3. このAPIキーを{configSetup}または{configApikeySet}にコピー`,
      google_footer: `このプロバイダーを設定したら、{configModel}でデフォルトモデルを変更できます`,
      deepseek_title: `DeepSeek APIキーの設定`,
      deepseek_description: `DeepSeekは従量課金制のテキストプロバイダーです。
- [DeepSeek APIドキュメント](https://api-docs.deepseek.com/)`,
      deepseek_getting_key_title: `APIキーの取得：`,
      deepseek_getting_key_description: `1. [DeepSeek API Keys](https://platform.deepseek.com/api_keys)にアクセス
2. DeepSeekのプラットフォームアカウントにログイン、または新規作成
3. 新しいAPIキーを作成
4. 必要に応じて、使用前にDeepSeekプラットフォームアカウントへ残高を追加
5. このAPIキーを{configSetup}または{configApikeySet}にコピー`,
      deepseek_footer: `このプロバイダーを設定したら、{configModel}でデフォルトモデルを変更できます`,
      custom_title: `カスタムエンドポイントのセットアップ`,
      custom_description: `旧来のインラインなカスタムプロバイダーフローは移動しました。

サーバー単位のエンドポイントは、{configSetup} で **カスタムエンドポイント（セットアップ後に完了）** を選び、その後 {configCustomModelsAdd} を実行してから {configModel} で有効化してください。

個人用エンドポイントは {personalCustomModelsAdd} を使用してください。

対応エンドポイント種類や手順の詳細は {helpCustomModels} を参照してください。`,
      nvidia_title: `NVIDIA NIM APIキーの設定`,
      nvidia_description: `NVIDIA NIMは、NVIDIA Build経由でホスト型のテキスト・埋め込み・画像APIを提供します。`,
      nvidia_getting_key_title: `APIキーの取得：`,
      nvidia_getting_key_description: `1. [NVIDIA Build](https://build.nvidia.com/)にアクセス
2. NVIDIA開発者アカウントでログイン、または新規作成
3. [API Keysページ](https://build.nvidia.com/settings/api-keys)でAPIキーを作成または管理
4. このAPIキーを{configSetup}または{configApikeySet}にコピー`,
      nvidia_important_title: `重要な注意事項：`,
      nvidia_important_description: `- テキストと埋め込みはNVIDIAのホスト型 \`integrate.api.nvidia.com\` を使用します
- ネイティブ画像生成はNVIDIAホストの \`ai.api.nvidia.com\` FLUXエンドポイントを使用します`,
      nvidia_footer: `このプロバイダーを設定したら、{configModel}、{configModelEmbedding}、{configModelImage}でテキスト・埋め込み・画像モデルを変更できます`,
      provider_choice_zai: `Z.ai`,
      provider_choice_vertex: `Google Vertex AI`,
      provider_choice_vertexexpress: `Google Vertex AI Express`,
      provider_choice_elevenlabs: `ElevenLabs TTS`,
      zai_title: `Z.ai APIキーの設定`,
      zai_description: `Z.aiは、汎用APIと別個のCodingエンドポイントを通じてGLMファミリーへアクセスできます。

⚠️ **利用規約の更新：** Z.aiの利用規約が更新され、コーディング/エージェントのユースケースのみが許可されるようになりました。汎用エンドポイントをコーディング以外のチャットに使用する場合、自己責任となり規約に違反する可能性があります。`,
      zai_getting_key_title: `APIキーの取得：`,
      zai_getting_key_description: `1. [Z.aiプラットフォーム](https://z.ai)にアクセス
2. ログインまたはアカウントを作成
3. ダッシュボードでAPIキーに移動
4. 新しいAPIキーを作成
5. このAPIキーを{configSetup}または{configApikeySet}にコピー`,
      zai_important_title: `重要な注意事項：`,
      zai_important_description: `- 通常のチャット、推論、画像生成には汎用エンドポイントを使ってください
- 専用のCodingエンドポイントは別扱いで、コーディング特化ワークフロー向けです
- ⚠️ Z.aiの利用規約がコーディング/エージェントのシナリオのみに制限されました。一般チャットでの使用は自己責任です`,
      zai_footer: `このプロバイダーを設定したら、{configModel}でデフォルトモデルを変更できます`,
      novelai_title: `NovelAI APIキーの設定`,
      novelai_description: `NovelAIはクリエイティブなストーリーテリングとロールプレイに焦点を当てたサブスクリプションベースのサービスです。
- 無制限の無検閲メッセージ
- 無検閲のテキスト生成と、別途設定するNovelAI画像生成に対応
- NovelAIのテキストモデルは画像入力に未対応
- [NovelAI利用規約](https://novelai.net/terms)`,
      novelai_getting_key_title: `APIキーの取得：`,
      novelai_getting_key_description: `1. [NovelAI](https://novelai.net/stories)にアクセス
2. 左上の⚙️アイコンから設定に移動
3. \`アカウント\`に移動
4. \`永続的APIトークンを取得\`を探す（購読申し込みが必要です！）
5. このAPIキーを{configSetup}または{configApikeySet}にコピー`,
      novelai_footer: `このプロバイダーを設定したら、{configModel}でデフォルトモデルを変更できます`,
      openrouter_title: `OpenRouter APIキーの設定`,
      openrouter_description: `OpenRouterは従量課金制で複数のプロバイダーの様々なAIモデルへのアクセスを提供します。
 - 最新かつ最も強力なAIモデルへのアクセス（無料もあります）
 - 現在、TomoriBotの全機能をサポートしていません
 - [OpenRouter利用規約](https://openrouter.ai/terms)`,
      openrouter_getting_key_title: `APIキーの取得：`,
      openrouter_getting_key_description: `1. [OpenRouter](https://openrouter.ai/settings/keys)にアクセス
2. \`APIキーを作成\`をクリック
3. このAPIキーを{configSetup}または{configApikeySet}にコピー`,
      openrouter_important_title: `重要な注意事項：`,
      openrouter_important_description: `- **無料モデルは厳格なレート制限があります**。通常は有料モデルの方が安定します
- モデルを選ぶ前に**必ず料金を確認**してください
- OpenRouterアカウント側の設定もそのまま適用されます
- 一覧にないモデルが必要なら{supportServer}で提案してください`,
      openrouter_footer: `このプロバイダーを設定したら、{configModel}でデフォルトモデルを変更できます`,
      vertex_title: `Google Vertex AIの設定`,
      vertex_description: `Google Vertex AIは、Google Cloudを通じてGeminiモデルへのエンタープライズグレードのアクセスを提供します。
- 認証にApplication Default Credentials（ADC）を使用、APIキーの管理が不要
- ローカルのgcloud ADC、またはホスト環境のワークロードID・サービスアカウントを使用
- [Vertex AIドキュメント](https://cloud.google.com/vertex-ai/docs)`,
      vertex_getting_key_title: `設定手順：`,
      vertex_getting_key_description: `**手順1: [Google Cloud CLI](https://cloud.google.com/cli)をインストール**

**手順2: Google Cloudプロジェクトを作成**
\`gcloud projects create PROJECT_ID --name="Vertex AI Project"\`
（\`PROJECT_ID\` を一意のIDに置き換えてください。例：\`my-vertex-project-12345\`）

**手順3: アクティブプロジェクトに設定**
\`gcloud config set project PROJECT_ID\`

**手順4: 請求先アカウントを紐付け**
\`gcloud billing accounts list\` で請求先アカウントIDを確認し、
\`gcloud billing projects link PROJECT_ID --billing-account=ACCOUNT_ID\` を実行

**手順5: Vertex AI APIを有効化**
\`gcloud services enable aiplatform.googleapis.com\`

**手順6: Application Default Credentialsを設定**
\`gcloud auth application-default login\` を実行してブラウザでログイン

**手順7: 設定を入力**
{configSetup}または{configApikeySet}で \`{project_id}::{location}\` の形式で入力
- ロケーションは \`global\` を推奨（プレビューモデル対応・最高の可用性）
- 例：\`my-vertex-project-12345::global\``,
      vertex_important_title: `重要な注意事項：`,
      vertex_important_description: `- 保存される値は**設定情報**（プロジェクト＋ロケーション）であり、認証情報ではありません
- すべてのVertexリクエストはホストのApplication Default Credentials IDを使用します
- AI StudioのAPIキーだけではこのプロバイダーを認証できません。プロジェクトで請求とVertex AI APIを有効にし、ホストIDにVertexアクセス権を付与してください。
- チャット、ツール呼び出し、ストリーミング、構造化出力、圧縮、埋め込み、プリセット生成に対応`,
      vertex_footer: `このプロバイダーを設定したら、{configModel}でデフォルトモデルを変更できます`,
      vertexexpress_title: `Google Vertex AI Expressの設定`,
      vertexexpress_description: `Google Vertex AI Expressは、Vertex AI上のGeminiへAPIキーでアクセスできるモードです。
- ホスト側のApplication Default Credentialsではなく、自分のGoogle Cloud APIキーを使用します
- デプロイ済みTomoriBotで各ユーザーが自分のキーを持つBYOK運用に向いています
- Gemini限定の小さめなモデルカタログを持つPreview機能です
- [Vertex AI Express Mode概要](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/express-mode/overview)`,
      vertexexpress_getting_key_title: `設定手順：`,
      vertexexpress_getting_key_description: `1. [Vertex AI Express Mode](https://console.cloud.google.com/expressmode) を開く
2. 標準の Google Cloud にリダイレクトされる場合は、別プロバイダーの \`vertex\` を使ってください
3. Express コンソールで **APIs & Services > Credentials** を開き、Express の API キーをコピー
4. その生の API キーを {configSetup} または {configApikeySet} で追加
5. {configModel} で Vertex AI Express 用モデルを選択`,
      vertexexpress_important_title: `重要な注意事項：`,
      vertexexpress_important_description: `- 保存するのは \`{project_id}::{location}\` ではなく、生の API キーです
- ここではロケーション設定は不要です。\`global\` は別プロバイダーの \`vertex\` 用です
- フル Google Cloud の Vertex プロジェクトは \`vertexexpress\` ではなく \`vertex\` を使ってください
- 利用できるモデルは Vertex AI Express 対応の Gemini カタログに限定されます
- 画像生成には対応しますが、動画と埋め込みには対応しません
- Express Mode は現在 Google の Preview 機能です`,
      vertexexpress_footer: `このプロバイダーを設定したら、{configModel}でデフォルトモデルを変更できます`,
    },
    elevenlabs: {
      description: `ElevenLabs音声合成の設定方法を学ぶ`,
      title: `ElevenLabs TTSの設定`,
      getting_key_title: `APIキーの取得：`,
      getting_key_description: `1. [ElevenLabs](https://elevenlabs.io/app/settings/api-keys)にアクセス
2. アカウントにサインインまたは新規登録
3. 新しいAPIキーを作成
4. {configSpeechElevenlabs}を使用してAPIキーを入力`,
      choosing_voice_title: `ボイスの選択：`,
      choosing_voice_description: `APIキーを設定したら、使用するボイスを選択できます。
 - {configSpeechVoiceAssign}を使って利用可能なボイスを参照・選択
 - [Voice Library](https://elevenlabs.io/app/voice-library) からボイスを追加でき、自分の声のクローンも作成できます`,
      free_voices_title: `プリメイド音声（無料プラン対応）：`,
      free_voices_description: `プリメイド音声は無料プランでも利用できます。一覧は [ElevenLabs Premade Voices](https://elevenlabs-sdk.mintlify.app/voices/premade-voices) で確認し、{configSpeechElevenlabs} または {configSpeechVoiceAssign} で各ペルソナに割り当てましょう。`,
      important_notes_title: `重要な注意点：`,
      important_notes_description: `- 音声メッセージを生成・読み上げると文字数が消費されます
- 無料ティアには月間制限があります。使用量はElevenLabsダッシュボードで確認してください
- 表示用字幕投稿は {configSpeechTranscripts} で別途制御します`,
      footer: `ElevenLabsキーを更新するには {configSpeechElevenlabs} を再実行してください。`,
    },
  },
};
