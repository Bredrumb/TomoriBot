---
title: "データ処理"
sidebar:
  order: 4
---

TomoriBotはユーザーのデータについて透明性を持つように設計されています。彼女が保存するすべてのデータをエクスポート、インポート、または削除することができ、このページではその内容を正確に説明します。法的テキストについては、`/legal privacy-policy`および`/legal terms-of-service`を参照してください。

:::note
このページでは、Discord内でのユーザーごとの制御について説明します。**独自のインスタンスをセルフホストしていますか？**
データベース全体のバックアップとリストアはホスト側の操作です（[メンテナンスとバックアップ](/ja/self-hosting/maintenance/)を参照してください）。
:::

## 保存されるデータ

**保存されるもの：**

- サーバーの記憶と個人の記憶
- 彼女の設定とペルソナデータ
- サーバー設定
- 暗号化されたAPIキー

**保存されないもの：**

- ユーザーのDiscordメッセージ
- チャット履歴

**AIプロバイダーに送信されるデータ：** 彼女がトリガーされるたびに、モデルのコンテキストとしてチャンネル内の**最新のメッセージ**と**関連する記憶**を取得します。彼女はトリガー以外の状況でメッセージを監視したり読んだりすることはありません。

:::note
選択したAIプロバイダー（Google、OpenRouter、NovelAIなど）は、*独自*のプライバシーポリシーに基づいてメッセージを処理します。機密性の高い個人情報をAIと絶対に共有しないでください。
:::

## データのエクスポート

エクスポート可能なすべてのデータは、JSONファイルとしてDMに送信されます：

- `/export config`：サーバーの設定値（APIキー、認証情報、プロバイダー設定は含まれません）。
- `/export personal config`：個人の設定（プロフィール、プライバシー、外観、応答モード）。
- `/export memories`：サーバーの記憶。メインペルソナ、選択した1つのペルソナ、またはすべてのペルソナごとに個別にスコープ設定されます。
- `/export personal memories`：個人の記憶。グローバル、1つのペルソナ、またはすべてのペルソナごとに個別にスコープ設定されます。
- `/persona export`：完全なペルソナの定義。

## データのインポート

以前にエクスポートしたファイルを添付して復元します：

- `/import config`：サーバー設定。**サーバー管理**権限が必要です。検出されたセクションのうち、どれを適用するかを選択します。
- `/import personal config`：個人の設定。検出されたセクションのうち、どれを適用するかを選択します。
- `/import memories`：サーバーの記憶。**サーバー管理**権限が必要です。マージするか置換するかを選択し、ファイルに複数のペルソナが含まれている場合は各ソースペルソナをマッピングします。
- `/import personal memories`：個人の記憶。マージするか置換するかを選択し、ファイルに複数のペルソナが含まれている場合は各ソースペルソナをマッピングします。
- `/persona import`：ペルソナを復元します。PNGやJSONのSillyTavernカード、`.charx`のCharacter Card V3アーカイブも受け付けますが、これらはキャラクターテキストのみをインポートします（[SillyTavernサポート](/ja/features/integrations/sillytavern-support/)を参照）。

## データの削除

これらはデータを完全に削除またはリセットします（**元に戻すことはできません**）：

- `/personal memories`、`/memories`
- `/reset config`：29の設定テーブル全体のサーバー設定をデータベースのデフォルトにリセットします。
  - **DDLのデフォルトに復元されるシングルトン（18テーブル）：**チャット設定、モデル設定、メンバー権限、機能、通知の埋め込み、NSFW設定、音声設定、自動トリガー設定、チャンネルスコープ設定、トリガーの振る舞い設定、NovelAI画像生成設定、BYOK設定、記憶設定、短期記憶設定、ウェルカム設定、画像クォータ設定、テキストクォータ設定、および動画クォータ設定。
  - **保持される設定（2セット）：**`server_model_configs`のアクティブなモデルID、認証情報、およびカスタムエンドポイントパラメータ（`llm_id`、`embedding_model_id`、`diffusion_model_id`、`video_model_id`、`vision_llm_id`、`api_key`、`key_version`、`custom_endpoint_url`、`custom_model_name`、`custom_num_ctx`、`other_model_codename`、`other_model_capabilities`、`other_model_capabilities_fetched_at`）、さらにアクティブなNovelAI拡散モデルID（`server_novelai_imagegen_configs`の`nai_diffusion_model_id`）。
  - **クリアされるコレクション（11テーブル）：**`server_auto_trigger_persona_overrides`、`stm_categories`、`random_triggers`、`channel_llm_overrides`、`channel_prompt_overrides`、`channel_context_notes`、`personalization_blacklist`、`persona_user_blocks`、`channel_whitelist`、`role_whitelist`、および`channel_persona_whitelist`。
  - **保持されるドメイン：**ペルソナとペルソナ設定、サーバーの記憶、短期記憶、表現（絵文字とスタンプ）、記録されたクォータ消費、保存されたプロバイダー設定、および外部統合（MatrixとMCP）。
  - **コンテキストと権限：**ギルドでは「サーバー管理」権限が必要です。ダイレクトメッセージ（DM）では、コマンドを実行したユーザーワークスペースのsnowflakeを使用してサポートされます。
- `/reset personal config`：すべてのサーバーのユーザー設定とパーソナルチャンネルスポットライトをデータベースのデフォルトにリセットします。
  - **リセットされるフィールド：**`users.language_pref`（'en-US'）および`users.privacy_level`（0）を復元し、`user_personalization_configs`の全13列（ニックネーム、サーバー間オプトイン、外観タグ、キャラクター参照URL、なりきりプロンプト、パーソナルDTM、明示的ツールモード、タイムゾーンオフセット、プレフィックス/サフィックスのオーバーライド、性自認、代名詞、呼称スタイル）をスキーマのデフォルトに復元し、すべての`user_persona_naming_preferences`を削除します。
  - **クリアされるコレクション：**ワークスペース全体のユーザーのすべての`personal_spotlights`を削除し、`personal_spotlight_personas`にカスケードします。
  - **保持されるパーソナルドメイン：**ユーザーアカウントのアイデンティティ、登録ロケール、個人の記憶、保存されたプロバイダー設定（`user_saved_provider_configs`）、カスタムエンドポイント、およびスケジュール済みタスク/リマインダー。
  - **コンテキスト：**ギルドとDMの両方ですべてのユーザーが利用できます。

## オプトアウト

- `/personal config`：彼女に対するユーザーの可視性を制御し、完全に不可視にすることもできます（記憶機能を完全にオプトアウトします）。
- `/config` > 権限：サーバー管理者は自己学習やその他の機能をオフにできます。

日々の記憶の仕組みについては、[記憶](/ja/features/knowledge/memory/)を参照してください。
