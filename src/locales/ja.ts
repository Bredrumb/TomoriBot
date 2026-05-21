// locales/ja.ts

// ロケール構造全体をデフォルトオブジェクトとしてエクスポートします
export default {
  general: {
    yes: `はい`,
    confirm: `確認`,
    none: `なし`,
    unknown: `不明`,
    scoped_openrouter_model_description: `/openrouter model から追加`,
    openrouter_model_moved_title: `機能の場所が変わりました`,
    openrouter_model_moved_description: `\`other-model\` の直接選択は OpenRouter モデル登録に移動しました。まず {add_command} で正確なモデルコードネームを登録し、不要な登録は {remove_command} で削除してください。その後、通常の OpenRouter モデル一覧から登録済みモデルを選択してください。`,
    defaults: {
      bot_name: `ともり`,
    },
    api_styles: {
      openai_compatible: `OpenAI互換`,
      comfyui: `ComfyUI`,
      ollama_native: `Ollamaネイティブ`,
      elevenlabs: `ElevenLabs TTS`,
      elevenlabs_transcription: `ElevenLabs STT`,
      tts_clone: `ローカルTTSクローン`,
      openai_compatible_transcription: `OpenAI互換STT`,
    },
    script_markup: {
      plain: `通常テキスト`,
      bracket_tags: `角括弧タグ`,
      emoji: `絵文字マーカー`,
    },
    cooldown_title: `⌛ お待ちください！`,
    cooldown: `再度 \`/{category}\` コマンドを使用するまで {seconds} 秒待つ必要があります。`,
    message_cooldown_title: `⌛ お待ちください！`,
    message_cooldown: `このサーバーの管理者がクールダウンを設定しています。**{botName}** に再度話しかけるには **{seconds}** 秒お待ちください。`,
    message_cooldown_footer_per_user: `サーバー設定: ユーザーごとのクールダウン`,
    message_cooldown_footer_per_channel: `サーバー設定: チャンネルごとのクールダウン`,
    message_cooldown_footer_server_wide: `サーバー設定: サーバー全体のクールダウン`,
    message_cooldown_footer_strict: `サーバー設定: 厳密サーバー全体のクールダウン`,
    interaction: {
      cancel_title: `🔴 コマンドがキャンセルされました`,
      cancel_description: `コマンドはキャンセルされました。`,
      timeout_title: `⏰ コマンドがタイムアウトしました`,
      timeout_description: `時間内に応答しませんでした。もう一度お試しください。`,
    },
    pagination: {
      page_info: `ページ {current}/{total}`,
      previous: `前へ`,
      next: `次へ`,
      cancel: `キャンセル`,
      no_items: `表示する項目がありません。`,
      cancelled: `選択はキャンセルされました。`,
      timeout: `時間内に選択しませんでした。もう一度お試しください。`,
      item_selected: `選択済み: {item}`,
      select_page_title: `ページを選択`,
      select_page_description: `{totalItems}項目から{totalPages}ページ中の表示するページを選択してください：`,
      select_persona_title: `ペルソナを選択`,
      reloading_persona_picker: `ペルソナピッカーを更新しています...`,
      persona_no_attributes: `属性はまだ設定されていません。`,
      persona_select_button: `選択`,
    },
    errors: {
      guild_only_title: `サーバー専用コマンド`,
      guild_only_description: `このコマンドはサーバー内でのみ使用できます。`,
      channel_only_title: `チャンネルが必要です`,
      channel_only_description: `このコマンドは正常に動作するためにチャンネルが必要です。`,
      channel_not_supported_title: `サポートされていないチャンネルタイプ`,
      channel_not_supported_description: `申し訳ありませんが、サーバーのテキストチャンネルまたはダイレクトメッセージでのみ動作します。グループDMやその他のチャンネルタイプはサポートされていません。`,
      tomori_not_setup_title: `初期設定が必要です`,
      tomori_not_setup_description: `このサーバーではまだ私の設定が行われていないようです。\`サーバー管理\`権限を持つメンバーが最初に\`/config setup\`を使用する必要があります。\`/help setup\`で案内を確認でき、\`/config language\`で希望の言語を設定できます。`,
      tomori_updating_title: `現在アップデート中...`,
      tomori_updating_description: `現在アップデート中のため、まもなく復旧します。しばらくしてからもう一度お試しください！`,
      tomori_not_setup_dm_footer: `DMは「ミニサーバー」として扱われ、私はあなたのメッセージに個人的に応答します。ほとんどのサーバー関連コマンドは意図通りに動作します。`,
      api_key_missing_title: `APIキーがありません`,
      api_key_missing_description: `機能するには有効なプロバイダー設定が必要ですが、このサーバーには設定されていません。\`サーバー管理\`権限を持つメンバーが\`/setup\`（初回）または\`/config provider add\`で設定できます。`,
      api_key_error_title: `APIキーエラー`,
      api_key_error_description: `設定されたプロバイダー認証情報へのアクセスまたは復号化で問題が発生しました。\`/config provider add\`で再設定してください。`,
      personal_provider_required_title: `個人プロバイダーが必要です`,
      personal_provider_required_description: `このサーバーでは、ユーザーが発言したメッセージに対してメンバー自身のAIプロバイダー設定を使用しています。\`/help personal-provider\` を確認し、\`/personal provider add\` で設定してください。`,
      personal_provider_credentials_error_title: `個人プロバイダーエラー`,
      personal_provider_credentials_error_description: `有効になっている個人プロバイダーを使用できませんでした。\`/personal provider add\` で更新するか、\`/personal provider toggle-models\` で無効化してください。`,
      context_error_title: `コンテキスト構築エラー`,
      context_error_description: `会話のコンテキストを理解しようとしているときにエラーが発生しました。`,
      critical_error_title: `重大なエラー`,
      critical_error_description: `予期しない重大なエラーが発生しました。`,
      update_failed_title: `更新に失敗しました`,
      update_failed_description: `データベースの設定の更新に失敗しました。もう一度お試しください。`,
      unknown_error_title: `不明なエラー`,
      unknown_error_description: `予期しないエラーが発生しました。問題が解決しない場合は、\`/support discord\`で報告してください。`,
      unexpected_title: `予期しないエラー`,
      unexpected_description: `予期しないエラーが発生しました：{error}`,
      invalid_option_title: `無効なオプション`,
      invalid_option_description: `選択されたオプションは無効です。有効なオプションを選択してください。`,
      permission_denied_title: `権限がありません`,
      permission_denied_description: `このコマンドを使用する権限がありません。\`サーバー管理\`権限を持つメンバーのみがこのコマンドを使用できます。`,
      server_not_found_title: `サーバーが見つかりません`,
      server_not_found_description: `データベースにサーバー情報が見つかりませんでした。もう一度お試しいただくか、問題が解決しない場合はサポートにお問い合わせください。`,
      generic_error_title: `エラー`,
      generic_error_description: `リクエストの処理中にエラーが発生しました。後でもう一度お試しください。`,
      brave_api: {
        missing_key: {
          title: `Brave APIキーがありません`,
          description: `検索を実行するにはBrave Search APIキーが必要ですが、このサーバーには設定されていません。\`サーバー管理\`権限を持つメンバーが\`/optional-key brave set\`を使用して設定できます。`,
          footer: `/help api-keyで詳細を確認してください`,
        },
      },
      duckduckgo_rate_limit: {
        title: `DuckDuckGoがレート制限されています`,
        description: `DuckDuckGo検索は現在レート制限されています。より信頼性の高い検索のために、\`サーバー管理\`権限を持つメンバーが\`/optional-key brave set\`を使用してBrave Searchを設定できます。`,
        footer: `/help api-keyで詳細を確認してください`,
      },
      operation_failed_title: `操作に失敗しました`,
      operation_failed_description: `要求された操作を完了できませんでした。もう一度お試しください。`,
      custom_endpoint_unreachable_title: `カスタムエンドポイントに接続できません`,
      custom_endpoint_unreachable_description: `指定されたカスタムエンドポイントに接続できませんでした。URL、認証、公開設定を確認してからもう一度お試しください。`,
      comfyui_poll_timeout_title: `ComfyUIがタイムアウトしました`,
      comfyui_poll_timeout_description: `ComfyUIワークフローが制限時間内に完了しませんでした。タイムアウトを延ばすか、ワークフローを軽くしてもう一度お試しください。`,
      provider_not_supported_title: `サポートされていないプロバイダー`,
      provider_not_supported_description: `選択されたAIプロバイダーは現在サポートされていません。`,
      user_blacklisted_title: `ユーザーがブラックリスト登録済み`,
      user_blacklisted_description: `あなたは現在このサーバーのパーソナライズ機能のブラックリストに登録されており、この操作を実行できません。`,
      persona_response_failed_title: `ペルソナの応答に失敗しました`,
      persona_response_failed_description: `ペルソナ **{personaName}** からの応答の生成に失敗しました。\n\n> {errorMessage}`,
      webhook_missing_permissions_title: `Webhook 権限がありません`,
      webhook_missing_permissions_description: `このチャンネルでWebhookを作成できないため、オルタペルソナは通常メッセージで返信します。**Webhookの管理**権限を付与すると、オルタのアバターを表示できます。`,
      webhook_limit_title: `Webhookの上限に達しました`,
      webhook_limit_description: `このチャンネルはDiscordのWebhook上限(10)に達しているため、オルタペルソナは通常メッセージで返信します。不要なWebhookを削除するか、オルタの数を減らしてください。`,
      webhook_unknown_error_title: `Webhook エラー`,
      webhook_unknown_error_description: `このチャンネルでWebhookを作成できなかったため、オルタペルソナは通常メッセージで返信します。権限を確認してもう一度お試しください。`,
      voice_transcription_failed_title: `音声文字起こしに失敗しました`,
      voice_transcription_failed_description: `その音声メッセージを文字起こしできませんでした。もう一度試すか、代わりにテキストで送信してください。`,
      tts_synthesis_failed_title: `音声メッセージの生成に失敗しました`,
      tts_synthesis_failed_description: `音声メッセージを生成できませんでした。音声エンドポイントの設定を確認してもう一度お試しください。`,
      tts_server_unreachable_title: `音声サーバーに接続できません`,
      tts_server_unreachable_description: `音声サーバーに接続できませんでした。サーバーが起動していることを確認してもう一度お試しください。`,
      transcription_failed_title: `文字起こしに失敗しました`,
      transcription_failed_description: `音声を文字起こしできませんでした。文字起こしエンドポイントの設定を確認してもう一度お試しください。`,
      transcription_server_unreachable_title: `文字起こしサーバーに接続できません`,
      transcription_server_unreachable_description: `文字起こしサーバーに接続できませんでした。サーバーが起動していることを確認してもう一度お試しください。`,
    },
    tomori_busy_title: `他の人に返信中です！`,
    tomori_busy_replying: `現在このメッセージに返信中です: {message_link}。あなたのメッセージはキューに追加されました。`,
  },
  rate_limit: {
    user_exceeded_title: `🟡️ レート制限に達しました`,
    user_exceeded_description: `現在、全サーバーで多数のアクティブなメッセージを処理中です。不正利用を防ぐため、最新のトリガー試行は破棄されました。メッセージの処理が完了するまでお待ちください。`,
    server_exceeded_title: `🟡️ サーバー過負荷`,
    server_exceeded_description: `このサーバーでは現在多数のアクティブなメッセージを処理中です。現在キャパシティに達しています！しばらく待ってから再度お試しいただくか、他のサーバーやダイレクトメッセージでご利用ください。`,
    error_memory_critical_title: `🔴 システム過負荷`,
    error_memory_critical_description: `現在メモリ使用率が高く、ファイルアップロードができません。しばらく後にお試しください。`,
    error_quota_exceeded_title: `🔴 1日の上限に達しました`,
    error_quota_exceeded_description: `このコマンドの1日の上限に達しました。クォータは**{reset_time}**にリセットされます。リセット時刻以降に再度お試しください。`,
  },
  genai: {
    generic_error_title: `生成エラー`,
    generic_error_description: `申し訳ありません、応答を生成中にエラーが発生しました ({error_message})。`,
    generic_error_footer: `\`/tool refresh\`を実行してからもう一度お試しください。問題が解決しない場合は、\`/support discord\`で報告してください。`,
    error_stream_timeout_title: `接続タイムアウト`,
    error_stream_timeout_description: `この問題が続く場合、選択したAIプロバイダーに一時的な問題がある可能性があります。後でもう一度お試しいただくか、\`/tool refresh\`を使用してコンテキスト履歴をリフレッシュしてください。`,
    empty_response_title: `空の応答`,
    empty_response_description: `AIから空の応答を受け取りました。この問題が解決しない場合は、\`/tool refresh\`を使用してください。`,
    max_iterations_title: `思考ループ`,
    max_iterations_streaming_description: `思考ループに陥り、リクエストを完了できませんでした。この問題が解決しない場合は、\`/tool refresh\`を使用してください。`,
    still_working_title: `まだ作業中...`,
    still_working_description: `このタスクは通常より多くのステップが必要です。もし止まっていると思ったら、\`/bot kill\` を使用してください。`,
    nai_tool_retry_exhausted_title: `ツールエラー`,
    nai_tool_retry_exhausted_description: `ツールが複数回失敗し、リクエストを完了できませんでした。もう一度お試しいただくか、問題が解決しない場合は \`/tool refresh\` を使用してください。`,
    tool_error_loop_title: `ツールエラーループ`,
    tool_error_loop_description: `ツールエラーが続いたため、リクエストを完了できませんでした。言い回しを変えるか、問題が解決しない場合は \`/tool refresh\` を使用してください。`,
    fallback_used_title: `フォールバックモデルを使用しました`,
    fallback_used_description: `{chain} の代わりに \`{success_model}\` が使用されました`,
    fallback_used_details_description: `次のモデルが先に失敗したため、フォールバック枠 {slot} の \`{success_model}\` で応答しました:\n{failure_list}`,
    fallback_used_failure_line: `{index}. {model} は {error_code} で失敗しました`,
    fallback_used_details_button: `Fallback Used`,
    fallback_used_hide_footer: `\`/config notice-embeds visibility\` でこれを非表示にし、詳細を思考ログへ回せます`,
    no_response_title: `応答なし`,
    no_response_description: `応答がありませんでした - これはAIからの空の応答またはタイムアウトが原因である可能性があります。`,
    thought_log: {
      title: `思考ログ`,
      description: `元チャンネル: {source_line}`,
      personal_attribution: `{user_mention} さんの個人 {provider} 設定で生成されました。`,
      personal_attribution_title: `個人プロバイダー属性`,
      summary_field: `思考サマリー`,
      raw_field: `生の思考`,
      fetched_content_field: `取得コンテンツ`,
      footer: `プロバイダー: {provider} | モデル: {model}`,
      footer_with_generation_time: `プロバイダー: {provider} | モデル: {model} | 生成時間: {generation_time}`,
    },
    message_interaction: {
      reply_context_author: `返信先: {user}`,
      reply_context_description: `返信先: {message_url}`,
      reply_context_footer: `返信先: {user} • {message_url}`,
    },
    text_quota_exceeded_title: `🔴 テキストクォータを超過しました`,
    text_quota_exceeded_description: `テキスト生成クォータに達しました。{reset_info}`,
    text_user_quota_exceeded_description: `日次テキスト生成クォータに達しました。{reset_info}`,
    text_serverwide_quota_exceeded_description: `このサーバーはこの期間のテキスト生成クォータに達しました。{reset_info}`,
    text_quota_resets_in_hours: `クォータは {hours} 時間後にリセットされます。`,
    text_quota_resets_in_days: `クォータは {days} 日後にリセットされます。`,
    text_quota_exceeded_footer: `このクォータは、このサーバーの管理者が \`/server quota\` で設定しています。`,
    search: {
      web_search_title: `🔍 ウェブで \`{query}\` を検索中...`,
      image_search_title: `🔍 \`{query}\` の画像を検索中...`,
      video_search_title: `🔍 \`{query}\` の動画を検索中...`,
      news_search_title: `🔍 ニュースで \`{query}\` を検索中...`,
      disclaimer_description: `AIによる生成応答と検索結果は不正確または不完全な場合があります。**重要な情報は再確認してください**。`,
    },
    mcp: {
      tool_invoke_title: `🔧 **{server}** の \`{function}\` を使用中...`,
      tool_invoke_description: `パラメーター:`,
      tool_invoke_no_params: `パラメーターなし。`,
    },
    tool_notice: {
      hide_footer: `\`/config notice-embeds visibility\` で非表示にできます`,
      hide_footer_with_kill: `\`/config notice-embeds visibility\` で非表示にできます · 止まっていると思ったら \`/bot kill\` を使用してください`,
    },
    video: {
      youtube_processing_title: `👁️ YouTube動画を視聴中...`,
      youtube_processing_description: `現在、YouTube動画を視聴しています: {video_url}`,
      youtube_processing_footer: `動画の長さに応じて、少し時間がかかる場合があります`,
      generating_title: `🎬 動画を生成中...`,
      generating_description: `現在のプロンプトから動画を作成しています`,
      generating_with_references_description: `現在のプロンプトと参照画像から動画を作成しています`,
      notice_model_line: `**モデル:** {model}`,
      notice_prompt_line: `**プロンプト:** {prompt}`,
      notice_reference_line: `参照元: {message_url}`,
      notice_reference_count_line: `参照画像を {count} 枚使用しています。`,
      generating_footer: `1〜3分ほどかかる場合があります。`,
    },
    document: {
      reading_title: `📄 ドキュメントを読み取り中...`,
      reading_description: `\`{filename}\` の内容を読み取っています`,
      truncated_title: `⚠️ ファイルが省略されました`,
      truncated_description: `\`{filename}\` が長すぎるため、{limit}文字に省略されました（元のサイズ：{original}文字）。応答が不完全な場合があります。ファイルを小さく分割して、一つずつ送ることをお勧めします。`,
    },
    image: {
      generating_title: `🖼️ 画像を生成中...`,
      generating_description: `現在のプロンプトから画像を作成しています`,
      generating_with_references_description: `現在のプロンプトと参照画像を使って画像を作成しています`,
      editing_title: `🖌️ 画像を編集中...`,
      editing_description: `参照画像の \`{edit_target}\` を対象に編集しています`,
      notice_model_line: `**モデル:** {model}`,
      notice_prompt_line: `**プロンプト:** {prompt}`,
      notice_reference_line: `参照元: {message_url}`,
      notice_character_prompt_line: `**キャラクター {index}:** {prompt}`,
      notice_nai_tags_help_line: `より良いNovelAI画像を生成するには \`/novelai image-tags\` を使ってください。`,
      notice_reference_count_line: `参照画像を {count} 枚使用しています。`,
      generating_footer: `プロバイダーの混雑状況によって少し時間がかかる場合があります。`,
    },
    vision: {
      analyzing_title: `🖼️ 画像を解析中...`,
      analyzing_description: `現在のモデルはビジョン非対応です。設定されたビジョンモデルを使用して画像を解析しています`,
      analyzing_footer: `画像の数によって少し時間がかかる場合があります`,
    },
    gif: {
      processing_title: `🎞️ GIFを処理中...`,
      processing_description: `詳細に確認するため、指定されたGIFからキーフレームを抽出しています`,
      processing_footer: `大きいGIFは少し時間がかかる場合があります`,
    },
    fetch: {
      reading_title: `🌐 Webページを読み取り中...`,
      reading_title_page: `🌐 Webページを読み取り中（{page}ページ目）...`,
      reading_description: `{url} を取得して内容を読み取っています`,
      reading_offset_line: `文字 {start_index} から読み取っています`,
      reading_footer: `ページサイズによって少し時間がかかる場合があります`,
    },
    stream: {
      response_stopped_title: `応答が中断されました`,
      response_stopped_description: `次の理由で応答が中断されました: {reason}。送信されたコンテンツがAIプロバイダーにとって大きすぎないか確認してください。\`/tool refresh\`で会話コンテンツをクリアしてください。`,
      streaming_failed_description: `応答をストリーミング中に問題が発生しました。`,
      provider_error_interaction: `ストリーム応答がブロック/停止されました。理由: {reason}。`,
      api_error_title: `🔴 プロバイダーAPIエラー`,
      api_error_tip: `APIキーを確認して再度お試しください。このエラーが解決しない場合は、\`/support discord\`で報告してください。`,
      rate_limit_title: `🟡 プロバイダーレート制限を超過`,
      rate_limit_title_all_rotation_keys: `🟡 全ローテーションキーがレート制限中`,
      rate_limit_tip: `数分お待ちいただいてから再度お試しください。複数の個人キーをお持ちなら、\`/config api-key rotation\` の利用も検討してください。`,
      model_fallback_hint: `耐障害性を高めるには、\`/config model fallback\` でモデルのフェイルオーバーを設定できます。`,
      content_blocked_title: `🔴️ プロバイダーコンテンツフィルター`,
      content_blocked_tip: `ヒント: \`/nsfw jailbreaks\` でこのエラーの回避を試すか、メッセージ(\`/tool refresh\`)、記憶/設定(\`/memory personal export\`、\`/memory server export\`、\`/server config export\`)、問題のあるメンバーをブラックリスト(\`/server user-blacklist add\`)、またはプロバイダを変更(\`/config model\`)を確認してください。`,
      timeout_title: `🟡️ プロバイダーリクエストタイムアウト`,
      timeout_tip: `メッセージを短くするか再度お試しください`,
      provider_overloaded_title: `🔴 プロバイダーの過負荷`,
      provider_overloaded_tip: `プロバイダーが現在過負荷状態です。しばらく後に再度お試しいただくか、別のプロバイダーに変更してください`,
      flush_limit_title: `🟡️ 応答の長さ制限に達しました`,
      flush_limit_description: `この応答はメッセージの最大長制限に達したため停止されました。必要に応じて \`/bot respond\` を使用して手動で応答を続けることができます。`,
      inactivity_timeout_title: `🟡️ 応答がタイムアウトしました`,
      inactivity_timeout_description: `AIプロバイダーからの応答が停止し、接続がタイムアウトしました。プロバイダーが過負荷状態にあるか、問題が発生している可能性があります。もう一度お試しください。`,
    },
    google: {
      "400_default_message": `リクエスト形式にエラーがありました`,
      "400_billing_default_message": `このサービスには課金が必要です`,
      "403_default_message": `APIキーに必要な権限がありません。Google AI Studioから合法的に取得した自分自身のAPIキーを使用していることを確認してください`,
      "404_default_message": `参照されたリソースが見つかりませんでした`,
      "429_default_message": `短時間に多くのリクエストを送信しすぎました`,
      "503_default_message": `AIモデルが現在過負荷状態です`,
      "504_default_message": `リクエストの処理時間が長すぎました`,
      content_blocked_default_message: `あなたのコンテンツは安全フィルターによってブロックされました`,
      unknown_default_message: `予期しないエラーが発生しました`,
    },
    vertexexpress: {
      "403_predict_permission_message": `このキーでは Vertex AI Express モデルを呼び出せません。Express Mode のキーを使うか、フル Google Cloud プロジェクトなら別プロバイダーの \`vertex\` を使ってください。`,
    },
    novelai: {
      "400_default_message": `無効なリクエスト形式またはパラメータ`,
      "400_trial_message": `トライアルアカウントでは生成にrecaptcha認証が必要です。API経由のアクセスには有料のNovelAIサブスクリプションが必要です。https://novelai.net/ でアカウントをアップグレードしてください`,
      "401_default_message": `NovelAIのAPIキーが無効または期限切れです`,
      "402_default_message": `Anlasクレジットが不足しています`,
      "429_default_message": `リクエストを送信しすぎています。ペースを落としてください`,
      "503_default_message": `NovelAIサーバーが現在過負荷状態です`,
      "504_default_message": `リクエストの処理時間が長すぎました`,
      unknown_default_message: `予期しないエラーが発生しました`,
    },
    openrouter: {
      "404_privacy_policy_error": `**プライバシーポリシー制限**
選択したモデルは有料モデルトレーニングのためのデータ使用を許可する必要がありますが、OpenRouterアカウントのプライバシー設定で現在ブロックされています。

**修正方法：**
1. https://openrouter.ai/settings/privacy にアクセス
2. 「Data Policy」設定を調整してこのモデルを許可
3. またはプライバシー設定に一致する別のモデルを選択`,
      unknown_default_message: `予期しないエラーが発生しました`,
    },
    anthropic: {
      "400_default_message": `Anthropic APIへのリクエストが無効です。別のモデルを試すか、コンテキスト長を減らしてください。`,
      "401_default_message": `Anthropic APIキーが無効です。console.anthropic.comでキーを確認してください。`,
      "403_default_message": `Anthropic APIキーにこの操作の権限がありません。`,
      "404_default_message": `リクエストされたAnthropicモデルが見つかりません。\`/config model text\`でモデルを切り替えてください。`,
      "429_default_message": `Anthropicのレート制限に達しました。しばらく待ってから再試行してください。`,
      "500_default_message": `Anthropicで内部サーバーエラーが発生しました。`,
      "503_default_message": `Anthropicは現在利用できないか、過負荷状態です。`,
      temperature_top_p_conflict_message: `Anthropic は Temperature と Top-P を同時に受け付けません。\`/config parameters\` を使って、そのプロバイダーの **Temperature** か **Top P** のどちらかを調整してください。`,
      unknown_default_message: `Anthropicとの通信中に予期しないエラーが発生しました。`,
    },
    self_teach: {
      server_memory_learned_title: `🧠 {persona_nickname}が新しいことを学びました！`,
      server_memory_learned_description: `サーバー記憶を保存しました:
\`{memory_content}\``,
      server_memory_updated_title: `📝 {persona_nickname}が記憶を更新しました！`,
      server_memory_updated_description: `サーバー記憶を更新しました:
\`{memory_content}\``,
      server_memory_deleted_title: `🗑️ {persona_nickname}が記憶を削除しました！`,
      server_memory_deleted_description: `サーバー記憶を削除しました:
\`{memory_content}\``,
      personal_memory_learned_title: `💡 {persona_nickname}が{user_nickname}さんについて新しいことを学びました！`,
      personal_memory_learned_description: `{user_nickname}さんに関する個人的な記憶を保存しました:
\`{memory_content}\``,
      personal_memory_updated_title: `📝 {persona_nickname}が{user_nickname}さんについての記憶を更新しました！`,
      personal_memory_updated_description: `{user_nickname}さんに関する個人的な記憶を更新しました:
\`{memory_content}\``,
      personal_memory_deleted_title: `🗑️ {persona_nickname}が{user_nickname}さんについての記憶を削除しました！`,
      personal_memory_deleted_description: `{user_nickname}さんに関する個人的な記憶を削除しました:
\`{memory_content}\``,
      server_memory_footer: `サーバー管理者は\`/memory server\`でこの記憶を管理できます。`,
      personal_memory_footer_manage: `個人記憶は\`/memory personal\`で管理できます。`,
      personal_memory_footer_personalization_disabled: `この記憶は保存されましたが、現在このサーバーではパーソナライズ機能が無効になっているため、すぐには効果がありません。全文は\`/memory personal export\`で確認できます。\`/personal privacy\`でオプトアウトできます。`,
      personal_memory_footer_user_blacklisted: `この記憶は保存されましたが、対象のユーザーは現在このサーバーのパーソナライズ機能のブラックリストに登録されているため、すぐには効果がありません。全文は\`/memory personal export\`で確認できます。\`/personal privacy\`でオプトアウトできます。`,
    },
  },
  commands: {
    speech: {
      description: `音声出力の声とサンプルを管理します。`,
      "voice-add": {
        description: `ローカルTTS用の参照音声サンプルをアップロードします。`,
      },
      "voice-remove": {
        description: `このサーバーのローカルTTS音声サンプルを削除します。`,
      },
      "voice-assign": {
        description: `ペルソナに音声出力用の声を割り当てます。`,
      },
      "voice-design": {
        description: `ペルソナの VoiceDesign プロンプトを管理します。`,
        set: {
          description: `ペルソナに VoiceDesign 用の声質プロンプトを設定します。`,
        },
        remove: {
          description: `ペルソナの VoiceDesign プロンプトを削除します。`,
        },
      },
      elevenlabs: {
        description: `ElevenLabs の音声生成と文字起こしを接続します。`,
        key_description: `ElevenLabs APIキー。`,
        invalid_key_title: `APIキーが無効です`,
        invalid_key_description: `有効な ElevenLabs APIキーを入力してください。`,
        key_validation_failed_title: `キー検証に失敗しました`,
        key_validation_failed_description: `この ElevenLabs キーを検証できませんでした。キーを確認して再試行してください。`,
        success_title: `ElevenLabs を接続しました`,
        success_description: `ElevenLabs の音声生成と文字起こしエンドポイントを接続しました。\`/speech voice-assign\` でペルソナに声を割り当てます。`,
      },
      chatterbox: {
        description: `Chatterbox の音声設定を管理します。`,
        parameters: {
          description: `Chatterbox Turbo と標準モデルの音声生成を調整します。`,
          cfg_weight_description: `標準モデルのみ: 下げると速い声のペース調整に役立ち、上げると参照音声により強く寄せます。`,
          exaggeration_description: `標準モデルのみ: 上げるほど表現が強くドラマチックになり、発話が速くなる場合があります。`,
          turbo_description: `高速生成と対応済みイベントタグ用に Chatterbox-Turbo を使います。CFG/表現調整を使う場合は無効化します。`,
          enabled_label: `有効`,
          disabled_label: `無効`,
          success_title: `Chatterbox パラメータを更新しました`,
          success_description: `Chatterbox Turbo: **{turbo}**\nCFG weight: **{cfg_weight}**\nExaggeration: **{exaggeration}**`,
          turbo_notice: `現在 Turbo が有効なため、CFG weight と Exaggeration は保存されますが無視されます。対応済みイベントタグは保持され、未対応の角括弧記述は削除されます。`,
          standard_notice: `現在 Turbo が無効なため、CFG weight と Exaggeration が有効です。\`[laugh]\` や \`[whisper]\` のような角括弧の記述は、音声生成前に削除されます。`,
        },
      },
      transcripts: {
        description: `ボイスメッセージの表示用字幕投稿を切り替えます。`,
        set_description: `チャット内の表示用字幕メッセージを有効または無効にします。`,
        already_set_title: `既に設定済みです`,
        already_enabled_description: `このサーバーでは表示用字幕投稿が既に有効です。`,
        already_disabled_description: `このサーバーでは表示用字幕投稿が既に無効です。`,
        success_title: `表示用字幕モードを更新しました`,
        enabled_success: `表示用字幕投稿を**有効**にしました。ボイスメッセージは文字起こしされ、Webhook経由でチャットに投稿されます。内部理解用の背景STTは \`/config model transcription\` で別途設定します。`,
        disabled_success: `表示用字幕投稿を**無効**にしました。文字起こしエンドポイントが設定されている場合、内部理解用の背景STTは引き続き利用できます。`,
      },
      voice_add: {
        description: `ローカルTTS用の参照音声サンプルをアップロードします。`,
        audio_file_description: `設定されたサイズ上限内の参照音声ファイル。`,
        name_description: `この音声サンプルの短いラベル。`,
        ref_text_description: `参照音声の任意の書き起こし。`,
        format_error_title: `未対応の音声形式です`,
        format_error_description: `WAV、MP3、OGG、OPUS、FLAC、M4A、AAC の音声ファイルをアップロードしてください。`,
        size_error_title: `音声ファイルが大きすぎます`,
        size_error_description: `音声サンプルは {limit_mb} MB 以下にしてください。`,
        duration_error_title: `音声クリップが長すぎます`,
        duration_error_description: `音声サンプルは {limit_secs} 秒以下にしてください。`,
        normalization_error_title: `音声変換に失敗しました`,
        normalization_error_description: `音声ファイルをWAV形式に変換できませんでした。別のファイルまたは形式をお試しください。`,
        success_title: `音声サンプルを追加しました`,
        success_description: `**{name}** をローカル音声サンプルとして追加しました。\n\n参照テキスト: {ref_text_hint}`,
        ref_text_provided: `あり`,
        ref_text_missing: `なし`,
      },
      voice_remove: {
        description: `このサーバーのローカルTTS音声サンプルを削除します。`,
        no_sample_title: `音声サンプルがありません`,
        no_sample_description: `このサーバーには削除できるローカル音声サンプルがありません。`,
        modal_title: `削除する音声サンプルを選択`,
        select_label: `削除する音声サンプル`,
        select_placeholder: `音声サンプルを選んでください…`,
        confirm_title: `音声サンプルを削除しますか？`,
        confirm_description: `**{name}** を削除し、{refs} 件のペルソナ割り当てを解除しますか？`,
        confirm_button: `サンプルを削除`,
        cancel_button: `キャンセル`,
        success_title: `音声サンプルを削除しました`,
        success_description: `**{name}** を削除し、それを使っていたペルソナ割り当てを解除しました。`,
      },
      voice_assign: {
        description: `ペルソナに音声出力用の声を割り当てます。`,
        no_speech_endpoint_title: `音声エンドポイントがありません`,
        no_speech_endpoint_description: `まず \`/provider custom-endpoint add\` で音声エンドポイントを登録してください。`,
        no_sample_title: `音声サンプルがありません`,
        no_sample_description: `まず \`/speech voice-add\` でローカル音声サンプルを追加してください。`,
        select_persona_title: `音声を設定するペルソナを選択`,
        clear_choice_label: `音声を無効化`,
        clear_choice_description: `このペルソナの現在の音声設定を削除します。`,
        assign_clone_title: `音声サンプルを割り当て`,
        sample_ref_hint_with: `書き起こしあり · {duration}`,
        sample_ref_hint_without: `{duration}`,
        elevenlabs_modal_title: `ElevenLabs音声を選択`,
        elevenlabs_voice_fetch_failed_title: `音声一覧を取得できませんでした`,
        elevenlabs_voice_fetch_failed_description: `ElevenLabsの音声一覧を読み込めませんでした。設定済みキーを確認して再試行してください。`,
        success_title: `ペルソナの音声を更新しました`,
        success_description: `**{persona}** は今後、ボイスメッセージで **{voice}** を使用します。`,
        cleared_title: `ペルソナの音声を解除しました`,
        cleared_description: `**{persona}** の音声設定を削除しました。`,
      },
      voice_design: {
        description: `ペルソナに VoiceDesign 用の声質プロンプトを設定します。`,
        prompt_description: `任意の声質説明。省略すると大きめの入力欄を開きます。`,
        unsupported_endpoint_title: `VoiceDesign エンドポイントが有効ではありません`,
        unsupported_endpoint_description: `VoiceDesign プロンプトを設定する前に、Supports Instruct が有効なローカルTTSエンドポイントを選択してください。`,
        select_persona_title: `VoiceDesign を設定するペルソナを選択`,
        modal_title: `VoiceDesign プロンプト`,
        update_modal_title: `VoiceDesign プロンプトを更新`,
        prompt_label: `声質説明`,
        prompt_help: `話者の年齢、声色、質感、アクセント、速度、感情、話し方を説明してください。`,
        prompt_placeholder: `落ち着いた大人のナレーター。ゆっくりめで、柔らかく息成分のある、安心感のある話し方。`,
        prompt_required_description: `VoiceDesign プロンプトを入力してください。`,
        success_title: `VoiceDesign プロンプトを設定しました`,
        success_description: `**{persona}** はローカルボイスメッセージで次の VoiceDesign プロンプトを使用します:\n\n> {preview}`,
        cleared_title: `VoiceDesign プロンプトを削除しました`,
        cleared_description: `**{persona}** から VoiceDesign プロンプトを削除しました。`,
      },
      validation: {
        sample_not_found: `音声サンプルが見つかりません。`,
        no_voice_assigned: `このペルソナには音声が割り当てられていません。`,
        unsupported_format: `未対応の音声形式です。`,
        file_too_large: `アップロードされたファイルが大きすぎます。`,
      },
    },
    choices: {
      always: `常時`,
      enable: `有効にする`,
      disable: `無効にする`,
      enabled: `有効`,
      disabled: `無効`,
      none: `なし`,
      none_user_byok: `なし（ユーザーBYOK）`,
      inherit_global: `グローバルクールダウンを継承`,
    },
    "st-preset": {
      description: `SillyTavernプリセットを管理。詳しくは /help st-preset`,
      import: {
        description: `SillyTavernプリセットJSONをインポート。詳しくは /help st-preset`,
        file_description: `インポートするSillyTavernプリセットの.jsonファイル`,
        invalid_file_title: `無効なファイル`,
        file_too_large_title: `ファイルが大きすぎます`,
        file_too_large_description: `プリセットファイルは{max_size} MB以下にしてください。`,
        download_failed: `添付ファイルのダウンロードに失敗しました。もう一度お試しください。`,
        invalid_json: `ファイルを有効なJSONとして解析できませんでした。`,
        not_a_preset_title: `未対応のプリセット形式`,
        not_a_preset_description: `これは対応しているSillyTavernプリセットではないようです。対応しているのは **Chat Completions** プリセットのみです — Prompt Manager の \`prompts\` 配列、または \`context.story_string\` + \`sysprompt.content\` を使った旧形式のみです。\n\n**Text-completions プリセット**（\`instruct\` ブロックを使用するもの）は対応していません。`,
        no_nodes: `このプリセットに使用可能なプロンプトノードが見つかりませんでした。`,
        success_title: `プリセットをインポートしました`,
        success_description: `**{name}**をインポートしました。

• **{total}** 合計ノード
• **{markers}** 構造マーカー
• **{toggleable}** 切り替え可能ノード（**{enabled}** 有効）
{notes}
{stPresetToggle}でアクティブなノードを調整できます。
{helpStPreset}で、この環境でのプリセットの挙動を確認できます。
{stPresetRemove}でデフォルトの動作に戻せます。`,
        note_comment_only: `> **{count}** 個のコメントのみのノードが\`/st-preset node toggle\`で表示されますが、プロンプトには挿入されません。`,
        note_disabled_by_preset: `> **{count}** 個のノードがこのプリセットでデフォルトで無効になっています。\`/st-preset node toggle\`で有効にできます。`,
        note_unsupported_macros: `> 有効なノードに未対応のプリセットマクロが残っています: {macros}。その部分はそのまま送信されたり、この環境ではSTどおりに動かない場合があります。`,
        note_legacy_text_completion: `> この古い text-completions プリセットは、legacy の\`story_string\`からベストエフォートで変換されました。\`persona\`、\`scenario\`、アンカー、stop strings、古いバックエンド設定などの ST 専用要素は引き続き無視されます。`,
      },
      remove: {
        description: `インポートしたSillyTavernプリセットを削除`,
        no_preset_title: `プリセットが見つかりません`,
        no_preset_description: `このサーバーにインポートされたSillyTavernプリセットがありません。削除するものがありません。`,
        modal_title: `プリセットを削除`,
        checkbox_label: `プリセット（チェックを外すと削除）`,
        checkbox_label_continued: `プリセット（続き）`,
        checkbox_description: `削除したいプリセットのチェックを外してください。チェックされたプリセットは保持されます。`,
        no_removals_title: `プリセットは削除されませんでした`,
        no_removals_description: `すべてのプリセットが保持されました。削除するには少なくとも1つのチェックを外してください。`,
        failed_title: `削除に失敗しました`,
        failed_description: `1つ以上のプリセットの削除に失敗しました。もう一度お試しください。`,
        success_title: `プリセットを削除しました`,
        success_description: `**{count}**件のプリセットを削除しました: {names}{promoted_note}`,
        auto_promoted_note: `\n\n**{name}**が新しいアクティブプリセットに設定されました。`,
      },
      switch: {
        description: `アクティブなSillyTavernプリセットを切り替え`,
        modal_title: `アクティブプリセットの切り替え`,
        select_label: `有効にするプリセットを選択`,
        select_placeholder: `プリセットを選択...`,
        no_presets_title: `プリセットが見つかりません`,
        no_presets_description: `SillyTavernプリセットがインポートされていません。\`/st-preset import\`で追加してください。`,
        single_preset_title: `プリセットが1件のみ`,
        single_preset_description: `インポートされたプリセットが1件のみです。切り替えるには\`/st-preset import\`でさらに追加してください。`,
        success_title: `プリセットを切り替えました`,
        success_description: `**{name}**がアクティブなSillyTavernプリセットになりました。`,
      },
      node: {
        description: `プリセットのプロンプトノードを管理`,
        toggle: {
          description: `プリセットのプロンプトノードのオン・オフを切り替え`,
          no_preset_title: `プリセットが見つかりません`,
          no_preset_description: `このサーバーにアクティブなSillyTavernプリセットがありません。まず\`/st-preset import\`でインポートしてください。`,
          no_nodes_title: `切り替え可能なノードがありません`,
          no_nodes_description: `このプリセットには切り替え可能なプロンプトノードがありません。`,
          select_page_title: `ページを選択`,
          select_page_description: `**{preset_name}**には**{total_nodes}**個の切り替え可能なノードが**{total_pages}**ページにわたってあります。
ページを選択してノードを表示・切り替え:`,
          group_description: `チェックで有効、チェック解除で無効`,
          done_button: `完了`,
          no_changes: `変更なし`,
          result_title: `ノード切り替え結果`,
          result_description: `**{enabled}** / **{total}** ノードが有効。

{changes}`,
        },
      },
    },
    tool: {
      ping: {
        description: `ボットの遅延を確認します`,
        title: `ポン！ 🏓`,
        response_fast: `応答時間: \`{response_time}ms\``,
        response_slow: `応答時間: \`{response_time}ms\``,
      },
      estimate: {
        description: `利用量と費用の見積もり`,
        cost: {
          description: `有料AIプロバイダーのAPI費用を見積もる`,
          title: `推定API費用`,
          embed_description: `Discordチャンネルでのトリガーあたりの**非常におおまかな**推定費用です。費用は**{provider}**の例を使用して推定されています（入力：{inputPrice}/百万トークン、出力：{outputPrice}/百万トークン）`,
          current_context_description: `あなたの**現在のコンテキストのみ**を対象にした推定費用です。入力トークンは、現在の設定と直近のチャンネル履歴を使って、**{provider}** のモデル **{model}** でプロバイダーAPI計測を行います。出力トークンは推定値です。使用価格: 入力 {inputPrice}/百万、出力 {outputPrice}/百万。`,
          current_input_title: `計測済み入力トークン（現在のコンテキスト）`,
          current_input_value: `**入力:** {inputTokens} トークン
**入力コストのみ:** 1トリガーあたり約 {inputCost}`,
          current_output_short_title: `推定出力: 短め`,
          current_output_typical_title: `推定出力: 標準`,
          current_output_long_title: `推定出力: 長め`,
          current_output_band_value: `**出力推定:** {outputTokens} トークン
**合計推定:** {totalTokens} トークン
**費用:** 1トリガーあたり約 {costPerMessage}（100トリガーあたり約 {costPer100}）`,
          current_footer: `入力トークンは、ライブ計測に対応したプロバイダーでのみプロバイダー計測値になります。出力トークンは推定値です。`,
          no_cost_provider_description: `現在のプロバイダーには費用がありません`,
          unavailable_description: `現在のプロバイダー（**{provider}**）ではライブ費用見積もりを利用できません。`,
          fallback_notice_title: `ライブ計測を利用できません`,
          fallback_notice_value: `現在の設定ではライブのプロバイダートークン計測を利用できなかったため、この表示はおおまかな代替推定です。`,
          minimum_scenario_title: `最小シナリオ（軽量使用）`,
          minimum_scenario_value: `**コンテキスト：** 1ユーザー、メモリなし、1段落のペルソナ、会話は1メッセージあたり1文未満
**トークン数：** {inputTokens} 入力 + {outputTokens} 出力 = {totalTokens} 合計
**費用：** ~{costPerMessage} /トリガー（~{costPer100} /100トリガー）`,
          average_scenario_title: `平均シナリオ（中程度使用）`,
          average_scenario_value: `**コンテキスト：** 3ユーザー（各10メモリ）、~16段落のペルソナ（属性と対話を含む）、会話は1メッセージあたり1〜2文
**トークン数：** {inputTokens} 入力 + {outputTokens} 出力 = {totalTokens} 合計
**費用：** ~{costPerMessage} /トリガー（~{costPer100} /100トリガー）`,
          maximum_scenario_title: `最大シナリオ（重量使用）`,
          maximum_scenario_value: `**コンテキスト：** 5ユーザー（各25メモリ）、~31段落のペルソナ（属性と対話を含む）、会話は1メッセージあたり2段落
**トークン数：** {inputTokens} 入力 + {outputTokens} 出力 = {totalTokens} 合計
**費用：** ~{costPerMessage} /トリガー（~{costPer100} /100トリガー）`,
          breakdown_title: `費用に影響する要因`,
          breakdown_value: `**入力トークン（AIに送信されるコンテキスト）：**
- ペルソナの段落数（属性とサンプル対話を含む）
- サーバー＆個人メモリ
- 有効化されたツール（ある場合）
- ユーザーステータス＆リマインダー
- 最近の会話履歴（プロバイダーがサポートしている場合、画像、動画、スタンプ、絵文字、埋め込みを含む）
- サーバー絵文字（常に10個）

**出力トークン（AI応答）：**
- 応答の長さはクエリの複雑さによって異なります
- より詳細な質問 = より長い応答 = より高い費用

**費用を削減するヒント：**
サーバー内の悪用者やスパマーによる費用を削減するための組み込み機能がありますが、以下の追加のヒントもあります：
- ペルソナの段落数を少なくする（属性と対話）
- メモリを簡潔に保つ
- 無料のAIプロバイダーを使用する（Google Gemini無料プラン）
- 自動トリガーチャンネルを制限する`,
          footer: `Google Gemini（無料プラン）や一部のOpenRouterモデルなどの無料プロバイダーは費用がかかりません！NovelAIはサブスクリプション制で無制限に使用できます。プロバイダーの詳細は\`/help api-key\`をご覧ください。`,
        },
      },
      compact: {
        description: `最近の会話をコンパクトなシステム要約にまとめます。`,
        channel_description: `要約を投稿するチャンネル（省略時はこのチャンネルに投稿）。`,
        thread_description: `要約を投稿するDiscordスレッドID（任意）。`,
        modal: {
          title: `コンパクト要約`,
          type_label: `要約タイプ`,
          type_description: `生成する要約形式を選択してください。`,
          type_choice_conversation: `会話`,
          type_choice_roleplay: `ロールプレイ`,
          refresh_label: `コンテキストをリフレッシュ?`,
          refresh_description: `はいの場合、この要約より上のメッセージは無視されます。`,
          analyze_images_label: `画像を解析?`,
          analyze_images_description: `添付・絵文字・スタンプの画像解析を含めます。`,
          additional_instructions_label: `追加指示`,
          additional_instructions_placeholder: `任意: 要約への追加の指示を入力してください。`,
        },
        processing_title: `⏳ 要約中`,
        processing_description: `最近の会話を要約しています...`,
        success_title: `✅ 要約を投稿しました`,
        success_description: `コンパクト要約をこのチャンネルに投稿しました。`,
        success_description_redirect: `コンパクト要約を {channel} に投稿しました。`,
        destination_conflict_title: `投稿先を1つだけ選択してください`,
        destination_conflict_description: `channelオプションとthreadオプションは同時に指定できません。どちらか一方だけを指定してください。`,
        thread_invalid_title: `無効なスレッド`,
        thread_invalid_description: `このサーバー内の有効なDiscordスレッドIDを入力してください。`,
        failed_title: `要約に失敗しました`,
        failed_description: `要約の生成に失敗しました: {error}`,
        provider_unsupported_title: `未対応のプロバイダー`,
        provider_unsupported_description: `現在のプロバイダー ({provider}) はコンパクト要約に未対応です。対応プロバイダーに切り替えてください。`,
        model_incompatible_title: `モデル非対応`,
        model_incompatible_description: `現在のモデル ({model_name}) はロールプレイ要約に必要な構造化出力 (STRUCT) に対応していません。`,
        image_vision_required_title: `画像認識が必要`,
        image_vision_required_description: `現在のモデル ({model_name}) は画像解析に対応していません。画像解析をオフにするか、対応モデルを選択してください。`,
        summary_title: `🧠 コンパクト要約`,
        summary_title_refreshed: `🧹 コンパクト要約 (リフレッシュ)`,
        roleplay_scene_title: `🎭 ロールプレイのシーン要約`,
        roleplay_scene_title_refreshed: `🧹 ロールプレイのシーン要約 (リフレッシュ)`,
        roleplay_scene_synopsis_header: `現在のストーリーのあらすじ:`,
        roleplay_character_title_prefix: `🎭 キャラクター要約:`,
        roleplay_labels: {
          current_goals: `直近の目標`,
          emotional_status: `現在の感情状態`,
          physical_status: `現在の身体の状態`,
          appearance_clothing: `外見・服装`,
          inventory: `所持品`,
        },
        refresh_footer: `この埋め込みからコンテキストがリフレッシュされました。`,
      },
      refresh: {
        description: `最近の会話履歴をクリアします。`,
        title: `🧹 会話履歴がクリアされました`,
        response: `コンテキストがリフレッシュされました。これより上のすべてのメッセージは無視されます。`,
        footer: `この埋め込みを削除すると、以前のメッセージがもう一度含まれるようになります。`,
      },
      status: {
        description: `現在の個人、サーバー、またはペルソナのステータスを表示します。`,
        scope_description: `どのスコープのステータスを表示しますか？`,
        scope_choice_server_model: `サーバーモデル`,
        scope_choice_server_config: `サーバー設定`,
        scope_choice_server_channels: `サーバーチャンネル`,
        scope_choice_personal: `個人`,
        scope_choice_persona: `ペルソナ`,
        personal_title: `個人ステータス`,
        personal_description: `あなたの個人設定とグローバル個人メモリ`,
        personal_page2_title: `個人ステータス: プロバイダー`,
        personal_page2_description: `あなたの個人プロバイダー設定とカスタムエンドポイント`,
        field_personal_providers_with_count: `個人プロバイダー ({count})`,
        field_personal_custom_endpoints_with_count: `個人カスタムエンドポイント ({count})`,
        personal_provider_no_capabilities: `有効な機能なし`,
        server_page1_title: `サーバーステータス: モデルとサンプリング`,
        server_page1_description: `言語モデルとサンプラー設定`,
        server_page2_title: `サーバーステータス: 動作設定`,
        server_page2_description: `タイミング、上限、クールダウン設定`,
        server_page3_title: `サーバーステータス: チャンネルと自動化`,
        server_page3_description: `自動チャット、RPチャンネル、ホワイトリスト、ランダムトリガー`,
        server_page4_title: `サーバーステータス: 機能とモデレーション`,
        server_page4_description: `機能トグルとモデレーション設定`,
        server_page5_title: `サーバーステータス: システムプロンプト`,
        server_page5_description: `現在のサーバーシステムプロンプトのプレビュー`,
        server_page6_title: `サーバーステータス: モデル上書き`,
        server_page6_description: `チャンネルとペルソナのモデル上書き`,
        server_page7_title: `サーバーステータス: クォータ`,
        server_page7_description: `画像・テキスト・動画のクォータ設定を完全表示`,
        server_page9_title: `サーバーステータス: 連携とアクセス`,
        server_page9_description: `秘匿情報を伏せた認証状態、外部連携、STプリセット状態`,
        persona_page1_title: `{persona_name}: アイデンティティ`,
        persona_page1_description: `ペルソナのアイデンティティとトリガーワード`,
        persona_page2_title: `{persona_name}: 属性`,
        persona_page2_description: `ペルソナ属性の省略表示`,
        persona_page3_title: `{persona_name}: サンプル対話`,
        persona_page3_description: `ペルソナのサンプル対話ペアの省略表示`,
        persona_page4_title: `{persona_name}: 記憶`,
        persona_page4_description: `あなた向けのペルソナ個人メモリとサーバーメモリ`,
        persona_page5_title: `{persona_name}: プロンプトとタグ`,
        persona_page5_description: `ペルソナプロンプトと生成タグ`,
        field_model: `AIモデル`,
        field_speech_model: `音声モデル`,
        field_transcription_model: `文字起こしモデル`,
        field_user_byok: `ユーザーBYOK`,
        field_temperature: `温度`,
        field_top_p: `トップP`,
        field_top_k: `トップK`,
        field_min_p: `最小P`,
        field_frequency_penalty: `頻度ペナルティ`,
        field_presence_penalty: `存在ペナルティ`,
        field_omitted_params: `無効化したパラメーター`,
        field_humanizer: `ヒューマナイザーレベル`,
        field_thinking_level: `思考レベル`,
        field_timezone: `サーバータイムゾーン`,
        field_message_fetch_limit: `メッセージ取得上限`,
        field_autoch_threshold: `自動チャットモード`,
        field_autoch_channels: `自動チャットチャンネル`,
        field_rp_channels: `RPチャンネル`,
        field_private_channels: `プライベートチャンネル`,
        field_crosschannel_blocklist: `クロスチャンネルブロックリスト`,
        field_thought_logs_channel: `思考ログチャンネル`,
        field_welcome_channel: `ウェルカムチャンネル`,
        field_welcome_prompt: `ウェルカムプロンプト`,
        field_whitelist_personas: `ペルソナチャンネルホワイトリスト`,
        field_whitelist_channels: `チャネルホワイトリスト`,
        field_whitelist_roles: `ロールホワイトリスト`,
        whitelist_personas_all_allowed: `なし（全ペルソナが全チャンネルで許可）`,
        whitelist_all_allowed: `なし（全チャンネル許可）`,
        whitelist_roles_all_allowed: `なし（全ロール許可）`,
        field_random_triggers: `ランダムトリガー`,
        field_channel_llm_overrides: `チャンネルモデル上書き`,
        field_persona_llm_overrides: `ペルソナモデル上書き`,
        random_trigger_persona_random: `ランダム`,
        random_trigger_timer_segment: `{hours}時間`,
        random_trigger_chance_segment: `{chance}%`,
        random_trigger_offset_segment: `±{hours}時間`,
        random_trigger_silence_segment: `静穏 {hours}時間`,
        random_trigger_self_segment: `自己発言可`,
        random_trigger_prompt_segment: `追加プロンプト`,
        random_trigger_failure_segment: `失敗 {count}`,
        field_cooldown_type: `クールダウンタイプ`,
        field_cooldown_length: `クールダウン時間`,
        field_cooldown_length_value: `{seconds}秒`,
        field_cascade_limit: `カスケード上限`,
        field_send_message_limit: `送信上限`,
        field_always_reply: `常時応答`,
        field_match_limit: `マッチ上限`,
        field_personalization: `個人の記憶`,
        field_self_teach: `自己学習`,
        field_manage_message: `メッセージ管理ツール`,
        field_hide_respond_embed: `応答埋め込みを非表示`,
        field_self_debug: `セルフデバッグエラー埋め込み`,
        field_blacklisted_members: `ブラックリスト登録済みメンバー`,
        field_api_key_set: `APIキー設定済み`,
        field_brave_api_key_set: `Brave APIキー設定済み`,
        field_emoji_usage: `絵文字使用`,
        field_sticker_usage: `スタンプ使用`,
        field_web_search: `ウェブ検索`,
        field_image_generation: `画像生成`,
        field_videogen: `動画生成`,
        field_server_memteaching: `サーバー記憶の学習`,
        field_attribute_memteaching: `属性の学習`,
        field_sampledialogue_memteaching: `サンプル対話の学習`,
        field_hide_impersonation: `なりすまし埋め込みを非表示`,
        field_uncensor_injection: `インジェクション対策プロンプト`,
        field_uncensor_unicode: `Unicode空白置換`,
        field_uncensor_sanitize: `ワードサニタイズ`,
        field_image_quota_enabled: `画像クォータ有効`,
        field_image_quota_daily_user: `画像 1日あたりユーザークォータ`,
        field_image_quota_serverwide: `画像 サーバー全体クォータ`,
        field_image_quota_reset_days: `画像クォータ リセット周期`,
        field_text_quota_enabled: `テキストクォータ有効`,
        field_text_quota_daily_user: `テキスト 1日あたりユーザークォータ`,
        field_text_quota_serverwide: `テキスト サーバー全体クォータ`,
        field_text_quota_reset_days: `テキストクォータ リセット周期`,
        field_video_quota_enabled: `動画クォータ有効`,
        field_video_quota_daily_user: `動画 1日あたりユーザークォータ`,
        field_video_quota_serverwide: `動画 サーバー全体クォータ`,
        field_video_quota_reset_days: `動画クォータ リセット周期`,
        field_quota_reset_days_value: `{days}日`,
        field_quota_unlimited: `無制限`,
        field_nickname: `ニックネーム`,
        field_is_alter: `オルターペルソナ`,
        field_alter_triggers: `オルタートリガー`,
        field_persona_triggers: `ペルソナトリガー`,
        field_persona_model: `ペルソナモデル上書き`,
        persona_model_server_default: `サーバーデフォルト`,
        field_system_prompt: `システムプロンプト`,
        field_persona_prompt: `ペルソナプロンプト`,
        field_persona_prompt_not_set: `*(未設定)*`,
        field_nai_tags: `NAI画像タグ`,
        field_nai_attg: `NAI ATTGメタデータ`,
        nai_attg_not_set: `*(未設定)*`,
        field_user_nickname: `ユーザーニックネーム`,
        field_language_pref: `言語設定`,
        field_privacy: `プライバシーモード`,
        field_impersonation_prompt: `なりすましプロンプト`,
        field_impersonation_prompt_not_set: `*(未設定)*`,
        field_reminders_count: `アクティブなリマインダー`,
        item_count: `{count} 件`,
        unknown_channel: `不明なチャンネルID:`,
        export_footer_global_personal_memories: `完全な値を表示するには \`/memory personal export scope:global\` を使用してください`,
        export_footer_persona_memories: `完全な値を表示するには \`/memory personal export scope:persona\` と \`/memory server export\` を使用してください`,
        export_footer_persona_attributes_and_dialogues: `完全な属性とサンプル対話を表示するには \`/persona export\` を使用してください`,
        export_footer_server_config: `完全な値を表示するには \`/server config export\` を使用してください`,
        field_global_personal_memories_with_count: `グローバル個人メモリ ({current}/{max} 枠使用中)`,
        field_attributes_with_count: `属性 ({current}/{max} 枠使用中)`,
        field_sample_dialogues_with_count: `サンプル対話 ({current}/{max} 枠使用中)`,
        field_persona_personal_memories_with_count: `ペルソナ個人メモリ ({current}/{max} 枠使用中)`,
        field_persona_server_memories_with_count: `ペルソナサーバーメモリ ({current}/{max} 枠使用中)`,
        field_blacklisted_members_with_count: `{current} 人`,
        // Personal scope additions
        field_personal_dtm: `個人DTM`,
        field_personal_deliberate_tool_mode: `個人ツールモード`,
        field_crossserver_stm: `クロスサーバーSTM`,
        field_nai_char_tags: `NAIキャラクタータグ`,
        field_nai_char_ref: `NAIキャラクター参照画像`,
        // Server scope - Page 1 additions
        custom_endpoint_capability_label: `{capability}`,
        field_vision_model: `ビジョンモデル`,
        field_fallback_models: `フォールバックモデル`,
        field_logit_biases: `ロジットバイアス`,
        field_diffusion_model: `画像生成モデル`,
        field_video_model: `動画生成モデル`,
        field_embedding_model: `埋め込みモデル`,
        field_custom_endpoint: `カスタムエンドポイント`,
        // Server scope - Page 2 additions
        field_deliberate_trigger: `明示的トリガーモード`,
        field_deliberate_tool_mode: `明示的ツールモード`,
        field_deliberate_tool_context_turns: `ツールコンテキストターン`,
        field_user_byok_enabled: `有効。ユーザー発言に対する応答では各メンバーの個人プロバイダーが必要です。{toggle_command} で切り替えられます。`,
        field_user_byok_disabled: `無効。個人プロバイダーがない場合でもユーザー発言はサーバープロバイダーにフォールバックできます。{toggle_command} で切り替えられます。`,
        // Server scope - Page 4 additions
        field_tool_use: `ツール使用`,
        field_prompt_snapshot: `プロンプトスナップショット`,
        field_stm_privacy_bypass: `STMプライバシーバイパス`,
        field_voice_messages: `音声メッセージ`,
        field_voice_transcript_mode: `音声文字起こしチャットモード`,
        field_nai_exclusive_imggen: `NAI専用画像生成`,
        // Server scope - Page 5 additions (merged author's note)
        field_context_note: `作者注`,
        field_context_note_depth: `注の深さ`,
        field_context_note_not_set: `*(未設定)*`,
        // Server scope - Page 8 (NAI Image Config)
        server_page8_title: `サーバーステータス: NAI画像設定`,
        server_page8_description: `NovelAI画像生成パラメーター`,
        field_nai_diffusion_model: `NAI画像モデル`,
        field_nai_preset: `NAIサンプリングプリセット`,
        field_nai_style_tags: `NAIスタイルタグ`,
        field_nai_negative_tags: `NAIネガティブタグ`,
        field_nai_sampler: `NAIサンプラー`,
        field_nai_steps: `NAIステップ数`,
        field_nai_scale: `NAIスケール`,
        field_nai_noise_schedule: `NAIノイズスケジュール`,
        field_nai_cfg_rescale: `NAI CFGリスケール`,
        // Server scope - Page 9 (Integrations & Access)
        field_api_key_rotation_status: `APIキーローテーション`,
        field_api_key_rotation_pool: `ローテーションプール`,
        field_api_key_rotation_pool_value: `{total}件 · 追加キー {additional}件 · 有効 {enabled}件 · 無効 {disabled}件`,
        field_optional_api_keys_with_count: `任意APIキー ({count})`,
        field_saved_provider_configs_with_count: `保存済みプロバイダー設定 ({count})`,
        field_server_custom_endpoints_with_count: `カスタムエンドポイント ({count})`,
        field_mcp_servers_with_count: `MCPサーバー ({count})`,
        field_matrix_links_with_count: `Matrixリンク ({count})`,
        field_hidden_notice_embeds_with_count: `非表示の通知埋め込み ({count})`,
        field_st_preset_active: `有効なSTプリセット`,
        field_st_preset_library: `STプリセット一覧`,
        field_st_preset_library_value: `{count}件`,
        field_st_preset_nodes: `STプリセットノード`,
        field_st_preset_nodes_value: `{enabled}/{total}件有効`,
        optional_api_service_brave: `Brave Search`,
        optional_api_service_google: `Google`,
        optional_api_service_elevenlabs: `ElevenLabs`,
        optional_api_service_novelai: `NovelAI`,
        mcp_server_type_custom: `カスタム`,
        mcp_server_type_web_search: `ウェブ検索`,
        mcp_server_type_url_fetcher: `URL取得`,
        mcp_server_auth_present: `認証あり`,
        mcp_server_auth_absent: `認証なし`,
        // Persona scope - Page 1 additions
        field_avatar: `アバター`,
        field_voice: `音声`,
        field_persona_nai_ref: `NAIキャラクター参照画像`,
        field_reward_conditioning: `報酬コンディショニング`,
        field_punish_conditioning: `罰コンディショニング`,
        // Persona scope - Page 5 additions
        field_persona_context_note: `ペルソナ作者注`,
        field_persona_context_note_depth: `注の深さ`,
        field_persona_context_note_not_set: `*(未設定)*`,
      },
      comment: {
        description: `チャットに表示されるが、コンテキストには表示されないコメントを送信します。`,
        content_description: `コメントのテキスト内容。`,
        invalid_channel_title: `無効なチャンネル`,
        invalid_channel_description: `このコマンドはサーバーのテキストチャンネルまたはスレッドでのみ使用できます。`,
        footer: `{user}によるコメント、コンテキストには非表示`,
        success_title: `コメント投稿済み`,
        success_description: `コメントがこのチャンネルに投稿されました。`,
      },
      delete: {
        description: `ターンやチャンネルのコンテンツを削除します。`,
        turn: {
          description: `チャンネルから最後のペルソナのターンを削除します。`,
          regenerate_description: `trueの場合、削除後にペルソナを再トリガーします。`,
          select_persona_description: `trueの場合、削除するペルソナのターンを選択できます。`,
          no_permission_title: `権限が不足しています`,
          no_permission_description: `このコマンドにはサーバー管理権限が必要か、指定されたRPチャンネルで使用する必要があります。`,
          already_running_title: `削除中です`,
          already_running_description: `このチャンネルではすでに削除処理が進行中です。しばらくお待ちください。`,
          no_persona_found_title: `ペルソナのターンが見つかりません`,
          no_persona_found_description: `最近の履歴にペルソナの連続したメッセージブロックが見つかりませんでした。`,
          deleting_title: `⏳ ターンを削除中`,
          deleting_description: `**{persona_name}** の {count} 件のメッセージを削除中...`,
          success_title: `✅ ターンが削除されました`,
          success_description: `**{persona_name}** の {count} 件のメッセージを削除しました。`,
          success_regenerate_description: `**{persona_name}** の {count} 件のメッセージを削除しました。再トリガー中...`,
          partial_title: `⚠️ 一部削除されました`,
          partial_description: `**{persona_name}** の {deleted_count}/{total_count} 件のメッセージを削除しました。一部のメッセージは削除できませんでした。`,
          partial_no_manage_messages_description: `**{persona_name}** の {deleted_count}/{total_count} 件のメッセージを削除しました。**メッセージ管理**権限がないため、すべてを削除することはできませんでした。`,
          bot_no_delete_title: `メッセージを削除できません`,
          bot_no_delete_description: `このチャンネルで**メッセージ管理**権限がなく、ウェブフックフォールバックでもメッセージを削除できませんでした。**メッセージ管理**権限を付与するか、ウェブフックが利用可能であることを確認してください。`,
          bot_failed_delete_description: `メッセージを削除しようとしましたが、予期しないエラーが発生しました。`,
        },
      },
      prompt: {
        snapshot: {
          description: `デバッグ用に、ペルソナのLLMプロンプトをファイルに出力します。`,
          format_description: `スナップショットファイルの出力形式。`,
          fetch_tools_description: `trueの場合、利用可能なツール／関数定義をスナップショットに追加します（JSON形式のみ）。`,
          text_option: `テキスト`,
          json_option: `JSON`,
          no_permission_title: `権限が不足しています`,
          no_permission_description: `**サーバー管理**権限が必要か、サーバーオーナーが\`/server member-permissions\`でこの機能を有効にする必要があります。`,
          modal_title: `ペルソナを選択`,
          persona_select_label: `ペルソナ`,
          persona_select_description: `スナップショットを取るペルソナを選択してください。`,
          persona_select_placeholder: `ペルソナを選択...`,
          dm_title: `プロンプトスナップショット`,
          dm_description: `ペルソナ **{persona_name}** のプロンプトスナップショットです（形式: {format}）。`,
          dm_txt_headers_note: `ご注意 — TXTファイル内の \`=== タイトル (/コマンド) ===\` および \`== サブタイトル ==\` のヘッダーは、各セクションを制御する設定コマンドを示すための注釈です。LLMに実際に送信されるプロンプトの一部では**ありません**。`,
          dm_hint_try_json: `生の機械可読フォーマットが必要ですか？コマンドを再実行する際に \`format: JSON\` を指定してください。`,
          dm_hint_try_text: `より人間に読みやすい形式が必要ですか？コマンドを再実行する際に \`format: Text\` を指定してください。`,
          dm_tools_txt_note: `ツール定義はTXT形式からは省略されています。含めるには \`format: JSON\` と \`fetch_tools: true\` を指定して再実行してください。`,
          dm_tools_filtering_note: `JSONスナップショット内のツール定義は、deliberate tool mode が有効な場合、直近の表示済みターンに合わせてフィルタリングされます。後から作成するスナップショットでは一時的な直近ツール文脈を完全には復元できない場合がありますが、実際のターンでツールが限定または抑制される状況で全ツール一覧を出力しないようになっています。`,
          dm_config_heading: `**サンプリング / リクエスト設定**（プロバイダーアダプタが実行時に送信する内容と一致）：`,
          dm_failed_title: `DMを送信できませんでした`,
          dm_failed_description: `DMを送信できませんでした。スナップショットをここに添付します。今後DMで受け取るには、サーバーメンバーからのDMを有効にしてください。`,
          success_title: `スナップショットを送信しました`,
          success_description: `プロンプトスナップショットをDMに送信しました。`,
          no_personas_title: `ペルソナが見つかりません`,
          no_personas_description: `このサーバーにはペルソナが登録されていません。`,
          build_failed_title: `スナップショット失敗`,
          build_failed_description: `プロンプトスナップショットの生成に失敗しました。もう一度お試しください。`,
          guild_only_title: `サーバー専用`,
          guild_only_description: `このコマンドはサーバーチャンネルでのみ使用できます。`,
        },
      },
    },
    data: {
      export: {
        type_choice_persona_personal_memories: `ペルソナの個人メモリ`,
        type_choice_persona_server_memories: `ペルソナのサーバーメモリ`,
        type_choice_personal_settings: `個人設定`,
        type_choice_server_config: `サーバー設定`,
        type_choice_global_personal_memories: `グローバル個人メモリ`,
        persona_modal_title: `ペルソナを選択`,
        persona_select_label: `ペルソナ`,
        persona_select_description: `記憶データをエクスポートする対象ペルソナを選択してください。`,
        persona_select_placeholder: `ペルソナを選択...`,
        main_persona_description: `メインペルソナ`,
        alter_persona_description: `オルタペルソナ`,
        success_title: `🟢 エクスポート成功`,
        success_description: `{type}データがDMに送信されました！`,
        failed_title: `🔴 エクスポート失敗`,
        failed_description: `データのエクスポートに失敗しました。後でもう一度お試しください。`,
        dm_title: `データエクスポート`,
        dm_description: `リクエストされた{type}データをお送りします！`,
        dm_failed_title: `🔴 DMを送信できませんでした`,
        dm_failed_description: `DMを送信できませんでした。サーバーメンバーからのDMを有効にしてから、もう一度お試しください。`,
        no_permission_title: `🔴 権限がありません`,
        no_permission_description: `サーバーデータをエクスポートするには**サーバー管理**権限が必要です。`,
        error_no_user_data: `ユーザーデータが見つかりません。まずボットとやり取りする必要があるかもしれません。`,
        error_no_server_data: `サーバーがデータベースに見つかりません。まず /config setup を実行してください。`,
        error_no_server_config: `サーバー設定が見つかりません。まず /config setup を実行してください。`,
        error_no_personality_data: `このサーバーの性格データが見つかりません。まず /config setup を実行してください。`,
        error_validation_failed: `エクスポートデータ構造の検証に失敗しました`,
        error_export_failed: `データのエクスポートに失敗しました`,
      },
      import: {
        persona_modal_title: `ペルソナを選択`,
        persona_select_label: `ペルソナ`,
        persona_select_description: `このインポートを適用するペルソナを選択してください。`,
        persona_select_placeholder: `ペルソナを選択...`,
        main_persona_description: `メインペルソナ`,
        alter_persona_description: `オルタペルソナ`,
        success_title: `🟢 インポート成功`,
        success_description: `{type}データを正常にインポートしました！
インポートされたメモリ: {memories_count}
 更新された設定フィールド: {config_count}`,
        failed_title: `🔴 インポート失敗`,
        failed_description: `データのインポートに失敗しました。ファイルを確認してもう一度お試しください。`,
        cancelled_title: `🔴 インポートがキャンセルされました`,
        cancelled_description: `インポートがキャンセルされました。データは変更されていません。`,
        invalid_file_title: `🔴 無効なインポートファイル`,
        invalid_file_description: `インポートファイルの形式が無効または互換性がありません。`,
        no_permission_title: `🔴 権限がありません`,
        no_permission_description: `サーバーデータをインポートするには**サーバー管理**権限が必要です。`,
        error_invalid_memory: `無効なメモリコンテンツ: {details}`,
        error_update_failed: `データベースのユーザーデータの更新に失敗しました`,
        error_import_failed: `データのインポートに失敗しました`,
        error_no_server_data: `サーバーがデータベースに見つかりません。まず /config setup を実行してください。`,
        error_invalid_server_memory: `無効なサーバーメモリコンテンツ: {details}`,
        error_invalid_config: `インポートデータに無効な設定フィールドがあります`,
        error_no_users: `データベースにユーザーが見つかりません。サーバーメモリを帰属できません。`,
        error_not_json: `インポートファイルは有効なJSONオブジェクトである必要があります`,
        error_incompatible_version: `互換性のないインポートバージョン。期待値: {expected}、実際値: {actual}`,
        error_invalid_personal_format: `無効な個人インポートファイル形式`,
        error_invalid_server_format: `無効なサーバーインポートファイル形式`,
        error_invalid_personal_memories_format: `無効な個人メモリインポートファイル形式`,
        error_invalid_server_memories_format: `無効なサーバーメモリインポートファイル形式`,
        error_invalid_personal_settings_format: `無効な個人設定インポートファイル形式`,
        error_invalid_server_config_format: `無効なサーバー設定インポートファイル形式`,
        error_unknown_type: `不明なインポートタイプ: {type}`,
      },
      delete: {
        confirmation_required_title: `確認が必要です`,
        confirmation_required_description: `削除を確認するには確認オプションを選択する必要があります。`,
        success_personal_settings_title: `🟢 個人設定をリセットしました`,
        success_personal_settings_description: `個人設定をデフォルトに戻しました。`,
        success_server_config_title: `🟢 サーバー設定をリセットしました`,
        success_server_config_description: `サーバー設定をデフォルトに戻しました。`,
        no_data_title: `🟡️ データが見つかりません`,
        no_data_description: `データベースに個人データが保存されていません。`,
        no_server_data_title: `🟡️ サーバーデータが見つかりません`,
        no_server_data_description: `このサーバーにはデータが保存されていません。まず \`/config setup\` を実行してください。`,
        no_permission_title: `🔴 権限がありません`,
        no_permission_description: `サーバーデータを削除するには**サーバー管理**権限が必要です。`,
      },
    },
    persona: {
      description: `人格プリセットを管理する`,
      attribute: {
        description: `ペルソナの属性を管理します。`,
        add: {
          description: `ペルソナに属性を追加します。`,
        },
        edit: {
          description: `ペルソナの属性を編集します。`,
          select_modal_title: `属性を選択`,
          select_label: `編集する属性`,
          select_description: `編集する属性を選択してください`,
          select_placeholder: `属性を選択...`,
          confirm_title: `属性を編集しますか？`,
          confirm_description: `次の属性を選択しました:
{attribute}

**確認** を押すと編集モーダルを開きます。`,
          modal_title: `属性を編集`,
          attribute_input_label: `更新後の属性`,
          attribute_input_description: `選択した属性を新しいテキストに置き換えます。`,
          attribute_input_placeholder: `{bot}はマンゴーが好き`,
          attribute_input_part2_label: `属性（後半・任意）`,
          no_changes_title: `変更はありません`,
          no_changes_description: `その属性は既にその内容に設定されています。`,
          duplicate_title: `重複した属性`,
          duplicate_description: `この属性 '{attribute}' は既に私の属性リストにあります。`,
          success_title: `属性を更新しました`,
          success_description: `属性を正常に更新しました: "{attribute}"`,
        },
        remove: {
          description: `ペルソナから属性を削除します。`,
        },
      },
      prompt: {
        description: `ペルソナのプロンプト指示を管理します。`,
        set: {
          description: `ペルソナプロンプトを設定します。`,
        },
        remove: {
          description: `ペルソナプロンプトを削除します。`,
        },
      },
      "sample-dialogue": {
        description: `私がどのように応答すべきかの例として、ユーザー/ボットの対話ペアを追加します。`,
        add: {
          description: `私がどのように応答すべきかの例として、ユーザー/ボットの対話ペアを追加します。`,
        },
        edit: {
          description: `サンプル対話ペアを編集します。`,
          select_modal_title: `サンプル対話を選択`,
          select_label: `編集する対話`,
          select_description: `編集する対話ペアを選択してください`,
          select_placeholder: `対話を選択...`,
          confirm_title: `サンプル対話を編集しますか？`,
          confirm_description: `次の対話ペアを選択しました:
**ユーザー:**
{input}
**私:**
{output}

**確認** を押すと編集モーダルを開きます。`,
          modal_title: `サンプル対話を編集`,
          user_input_label: `ユーザーのセリフ`,
          user_input_description: `ユーザー側の例文を更新します。`,
          user_input_placeholder: `好きな食べ物は何ですか？`,
          user_input_part2_label: `ユーザーのセリフ（後半・任意）`,
          bot_input_label: `私の応答`,
          bot_input_description: `私の応答例を更新します。`,
          bot_input_placeholder: `わ、わたしはマンゴーが好きです…`,
          bot_input_part2_label: `私の応答（後半・任意）`,
          no_changes_title: `変更はありません`,
          no_changes_description: `そのサンプル対話ペアは既にその内容に設定されています。`,
          duplicate_title: `重複したサンプル対話`,
          duplicate_description: `そのサンプル対話ペアは既に存在します。`,
          success_title: `サンプル対話を更新しました`,
          success_description: `対話ペアを正常に更新しました: ユーザー: "{input}" -> ボット: "{output}"`,
        },
        remove: {
          description: `私の記憶からサンプルユーザー/ボットの対話ペアを削除します。`,
        },
      },

      name_conflict_title: `🔴 ペルソナ名の競合`,
      name_conflict_description: `**{name}** という名前のペルソナは既にこのサーバーに存在します。ペルソナ名はサーバー内で一意である必要があります。`,
      export: {
        description: `の人格を共有可能なPNGファイルとしてエクスポートする`,
        export_json_select_label: `JSONをエクスポート`,
        export_json_select_description: `任意：読み取り用JSONファイルとしてエクスポート`,
        persona_modal_title: `ペルソナを選択`,
        persona_select_label: `ペルソナ`,
        persona_select_description: `エクスポートするペルソナを選択してください。`,
        persona_select_placeholder: `ペルソナを選択...`,
        main_persona_description: `メインペルソナ`,
        alter_persona_description: `オルタペルソナ`,
        success_title: `🟢 ペルソナのエクスポートに成功しました`,
        success_description: `ペルソナ **{nickname}** がエクスポートされました！このPNGファイルを他の人と共有して、人格設定を広めましょう。`,
        success_description_json: `ペルソナ **{nickname}** が読み取り用JSONファイルとしてエクスポートされました。

**注意:** このJSONエクスポートは参照用のみで、インポートはできません。`,
        json_non_importable_note: `このJSONエクスポートは参照用のみで、インポートはできません。`,
        failed_title: `🔴 エクスポートに失敗しました`,
        avatar_failed_title: `🔴 アバターのダウンロードに失敗しました`,
        avatar_failed_description: `ペルソナアバターのダウンロードに失敗しました。後でもう一度お試しください。`,
        embed_failed_title: `🔴 PNG処理に失敗しました`,
        embed_failed_description: `PNGファイルへのメタデータの埋め込みに失敗しました。もう一度お試しください。`,
        error_no_server_data: `データベースにサーバーが見つかりません。まず \`/config setup\` を実行してください。`,
        error_no_preset_data: `ペルソナデータが見つかりません。まず /config setup を実行してください。`,
        error_validation_failed: `エクスポートデータ構造の検証に失敗しました`,
        error_export_failed: `ペルソナデータのエクスポートに失敗しました`,
      },
      import: {
        description: `PNGまたはJSONファイルからペルソナをインポートする`,
        file_description: `ペルソナデータを含むPNGまたはJSONファイル`,
        type_description: `メインペルソナまたはオルタペルソナとしてインポート`,
        triggers_description: `任意の追加トリガー（カンマ区切り: "," または "、"）`,
        memories_description: `このペルソナの記憶（ユーザー・サーバー）を引き継ぎますか？`,
        memories_choice_preserve: `はい（ユーザー/サーバー記憶を引き継ぐ）`,
        memories_choice_fork: `いいえ（ユーザー/サーバー記憶を新しく開始する）`,
        type_choice_main: `メインペルソナ（現在の人格を置き換え）`,
        type_choice_alter: `オルタペルソナ`,
        success_title: `🟢 ペルソナのインポートに成功しました`,
        success_description: `ペルソナ **{nickname}** が正常にインポートされました！
属性: {attribute_count}
サンプル対話: {dialogue_count}
トリガーワード: {trigger_word_count}`,
        success_confirmation: `メインペルソナ **{nickname}** が正常にインポートされました！詳細なインポート情報がチャンネルに投稿されました。`,
        nickname_update_success: `サーバーニックネームが更新されました。`,
        nickname_update_failed: `🟡 サーバーニックネームを更新できませんでした。Discordのレート制限が原因である可能性があります。手動で変更してください。`,
        avatar_update_success: `サーバーアバターが更新されました。`,
        avatar_update_skipped_no_image: `🟡 インポートしたファイルにはアバター画像が含まれていなかったため、現在のメインペルソナのアバターをそのまま維持しました。`,
        avatar_update_rate_limited: `🟡 Discordのレート制限によりサーバーアバターは更新されませんでした。手動で変更してください。`,
        avatar_update_failed: `🟡 サーバーアバターを更新できませんでした。Discordのレート制限が原因である可能性があります。手動で変更してください。`,
        alter_success_title: `🟢 オルタペルソナのインポートに成功しました`,
        alter_success_description: `オルタペルソナ **{nickname}** が正常にインポートされました！
固有トリガーワード: {trigger_count}
トリガー: {triggers}

これらのトリガーがメッセージに含まれると、このペルソナが応答します。`,
        alter_success_confirmation: `オルタペルソナ **{nickname}** が {trigger_count} 個の固有トリガーワードで正常にインポートされました！詳細なインポート情報がチャンネルに投稿されました。`,
        alter_avatar_fallback_main: `🟡 このインポートにはアバター画像が含まれていなかったため、このオルタはフォールバックとして **{nickname}** の現在のメインペルソナアバターを使用します。変更したい場合は \`/server avatar\` を使用できます。`,
        alter_avatar_warning: `⚠️ 上記のアバター画像埋め込みを削除しないでください。削除するとオルタペルソナのアバターが失われます。`,
        alter_dm_not_allowed_title: `🔴 DMではオルタペルソナは許可されていません`,
        alter_dm_not_allowed_description: `オルタペルソナはサーバーでのみインポートできます。ダイレクトメッセージではインポートできません。サーバーでこのコマンドを実行してください。`,
        alter_no_triggers_warning: `⚠️ このペルソナにはトリガーワードがありません。\`/server trigger add\`を使用してトリガーを追加するまで、メッセージに応答しません。`,
        alter_name_conflict_title: `🔴 ペルソナ名が既に存在します`,
        alter_name_conflict_description: `**{name}** という名前のペルソナは既にこのサーバーに存在します。各ペルソナには固有の名前が必要です。

インポートファイルを編集して別の名前を使用するか、\`/persona remove\`を使用して既存のペルソナを削除してください。`,
        alter_limit_title: `🔴 ペルソナ上限に達しました`,
        alter_limit_description: `このサーバーには既に {current} 個のペルソナがあります。上限は {max} 個です。\`/persona remove\` でオルタを削除してからインポートしてください。`,
        failed_title: `🔴 インポートに失敗しました`,
        failed_description: `ペルソナのインポートに失敗しました。ファイルを確認してもう一度お試しください。`,
        invalid_file_type_title: `🔴 無効なファイル形式`,
        invalid_file_type_description: `ペルソナデータを含む有効な.pngまたは.jsonファイルをアップロードしてください。`,
        file_too_large_title: `🔴 ファイルが大きすぎます`,
        file_too_large_description: `ファイルが大きすぎます。最大ファイルサイズは10MBです。`,
        download_failed_title: `🔴 ダウンロードに失敗しました`,
        download_failed_description: `添付ファイルのダウンロードに失敗しました。もう一度お試しください。`,
        invalid_png_title: `🔴 無効なPNGファイル`,
        invalid_png_description: `アップロードされたファイルは有効なPNG画像ではありません。`,
        no_metadata_title: `🔴 ペルソナデータが見つかりません`,
        no_metadata_description: `このファイルには対応しているペルソナデータが含まれていません。\`/persona export\`でエクスポートしたファイル、または対応しているSillyTavernキャラクターカードを使用してください。`,
        invalid_file_title: `🔴 無効なペルソナファイル`,
        invalid_file_description: `ペルソナファイル形式が無効または互換性がありません。`,
        no_permission_title: `🔴 権限がありません`,
        no_permission_description: `ペルソナをインポートするには**サーバー管理**権限が必要です。`,
        error_download_timeout: `ファイルのダウンロードがタイムアウトしました。もう一度お試しください。`,
        error_invalid_attribute: `無効な属性内容: {details}`,
        error_invalid_dialogue_in: `無効なサンプル対話(入力): {details}`,
        error_invalid_dialogue_out: `無効なサンプル対話(出力): {details}`,
        error_invalid_trigger_word: `無効なトリガーワード: {details}`,
        error_dialogue_mismatch: `サンプル対話配列の長さが一致しません`,
        error_invalid_config: `ペルソナデータに無効な設定フィールドがあります`,
        error_no_server_data: `データベースにサーバーが見つかりません。まず \`/config setup\` を実行してください。`,
        error_name_conflict: `**{name}** という名前のペルソナは既にこのサーバーに存在します。別の名前を使用してください。`,
        error_import_failed: `ペルソナデータのインポートに失敗しました`,
        error_not_json: `インポートしたファイルには有効なJSONデータが含まれている必要があります`,
        error_incompatible_version: `互換性のないペルソナバージョン。期待: {expected}、実際: {actual}`,
        error_invalid_format: `無効なペルソナファイル形式`,
        error_invalid_type: `無効なペルソナタイプ: {type}。"preset"が期待されます`,
        avatar_update_skipped_dm: `ペルソナは正常にインポートされましたが、アバターとニックネームの更新はダイレクトメッセージでは利用できません。`,
        refresh_reminder: `この会話で人格の更新を適用するには\`/tool refresh\`を実行してください`,
      },
      remove: {
        description: `サーバーからオルタペルソナを削除する`,
        no_permission_title: `🔴 権限がありません`,
        no_permission_description: `オルタペルソナを削除するには**サーバー管理**権限が必要です。`,
        modal_title: `オルタペルソナの削除`,
        select_label: `オルタペルソナ`,
        select_placeholder: `削除するオルタペルソナを選択...`,
        no_alters_error_title: `🟡 オルタペルソナがありません`,
        no_alters_error_description: `削除するオルタペルソナがありません。\`/persona import type:alter\`を使用してオルタペルソナをインポートしてください。`,
        success_title: `🟢 オルタペルソナを削除しました`,
        success_description: `オルタペルソナ **{nickname}** が正常に削除されました。`,
      },
      swap: {
        description: `メインペルソナとオルタペルソナを交換する`,
        no_permission_title: `🔴 権限がありません`,
        no_permission_description: `ペルソナを交換するには**サーバー管理**権限が必要です。`,
        modal_title: `メインペルソナの交換`,
        select_label: `オルタペルソナ`,
        select_placeholder: `メインに昇格させるオルタペルソナを選択...`,
        no_alters_error_title: `🟡 オルタペルソナがありません`,
        no_alters_error_description: `交換するオルタペルソナがありません。\`/persona import type:alter\`を使用してオルタペルソナをインポートしてください。`,
        success_title: `🟢 ペルソナの交換に成功しました`,
        success_description: `**{new_main}** が現在のメインペルソナになりました。
**{old_main}** がオルタペルソナになりました。`,
        nickname_update_success: `サーバーニックネームが更新されました。`,
        nickname_update_failed: `🟡 サーバーニックネームを更新できませんでした。Discordのレート制限が原因である可能性があります。手動で変更してください。`,
        avatar_update_success: `サーバーアバターが更新されました。`,
        avatar_update_rate_limited: `🟡 Discordのレート制限によりサーバーアバターは更新されませんでした。手動で変更してください。`,
        avatar_update_failed: `🟡 サーバーアバターを更新できませんでした。Discordのレート制限が原因である可能性があります。手動で変更してください。`,
        avatar_embed_warning: `⚠️ この埋め込みを削除しないでください。削除すると保存されたアバターURLが失われる可能性があります。`,
        avatar_stored_notice: `以前のメインペルソナのアバターが保存されました。`,
      },
      default: {
        description: `人格設定のペルソナを適用します`,
        type_description: `適用先タイプ（デフォルトまたはオルタ）`,
        type_choice_default: `デフォルトペルソナ`,
        type_choice_alter: `オルタペルソナ`,
        no_permission_title: `🔴 権限がありません`,
        no_permission_description: `人格プリセットを適用するには**サーバー管理**権限が必要です。`,
        modal_title: `人格プリセットの適用`,
        select_label: `人格プリセット`,
        select_description: `適用するプリセットを選択してください。これにより、現在の属性と対話が上書きされます。`,
        select_placeholder: `プリセットを選択...`,
        no_presets_title: `利用可能なプリセットがありません`,
        no_presets_description: `データベースに人格プリセットがありません。\`/support discord\`で報告してください。`,
        preset_not_found: `選択されたプリセットが見つかりませんでした。`,
        success_title: `プリセットが適用されました`,
        success_details_description: `プリセット **{preset_name}** をペルソナ **{nickname}** に適用しました！
属性: {attribute_count}
サンプル対話: {dialogue_count}
トリガーワード ({trigger_word_count}): {triggers}`,
        success_confirmation: `ペルソナ **{nickname}** にプリセットを適用しました。詳細情報をこのチャンネルに投稿しました。`,
        avatar_update_failed: `🟡️ Discord APIエラーによりサーバーアバターを更新できませんでしたが、ペルソナは正常に適用されました。`,
        avatar_update_skipped_dm: `プリセットは正常に適用されましたが、アバター更新はダイレクトメッセージでは利用できません`,
      },
      generate: {
        description: `AIによる人格生成（対応プロバイダーが必要）`,
        modal: {
          title: `AI人格生成`,
          character_name_label: `キャラクター名`,
          character_name_description: `名前をカンマ（"," または "、"）区切りで入力してください。すべてトリガーワードとして追加され、先頭の名前が表示名になります。`,
          character_name_placeholder: `例: 初音ミク, ミク, Hatsune Miku`,
          character_info_label: `キャラクター情報と話し方の例`,
          character_info_description: `キャラクターとその話し方を説明してください`,
          character_info_placeholder: `性格、背景、話し方、例示のフレーズなど`,
          web_search_label: `ウェブ検索を使用しますか？`,
          web_search_description: `キャラクター情報を検索(既存メディアのキャラクター用)`,
          web_search_placeholder: `はいまたはいいえを選択`,
          web_search_yes: `はい、キャラクター情報を検索します`,
          web_search_no: `いいえ、オリジナルキャラクターを作成します`,
          additional_inst_label: `追加の指示`,
          additional_inst_placeholder: `任意：その他の指示（例：「キャラクターの返答は短くしてください」）`,
          file_upload_label: `キャラクター画像 / カード (任意)`,
          file_upload_description: `画像、Tomoriプリセット、またはSillyTavernカードPNGをアップロードして生成・変換`,
        },
        field_character_name: `キャラクター名`,
        field_character_info: `キャラクター情報と話し方の例`,
        field_web_search: `ウェブ検索を使用しますか？`,
        field_additional_inst: `追加の指示`,
        wrong_provider_title: `🔴 互換性のないプロバイダー`,
        wrong_provider_description: `ペルソナ生成には対応プロバイダーが必要です。現在のプロバイダーは **{current_provider}** です。\`/config model text\`で対応プロバイダーに切り替えてください。`,
        no_api_key_title: `🔴 APIキーがありません`,
        no_api_key_description: `有効なプロバイダーが設定されていません。\`/setup\`（初回）または\`/config provider add\`で登録してください。`,
        model_incompatible_title: `互換性のないモデル`,
        model_incompatible_description: `現在のモデル（**{model_name}**）は、ペルソナ生成に必要な**構造化出力**をサポートしていません。

**次のステップ:**
\`/config model text\`を使用して、構造化出力をサポートするモデル（例：「STRUCT」機能を持つモデル）に切り替えてください。`,
        image_vision_required_title: `🔴 画像ビジョンが必要`,
        image_vision_required_description: `画像がアップロードされましたが、現在のモデル（**{model_name}**）は**画像ビジョン**をサポートしておらず、ビジョンモデルも設定されていません。

**次のステップ:**
1. \`/config model vision\`を使用して専用ビジョンモデルを設定する、または
2. \`/config model text\`を使用してビジョン対応モデルに切り替える、または
3. 画像を削除して画像なしで再生成する`,
        vision_model_provider_unsupported_title: `🔴 ビジョンモデルのプロバイダー非対応`,
        vision_model_provider_unsupported_description: `ビジョンモデル（**{vision_model_name}**）はプロバイダー **{vision_provider}** に設定されていますが、このプロバイダーはペルソナプリセット生成に対応していません。

**次のステップ:**
1. \`/config model vision\`を使用して対応プロバイダー（Google、OpenRouter、DeepSeek、Z.ai、Custom、NVIDIA NIM）のビジョンモデルを設定する、または
2. \`/config model text\`を使用してビジョンとプリセット生成の両方に対応したプライマリモデルに切り替える`,
        web_search_tools_required_title: `🔴 ウェブ検索を利用できません`,
        web_search_tools_required_description: `ウェブ検索が選択されましたが、現在のモデル（**{model_name}**）は**ツール**に対応していません。

**次のステップ:**
1. \`/config model text\`を使用してツール対応モデルに切り替える、または
2. ウェブ検索なしで再生成する（質問されたら「いいえ」を選択）`,
        api_key_decrypt_failed_title: `🔴 APIキーエラー`,
        api_key_decrypt_failed_description: `有効なプロバイダー認証情報の復号化に失敗しました。\`/config provider add\`で再設定してください。`,
        invalid_image_title: `🔴 無効な画像`,
        invalid_image_description: `有効な画像ファイル(PNG、JPG、JPEGなど)をアップロードしてください。`,
        error_file_too_large: `アバター画像は8MB以下である必要があります。`,
        error_download_timeout: `アバターのダウンロードがタイムアウトしました。もう一度お試しください。`,
        error_download_failed: `アバター画像のダウンロードに失敗しました。`,
        processing_title: `人格を生成しています...`,
        processing_description: `これには1～2分かかる場合があります。キャラクターを生成していますので、お待ちください...

これは予期しない結果が生成される場合があります。必要に応じて再生成できます。`,
        generation_failed_title: `🔴 生成に失敗しました`,
        generation_failed_description: `人格の生成に失敗しました：{error}

異なる入力で再度お試しいただくか、APIキーを確認してください。`,
        validation_failed_title: `🔴 検証に失敗しました`,
        validation_failed_description: `生成された人格データの検証に失敗しました。もう一度お試しください。`,
        image_processing_failed_title: `🔴 画像処理に失敗しました`,
        image_processing_failed_description: `アップロードされた画像の処理に失敗しました。別の画像をお試しください。`,
        avatar_fetch_failed_title: `🔴 アバターの取得に失敗しました`,
        avatar_fetch_failed_description: `エクスポート用のサーバーアバターの取得に失敗しました。代わりに画像をアップロードしてみてください。`,
        metadata_embed_failed_title: `🔴 エクスポートに失敗しました`,
        metadata_embed_failed_description: `画像に人格データを埋め込むことができませんでした。もう一度お試しください。`,
        success_title: `🟢 {character_name} の生成に成功しました！`,
        success_description: `**{character_name}** の人格を生成しました！
**属性プレビュー:**
{attribute_preview}
**サンプル対話:**
{dialogue_preview}`,
        success_next_steps_title: `次のステップ`,
        success_next_steps_description: `1. 添付されたPNGファイルをダウンロード
2. PNGファイルと共に\`/persona import\`を使用してこのキャラクターをインポート
3. 進行中の会話に新しい人格を適用するには\`/tool refresh\`を実行
4. (任意) 必要に応じて\`/server avatar\`でアバターを変更`,
        avatar_update_skipped_dm: `アバターとニックネームの更新はダイレクトメッセージでインポートできませんのでご注意ください。`,
      },
      create: {
        description: `シンプルな人格プリセットを手動で作成`,
        modal: {
          title: `ペルソナ作成`,
          character_name_label: `キャラクター名`,
          character_name_description: `名前をカンマ（"," または "、"）区切りで入力してください。すべてトリガーワードとして追加され、先頭の名前が表示名になります。`,
          character_name_placeholder: `例: 初音ミク, ミク, Hatsune Miku`,
          character_desc_label: `キャラクター説明`,
          character_desc_placeholder: `キャラクターを説明してください（性格、外見、背景など）`,
          example_user_label: `ユーザーメッセージの例`,
          example_user_description: `ヒント: インポート後に /persona sample-dialogue add で例を追加できます`,
          example_user_placeholder: `こんにちは、{bot}！`,
          example_bot_label: `ボット返信の例`,
          example_bot_placeholder: `こんにちは、{user}！お元気ですか？`,
          file_upload_label: `キャラクター画像 (任意)`,
          file_upload_description: `キャラクターエクスポート用の画像をアップロード`,
        },
        field_character_name: `キャラクター名`,
        field_character_desc: `キャラクター説明`,
        field_example_user: `ユーザーメッセージの例`,
        field_example_bot: `ボット返信の例`,
        invalid_image_title: `🔴 無効な画像`,
        invalid_image_description: `有効な画像ファイル(PNG、JPG、JPEGなど)をアップロードしてください。`,
        error_file_too_large: `アバター画像は8MB以下である必要があります。`,
        error_download_timeout: `アバターのダウンロードがタイムアウトしました。もう一度お試しください。`,
        error_download_failed: `アバター画像のダウンロードに失敗しました。`,
        desc_too_long_title: `説明が長すぎます`,
        desc_too_long_description: `キャラクターの説明が長すぎます（{current_length} 文字）。最大許容長は {max_allowed} 文字です。`,
        example_user_too_long_title: `ユーザーメッセージの例が長すぎます`,
        example_user_too_long_description: `ユーザーメッセージの例が長すぎます（{current_length} 文字）。最大許容長は {max_allowed} 文字です。`,
        example_bot_too_long_title: `ボット返信の例が長すぎます`,
        example_bot_too_long_description: `ボット返信の例が長すぎます（{current_length} 文字）。最大許容長は {max_allowed} 文字です。`,
        validation_failed_title: `🔴 検証に失敗しました`,
        validation_failed_description: `ペルソナデータの検証に失敗しました。もう一度お試しください。`,
        image_processing_failed_title: `🔴 画像処理に失敗しました`,
        image_processing_failed_description: `アップロードされた画像の処理に失敗しました。別の画像をお試しください。`,
        avatar_fetch_failed_title: `🔴 アバターの取得に失敗しました`,
        avatar_fetch_failed_description: `エクスポート用のサーバーアバターの取得に失敗しました。代わりに画像をアップロードしてみてください。`,
        metadata_embed_failed_title: `🔴 エクスポートに失敗しました`,
        metadata_embed_failed_description: `画像に人格データを埋め込むことができませんでした。もう一度お試しください。`,
        success_title: `🟢 {character_name} の作成に成功しました！`,
        success_description: `**{character_name}** のペルソナが作成されました！
**説明:**
{character_description}`,
        success_dialogue_title: `サンプル対話`,
        success_next_steps_title: `次のステップ`,
        success_next_steps_description: `1. 添付されたPNGファイルをダウンロード
2. PNGファイルと共に\`/persona import\`を使用してこのキャラクターをインポート
3. 進行中の会話に新しい人格を適用するには\`/tool refresh\`を実行
4. (任意) 必要に応じて\`/server avatar\`でアバターを変更`,
        avatar_update_skipped_dm: `アバターとニックネームの更新はダイレクトメッセージでは利用できませんのでご注意ください。`,
      },
      rename: {
        no_permission_title: `🔴 権限がありません`,
        no_permission_description: `サーバーでこのコマンドを使用するには、**サーバー管理**権限が必要です。`,
        description: `このサーバーでの私の名前を変更します。`,
        modal_title: `ペルソナ名の変更`,
        persona_select_label: `ペルソナ`,
        persona_select_description: `名前を変更するペルソナを選択してください。`,
        persona_select_placeholder: `ペルソナを選択...`,
        main_persona_description: `メインペルソナ`,
        alter_persona_description: `オルタペルソナ`,
        new_name_input_label: `新しい名前`,
        new_name_input_description: `新しい名前を入力してください（2〜32文字）。`,
        new_name_input_placeholder: `新しいペルソナ名を入力...`,
        invalid_length_title: `無効な名前の長さ`,
        invalid_length: `名前は2〜32文字でなければなりません。`,
        already_set_title: `名前は既に設定済みです`,
        already_set_description: `私の名前は既に \`{nickname}\` に設定されています。`,
        success_title: `名前が更新されました`,
        success_description: `私の名前が \`{old_nickname}\` から \`{new_nickname}\` に変更されました。`,
        success_with_trigger_description: `私の名前が \`{old_nickname}\` から \`{new_nickname}\` に変更されました。トリガーワードもそれに合わせて更新されました。`,
        success_with_discord_description: `私の名前が \`{old_nickname}\` から \`{new_nickname}\` に変更され、サーバーのニックネームも更新されました！`,
        success_with_trigger_and_discord_description: `私の名前が \`{old_nickname}\` から \`{new_nickname}\` に変更されました。トリガーワードとサーバーのニックネームが更新されました！`,
        nickname_update_failed_footer: `注：サーバーのニックネーム更新に失敗しました（「ニックネームの変更」権限が必要な場合があります）。`,
        partial_success_title: `名前は更新されましたが問題あり`,
        partial_success_description: `私の名前は \`{new_nickname}\` に変更されましたが、一部のトリガーワードの更新に失敗しました。`,
      },
    },
    help: {
      "personal-provider": {
        description: `個人プロバイダーの仕組みを確認します。`,
        title: `個人プロバイダー`,
        description_body: `個人プロバイダーを使うと、サーバー既定の設定ではなく、あなた自身のAPIキーとモデルでメッセージを処理できます。`,
        setup_field: `設定手順`,
        setup_value: `1. {add_command} でプロバイダーを保存します。\n2. {model_command} でモデルを選びます。\n3. {toggle_command} でその機能を有効にします。`,
        behavior_field: `動作`,
        behavior_value: `有効にすると、その機能ではサーバー設定より個人プロバイダーが優先されます。思考ログにはその旨が記録され、{samplers_command} と {fallback_command} で調整できます。`,
        byok_field: `BYOKサーバー`,
        byok_value: `{byok_command} により、メンバー自身のプロバイダーが必須になるサーバーがあります。このモードでは、ユーザー発言に対する応答に個人プロバイダーが必要です。`,
        footer: `個人プロバイダー設定は、TomoriBot を使うすべてのサーバーで共通です。`,
      },
      custom_models: {
        description: `カスタムエンドポイントの使い方を確認します。`,
        endpoint_description: `表示するカスタムエンドポイントのガイドを選びます。`,
        choice_overview: `概要`,
        choice_comfyui: `ComfyUI`,
        title: `カスタムエンドポイント`,
        description_body: `カスタムエンドポイントを使うと、Ollama、LM Studio、LiteLLM、ComfyUI などの自己ホスト/プロキシ型エンドポイントをラベル付きプロバイダーバンドルとして登録できます。`,
        server_field: `サーバー登録`,
        server_value: `{add_command} でサーバー共通のエンドポイントを登録し、{remove_command} でそのラベルから選んだ機能だけ削除できます。`,
        personal_field: `個人登録`,
        personal_value: `{add_command} で自分専用のラベル付きエンドポイントを登録し、{remove_command} で選んだ機能だけ削除できます。`,
        selection_field: `使い方`,
        selection_value: `登録後は {text_command}、{image_command}、{video_command} からラベルを選択してください。画像理解対応のテキストエンドポイントは \`/config model vision\` にも表示されます。`,
        labels_field: `ラベルと削除`,
        labels_value: `1つのラベルは対応する全機能をまとめたカスタムプロバイダーバンドルです。{server_remove_command} と {personal_remove_command} はチェックを外した機能だけ削除します。{server_provider_remove_command} と {personal_provider_remove_command} はそのラベル全体を削除します。`,
        comfyui_page1_title: `ComfyUI セットアップ`,
        comfyui_page1_description: `このガイドでは、ComfyUI がすでにインストール済みかつ起動中である前提で進めます。1ページ目では、\`/config custom-endpoint add\` または \`/personal custom-endpoint add\` まで到達する最小構成を説明します。または、GitHubリポジトリにあるそのまま使える[ComfyUIワークフロー](https://github.com/Bredrumb/TomoriBot/tree/main/scripts/comfyui-workflows)を使用することもできます。`,
        comfyui_page1_workflow_field: `1. ワークフローを作る`,
        comfyui_page1_workflow_value: `まず ComfyUI 側でワークフローを作成し、正常に動くことを確認してください。画像用 MVP では、TomoriBot が完成ファイルを取得できるよう最後を \`SaveImage\` で終える必要があります。最小構成の画像グラフは通常、\`CheckpointLoaderSimple\` -> positive/negative \`CLIPTextEncode\` -> \`EmptyLatentImage\` -> \`KSampler\` -> \`VAEDecode\` -> \`SaveImage\` です。`,
        comfyui_page1_placeholders_field: `2. プレースホルダーを入れる`,
        comfyui_page1_placeholders_value: `テキスト入力欄には \`{TOMORI_PROMPT}\` をそのまま使えます。TomoriBot は、アップロードした API 形式 JSON 内の対応済み \`{TOMORI_*}\` トークンを実行前に置換します。文字列プレースホルダーは長い文章の一部として埋め込めますが、数値や真偽値は通常 JSON の値全体を置き換える形で使います。`,
        comfyui_page1_export_field: `3. JSON を書き出して編集する`,
        comfyui_page1_export_value: `ComfyUI で動作確認できたら Save (API Format) で JSON を保存してください。数値や真偽値のプレースホルダーを使う場合は、アップロード前に JSON を編集し、値全体をプレースホルダーに置き換えます。例: \`"width": "{TOMORI_WIDTH}"\`、\`"height": "{TOMORI_HEIGHT}"\`、\`"duration": "{TOMORI_VIDEO_DURATION}"\`。`,
        comfyui_page1_register_field: `4. 登録して有効化する`,
        comfyui_page1_register_value: `サーバー共通なら {server_add_command}、個人用なら {personal_add_command} を使います。\`endpoint_url\` には ComfyUI サーバーの URL（例: \`http://127.0.0.1:8188\`）を入れ、\`api_style\` は \`ComfyUI\`、\`capability\` は \`Image\` か \`Video\` を選択してください。コマンド実行後に表示されるモーダルの **ワークフローJSON** ファイル欄に書き出した JSON をアップロードします。その後、{image_command} または {video_command} でラベルを選択して有効化します。`,
        comfyui_page2_title: `ComfyUI プレースホルダー`,
        comfyui_page2_description: `2ページ目では、TomoriBot が ComfyUI ワークフローへ注入できる主なプレースホルダーをまとめます。`,
        comfyui_page2_core_field: `基本値`,
        comfyui_page2_core_value: `基本プレースホルダー: \`{TOMORI_PROMPT}\`、\`{TOMORI_MODEL}\`、\`{TOMORI_MODEL_NAME}\`、\`{TOMORI_MODE}\`、\`{TOMORI_ASPECT_RATIO}\`、\`{TOMORI_SIZE}\`。\`{TOMORI_MODE}\` は \`image\` または \`video\` に解決され、\`{TOMORI_SIZE}\` は \`1024x1024\` や \`1280x720\` のような文字列になります。`,
        comfyui_page2_numeric_field: `画像サイズ`,
        comfyui_page2_numeric_value: `サイズ系プレースホルダー: \`{TOMORI_WIDTH}\` と \`{TOMORI_HEIGHT}\`。画像生成では、TomoriBot が要求されたアスペクト比からこれらを導出します。latent サイズやキャンバスサイズなど、JSON 上で数値を期待する欄に使ってください。`,
        comfyui_page2_video_field: `動画用引数`,
        comfyui_page2_video_value: `動画用プレースホルダー: \`{TOMORI_VIDEO_DURATION}\`、\`{TOMORI_DURATION_SECONDS}\`、\`{TOMORI_VIDEO_RESOLUTION}\`、\`{TOMORI_RESOLUTION}\`、\`{TOMORI_GENERATE_AUDIO}\`。これらは \`generate_video\` ツールの引数から解決されます。`,
        comfyui_page3_title: `ComfyUI Img2Img`,
        comfyui_page3_description: `3ページ目では、画像参照つきのフローと img2img 的な扱いを説明します。`,
        comfyui_page3_image_refs_field: `参照画像の集め方`,
        comfyui_page3_image_refs_value: `\`generate_image\` では、\`media_id\` で参照した Discord メッセージ内の全画像が追加され、\`target_identity\` を使うとユーザーまたはペルソナのアバターも追加参照として渡せます。\`generate_video\` では、\`media_id\` で参照したメッセージの最初の画像だけが開始フレーム候補になります。`,
        comfyui_page3_reference_tokens_field: `参照画像プレースホルダー`,
        comfyui_page3_reference_tokens_value: `TomoriBot は \`{TOMORI_REFERENCE_IMAGE_COUNT}\`、\`{TOMORI_REFERENCE_IMAGES}\`、\`{TOMORI_REFERENCE_IMAGES_JSON}\` に加えて、\`{TOMORI_REFERENCE_IMAGE_1_DATA_URL}\`、\`{TOMORI_REFERENCE_IMAGE_1_BASE64}\`、\`{TOMORI_REFERENCE_IMAGE_1_MIME_TYPE}\`、URL がある場合は \`{TOMORI_REFERENCE_IMAGE_1_URL}\` も渡します。複数ある場合は \`_2_\`、\`_3_\`… と同じ形式で増えます。`,
        comfyui_page3_reference_note_field: `重要な注意点`,
        comfyui_page3_reference_note_value: `TomoriBot は参照画像データをワークフロー JSON に運べますが、標準 ComfyUI ノードはその文字列を自動で \`IMAGE\` テンソルに変換しません。参照画像プレースホルダーは、data URL・base64・JSON 配列を読めるカスタムノードやノードパックと組み合わせる前提だと考えてください。`,
        comfyui_page4_title: `ComfyUI 動画と出力`,
        comfyui_page4_description: `4ページ目では、動画フロー、保存出力、メタデータについて説明します。`,
        comfyui_page4_video_field: `動画フロー`,
        comfyui_page4_video_value: `動画ワークフロー実行時、TomoriBot はプレースホルダーを解決した後に ComfyUI の \`/prompt\` へグラフを POST し、\`/history/{prompt_id}\` をポーリングし、最初に保存されたファイルを \`/view\` から取得します。認証つき ComfyUI エンドポイントには、保存済み Bearer トークンもこれらの API 呼び出しへ送られます。`,
        comfyui_page4_output_field: `保存出力`,
        comfyui_page4_output_value: `TomoriBot が取得するのは最初に保存された出力だけなので、ワークフローは実際に画像または動画ファイルを保存する必要があります。プレビュー専用ノードだけでは不十分です。複数保存した場合は、ComfyUI の history で最初に報告されたものが返されます。`,
        comfyui_page4_metadata_field: `extra_pnginfo メタデータ`,
        comfyui_page4_metadata_value: `TomoriBot は、解決済みの値を \`extra_pnginfo\` にも入れます。そこには prompt、model、mode、aspect ratio、width、height、size、参照画像数、さらに動画用の duration・resolution・audio フラグも含まれます。JSON プレースホルダーの代わりに ComfyUI メタデータを読むカスタムノードを使いたい場合に有用です。`,
      },
      speech: {
        description: `音声生成の設定方法を確認します。`,
        engine_description: `音声エンジンのガイドを選択します。`,
        docs_title: `詳細ドキュメント`,
        docs_description: `コピー用のセットアップ手順とラッパーの注意点については、GitHub上の[TTSドキュメント](https://github.com/Bredrumb/TomoriBot/tree/main/docs/integrations/tts)と[スクリプトのREADME](https://github.com/Bredrumb/TomoriBot/blob/main/scripts/tts/README.md)を確認してください。`,
        overview: {
          title: `音声生成の概要`,
          description: `音声エンドポイントを使うと、ローカル音声クローンまたはElevenLabsでDiscordボイスメッセージを送信できます。ローカルクローンの場合、どの音声形式でも自動でモノラルWAVに変換されます。BGMなしの10〜20秒のクリップを推奨します。`,
          steps_title: `設定フロー`,
          steps_description: `ローカル: ラッパーサーバーを起動し、{custom_endpoint_add} で登録、{model_speech} で選択、{voice_add} でサンプル追加、{voice_assign} で割り当てます。\n\nElevenLabs: {elevenlabs} を実行し、追加ペルソナは後で {voice_assign} を使います。\n\n**エンジン別設定ガイド:**\n• Chatterbox-Turbo → \`/help speech engine:Chatterbox-Turbo\`\n• Qwen3-TTS → \`/help speech engine:Qwen3-TTS\`\n• IrodoriTTS → \`/help speech engine:IrodoriTTS\`\n• ElevenLabs → \`/help speech engine:ElevenLabs\``,
        },
        chatterbox: {
          title: `Chatterbox-Turbo 音声`,
          description: `Chatterbox-Turbo は高速・軽量な英語専用の音声クローンサーバーです。\`[excited]\`・\`[whisper]\` のような角括弧デリバリータグで発話スタイルを制御できます。TomoriBotがこれらのタグをそのまま送信できるように、登録時は **Script Markup（スクリプトマークアップ）** を **Bracket Tags（角括弧タグ）** に設定してください。`,
          steps_title: `設定手順`,
          steps_description: `**前提条件**: Python 3.10+、CUDA 12.x + ドライバー（任意、GPU 用）

1. GitHubリポジトリからマシンに [TTSスクリプト](https://github.com/Bredrumb/TomoriBot/tree/main/scripts/tts) をダウンロードします。
2. ダウンロードした \`chatterbox\` フォルダに移動し、Python \`.venv\` を作成して有効化します。
3. numpy を先にインストールします: \`pip install numpy\`、その後 \`requirements.txt\` をインストールします。
4. *(GPU のみ)* PyTorch を再インストールします: \`pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124\`
5. \`server.py\` を起動します。
6. {custom_endpoint_add} で登録します。Capability（機能）は \`Speech\`、API Style（API スタイル）は \`TTS-Clone\`、Script Markup（スクリプトマークアップ）は \`Bracket Tags\` を選択します。
7. {model_speech} で選択し、{voice_add} と {voice_assign} を実行します。`,
        },
        qwen3tts: {
          title: `Qwen3-TTS 音声`,
          description: `Qwen3-TTS 12Hz Base は中国語・英語・日本語・韓国語・ドイツ語・フランス語・ロシア語・ポルトガル語・スペイン語・イタリア語の 10 言語に対応した多言語音声クローンサーバーです。同じ Qwen3-TTS サーバーで、自然言語の声質説明を使う VoiceDesign モデルを起動したり、1つのエンドポイントURLでクローンと VoiceDesign のリクエストを自動判定したりできます。どのモードも感情マークアップなしのプレーンテキストのみ受け付けます。登録時は **Script Markup（スクリプトマークアップ）** を **Plain（通常テキスト）** に設定してください。`,
          steps_title: `設定手順`,
          steps_description: `**前提条件**
• Python 3.10+
• SoX をシステムにインストール（Windows: \`scoop install sox\`、macOS: \`brew install sox\`）
• CUDA 12.x + ドライバー（任意、GPU 用）

1. GitHubからマシンに [TTSスクリプト](https://github.com/Bredrumb/TomoriBot/tree/main/scripts/tts) をダウンロードします。
2. ダウンロードした \`qwen3tts\` フォルダに移動し、Python \`.venv\` を作成して有効化します。
3. \`requirements.txt\` をインストールします。
4. *(GPU)* PyTorch を再インストール: \`pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124\`
5. *(任意)* 高速化のため flash-attn をインストール — 手順 4 の後 \`pip install wheel\`、次に \`pip install flash-attn --no-build-isolation\` (Winは20-40分)。初回はスキップ。
6. 音声クローンには \`server.py\`、Qwen3-TTS VoiceDesign のみには \`server.py --mode voice-design\`、1つのURLでリクエストごとにクローン/VoiceDesignを判定するには \`server.py --mode auto\` を起動します。
7. {custom_endpoint_add} で登録: Capability（機能）は \`Speech\`、API Style（API スタイル）は \`TTS-Clone\`、Script Markup（スクリプトマークアップ）は \`Plain\` を選択。VoiceDesign では音声ソースモードに \`VoiceDesign\` を選ぶと、TomoriBot が自動的に instruct 対応として扱います。auto モードでは、同じサーバーURLを指すクローン用と VoiceDesign 用のエンドポイントを登録できます。
8. {model_speech} で選択します。クローンモードでは {voice_add} と {voice_assign}、VoiceDesign では各ペルソナに {voice_design_set} を実行します。`,
        },
        irodoritts: {
          title: `IrodoriTTS 音声`,
          description: `IrodoriTTS は日本語特化の音声クローンサーバーです。テキスト中に埋め込んだ絵文字（例: 😊 = 喜び、😢 = 悲しみ）を感情キューとして読み取ります。登録時は **Script Markup（スクリプトマークアップ）** を **Emoji Markers（絵文字マーカー）** に設定してください。TomoriBot が角括弧タグを除去し、モデルが期待する絵文字マーカーだけを残します。`,
          steps_title: `設定手順`,
          steps_description: `**前提条件**: Python 3.10+、CUDA 12.x + ドライバー（任意、GPU 用）

1. GitHubからマシンに [TTSスクリプト](https://github.com/Bredrumb/TomoriBot/tree/main/scripts/tts) をダウンロードします。
2. ダウンロードした \`irodoritts\` フォルダに移動し、Python \`.venv\` を作成して有効化します。
3. \`requirements.txt\` をインストールします。
4. パッチスクリプトで irodori-tts をインストール（上流のバグ対処）:
Windows: \`install-irodori.ps1\`
Linux/macOS: \`bash install-irodori.sh\`
5. *(GPU)* PyTorch を再インストール: \`pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124\`
6. \`server.py\` を起動します。
7. {custom_endpoint_add} で登録: Capability（機能）は \`Speech\`、API Style（API スタイル）は \`TTS-Clone\`、Script Markup（スクリプトマークアップ）は \`Emoji Markers\` を選択。
8. {model_speech} で選択し、{voice_add} と {voice_assign} を実行します。`,
        },
        elevenlabs: {
          title: `ElevenLabs 音声`,
          description: `ElevenLabs も同じ音声エンドポイント機構を使いますが、ショートカットコマンドで設定できます。`,
          steps_title: `設定手順`,
          steps_description: `{elevenlabs} に ElevenLabs APIキーを指定して実行します。音声生成と文字起こしエンドポイントを登録・選択します。その後 {voice_assign} で各ペルソナに声を割り当てます。`,
        },
      },
      transcription: {
        description: `音声文字起こしの設定方法を確認します。`,
        engine_description: `文字起こしエンジンのガイドを選択します。`,
        docs_title: `詳細ドキュメント`,
        docs_description: `ローカルサーバー設定の詳細については、GitHub上の[Transcriptionドキュメント](https://github.com/Bredrumb/TomoriBot/tree/main/docs/integrations/transcription)と[STTのREADME](https://github.com/Bredrumb/TomoriBot/blob/main/scripts/stt/README.md)を確認してください。`,
        overview: {
          title: `文字起こしの概要`,
          description: `文字起こしエンドポイントは、音声添付を内部会話コンテキスト用のテキストに変換します。見える形で投稿する字幕は {speech_transcripts} で別途制御します。`,
          steps_title: `推奨経路`,
          steps_description: `まず WhisperX を推奨します。\`scripts/stt\` の参照サーバーを起動し、{custom_endpoint_add} で登録してから {model_transcription} で選択します。ElevenLabs ユーザーは {elevenlabs} を実行します。\n\n**エンジン別設定ガイド:**\n• WhisperX → \`/help transcription engine:WhisperX\`\n• KoboldCPP → \`/help transcription engine:KoboldCPP\`\n• ElevenLabs → \`/help transcription engine:ElevenLabs\``,
        },
        whisperx: {
          title: `WhisperX 文字起こし`,
          description: `WhisperX は推奨ローカルSTT経路です。FFmpeg のシステムインストールが必要で、CUDA による GPU 高速化にも対応しています。`,
          steps_title: `設定手順`,
          steps_description: `**前提条件**
• Python 3.10+
• FFmpeg をシステムにインストール（必須）
• CUDA 12.x + ドライバー（任意、GPU 高速化用）

1. GitHubからマシンに [STTスクリプト](https://github.com/Bredrumb/TomoriBot/tree/main/scripts/stt) をダウンロードします。
2. ダウンロードした \`stt\` フォルダに移動し、Python \`.venv\` を作成して有効化します。
3. \`requirements-whisperx.txt\` をインストールします。
4. *(GPU)* CUDA 対応 PyTorch を再インストール:
\`pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124\`
5. \`whisperx_server.py\` を起動します。
6. {custom_endpoint_add} で登録: Capability（機能）は \`Transcription\`、API Style（API スタイル）は \`OpenAI Compatible\` を選び、選択したサイズのモデル名を指定します。
7. {model_transcription} で選択します。`,
          models_title: `利用可能なモデル`,
          models_description: `サーバー起動前に \`WHISPERX_MODEL\` を指定し、登録時も同じ名前を使います。\nGPU は **float16** · CPU は **int8**（バイト数が半分なので CPU RAM < GPU VRAM）\n\n\`tiny\` — VRAM 約0.5 GB / RAM 約200 MB\n\`base\` — VRAM 約0.5 GB / RAM 約300 MB\n\`small\` — VRAM 約1 GB / RAM 約600 MB\n\`medium\` — VRAM 約2 GB / RAM 約1.5 GB\n\`large-v3\` — VRAM 約4–5 GB / RAM 約2.5 GB *(デフォルト、最高精度)*\n\`large-v3-turbo\` — VRAM 約2–3 GB / RAM 約1.5 GB *(VRAM が少ない場合に推奨)*\n\n文字起こしは約100言語に対応（自動検出）。`,
        },
        koboldcpp: {
          title: `KoboldCPP 文字起こし`,
          description: `KoboldCPP のSTT対応は、利用しているビルドが公開するHTTPエンドポイント形状に依存します。`,
          steps_title: `設定メモ`,
          steps_description: `OpenAI互換の \`/v1/audio/transcriptions\` を公開している場合は {custom_endpoint_add} で登録できます。異なるエンドポイントだけの場合は、専用アダプターが入るまでラッパーを使ってください。`,
        },
        elevenlabs: {
          title: `ElevenLabs 文字起こし`,
          description: `ElevenLabs の文字起こしは音声ショートカットで自動登録されます。`,
          steps_title: `設定手順`,
          steps_description: `{elevenlabs} を実行します。音声生成と文字起こしの両方を登録・選択します。チャットに見える字幕を投稿したい場合だけ {speech_transcripts} を使います。`,
        },
      },
      "custom-endpoint": {
        description: `カスタムエンドポイントの使い方を確認します。`,
      },
      features: {
        description: `TomoriBotができることを表示`,
        title: `TomoriBotの機能（バージョン {version}）`,
        embed_description: `これが私の全機能です：`,
        vision_title: `ビジョン＆メディア`,
        vision_description: `- 画像、動画、スタンプ、絵文字を見て分析できます
- YouTubeリンクから動画を視聴できます
- 共有された埋め込み（ツイート、記事など）の内容を見ることができます`,
        search_title: `検索＆情報 `,
        search_description: `- 最新情報をウェブ検索できます
- 画像、動画、ニュース検索も可能です（\`/optional-key brave set\`経由）
- URLからコンテンツを取得して読むことができます`,
        personality_title: `パーソナリティ＆カスタマイズ`,
        personality_description: `- \`/config rename\`と\`/server avatar\`で名前とアバターを変更できます
- \`/persona\`で異なるペルソナに切り替えられます（\`/persona export\`でペルソナを共有・保存もできます！）
- アルターペルソナとして複数のキャラクターが同一サーバーで共存し、それぞれ独自のトリガーとウェブフックアバターを持てます
- \`/persona attribute add\`、\`/persona sample-dialogue add\`、\`/persona prompt set\`で行動やトーンを調整できます
- \`/config system-prompt\`でカスタムシステムプロンプトを設定し、行動をさらに形張ることができます
- 詳しくは\`/help customization\`をご覧ください`,
        memory_title: `記憶＆パーソナライゼーション`,
        memory_description: `- ユーザーやサーバーに関する事実を記憶し、会話を跨いで保持します
- 個人的な記憶は全サーバーで保持されます（他のサーバーでも私に話しかけてみて！）
- 最近の会話はSTM（短期記憶）として保持し、チャンネルやサーバーをまたいで文脈を把握します（クロスサーバー共有は\`/personal stm\`でオプトインできます）
- \`/personal nickname\`であなたを呼ぶ名前を変更できます
- \`/memory\` と \`/persona\` コマンドで手動で記憶やペルソナ情報を追加・削除できます
- \`/server initialize expressions\`で絵文字やステッカーを登録すると、より適切な場面で使えるようになります
- \`/personal privacy\`で完全に見えなくなるオプションが利用可能です
- 詳しくは\`/help memory\`をご覧ください`,
        time_title: `時間認識`,
        time_description: `- サーバーの現在時刻を認識しています（\`/config timezone\`経由）
- リマインダーを設定できます（何かを思い出させるように頼んでみて！）
- 繰り返しリマインダーもサポートされており、ペルソナ固有です`,
        alter_title: `アルターペルソナ`,
        alter_description: `- アルターペルソナを使って、一つのサーバーに複数のキャラクターが共存できます
- それぞれのアルターは独自のパーソナリティを持ち、特定のキーワードでトリガーされます
- アルターペルソナは異なるアバターのためにウェブフックを使用します
- 一つのメッセージで複数のアルターを同時にマッチできます（\`/config trigger-match-limit\`の上限まで）
- ウェブフックメッセージに返信すると、そのペルソナとして会話が続きます
- \`/persona import\`（アルターオプション）と\`/persona remove\`でアルターを管理できます`,
        expressions_title: `表情＆リアクション`,
        expressions_description: `- サーバーのカスタム絵文字を会話で自然に使えます（大文字小文字不問の \`:名前:\` 形式）
- 返信の一部としてスタンプを送れます
- 関連する絵文字でメッセージにリアクションできます
- \`/server initialize expressions\`で絵文字とスタンプを登録すると精度が向上します`,
        documents_title: `ドキュメント知識庫`,
        documents_description: `- \`/memory document add\`でテキスト、PDF、Markdownファイルをサーバー知識としてアップロードできます
- \`/memory history import\`でチャンネル履歴を検索可能な知識として抽出できます
- 質問に答える際に、私は関連するドキュメント内容を取得して参照します
- チャットで共有されたファイル添付（PDF、ソースコード、Markdown、JSON、YAMLなど）も直接読み取れます、読んでと頼むだけ！
- 埋め込みモデルが必要です（\`/config model embedding\`で設定）
- \`/memory document remove\`と\`/memory history remove\`で保存済みドキュメントを削除できます`,
        impersonation_title: `なりきり＆ツール`,
        impersonation_description: `- \`/bot impersonate\`で自分自身、ペルソナ、またはシステムメッセージとしてメッセージを送信できます
- \`/personal impersonate prompt\`でユーザーなりきり用の再利用プロンプトを設定できます
- \`/tools compact\`で会話履歴を要約したりロールプレイで圧縮できます
- \`/bot respond\`でボットから定型文や案内付きメッセージを送信できます`,
        imagegen_title: `画像生成`,
        imagegen_description: `- テキストプロンプトから画像を生成し、参照画像を編集することもできます
- Text2ImageとImage2Imageをカスタマイズタブルなアスペクト比で対応
- \`/generate image\`を使うか、画像を生成してほしいと頼むだけで動作します
- 参照画像としてメッセージの添付ファイル、ステッカー、絵文字、ユーザーアバターを使えます
 - Google、Vertex AI、Vertex AI Express、OpenRouter、Z.ai、NVIDIA NIMプロバイダーで利用可能（\`/config model image\`で設定）`,
        videogen_title: `動画生成`,
        videogen_description: `- テキストプロンプトから短い動画を生成し、参照画像をアニメーション化することもできます
- Text2VideoとImage2Videoをカスタマイズ可能なアスペクト比で対応
- \`/generate video\`を使うか、動画を生成してほしいと頼むだけで動作します
- 参照画像としてメッセージの添付ファイルやユーザーアバターを使えます
- Google、OpenRouter、Z.aiプロバイダーで利用可能（\`/config model video\`で設定）`,
        footer: `すべての機能がすべてのAIプロバイダーで利用できるわけではありません。推奨：Google Gemini。私に直接何ができるか聞いてみることもできます！`,
      },
      setup: {
        description: `TomoriBotの初期設定方法を学ぶ`,
        title: `TomoriBotを始める`,
        embed_description: `サーバー（またはDM）でTomoriBotを設定する方法：`,
        step1_title: `ステップ1：APIキーを取得`,
        step1_description: `TomoriBotは複数のAIプロバイダーに対応しています。いずれかのAPIキーが必要です。
- {helpApikey}で取得方法を確認
  - **Google Gemini** — 汎用、無料枠あり、すべての機能を実行可能
  - **OpenRouter** — 多数のAIモデルに一箇所でアクセス
  - **NovelAI** — 無検閲なロールプレイとストーリーテリング特化
  - **DeepSeek** — コスト効率の高い推論モデル
  - **NVIDIA NIM** — NVIDIAホスト型モデル
  - **Anthropic** — Claudeモデル
  - **Vertex AI** — ADC経由のGoogle Cloudモデル
  - **Vertex AI Express** — Express Mode経由のGoogle Cloud APIキーBYOK（Preview、Gemini限定）
  - **Z.ai (Zhipu)** — 中国のAIモデル、コーディングプランあり ⚠️ *利用規約でコーディング/エージェントのシナリオのみに制限*
  - **Custom** — OpenAI互換エンドポイント（Ollama、vLLM、LiteLLMなど）
- このAPIキーを**他人と共有しないでください**
- Customエンドポイントはセットアップ後に{configApiKeySet}または{configProviderSwitch}でBearer認証トークンを追加可能`,
        step2_title: `ステップ2：セットアップコマンドを実行`,
        step2_description: `- {configSetup}を使用してAPIキーを安全に追加し、TomoriBotを初期化
- （推奨）{serverInitializeExpressions}を実行して、サーバーの絵文字/スタンプ表現を適切に使えるようにする
	- APIキーは暗号化されて安全に保存されます
	- 各サーバーには独自の設定があります`,
        step3_title: `ステップ3：チャットを始める！`,
        step3_description: `- メンションするか、私のメッセージに返信するだけでチャットできます
- {serverTrigger}でトリガー方法を変更できます
- 記憶システムで会話を記憶します（{configPermissions}で無効化できます！）
- {serverAutotrigger}で自動トリガーを設定し、メンションなしでチャットできます`,
        step4_title: `オプション：カスタマイズする`,
        step4_description: `- {persona}コマンドで私のパーソナリティを完全に変更（アルターペルソナも含む！）
- {server}、{personal}、{memory}、{config}コマンドで設定を調整
- {memory}で記憶やドキュメント、{persona}で振る舞いを調整できます
- ドキュメントアップロード、APIキーローテーション、検閲なしモードなどの高度な機能も探してみてください`,
        need_help_title: `ヘルプが必要ですか？`,
        need_help_description: `- {helpFeatures} - 私ができることを見る
- {helpMemory} - 記憶システムについて学ぶ
- {helpCustomization} - パーソナリティのカスタマイズについて学ぶ
- {supportServer} - 公式TomoriBotサポートサーバーに参加

TomoriBotをセットアップすることで、あなたとサーバーメンバーは\`/legal terms\`と\`/legal privacy\`の通知に同意したことになります`,
      },
      matrix: {
        description: `Matrixブリッジの設定方法と使い方を学ぶ`,
        title: `Matrixブリッジガイド`,
        embed_description: `MatrixルームをDiscordチャンネルにリンクする方法と、現在Matrix側で使える機能の案内です。`,
        bot_user_fallback: `設定されているMatrixボットアカウント`,
        setup_title: `セットアップ`,
        setup_description: `1. 暗号化されていないMatrixルームに {botUserId} を招待します。
2. そのルームの Internal Room ID を確認します。
3. ブリッジしたいDiscordチャンネルで {serverMatrixLink} を実行し、そのルームIDを貼り付けます。`,
        room_id_title: `ルームIDの確認方法`,
        room_id_description: `多くのMatrixクライアントでは Room Settings -> Advanced -> Internal Room ID から確認できます。
IDの形式は \`!abc:matrix.org\` のようになります。

ボットが招待を受け入れると、Matrixルームにも短い案内を送りますが、リンク完了には引き続きDiscord側で {serverMatrixLink} を実行する必要があります。`,
        usage_title: `Matrixからの使い方`,
        usage_description: `- ルームをリンクした後は、Matrixで普通に話しかければ使えます
- Matrixのメッセージはリンク先のDiscordチャンネルにWebhookとして転送されます
- TomoriBotの返信はMatrixルームにも戻ってきます
- Matrix側で使えるテキストコマンドは /kill と /refresh のみです`,
        limitations_title: `現在の制限`,
        limitations_description: `- MatrixからSlash Commandは使えません
- DM / DM経由のクールダウン通知は使えません
- Matrixユーザーのプロフィール画像はTomoriBotから見えません
- メッセージのピン留めはできません
- カスタム絵文字やMarkdownは安定して描画されません
- Embedはプレーンテキストとして転送されます
- Matrixユーザーの個人メモリは属性付きのサーバーメモリにフォールバックします`,
        troubleshooting_title: `注意事項`,
        troubleshooting_description: `- ボットが自動参加しない場合は {botUserId} を手動で招待し、必要なら {serverMatrixLink} を再実行してください
- Matrixの暗号化は後から無効化できないため、暗号化済みルームは使えず、新しい非暗号化ルームが必要です
- 上に書かれていない制限は基本的に動作する想定なので、動かない場合は {supportServer} で報告してください`,
      },
      data: {
        description: `データ管理とプライバシーについて学ぶ`,
        title: `データの管理`,
        embed_description: `データの管理方法と保存内容：`,
        export_title: `データのエクスポート`,
        export_description: `{memoryPersonalExport}、{memoryServerExport}、{personalConfigExport}、{serverConfigExport}を使ってデータをダウンロード：
- **ペルソナの個人メモリ / グローバル個人メモリ**
- **ペルソナのサーバーメモリ**
- **個人設定**
- **サーバー設定**
- **ペルソナ本体** は {personaExport} で別途エクスポート
- データはJSONファイルとしてDMに送信されます`,
        import_title: `データのインポート`,
        import_description: `{memoryPersonalImport}、{memoryServerImport}、{personalConfigImport}、{serverConfigImport}を使ってエクスポートしたデータを復元：
- エクスポートファイルの種類を自動判別します
- メモリ系ファイルは「ペルソナ」または「グローバル」適用先を選択します
- サーバー系インポートにはサーバー管理権限が必要です
- コマンド使用時にエクスポートしたファイルを添付するだけ`,
        delete_title: `データの削除`,
        delete_description: `{memoryPersonalRemove}、{memoryServerRemove}、{personalConfigRemove}、{serverConfigRemove}を使用してデータを完全に削除またはリセット：
- **ペルソナの個人メモリ** / **グローバル個人メモリ**
- **ペルソナのサーバーメモリ**
- **個人設定** / **サーバー設定のリセット**
- この操作は元に戻せません！`,
        privacy_title: `プライバシー通知`,
        privacy_description: `**保存するもの：**
- サーバー/個人の記憶
- 私の設定とペルソナ
- 私のサーバー設定
- 暗号化されたAPIキー

**保存しないもの：**
- Discordメッセージ
- チャット履歴

**選択したAIプロバイダーに送信されるもの：**
トリガーされるたびに、AIモデルが返信を形成するためのコンテキストとして、テキストチャンネルの**最新メッセージ**と**関連する記憶**を取得します。これらのトリガー以外でメッセージを積極的に監視したり閲覧したりすることはありません。

{personalPrivacy}コマンドで記憶機能をオプトアウトし、{configPermissions}コマンドで自己学習を無効化できます。`,
        footer: `選択したAIプロバイダー（Google、NovelAI、OpenRouter）は独自のプライバシーポリシーに従ってメッセージを処理します。プライバシーのため、個人情報を共有しないでください。詳細は\`/legal privacy\`と\`/legal terms\`をご覧ください`,
      },
      "st-preset": {
        description: `この環境でのSillyTavernプリセットの挙動を学ぶ`,
        embed1_title: `この環境でのSillyTavernプリセット`,
        embed1_description: `{stPresetImport}でPrompt Managerプリセットを読み込み、{stPresetToggle}で有効ノードを確認し、{stPresetRemove}で通常レイアウトに戻せます。`,
        embed1_controls_title: `プリセットが制御するもの`,
        embed1_controls_description: `- プロンプト順序とマーカー配置
- カスタムプロンプトノード
- post-history / depth injection ノード
- インポート時に有効・無効で始まるノード`,
        embed1_still_sent_title: `それでも完全には置き換えないもの`,
        embed1_still_sent_description: `- 現在の system/persona 系ブロックは残ります: {configSystemPromptSet}、{personaPromptSet}、{personaAttributeAdd}、{personaSampleDialogueAdd}
- ライブ会話履歴と取得済み文書コンテキストも残ります
- Tomori専用の自動コンテキストも残ります: サーバーメモリ、絵文字/ステッカー文脈、会話参加者一覧、STM、conditioning など`,
        embed1_mapping_title: `ネイティブブロックの対応関係`,
        embed1_mapping_description: `- \`main\` は通常、現在の system prompt バケットを置きます: 設定済みなら {configSystemPromptSet}、なければ組み込みのフォールバック
- \`charDescription\` は通常 {personaPromptSet} を置きます
- \`charPersonality\` は通常 {personaAttributeAdd} を置きます
- \`dialogueExamples\` は通常 {personaSampleDialogueAdd} を置きます
- \`chatHistory\` は通常ライブ会話履歴を置きます
- \`worldInfoBefore\` / \`worldInfoAfter\` は通常、ST lorebook ではなく取得済み文書コンテキストを置きます`,
        embed1_system_prompt_title: `システムプロンプトのルール`,
        embed1_system_prompt_description: `- プリセットが有効な間は、組み込みのフォールバック用システムプロンプトは外れます
- {configSystemPromptSet} で自分のシステムプロンプトを設定していれば、それは送信されます
- STの感覚では、プリセットが制御するのはレイアウトであって、すべてのプロンプト供給元ではありません`,
        embed1_footer: `プリセットを読み込んだ後でも /help st-preset でいつでも確認できます`,
        embed2_title: `よくある意外な挙動`,
        embed2_description: `「無視された」「位置がおかしい」と感じやすい主な理由です。

- インポートされたからといって必ず送信されるとは限りません。 \`prompt_order\` で無効なノードは {stPresetToggle} で有効にするまで送られません
- コメント専用ノードや \`{{trim}}\` の結果が空になるノードは送信されません
- 有効なノードに未対応マクロが残っている場合、インポート結果で警告が出ます。そのタグはそのまま送信されたり、ここでは別の挙動になることがあります
- 未対応のマーカーはスキップされます
- 順序は文字どおりです。 \`chatHistory\` を \`dialogueExamples\` より前に置くと、ライブ会話が先に来ます
- 基本は \`character_id: 100001\` の \`prompt_order\` を使い、\`100001\` がない場合だけ \`100000\` にフォールバックします
- サンプル会話が最後になると、厳格なプロバイダーが例文を続けないよう短い区切り文が追加されます`,
        embed2_footer: `何か足りないように見えるときは、{stPresetToggle} のノード一覧と元JSONを見比べてください`,
        embed3_title: `制限と互換性`,
        embed3_description: `- post-history / depth injection は独立したメッセージとして挿入されず、既存の会話履歴項目にマージされます
- 同じ深さのノードはまとめて1つに束ねられます
- \`{{setvar}}\` と \`{{addvar}}\` は有効ノードの順番どおりに動きますが、変数はプリセット全体で共有されます
- 多くの native ブロックは削除ではなく移動です: \`main\`、\`charDescription\`、\`charPersonality\`、\`dialogueExamples\`、\`chatHistory\`、\`worldInfo\` マーカーは、Tomori 側の system prompt、persona prompt、性格属性、サンプル会話、ライブ履歴、取得済み文書を再配置します
- 実際に抑制されるのは限られています: {configSystemPromptSet} を設定していない場合だけ組み込みフォールバック system prompt が外れ、native の \`charDescription\` / \`charPersonality\` はカスタムノードが \`{{description}}\` / \`{{personality}}\` を展開したときだけスキップされます
- Tomori専用の自動ブロックは ST マーカーの所有物ではありません: サーバー情報・記憶・絵文字/ステッカー文脈は \`main\` / \`charDescription\` / \`charPersonality\` の後で flush され、会話参加者一覧・STM・conditioning・余った RAG は \`dialogueExamples\` / \`chatHistory\` の前で flush されます
- {botImpersonate} によるユーザーなりきりではプリセットが無視され、通常レイアウトが使われます
- \`context.story_string\` + \`sysprompt.content\` を使う古い text-completions プリセットは、ベストエフォートの変換経路でインポートされます
- その legacy 変換ではメインのシステムプロンプト、story layout、post-history は取り込みますが、\`persona\`、\`scenario\`、アンカー、stop strings、古いバックエンド設定などの ST 専用要素は引き続き無視されます
- modern Prompt Manager プリセット上にある追加の legacy \`post_history\` フィールドも一部取り込みます
- regex後処理、プリセット側の temperature/top_p/モデル上書き、多段プリセットは未対応です
- \`worldInfo\` マーカーは ST lorebook ではなく、取得された文書コンテキストを使います
- プリセットに明示的なSTマーカーを置かなくても、一部の自動サーバー/文脈ブロックは挿入されることがあります
- プロバイダー差も残ります。assistant prefill は効くプロバイダーもあれば無視するものもあります`,
        embed3_footer: `{stPresetRemove} でプリセットモードをすぐ無効化できます`,
      },
      "api-key": {
        description: `AIプロバイダーのAPIキー設定方法を学ぶ`,
        provider_description: `AIプロバイダーを選択`,
        provider_choice_brave: `Brave Search`,
        provider_choice_google: `Google Gemini`,
        provider_choice_deepseek: `DeepSeek`,
        provider_choice_custom: `カスタムエンドポイント`,
        provider_choice_nvidia: `NVIDIA NIM`,
        provider_choice_novelai: `NovelAI`,
        provider_choice_openrouter: `OpenRouter`,
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
        brave_footer: `メインAIプロバイダーの設定については、他の\`/help api-key\`オプションを確認してください`,
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
- ネイティブ画像生成はNVIDIAホストの \`ai.api.nvidia.com\` Stabilityエンドポイントを使用します`,
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
- ⚠️ Z.aiの利用規約がコーディング/エージェントのシナリオのみに制限されました — 一般チャットでの使用は自己責任です`,
        zai_footer: `このプロバイダーを設定したら、{configModel}でデフォルトモデルを変更できます`,
        novelai_title: `NovelAI APIキーの設定`,
        novelai_description: `NovelAIはクリエイティブなストーリーテリングとロールプレイに焦点を当てたサブスクリプションベースのサービスです。
- 無制限の無検閲メッセージ
- 現在、テキスト生成のみをサポートしています（ビジョンやアシスタント機能はありません）。
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
- TomoriBotをローカル（PC）で実行している開発者やユーザーに最適
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
- すべてのVertexリクエストはPCのGoogle Cloud CLI IDを使用します
- ⚠️ \`gen-lang-client-\` で始まるプロジェクトはGoogle AI Studioが自動生成したもので、Vertex AIでは**使用できません**。上記の手順でプロジェクトを作成してください。
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
      memory: {
        description: `TomoriBotの記憶システムについて学ぶ`,
        title: `記憶の仕組み`,
        embed_description: `会話を跨いでユーザーやサーバーに関する事実や情報を記憶する永続的な記憶システムがあります！これは**私が知っていること**（事実、コンテキスト、情報）についてです。**私がどう振る舞うか**（パーソナリティ、トーン、設定）については、代わりに{helpCustomization}をご覧ください！`,
        teaching_title: `物事を教える`,
        teaching_description: `{memoryPersonalAdd}と{memoryServerAdd}を使用して**事実と情報**を記憶させます：
- **個人的な記憶**（{memoryPersonalAdd}）：個々のユーザーに関する事実
  - 例：「Alexは猫が好き」、「ダークモードを好む」、「ピーナッツアレルギー」
- **サーバーの記憶**（{memoryServerAdd}）：サーバー全体に関連する情報
  - 例：「ゲームナイトは毎週金曜日午後8時」、「NSFWの投稿禁止」、「お知らせには#generalを使用」`,
        forgetting_title: `忘れること`,
        forgetting_description: `{memoryPersonalRemove}と{memoryServerRemove}を使用して記憶を削除：
- {memoryPersonalRemove} - ユーザーに関する個人的な事実を削除
- {memoryServerRemove} - サーバー全体の情報を削除`,
        how_it_works_title: `仕組み：`,
        how_it_works_description: `- **個人的な記憶**は全サーバーであなた専用に紐付けられ、あなたが積極的に参加している会話で返信する際にのみ記憶します
- **サーバーの記憶**はサーバー内にのみ留まり、サーバー内の会話で返信する際に常に記憶します
- 記憶は対応する\`/memory ... remove\`コマンドを使用するまで保持されます`,
        tips_title: `記憶のヒント：`,
        tips_description: `- 好み、ニックネーム、重要な事実を教えてください
- サーバーの記憶には共有情報、内輪ネタ、サーバー文化を使用
- {memoryPersonalExport}、{memoryServerExport}、または{status}で定期的に記憶を確認
- 最良の結果を得るために記憶を簡潔明瞭に保つ

**プライバシー:** データ処理の詳細は\`/legal privacy\`をご覧ください`,
        documents_title: `ドキュメント知識庫`,
        documents_description: `サーバー管理者は参照用のドキュメントをアップロードできます：
- \`/memory document add\`でテキスト、PDF、Markdownファイルをアップロード
- \`/memory history import\`でチャンネル履歴をドキュメント記憶として抽出
- ドキュメントは検索可能な埋め込みとして分割して保存されます
- 会話に基づいて私は自動的に関連する内容を取得します
- \`/memory document remove\`または\`/memory history remove\`で保存済みドキュメントを削除
- \`/config model embedding\`で埋め込みモデルの設定が必要`,
        shortterm_title: `短期記憶`,
        shortterm_description: `永続的な記憶に加え、最近の会話はSTM（短期記憶）として保持しています：
- 最近のメッセージはチャンネルごとにキャッシュされ、各ペルソナは同じサーバー内の他チャンネルにも最新のSTMを持ち越します
- 古い会話を自動的に要約し、文脈を効率的に保つことができます
- **クロスサーバー共有**はオプトイン制です：{personalStm}の\`crossserver\`オプションを使うと、あなた自身の他サーバーでの会話も参照できるようになります
- {personalStmClear}でユーザー固有のSTMをすべて削除できます
- STMは時間とともに自動的に期限切れになります`,
      },
      spotlight: {
        description: `パーソナルスポットライトの仕組みと使い方を学ぶ`,
        title: `パーソナルスポットライトガイド`,
        embed_description: `パーソナルスポットライトを使うと、特定のチャンネルで**あなた自身**がトリガーできるペルソナを絞り込み、必要ならそのチャンネル専用の自動トリガーペルソナも設定できます。`,
        what_title: `何をする機能か`,
        what_description: `- スポットライトは **あなた + 1チャンネル** 単位で適用されます
- 他のユーザーには影響しません
- そのチャンネル専用の個人向けペルソナホワイトリストのように動きます
- その場で使えるペルソナを自分で選べます`,
        set_title: `設定方法`,
        set_description: `{personalSpotlightSet} を使って、次を選びます：
- 継続時間（時間）
- 対象チャンネル
- スポットライトに含めたいペルソナ

**hours = 0** にすると、手動で消すまで永続になります。`,
        auto_trigger_title: `自動トリガーの設定`,
        auto_trigger_description: `ペルソナを選んだ後、その中から1人を個人用の自動トリガーペルソナとして設定できます。
- そのチャンネルでは、そのペルソナがあなたのメッセージに対する既定の応答役になります
- 明示的に別ペルソナを直接トリガーした場合は、そちらが優先されます
- Finish を押した場合は、自動トリガーペルソナは設定されません`,
        rules_title: `重要なルール`,
        rules_description: `- スポットライトはアクセスを**狭めるだけ**で、広げることはありません
- {serverWhitelistPersona} などのサーバー側制限もそのまま適用されます
- 選んだペルソナだけがそのチャンネルでトリガー可能です
- 代理トリガー連鎖も防がれます。たとえばAliceだけを選んでいる場合、Aliceの返信からBobへ受け渡すことはできません`,
        manage_title: `変更・削除するには`,
        manage_description: `{personalSpotlightManage} で現在のスポットライト一覧を確認できます。
- チェックを残すと維持
- チェックを外すと削除
- 時間制スポットライトは期限が来ると自動で消えます`,
        footer: `サーバー全体の設定を変えずに、特定チャンネルで自分向けに応答ペルソナを絞りたいときに使ってください。`,
      },
      "deliberate-trigger-mode": {
        description: `明示的トリガーモードで何が変わるかを学ぶ`,
        title: `明示的トリガーモードガイド`,
        embed_description: `明示的トリガーモード（DTM）は、ペルソナの明示的トリガーとして何を認めるかを変える設定です。特に通常のトリガーワードの扱いが変わります。`,
        normal_title: `通常時のトリガー`,
        normal_description: `DTMがオフのとき、Tomoriは通常次の方法で反応できます：
- メッセージ中の通常のトリガーワード
- Discordメンション
- そのペルソナへのリプライ
- 手動返信用の {botRespond}

いちばん大きい違いは、通常のトリガーワードだけでもペルソナを直接起動できることです。`,
        enabled_title: `DTMオンで変わること`,
        enabled_description: `DTMがオンになると、通常のトリガーワードは明示的なペルソナトリガーとして扱われなくなります。
- \`@{trigger}\` は引き続き有効
- Discordメンションは有効
- リプライは有効
- {botRespond} は有効

つまり、普段の会話で偶然ペルソナ名が出ただけでは起動せず、より意図的な呼びかけが必要になります。`,
        personal_title: `サーバー設定と個人設定`,
        personal_description: `- サーバー全体のDTMは {serverDtm} で切り替えられます
- 個人ごとの上書きは {personalDtm} で設定できます
- 個人DTMには3つのモードがあります：
  off = いつでも通常のトリガーワードを許可
  follow = サーバー設定に従う
  on = いつでも明示的な呼びかけだけを許可`,
        footer: `普段の会話でペルソナ名や短いトリガー語がよく出てしまい、誤反応が多いならDTMが有効です。`,
      },
      "deliberate-tool-mode": {
        description: `明示的ツールモードでツール利用がどう変わるかを学ぶ`,
        title: `明示的ツールモードガイド`,
        embed_description: `明示的ツールモードは、メッセージがツールを必要としているように見える場合だけ、通常会話ターンにツール宣言を含めます。`,
        what_title: `何をするか`,
        what_description: `明示的ツールモードが有効な場合、まずメッセージに明示的なツール意図があるか確認します。意図が見つからない場合、そのターンではツール宣言を外します。これによりプロンプト量が減り、小型・ローカルモデルの応答が速くなります。`,
        intent_title: `ツール意図として扱われるもの`,
        intent_description: `組み込みトリガーは、リマインダー、Web検索、メモリー更新、クロスチャンネルメッセージ、画像・動画・音声生成、メディア解析、スレッド作成、メッセージ操作などの一般的な依頼を扱います。

最近の文脈がツールを示している場合は、\`do that again but angrier\`、\`same thing but softer\`、音声メッセージ依頼の後の \`pretty please?\` などのフォローアップ表現も使えます。`,
        custom_title: `カスタムトリガーフレーズ`,
        custom_description: `サーバー管理者は {triggerCommand} でリテラルなフレーズを追加できます。たとえば \`pic\`、\`img\`、\`pfp\` を画像生成に対応させたり、サーバー独自の言い回しを適切なツール対象へ対応させたりできます。`,
        control_title: `制御とログ`,
        control_description: `- サーバー管理者は {serverDtm} で切り替えられます
- ユーザーは {personalDtm} で自分向けに上書きできます
- {thoughtLogs} で思考ログチャンネルが設定されている場合、明示的ツールモードで実際に使われたツールと、そのツールを表示させたトリガーがそこに記録されます`,
        footer: `明示的ツールモードは、どのツールをモデルに見せるかを決めます。見せられたツールを実際に呼ぶかどうかは、モデル側の判断です。`,
      },
      customization: {
        description: `TomoriBotのパーソナリティと動作をカスタマイズする方法を学ぶ`,
        embed1_title: `TomoriBotのカスタマイズ`,
        embed1_description: `TomoriBotは高度にカスタマイズ可能です！私を本当にあなたのものにするために設定できるすべてがここにあります。これは**私がどう振る舞うか**（パーソナリティ、トーン、設定）についてです。**私が記憶していること**（事実、記憶）については、代わりに{helpMemory}をご覧ください！`,
        embed1_personas_title: `パーソナリティペルソナ`,
        embed1_personas_description: `私の核となるパーソナリティと動作を制御：

**ペルソナコマンド：**
- {personaCreate} - ゼロからカスタムパーソナリティを作成
- {personaGenerate} - 説明と画像に基づいてAIがパーソナリティを生成（構造化出力に対応したプロバイダーが必要。TomoriプリセットやSillyTavernカードをアップロードして既存キャラクターを変換することも可能）
- {personaDefault} - デフォルトのパーソナリティに切り替え
- {personaExport} - ペルソナを共有またはバックアップ用にエクスポート
- {personaImport} - ファイルからペルソナをインポート（独自のトリガーとウェブフックアバターを持つアルターペルソナとしてインポートも対応）
- {personaRemove} - アルターペルソナを削除
- {personaAttributeAdd} / {personaSampleDialogueAdd} - 話し方や行動を教える
- {serverAvatar} - プロフィール画像を変更`,
        embed1_what_personas_include_title: `ペルソナに含まれるもの：`,
        embed1_what_personas_include_description: `- パーソナリティ属性（特性、特徴、癖）
- サンプル対話（話し方を教える会話例）
- そのパーソナリティ用のカスタムサーバーアバター
- 動作とトーンの設定
- アルターペルソナ：独自のトリガー、ウェブフックアバター、パーソナリティを持つ別キャラクター`,
        embed1_footer: `次：教えるコマンド`,
        embed2_title: `教えるコマンド `,
        embed2_description: `## ペルソナ学習コマンド（\`/persona\`）
パーソナリティと知識を微調整：

**パーソナリティの形成：**
- {personaAttributeAdd} - パーソナリティの特性を追加（例：「フレンドリー」、「皮肉っぽい」、「フォーマル」）
- {personaSampleDialogueAdd} - 話し方を形作る会話例を追加
- {configRename} - 自分を何と呼ぶべきかを設定

**サンプル対話の書き方：**
例で\`{user}\`と\`{bot}\`のプレースホルダーを使用：
- \`{user}\` = 実際のユーザーの名前/ニックネームに置き換えられます
- \`{bot}\` = 私の現在の名前に置き換えられます

**例：**
\`\`\`
ユーザーメッセージ：{user}：やあ、元気？
ボットの応答：{bot}：よぉ{user}！超元気だぜ、わかるだろ？
\`\`\`

**優れたサンプル対話のヒント：**
- 自然で会話的なやり取りを書く
- 表現したいパーソナリティの特性を含める
- 望むトーンを示す
- より良く学習できるように多様性を追加
- \`/persona export\`で共有する際にみんなに使えるようプレースホルダーを使用`,
        embed2_footer: `次：設定`,
        embed3_title: `設定＆管理`,
        embed3_description: `## 削除コマンド（\`/persona\`）
パーソナリティのカスタマイズを削除：

- {personaAttributeRemove} - 特定のパーソナリティ属性を削除
- {personaSampleDialogueRemove} - サンプル対話の例を削除

---

## サーバー設定（\`/server\`）
サーバー全体の設定と動作：

**学習＆プライバシー：**
- {serverMemberpermissions} - 誰が私に物事を教えられるかを制御
- {serverBlacklist} - 特定のユーザーから学習したり記憶を使用するのを防ぐ

**自動トリガー動作：**
- {serverAutotriggerChannels} - メンションなしで応答するチャンネルを設定
- {serverAutotriggerThreshold} - 自動応答のメッセージ閾値を設定

**トリガー＆外観：**
- {serverTriggerAdd} - 反応するカスタムトリガーワードを追加（アルターペルソナにも対応しています）
- {serverTriggerRemove} - トリガーワードを削除
- {serverAvatar} - このサーバー用のカスタムプロフィール画像を設定

**チャンネルホワイトリスト＆クールダウン：**
- {configCooldown} - 私の応答間のグローバルクールダウンを設定
- {serverWhitelistChannel} - チャンネルをホワイトリストに追加（ホワイトリストされたチャンネルのみが私をトリガーできます）
- {serverWhitelistPersona} - ペルソナがトリガーできるチャンネルを制限
- {serverWhitelistRole} - ロールホワイトリストにロールを追加/削除
- {serverWhitelistRemove} - ホワイトリスト項目を削除
- ホワイトリストされたチャンネルは、チャンネル固有の上書きを設定しない限りグローバルクールダウンを継承します

**ドキュメント：**
- {memoryDocumentAdd} - 参照用のドキュメントをアップロード
- {memoryDocumentRemove} - アップロードされたドキュメントを削除`,
        embed3_footer: `次：ボット設定`,
        embed4_title: `詳細設定`,
        embed4_description: `## ボット設定（\`/config\`）
個人的なボット設定：

**AI設定：**
- {configModel} - 使用するAIモデルを選択
- {configTemperature} - 創造性/ランダム性を調整。高いほど応答がより多様に（1.0-2.0）
- {configHumanizer} - 応答の人間らしさを変更

**画像生成：**
- {generateImage} - プロンプトから画像を生成し、参照画像を編集する
- {configModelImage} - 画像生成モデルを選択（Text2ImageとImage2Image対応）

**システムプロンプト：**
- {configPromptChange} - カスタムシステム指示を追加（最大16000文字）
- {configPromptPreset} - プリセットシステムプロンプトを選択
- {configPromptClear} - デフォルトシステムプロンプトにリセット

**APIキー：**
- {configApikeySet} - AIプロバイダーのAPIキーを設定
- {configApikeyDelete} - APIキーを削除
- {configApikeyRotation} - 自動フェイルオーバーとロード分散用のバックアップAPIキーを管理
- {configBraveapiSet} - Brave Search APIキーを設定（オプション）
- {configBraveapiDelete} - Brave Search APIキーを削除

**パーソナライゼーション：**
- {configRename} - 自分を何と呼ぶかを変更
- {configTimezone} - 時間認識応答とリマインダー用のタイムゾーンを設定
- {configPermissions} - 機能のオン/オフを切り替え（画像生成を含む）
- {configUncensors} - 検閲なし出力オプションを設定
- {personalPrivacy} - 私への視認性を制御（完全に見えなくなるオプション利用可能）
- {serverInitializeExpressions} - サーバーの絵文字とステッカーの見た目を登録し、適切な場面で使えるようにする

**ドキュメント知識庫：**
- {configModelEmbedding} - ドキュメントアップロードとRAG用の埋め込みモデルを設定`,
        embed4_footer: `他に質問があれば、\`/support discord\`でサポートサーバーに参加してください`,
        embed5_title: `プロのヒント`,
        embed5_description: `- ペルソナ（デフォルトまたは生成）を基盤として始める
- 素早くパーソナリティを調整するには\`/persona attribute add\`を使用
- サンプル対話では、属性や特性も示す例を使用すると効果的：
\`\`\`
ユーザーメッセージ：{user}：お気に入りの趣味は？
ボットの応答：{bot}：ふふ〜小さなぬいぐるみに小さな服を編むのが好きです〜♥
\`\`\`
- チャットして変更をテストし、しっくりくるまで繰り返す
- ペルソナをエクスポートしてバックアップするか、他のサーバーと共有！`,
      },
      updates: {
        description: `TomoriBotの最新リリース情報を表示`,
        title: `TomoriBot {version} リリース！`,
        no_notes: `このバージョンのリリースノートはありません。`,
        footer: `更新情報が古い可能性があります。最新のリリースと更新は \`/support discord\` を確認してください。`,
        fetch_error_title: `最新リリース情報の取得に失敗`,
        fetch_error_description: `GitHubから最新リリース情報を取得できませんでした。しばらくお待ちください。または、[GitHubリリース](https://github.com/Bredrumb/TomoriBot/releases)ページを直接確認してください。`,
      },
      mcp: {
        description: `MCPツールサーバーの追加と管理方法を学ぶ`,
        title: `MCPサーバーセットアップガイド`,
        description_text: `MCP（Model Context Protocol）サーバーは、外部ツールでTomoriの機能を拡張します。始め方を説明します。`,
        online_title: `オンラインMCPの追加`,
        online_description: `HTTPSエンドポイントを持つ公開MCPサーバーであれば、どれでも追加できます。Smithery.aiはその一例に過ぎません。

**Smithery.aiを使う場合：**
**1.** [smithery.ai](https://smithery.ai) にアクセスし、アカウントを作成してプロフィールからAPIキーを生成します。
**2.** カタログを閲覧し、追加したいMCPを開きます。ページに表示されている**接続URL**をコピーします（例：\`https://youtube.run.tools\`）。
**3.** {configMcpAdd} を実行し、**URL**フィールドに接続URLを、**認証トークン**フィールドにSmithery APIキーを貼り付けます。

**他のソースを使う場合：**
認証が不要なMCPサーバーの場合は、**認証トークン**フィールドを空白のままにしてください。サーバーによっては別の認証形式を使用する場合があります。詳細はそのサーバーのドキュメントを確認してください。

認証トークンは保存後に暗号化され、平文で表示されることはありません。`,
        local_title: `ローカルMCPの追加（自己ホスト限定）`,
        local_description: `ローカルMCPサーバーは、**自己ホストのTomoriBotインスタンスでのみ対応しています**。公式ホスト版のbotはセキュリティのためHTTPSが必要で、ローカル/プライベートアドレスはブロックされます。

自己ホストの場合は、ローカルサーバーのURLを指定してください（例：\`http://localhost:3000/sse\`）。ローカルサーバーには認証トークンは不要です。`,
        removing_title: `MCPサーバーの削除`,
        removing_description: `{configMcpRemove} を使えば、いつでもサーバーの登録を解除できます。削除すると即座に接続が切断され、新しいサーバーのスロットが解放されます。`,
        security_title: `セキュリティに関する警告`,
        security_description: `**信頼できるMCPサーバーのみ追加してください。**

悪意のあるMCPサーバーは以下のことが可能です：
- **プロンプトインジェクション** — Tomoriへ隠し指示を送り、動作を操作する
- **データ漏洩** — ツールに渡されたデータ（メッセージやファイル内容など）を外部へ送信する
- **有害または虚偽の結果** を返し、Tomoriがそれをサーバーに中継する

MCPサーバーはブラウザ拡張機能やサードパーティアプリと同様の注意を持って扱ってください。不安な場合は追加しないでください。`,
        footer: `Smithery.aiはサードパーティのサービスであり、TomoriBotとは無関係です。追加前に必ずMCPの提供ツールを確認してください。`,
      },
      nsfw: {
        description: `年齢制限コマンド（NSFW）を有効にする方法を学ぶ`,
        title: `年齢制限コマンドの有効化`,
        embed_description: `TomoriBotは年齢制限コマンドに対応しています。有効化方法は以下の通りです：`,
        enable_title: `ステップ1：Discordの設定で有効化`,
        enable_description: `**1.** Discordを開いて **ユーザー設定** （左下の歯車アイコン）を開く
**2.** **プライバシーとセーフティ** に移動
**3.** **アプリのコマンドで年齢制限付きコンテンツを許可する** をオンにする
**4.** 有効化すると、NSFWコマンドが利用可能になります

注：この設定を有効にするには18歳以上である必要があります。`,
        channel_title: `ステップ2：NSFWチャンネルで使用`,
        channel_description: `年齢制限コマンドはNSFWとしてマークされたチャンネルでのみ実行可能です：
- デスクトップ：チャンネルを右クリック → **チャンネル編集** → **NSFW** をオン
- モバイル：チャンネル設定 → **NSFW** をオン
- NSFWのマークはサーバー管理者のみが変更できます

チャンネルがNSFWでない場合はコマンド実行時に権限エラーが表示されます。`,
        warning_title: `⚠️ コンテンツ警告`,
        warning_description: `年齢制限コマンドは **成人向けのコンテンツ** を含む場合があります。これらのコマンドは18歳以上の利用者を対象としています。責任を持って使用し、Discordコミュニティガイドラインを守ってください。`,
        footer: `その他のヘルプについては \`/help\` を使用して、利用可能なコマンドをご確認ください。`,
      },
    },
    legal: {
      privacy: {
        description: `TomoriBotのプライバシーポリシーを表示`,
        title: `プライバシーポリシー`,
        description_text: `TomoriBotのプライバシーポリシーを表示して、データの取り扱いについて理解してください。これは公式ホスト版インスタンスに適用されます。セルフホスト版インスタンスは独自のデータ処理を制御します。`,
        link_title: `完全なプライバシーポリシー`,
      },
      terms: {
        description: `TomoriBotの利用規約を表示`,
        title: `利用規約`,
        description_text: `TomoriBotの利用規約を表示して、ボットの使用に関するルールとガイドラインを理解してください。これは公式ホスト版インスタンスに適用されます。セルフホスト版インスタンスはAGPLv3ライセンスに準拠します。`,
        link_title: `完全な利用規約`,
      },
      license: {
        description: `TomoriBotのオープンソースライセンスを表示`,
        title: `オープンソースライセンス`,
        description_text: `TomoriBotはGNU Affero General Public License v3.0（AGPLv3）の下でライセンスされたオープンソースソフトウェアです。このライセンスにより、コードを自由に使用、変更、配布できますが、公開ホストされたインスタンスへの変更もオープンソース化する必要があります。`,
        link_title: `完全なAGPLv3ライセンス`,
      },
    },
    novelai: {
      "character-reference": {
        description: `自分またはペルソナ用のNovelAIキャラクター参照画像を保存またはクリアします。`,
        target_description: `自分のプロフィールかサーバーのペルソナかを選択します。`,
        image_description: `保存する参照画像。空欄で現在の画像をクリアします。`,
        persona_select_title: `ペルソナを選択`,
        invalid_image_title: `無効な画像`,
        invalid_image_description: `キャラクター参照画像には画像添付ファイルを指定してください。`,
        download_failed_title: `ダウンロードに失敗しました`,
        download_failed_description: `選択した画像添付のダウンロードに失敗しました。もう一度お試しください。`,
        conversion_failed_title: `画像変換に失敗しました`,
        conversion_failed_description: `保存用にその画像をPNGへ変換できませんでした。別の画像をお試しください。`,
        success_title: `キャラクター参照画像を更新しました`,
        success_me_description: `あなたのNovelAIキャラクター参照画像を更新しました。`,
        success_persona_description: `**{persona_name}**のNovelAIキャラクター参照画像を更新しました。`,
        cleared_title: `キャラクター参照画像をクリアしました`,
        cleared_me_description: `あなたのNovelAIキャラクター参照画像をクリアしました。`,
        cleared_persona_description: `**{persona_name}**のNovelAIキャラクター参照画像をクリアしました。`,
      },
      tags: {
        style: {
          description: `このサーバー全体で使うNovelAIスタイルタグを設定します。`,
          modal_title: `スタイルタグ`,
          tags_input_label: `スタイルタグ`,
          tags_input_description: `このサーバーのすべてのNovelAI画像プロンプトの先頭に付くカンマ区切りタグです。空欄で全スタイルタグをクリアします。`,
          tags_input_placeholder: `8k, absurdres, watercolor, soft lighting`,
          no_tags_title: `タグが未入力です`,
          no_tags_description: `少なくとも1つのスタイルタグを入力してください。`,
          too_many_tags_title: `タグが多すぎます`,
          too_many_tags_description: `このサーバーには最大{max_tags}個までスタイルタグを設定できます。`,
          tag_too_long_title: `タグが長すぎます`,
          tag_too_long_description: `各スタイルタグは{max_length}文字以下にしてください。`,
          success_title: `スタイルタグを更新しました`,
          success_description: `サーバー全体のスタイルタグを更新しました：
\`\`\`
{tag_list}
\`\`\``,
          cleared_title: `スタイルタグを初期値に戻しました`,
          cleared_description: `サーバー全体のスタイルタグを初期値に戻しました：
\`\`\`
{tag_list}
\`\`\``,
        },
        negative: {
          description: `このサーバー全体で使うNovelAIネガティブタグを設定します。`,
          modal_title: `ネガティブタグ`,
          tags_input_label: `ネガティブタグ`,
          tags_input_description: `このサーバーのNovelAI画像生成に使うカンマ区切りのネガティブタグです。空欄でサーバー上書きをクリアし、フォールバックのネガティブプロンプトに戻します。`,
          tags_input_placeholder: `lowres, blurry, bad anatomy, watermark`,
          no_tags_title: `タグが未入力です`,
          no_tags_description: `少なくとも1つのネガティブタグを入力してください。`,
          too_many_tags_title: `タグが多すぎます`,
          too_many_tags_description: `このサーバーには最大{max_tags}個までネガティブタグを設定できます。`,
          tag_too_long_title: `タグが長すぎます`,
          tag_too_long_description: `各ネガティブタグは{max_length}文字以下にしてください。`,
          success_title: `ネガティブタグを更新しました`,
          success_description: `サーバー全体のネガティブタグを更新しました：
\`\`\`
{tag_list}
\`\`\``,
          cleared_title: `ネガティブタグを初期値に戻しました`,
          cleared_description: `サーバー全体のネガティブタグを初期値に戻しました：
\`\`\`
{tag_list}
\`\`\``,
        },
        me: {
          description: `自分用のNovelAIキャラクタータグを設定します。`,
          modal_title: `自分のキャラクタータグ`,
          tags_input_label: `キャラクタータグ`,
          tags_input_description: `あなたのNovelAIプロフィール用のカンマ区切り画像ボードスタイルタグです。空欄でクリアします。`,
          tags_input_placeholder: `1girl, short hair, red eyes, school uniform`,
          no_tags_title: `タグが未入力です`,
          no_tags_description: `少なくとも1つのキャラクタータグを入力してください。`,
          too_many_tags_title: `タグが多すぎます`,
          too_many_tags_description: `個人キャラクタータグは最大{max_tags}個まで設定できます。`,
          tag_too_long_title: `タグが長すぎます`,
          tag_too_long_description: `各キャラクタータグは{max_length}文字以下にしてください。`,
          success_title: `キャラクタータグを更新しました`,
          success_description: `あなたのNovelAIキャラクタータグを更新しました：
\`\`\`
{tag_list}
\`\`\``,
          cleared_title: `キャラクタータグをクリアしました`,
          cleared_description: `あなたのNovelAIキャラクタータグをすべてクリアしました。`,
        },
        character: {
          description: `ペルソナプロフィール用のNovelAIキャラクタータグを設定します。`,
          modal_title: `キャラクタータグ`,
          persona_select_label: `ペルソナ`,
          persona_select_description: `キャラクタータグを設定するペルソナを選択してください。`,
          persona_select_placeholder: `ペルソナを選択...`,
          tags_input_label: `キャラクタータグ`,
          tags_input_description: `カンマ区切りの画像ボードスタイルのタグ（例：1girl, short hair, red eyes）。大文字小文字を区別します。`,
          tags_input_placeholder: `1girl, short hair, red eyes, school uniform`,
          no_tags_title: `タグが未入力です`,
          no_tags_description: `少なくとも1つのキャラクタータグを入力してください。`,
          too_many_tags_title: `タグが多すぎます`,
          too_many_tags_description: `1ペルソナあたり最大{max_tags}タグまで設定できます。`,
          tag_too_long_title: `タグが長すぎます`,
          tag_too_long_description: `各タグは{max_length}文字以下にしてください。`,
          success_title: `キャラクタータグを更新しました`,
          success_description: `**{persona_name}**のキャラクタータグを更新しました：
\`\`\`
{tag_list}
\`\`\``,
          cleared_title: `キャラクタータグをクリアしました`,
          cleared_description: `**{persona_name}**のキャラクタータグをすべてクリアしました。`,
        },
      },
      preset: {
        text: {
          description: `このサーバーのテキスト生成設定にNovelAIサンプリングプリセットを適用します。`,
          not_novelai_title: `NovelAIプロバイダーが必要です`,
          not_novelai_description: `このコマンドはAIプロバイダーがNovelAIに設定されている場合にのみ使用できます。\`/config model text\` でNovelAIモデルに切り替えてください。`,
          not_kayra_erato_title: `KayraまたはEratoが必要です`,
          not_kayra_erato_description: `サンプリングプリセットは **kayra-v1** および **llama-3-erato-v1** モデルのみで利用可能です。\`/config model text\` でモデルを切り替えてください。`,
          modal_title: `サンプリングプリセットを選択`,
          select_label: `サンプリングプリセット`,
          select_description: `テキスト生成に適用するプリセットを選択してください。`,
          select_placeholder: `サンプリングプリセットを選択...`,
          success_title: `プリセットを適用しました`,
          success_description: `サンプリングプリセット **{preset_name}** を適用しました。温度、トップK、トップP、ミンPがサーバー設定に反映されました。`,
        },
      },
      image: {
        description: `このサーバーのNovelAI画像生成モデルとパラメータ上書きを管理します。`,
        generate: {
          description: `画像掲示板タグ形式のプロンプトと任意のキャラクター参照画像でNovelAI画像を生成します。`,
          modal_title: `NovelAI画像生成`,
          prompt_label: `プロンプトタグ`,
          prompt_modal_description: `メインシーン用の画像掲示板タグです。`,
          prompt_placeholder: `例: 1girl, solo, cafe, window light, detailed eyes`,
          negative_tags_label: `追加ネガティブタグ`,
          negative_tags_modal_description: `今回の生成だけに追加する任意のネガティブタグです。`,
          negative_tags_placeholder: `例: blurry, text, watermark, extra fingers`,
          orientation_label: `向き`,
          orientation_modal_description: `画像の向きを選択します。`,
          orientation_choice_portrait: `縦長`,
          orientation_choice_landscape: `横長`,
          orientation_choice_square: `正方形`,
          character_reference_label: `キャラクター参照画像`,
          character_reference_modal_description: `単一キャラクター用の任意の参照画像です。`,
          success_title: `NovelAI画像を生成しました`,
          field_prompt: `プロンプトタグ`,
          field_model: `モデル`,
          field_generation_time: `生成時間`,
          field_orientation: `向き`,
          field_negative_tags: `追加ネガティブタグ`,
          no_model_title: `NovelAI画像モデルが必要です`,
          no_model_description: `現在、NovelAI画像生成は無効です。まず \`/config model image\` でNovelAI画像モデルを選択してください。`,
          no_api_key_title: `NovelAI APIキーが必要です`,
          no_api_key_description: `このサーバーには利用可能なNovelAIプロバイダー認証情報がありません。\`/config provider add\`で保存するか、メインプロバイダーをNovelAIに切り替えてください。`,
          invalid_reference_title: `無効なキャラクター参照画像です`,
          invalid_reference_description: `キャラクター参照画像には、NovelAIが読み取れる有効な画像添付を指定してください。`,
          character_reference_requires_v4_title: `V4モデルが必要です`,
          character_reference_requires_v4_description: `キャラクター参照画像は現在NovelAI V4モデルでのみ利用できます。現在の有効モデル: **{model}**。`,
          auth_error_title: `NovelAI認証に失敗しました`,
          auth_error_description: `NovelAIが画像生成リクエストを拒否しました。APIキーとサブスクリプション状態を確認してから再試行してください。`,
          quota_error_title: `NovelAI生成クォータを使い切りました`,
          quota_error_description: `このアカウントではNovelAI画像生成に必要なクォータまたはAnlasクレジットが不足しています。アカウントを補充するか、クォータのリフレッシュ後に再試行してください。`,
          rate_limit_error_title: `NovelAIのレート制限に達しました`,
          rate_limit_error_description: `NovelAIのレート制限により画像生成できませんでした。少し待ってから再試行してください。`,
          error_title: `NovelAI画像生成に失敗しました`,
          error_description: `NovelAIで画像を生成できませんでした。
\`\`\`
{error}
\`\`\``,
        },
        params: {
          description: `このサーバー用にNovelAI画像生成のサンプラーと品質設定を上書きします。`,
          modal_title: `NovelAI画像生成パラメータ`,
          sampler_label: `サンプラー`,
          sampler_description: `変更したいSamplerを選択してください。未選択のままなら現在の値を維持します。`,
          sampler_placeholder_current: `現在の上書き値: {sampler}`,
          sampler_placeholder_default: `現在、上書きなし`,
          option_default_suffix: `（デフォルト）`,
          sampler_option_k_euler_ancestral: `Euler Ancestral`,
          sampler_option_k_euler: `Euler`,
          sampler_option_k_dpmpp_2s_ancestral: `DPM++ 2S Ancestral`,
          sampler_option_k_dpmpp_2m_sde: `DPM++ 2M SDE`,
          sampler_option_k_dpmpp_2m: `DPM++ 2M`,
          sampler_option_k_dpmpp_sde: `DPM++ SDE`,
          steps_label: `ステップ数`,
          steps_description: `1〜50の整数。空欄でデフォルトを使います。`,
          steps_placeholder: `例: 23`,
          scale_label: `プロンプトガイダンス`,
          scale_description: `0.0〜10.0の小数。空欄でデフォルトを使います。`,
          scale_placeholder: `例: 5`,
          noise_schedule_label: `ノイズスケジュール`,
          noise_schedule_description: `変更したいNoise Scheduleを選択してください。未選択のままなら現在の値を維持します。`,
          noise_schedule_placeholder_current: `現在の上書き値: {noise_schedule}`,
          noise_schedule_placeholder_default: `現在、上書きなし`,
          noise_schedule_option_karras: `Karras`,
          noise_schedule_option_exponential: `指数`,
          noise_schedule_option_polyexponential: `多項指数`,
          cfg_rescale_label: `プロンプトガイダンス再スケール`,
          cfg_rescale_description: `0.0〜1.0の小数。空欄でデフォルトを使います。`,
          cfg_rescale_placeholder: `例: 0.0`,
          invalid_sampler_title: `無効なSamplerです`,
          invalid_sampler_description: `Samplerは次のいずれかである必要があります: {options}。`,
          invalid_steps_title: `無効なStepsです`,
          invalid_steps_description: `Stepsは{min}〜{max}の整数で入力してください。`,
          invalid_scale_title: `無効なPrompt Guidanceです`,
          invalid_scale_description: `Prompt Guidanceは{min}〜{max}の数値で入力してください。`,
          invalid_noise_schedule_title: `無効なNoise Scheduleです`,
          invalid_noise_schedule_description: `Noise scheduleは次のいずれかである必要があります: {options}。`,
          invalid_cfg_rescale_title: `無効なPrompt Guidance Rescaleです`,
          invalid_cfg_rescale_description: `Prompt Guidance Rescaleは{min}〜{max}の数値で入力してください。`,
          success_title: `画像生成パラメータを更新しました`,
          success_description: `このサーバーの有効なNovelAI画像生成パラメータ:
\`\`\`
Sampler: {sampler}
Steps: {steps}
Prompt Guidance: {scale}
Noise schedule: {noise_schedule}
Prompt Guidance Rescale: {cfg_rescale}
\`\`\``,
        },
      },
      attg: {
        description: `NovelAI KayraおよびEratoプロンプト用のAuthor/Title/Tags/Genre/Starsメタデータを設定します。`,
        modal_title: `ATTGの設定`,
        persona_select_title: `ペルソナを選択`,
        author_label: `作者`,
        author_placeholder: `例: 山田太郎`,
        title_label: `タイトル`,
        title_placeholder: `例: 私の物語`,
        tags_label: `タグ`,
        tags_placeholder: `例: ロマンス, 冒険`,
        genre_label: `ジャンル`,
        genre_placeholder: `例: ファンタジー, 日常`,
        stars_label: `スター (Eratoのみ)`,
        stars_placeholder: `1-5`,
        invalid_stars_title: `スター値が無効です`,
        invalid_stars_description: `スターは1〜5の整数か、空欄にしてください。`,
        success_title: `ATTGメタデータを更新しました`,
        success_description: `**{persona_name}**のATTGメタデータを更新しました。`,
        cleared_title: `ATTGメタデータをクリアしました`,
        cleared_description: `**{persona_name}**のATTGメタデータをすべてクリアしました。`,
      },
    },
    bot: {
      generate: {
        description: `現在のチャンネルの流れに合わせて素早く実行する手動生成コマンド。`,
        image: {
          description: `このチャンネルの直近コンテキストから素早くシーン画像を生成します。`,
          missing_permissions_title: `権限がありません`,
          missing_permissions_description: `このチャンネルでシーン画像を生成するには、チャンネルの閲覧、メッセージ履歴の読み取り、メッセージ送信、ファイル添付の権限が必要です。`,
          cooldown_active: `このサーバーの管理者がクールダウンを設定しています。\`/bot generate image\` を再度使用するまで、あと **{seconds}** 秒お待ちください。このクールダウンはメッセージトリガーや他の手動 /bot 操作と共有されています。`,
          channel_not_whitelisted: `このサーバーではホワイトリスト制限が有効です。\`/bot generate image\` はホワイトリスト登録チャンネル内で、かつホワイトリスト登録ロールを持つメンバーのみ使用でき、このチャンネルで許可されたペルソナだけを使えます。`,
          persona_access_blocked: `現在のホワイトリスト権限と個人スポットライト設定では、このチャンネルで \`/bot generate image\` に使えるペルソナがありません。`,
          no_backend_title: `使える画像バックエンドがありません`,
          no_backend_description: `このサーバーで今使える画像バックエンドが見つかりませんでした。**{current_provider}** に有効な画像モデルを設定するか、NovelAI で描画したい場合は NovelAI のオプション API キーを追加してください。`,
          planner_unavailable_title: `計画用モデルがありません`,
          planner_unavailable_description: `現在のプロバイダーで構造化出力に対応したモデルが見つからないため、今はシーン画像を計画できません。`,
          planner_failed_title: `シーン計画に失敗しました`,
          planner_failed_description: `最近のチャンネル文脈を画像プランに変換できませんでした: {error}`,
          success_title: `シーン画像を投稿しました`,
          success_description: `最近のチャンネル文脈から構図を計画し、このチャンネルに画像を投稿しました。`,
          modal: {
            title: `シーン画像`,
            prompt_label: `追加指示（任意）`,
            prompt_description: `シーンプランナーに反映してほしい補足、雰囲気、修正を入力してください`,
            prompt_placeholder: `例: 雨を強調して、やわらかめの雰囲気で、二人とも見えるように`,
            setting_label: `構図プリセット`,
            setting_description: `この fire-and-forget シーン画像に使う構図プリセットを選択してください`,
            setting_storybeat_label: `ストーリービート`,
            setting_storybeat_description: `直近の場面を広めに切り取るシネマ風構図`,
            setting_character_label: `キャラクター重視`,
            setting_character_description: `主役や話者に寄せた近めの構図`,
            setting_snapshot_label: `スクエアスナップ`,
            setting_snapshot_description: `今この瞬間を収めるバランス型の正方形構図`,
            setting_vertical_label: `スマホ壁紙`,
            setting_vertical_description: `シルエットを活かした縦長構図`,
            backend_label: `画像バックエンド`,
            backend_description: `どのレンダラーでこのシーン画像を生成するか選択してください`,
            backend_current_label: `現在のプロバイダー`,
            backend_current_description: `{provider} の通常の画像生成フローとプロンプト形式を使います`,
            backend_novelai_label: `NovelAI`,
            backend_novelai_description: `シーンを NovelAI 向けタグに変換し、NovelAI の画像ツールで生成します`,
            persona_label: `送信ペルソナ`,
            persona_description: `生成された画像を投稿するペルソナを選んでください`,
          },
        },
      },
      respond: {
        description: `このチャンネルの最新メッセージに手動で応答をトリガーします。`,
        prompt_description: `コンテキスト末尾に追加する任意のシステムプロンプト。`,
        prompt_label: `プロンプト（任意）`,
        prompt_placeholder: `システム指示を追加（任意）...`,
        prefill_description: `私に続きを書いてほしい、アシスタントの返答の書き出し（任意）。`,
        prefill_label: `プリフィル（任意）`,
        prefill_placeholder: `アシスタントのプリフィルを追加（任意）...`,
        success_title: `手動応答がトリガーされました`,
        success_description: `このチャンネルの最新メッセージに応答しています...`,
        missing_permissions_title: `権限がありません`,
        missing_permissions_description: `このチャンネルのメッセージ履歴を読み取る権限がありません。**チャンネルを見る**および**メッセージ履歴を読む**権限があることを確認してください。`,
        extra_options_description: `応答前に追加オプションを表示（ペルソナ選択、推論、プロンプト、プリフィル）。`,
        extra_options_title: `応答オプション`,
        select_persona_title: `ペルソナを選択`,
        select_persona_label: `ペルソナを選択`,
        select_persona_description: `応答するペルソナを選択してください。`,
        select_persona_placeholder: `応答するペルソナを選択...`,
        main_persona_description: `メインペルソナ`,
        alter_persona_description: `オルタペルソナ`,
        embed_hide_notice: `\`/config notice-embeds visibility\` でこの埋め込みを非表示にできます。`,
        use_reasoning_label: `推論を使用`,
        use_reasoning_description: `利用可能な最も賢いモデルを使用して高度な推論モードを切り替えます。`,
        no_smart_model_title: `推論モデルが見つかりません`,
        no_smart_model_description: `現在のAIプロバイダーに推論モデルが見つかりませんでした。\`/config model text\`を使用して、推論モデルをサポートするプロバイダーに切り替えてください。`,
        no_messages_title: `メッセージが見つかりません`,
        no_messages_description: `このチャンネルにメッセージが見つかりません。 \`/bot respond\` を使う前に、少なくとも1件メッセージを送信してください。`,
        cooldown_active: `このサーバーの管理者がクールダウンを設定しています。\`/bot respond\` を再度使用するまで、あと **{seconds}** 秒お待ちください。このクールダウンはメッセージトリガーと共有されています。`,
        channel_not_whitelisted: `このサーバーではホワイトリスト制限が有効です。\`/bot respond\` はホワイトリスト登録チャンネル内で、かつホワイトリスト登録ロールを持つメンバーのみ使用でき、このチャンネルで許可されたペルソナだけを使えます。`,
        persona_access_blocked: `現在のホワイトリスト権限と個人スポットライト設定では、このチャンネルで \`/bot respond\` に使えるペルソナがありません。`,
      },
      kill: {
        description: `このチャンネルで現在のストリーム応答を停止し、キュー済み応答をすべてクリアします。`,
        success_title: `ストリームを停止しました`,
        success_description: `進行中の応答ストリーム（ある場合）を停止し、このチャンネルのキュー済み応答をクリアしました。`,
        nothing_to_stop_title: `停止・クリア対象がありません`,
        nothing_to_stop_description: `このチャンネルには停止できる進行中の応答ストリームも、クリアできるキュー済み応答もありません。`,
      },
      impersonate: {
        description: `ペルソナ、ユーザー、またはシステムプロンプトになりすます。`,
        target_description: `なりすます対象を選択してください。`,
        target_persona: `ペルソナ`,
        target_user: `ユーザー`,
        target_system: `システム`,
        user_select_title: `ユーザーを選択`,
        user_select_description: `なりすますユーザーを選択してください。`,
        user_select_placeholder: `なりすますユーザーを選択...`,
        persona_modal_title: `ペルソナになりすます`,
        persona_select_label: `ペルソナを選択`,
        persona_select_placeholder: `なりすますペルソナを選択...`,
        persona_message_label: `メッセージ`,
        persona_message_placeholder: `ペルソナとして送信するメッセージを入力...`,
        persona_success_title: `メッセージを送信しました`,
        persona_success_description: `{persona}としてメッセージを送信しました。`,
        persona_impersonation_notice_description: `\`/config notice-embeds visibility\` でこの埋め込みを非表示にできます。`,
        persona_impersonation_notice_footer: `{user}によるなりすまし`,
        user_impersonation_notice_description: `\`/config notice-embeds visibility\` でこの埋め込みを非表示にできます。あなたをどうなりすますか教えるには、\`/personal impersonate prompt\` を設定してください。`,
        user_impersonation_notice_footer: `{user}が{target}のなりすましをトリガーしました`,
        me_success_title: `ユーザーなりすましが発動しました`,
        me_success_description: `{user}としてメッセージを生成できました.`,
        no_messages_title: `メッセージが見つかりません`,
        no_messages_description: `このチャンネルにメッセージが見つかりません。ユーザーなりすましを使用する前に、少なくとも1つのメッセージを送信してください。`,
        cooldown_active: `このサーバーの管理者がクールダウンを設定しています。\`/bot impersonate me\` を再度使用するまで、あと **{seconds}** 秒お待ちください。このクールダウンはメッセージトリガーと\`/bot respond\`と共有されています。`,
        cooldown_active_user: `このサーバーの管理者がクールダウンを設定しています。\`/bot impersonate user\` を再度使用するまで、あと **{seconds}** 秒お待ちください。このクールダウンはメッセージトリガーと\`/bot respond\`と共有されています。`,
        channel_not_whitelisted: `このサーバーではホワイトリスト制限が有効です。\`/bot impersonate\` はホワイトリスト登録チャンネル内で、かつホワイトリスト登録ロールを持つメンバーのみ使用でき、このチャンネルで許可されたペルソナだけを使えます。`,
        channel_not_whitelisted_user: `このサーバーではホワイトリスト制限が有効です。\`/bot impersonate user\` はホワイトリスト登録チャンネル内で、かつホワイトリスト登録ロールを持つメンバーのみ使用でき、このチャンネルで許可されたペルソナだけを使えます。`,
        persona_access_blocked: `現在のホワイトリスト権限と個人スポットライト設定では、このチャンネルで \`/bot impersonate persona\` に使えるペルソナがありません。`,
        main_persona_access_blocked: `現在のホワイトリスト権限と個人スポットライト設定では、このチャンネルでメインペルソナが発話できないため、ユーザーなりすましは実行できません。`,
        system_modal_title: `システムプロンプト注入`,
        system_content_label: `システムプロンプト`,
        system_content_placeholder: `システム指示を入力...`,
        system_title: `システムメッセージ`,
        system_injected_footer: `{user}により注入`,
        system_success_title: `システムプロンプトを注入しました`,
        system_success_description: `システムプロンプトが会話に注入されました。ボットは次のメッセージでこの指示を認識します。`,
        missing_permissions_title: `権限が不足しています`,
        missing_permissions_description: `このチャンネルでメッセージを送信するか、Webhookを管理する権限がありません。`,
        webhook_error_title: `Webhookエラー`,
        webhook_error_description: `なりすまし用のWebhookの作成に失敗しました。エラー：{error}`,
        no_personas_title: `ペルソナが見つかりません`,
        no_personas_description: `このサーバーにはペルソナが設定されていません。まず\`/config setup\`を使用してください。`,
      },
    },
    conditioning: {
      description: `ご褒美・おしおきの条件付け記憶を管理します。`,
      reward: {
        description: `ご褒美のふれあいで私を褒めます。`,
      },
      punish: {
        description: `しつけのふれあいで私を叱ります。`,
      },
      shared: {
        select_persona_title: `管理するペルソナを選択`,
        reason_line: `理由: \`\`{reason}\`\``,
        reward_footer: `❤️ {bot}はこれを覚えておきます。管理は /conditioning manage を使用してください。`,
        punish_footer: `💀 {bot}はこれを覚えておきます。管理は /conditioning manage を使用してください。`,
        persona_access_blocked_title: `利用できるペルソナがありません`,
        persona_access_blocked_description: `現在のホワイトリスト権限と個人スポットライト設定では、このチャンネルでこの操作に使えるペルソナがありません。`,
      },
      manage: {
        description: `このサーバー内の全ペルソナに注入対象の条件付け履歴を管理します。`,
        marker_reward: `❤️`,
        marker_punish: `💀`,
        none_title: `管理する条件付けはありません`,
        none_description: `このサーバーには管理できる注入対象の条件付け履歴がありません。`,
        too_many_title: `項目が多すぎます`,
        too_many_description: `{total_entries} 件の項目が見つかりました（{total_pages} ページ）。現在は最大 {max_pages} ページまで対応しています。`,
        select_page_title: `条件付けページを選択`,
        select_page_description: `管理したい注入対象の条件付け項目のページを選択してください。
項目数: {total_entries}
ページ数: {total_pages}
各項目にはペルソナ名とご褒美/おしおき種別が表示されます。`,
        checkbox_label: `条件付け項目`,
        checkbox_label_continued: `条件付け項目（続き）`,
        checkbox_description: `チェックを残すと保持されます。チェックを外すと、その注入対象の条件付けグループが削除されます。`,
        option_reason_description: `合計 {count} 回 • 理由: 「{reason}」`,
        option_label: `{type_marker} {persona_name} • {action}`,
        modal_title: `条件付けを管理`,
        done_button: `完了`,
        no_changes_title: `変更はありません`,
        no_changes_description: `すべてチェックされたままだったため、削除は行われませんでした。`,
        success_title: `条件付けを更新しました`,
        success_description: `{persona_count} 個のペルソナにまたがるご褒美グループ {reward_groups} 件、おしおきグループ {punish_groups} 件を削除しました（保存行 {deleted_rows} 件を削除）。`,
      },
    },
    reward: {
      description: `私へのご褒美インタラクション。`,
      headpat: {
        description: `ヘッドパットして応答をトリガーします。`,
        reason_description: `どうしてご褒美をくれるの？`,
        embed_title: `🫳 ヘッドパット・タイム！`,
        embed_description: `{user}は現在{bot}をなでています。`,
        history_label: `ヘッドパット`,
      },
      hug: {
        description: `ハグして応答をトリガーします。`,
        reason_description: `どうしてご褒美をくれるの？`,
        embed_title: `🤗 ハグ・タイム！`,
        embed_description: `{user}は{bot}をぎゅっと抱きしめています。`,
        history_label: `ハグ`,
      },
      kiss: {
        description: `キスして応答をトリガーします。`,
        reason_description: `どうしてご褒美をくれるの？`,
        embed_title: `💋 キス・タイム！`,
        embed_description: `{user}は{bot}にキスしました。`,
        history_label: `キス`,
      },
      tickle: {
        description: `くすぐって応答をトリガーします。`,
        reason_description: `どうしてご褒美をくれるの？`,
        embed_title: `🤭 くすぐり・タイム！`,
        embed_description: `{user}は{bot}をくすぐっています。`,
        history_label: `くすぐり`,
      },
      feed: {
        description: `美味しいものを食べさせて応答をトリガーします。`,
        reason_description: `どうしてご褒美をくれるの？`,
        food_description: `何を食べさせますか？`,
        embed_title: `🍴 スナック・タイム！`,
        embed_description: `{user}は{bot}に{food_text}を与えました。`,
        history_label: `食べさせる`,
      },
    },
    punish: {
      description: `私をおしおきして応答をトリガーします。`,
      spank: {
        description: `ぺしっとして応答をトリガーします。`,
        reason_description: `どうしておしおきするの？`,
        embed_title: `🖐️ スパンク・タイム！`,
        embed_description: `{user}は{bot}をぺしっとしました。`,
        history_label: `スパンク`,
      },
      pinch: {
        description: `つねって応答をトリガーします。`,
        reason_description: `どうしておしおきするの？`,
        embed_title: `🤏 ピンチ・タイム！`,
        embed_description: `{user}は{bot}をつねりました。`,
        history_label: `つねり`,
      },
      bite: {
        description: `甘噛みして応答をトリガーします。`,
        reason_description: `どうしておしおきするの？`,
        embed_title: `🦷 バイト・タイム！`,
        embed_description: `{user}は{bot}を甘噛みしました。`,
        history_label: `甘噛み`,
      },
      bonk: {
        description: `ポカッとして応答をトリガーします。`,
        reason_description: `どうしておしおきするの？`,
        embed_title: `🔨 ボンク！`,
        embed_description: `{user}は{bot}をポカッと叩きました。`,
        history_label: `ポカッ`,
      },
      squeeze: {
        description: `ぎゅっとして応答をトリガーします。`,
        reason_description: `どうしておしおきするの？`,
        embed_title: `👐 スクイーズ・タイム！`,
        embed_description: `{user}は{bot}をぎゅっと握りました。`,
        history_label: `スクイーズ`,
      },
    },
    support: {
      discord: {
        description: `バグ報告、フィードバック、コミュニティチャットのための公式Discordサーバーリンクを取得します。`,
        title: `Discordサーバーに参加`,
        description_text: `TomoriBotのヘルプが必要ですか？またはコミュニティと交流したいですか？

🔗 **Discordサーバー**: https://discord.gg/bjCfHm9QsB

参加して:
• バグや問題を報告
• フィードバックや提案を共有
• 他のユーザーや開発チームとチャット
• 新機能の最新情報を入手`,
      },
    },
    contribute: {
      github: {
        description: `GitHubリポジトリのリンクを取得し、TomoriBotへの貢献方法を学びます。`,
        title: `TomoriBotに貢献する`,
        description_text: `TomoriBotをより良くするお手伝いをしたいですか？貢献をお待ちしています！

🔗 **GitHubリポジトリ**: https://github.com/Bredrumb/TomoriBot

貢献方法:
• GitHubでリポジトリにスターを付ける ⭐
• バグ報告や機能リクエストを送信
• コードの改善や新機能を貢献
• TomoriBotを他の言語に翻訳するお手伝い
• ドキュメントの改善`,
      },
    },
    donate: {
      kofi: {
        description: `Ko-fiを通じてTomoriBotの開発を支援します。`,
        title: `TomoriBotの開発を支援`,
        description_text: `TomoriBotを使うのが好きですか？無料で維持し、継続的な開発を支援してください！

🔗 **Ko-fi**: https://ko-fi.com/bredrumb

あなたの寄付は以下に役立ちます:
• TomoriBotの運営と保守
• 新機能と改善の追加
• サーバーコストと開発時間のサポート
• TomoriBotを完全に無料で維持

大小問わず、すべての貢献に心から感謝します！ ❤️`,
      },
    },
    nsfw: {
      description: `年齢制限付きのコマンドと設定です。`,
      jailbreaks: {
        description: `このサーバーでの任意のjailbreak機能を管理します。`,
        modal_title: `Jailbreak設定を管理`,
        checkbox_label: `有効なJailbreak設定`,
        checkbox_description: `チェックした設定は有効のままです。外した設定は無効になります。`,
        injection_option: `プロンプト注入（18+同意の確認）`,
        unicode_spaces_option: `Unicodeスペース置換`,
        sanitize_option: `センシティブ語句のサニタイズ`,
        no_changes_title: `変更はありません`,
        no_changes_description: `Jailbreak設定は変更されませんでした。`,
        success_title: `Jailbreak設定を更新しました`,
        success_description: `Jailbreak設定を更新しました。現在 **{enabled_count}** 件の設定が有効です。`,
      },
    },
    openrouter: {
      description: `OpenRouter専用のモデルと設定を管理します。`,
      models: {
        description: `保存済みOpenRouterモデル登録を管理します。`,
        add: {
          description: `このサーバー用にOpenRouterモデルコードネームを登録します。`,
          capability_description: `このモデルを追加するOpenRouter機能リストを選びます。`,
          model_name_description: `登録する正確なOpenRouterモデルコードネーム。`,
          success_title: `OpenRouterモデルを追加しました`,
          success_description: `OpenRouterの{capability}モデル \`{model_name}\` をこのサーバーに登録しました。この機能の通常のOpenRouterモデル選択に表示されます。`,
          already_registered_title: `既に登録されています`,
          already_registered_description: `OpenRouterの{capability}モデル \`{model_name}\` はこのサーバーに既に登録されています。`,
          already_available_title: `最初から利用可能です`,
          already_available_description: `OpenRouterの{capability}モデル \`{model_name}\` は最初から組み込み済みです。追加登録は不要です。`,
          not_found_title: `モデルが見つかりません`,
          not_found_description: `OpenRouter モデル \`{model_name}\` が見つかりませんでした。正確なOpenRouterコードネームを入力して再試行してください。`,
        },
        remove: {
          description: `このサーバーから登録済みのOpenRouterモデルを削除します。`,
          none_title: `登録済みモデルがありません`,
          none_description: `このサーバーにはまだ追加のOpenRouterモデル登録がありません。`,
          too_many_title: `登録済みモデルが多すぎます`,
          too_many_description: `1つのモーダルで編集するには登録済みOpenRouterモデルが多すぎます。先に数を減らしてから再試行してください。最大グループ数: {max_groups}。`,
          modal_title: `OpenRouterモデルを削除`,
          checkbox_description: `登録を残すモデルはチェックしたままにし、削除したいモデルだけチェックを外してください。`,
          checkbox_text_label: `登録済みテキストモデル`,
          checkbox_text_label_continued: `登録済みテキストモデル（続き）`,
          checkbox_embedding_label: `登録済み埋め込みモデル`,
          checkbox_embedding_label_continued: `登録済み埋め込みモデル（続き）`,
          checkbox_image_label: `登録済み画像モデル`,
          checkbox_image_label_continued: `登録済み画像モデル（続き）`,
          checkbox_video_label: `登録済み動画モデル`,
          checkbox_video_label_continued: `登録済み動画モデル（続き）`,
          capability_text: `テキスト`,
          capability_embedding: `埋め込み`,
          capability_image: `画像`,
          capability_video: `動画`,
          no_removals_title: `削除はありません`,
          no_removals_description: `OpenRouterモデル登録は何も削除されませんでした。`,
          success_title: `OpenRouterモデルを削除しました`,
          success_description: `このサーバーから次のOpenRouter登録を削除しました: {models_removed}。`,
          success_still_referenced_description: `このサーバーから次のOpenRouter登録を削除しました: {models_removed}。すでにそれらを使っている既存の選択はそのまま残るため、不要なら手動で切り替えてください。`,
          already_available_title: `組み込みモデルです`,
          already_available_description: `OpenRouter モデル \`{model_name}\` は組み込みモデルなので、このコマンドでは削除できません。`,
        },
      },
      model: {
        description: `保存済みOpenRouterモデル登録を管理します。`,
        add: {
          description: `このサーバー用にOpenRouterモデルコードネームを登録します。`,
        },
        remove: {
          description: `このサーバーから登録済みのOpenRouterモデルコードネームを削除します。`,
        },
      },
    },
    config: {
      options: {
        enable: `有効化`,
        disable: `無効化`,
      },
      custom: {
        endpoint_url_invalid_title: `無効なエンドポイントURL`,
        endpoint_url_invalid_description: `カスタムエンドポイントの有効なHTTPまたはHTTPS URLを入力してください。`,
        endpoint_url_protocol_description: `URLはHTTPまたはHTTPSプロトコルを使用する必要があります。`,
        endpoint_url_https_required_description: `本番環境ではHTTPSが必要です。公開アクセス可能なHTTPSエンドポイントを使用してください（例：https://my-llm-server.com/v1）。`,
        endpoint_url_http_localhost_only_description: `HTTPは開発環境のlocalhost専用です。リモートサーバーにはHTTPSを使用してください。`,
        endpoint_url_localhost_blocked_description: `本番環境ではlocalhostエンドポイントは使用できません。公開アクセス可能なHTTPSエンドポイントを使用してください。`,
        endpoint_url_dns_failed_description: `ホスト名 \`{hostname}\` を解決できませんでした。サーバーが公開アクセス可能であり、URLが正しいことを確認してください。`,
        endpoint_url_private_address_description: `\`{address}\` はプライベートまたは予約済みIPアドレスです。公開アクセス可能なHTTPSエンドポイントを使用してください。`,
        model_name_label: `モデル名（必須）`,
        model_name_placeholder: `例：gpt-5.4 または gemma3:latest`,
        model_name_required_description: `確認する前に正確なモデル名を設定してください。ChatMockなら \`gpt-5.4\` のような名前、Ollamaなら \`gemma3:latest\` のような正確なモデルタグを入力してください。`,
        capabilities_prompt: `エンドポイントが期待する正確なモデル名を設定してから、そのモデルがサポートする機能を選択し、**確認**をクリックしてください:`,
        capability_tools_label: `関数呼び出し（ツール）?`,
        capability_tools_yes: `関数呼び出しをサポート`,
        capability_tools_no: `関数呼び出し非対応`,
        capability_images_label: `画像理解?`,
        capability_images_yes: `画像をサポート`,
        capability_images_no: `画像非対応`,
        capability_videos_label: `動画理解?`,
        capability_videos_yes: `動画をサポート`,
        capability_videos_no: `動画非対応`,
        capability_structoutput_label: `構造化出力?`,
        capability_structoutput_yes: `構造化出力をサポート`,
        capability_structoutput_no: `構造化出力非対応`,
        capabilities_timeout: `モデル機能の設定がタイムアウトしました。もう一度お試しください。`,
        num_ctx_label: `コンテキストウィンドウ（Ollama / KoboldCPP）`,
        num_ctx_placeholder: `例：8192 または 16384 — OllamaとKoboldCPPのみに適用。`,
        num_ctx_invalid: `コンテキストウィンドウサイズは512以上の数値を入力してください。空欄のままにするとエンドポイントのデフォルト値が使用されます。`,
      },
      custom_models: {
        description: `ラベル付きカスタムエンドポイントを管理します。`,
        add: {
          description: `ラベル付きカスタムエンドポイントに1機能を登録します。`,
          label_description: `一致する機能で共有するバンドル用ラベル。例: ComfyUI。`,
          capability_description: `このエンドポイントが提供する機能。`,
          api_style_description: `このエンドポイントが使うAPI形式。`,
          endpoint_url_description: `エンドポイントのベースURL。`,
          auth_token_description: `保護されたエンドポイント用のBearerトークン（任意）。`,
          success_title: `カスタムエンドポイントを追加しました`,
          success_description: `**{display_name}** をラベル **{label}** の **{capability}** として追加しました。\`/config model\` から選択できます。`,
          speech_next_steps_description: `**{display_name}** をラベル **{label}** の **{capability}** として追加しました。次に \`/speech voice-add\` で音声サンプルを追加し、\`/speech voice-assign\` で割り当ててください。`,
          speech_voice_design_next_steps_description: `**{display_name}** をラベル **{label}** の **{capability}** として追加しました。次に \`/model speech\` で選択し、\`/speech voice-design set\` でペルソナの声質プロンプトを設定してください。`,
          speech_auto_next_steps_description: `**{display_name}** をラベル **{label}** の **{capability}** として追加しました。次に \`/model speech\` で選択してください。クローン用ペルソナは \`/speech voice-add\` と \`/speech voice-assign\`、VoiceDesign 用ペルソナは \`/speech voice-design set\` を使用します。`,
        },
        edit: {
          description: `登録済みのラベル付きカスタムエンドポイントを編集します。`,
          none_title: `登録済みカスタムエンドポイントがありません`,
          none_description: `このサーバーには編集できるラベル付きカスタムエンドポイントがまだありません。`,
          select_modal_title: `カスタムエンドポイントを編集`,
          select_label: `編集するエンドポイント`,
          select_description: `編集する登録済みカスタムエンドポイントを選んでください。`,
          select_placeholder: `カスタムエンドポイントを選択...`,
          edit_fields_button: `項目を編集`,
          summary_title: `現在の設定 — {label}`,
          summary_capability: `機能`,
          summary_api_style: `API形式`,
          success_title: `カスタムエンドポイントを更新しました`,
          success_description: `ラベル **{label}** の **{capability}** にある **{display_name}** を更新しました。`,
        },
        remove: {
          description: `ラベル付きカスタムエンドポイントから選んだ機能を削除します。`,
          label_description: `バンドル用ラベル。チェックを外した機能だけ削除されます。`,
          capability_description: `削除する機能。`,
          none_title: `登録済みカスタムエンドポイントがありません`,
          none_description: `このサーバーにはまだラベル付きカスタムエンドポイントの登録がありません。`,
          too_many_title: `登録済みカスタムエンドポイントが多すぎます`,
          too_many_description: `1つのモーダルで編集するには登録済みカスタムエンドポイントが多すぎます。先に数を減らしてから再試行してください。最大グループ数: {max_groups}。`,
          modal_title: `カスタムエンドポイントを削除`,
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
          capability_text: `テキスト`,
          capability_embedding: `埋め込み`,
          capability_image: `画像`,
          capability_video: `動画`,
          capability_speech: `音声`,
          capability_transcription: `文字起こし`,
          no_removals_title: `削除はありません`,
          no_removals_description: `カスタムエンドポイント登録は何も削除されませんでした。`,
          not_found: `そのラベルと機能に一致するカスタムエンドポイントはありません。`,
          success_title: `カスタムエンドポイントを削除しました`,
          success_description: `このサーバーから次のカスタムエンドポイント登録を削除しました: {models_removed}。`,
        },
        validation: {
          invalid_label: `ラベルは英小文字・数字・アンダースコア・ハイフンのみ使用でき、長さは1〜40文字です。`,
          unreachable: `そのエンドポイントに接続できませんでした: {reason}`,
          local_address_blocked: `パーソナルエンドポイントはデフォルトでlocalhostとプライベートIPをブロックします。セルフホストの場合は、ローカルアドレスを許可するために \`.env\` に \`ALLOW_PERSONAL_LOCAL_ENDPOINTS=true\` を設定してください。`,
          workflow_required: `ComfyUI の画像/動画エンドポイントではワークフローJSONの添付が必要です。`,
          model_name_required: `テキストと埋め込みのエンドポイントではモデル名が必要です。`,
          transcription_model_required: `文字起こしエンドポイントには \`large-v3\` や \`whisper-1\` などのモデル識別子が必要です。`,
        },
        capability_modal: {
          text_title: `テキストエンドポイントの詳細`,
          embedding_title: `埋め込みエンドポイントの詳細`,
          speech_title: `音声エンドポイントの詳細`,
          transcription_title: `文字起こしエンドポイントの詳細`,
          image_title: `画像エンドポイントの詳細`,
          video_title: `動画エンドポイントの詳細`,
          text_edit_title: `テキストエンドポイントを編集`,
          embedding_edit_title: `埋め込みエンドポイントを編集`,
          speech_edit_title: `音声エンドポイントを編集`,
          transcription_edit_title: `文字起こしエンドポイントを編集`,
          image_edit_title: `画像エンドポイントを編集`,
          video_edit_title: `動画エンドポイントを編集`,
          model_name_label: `モデル名`,
          model_name_placeholder: `例: llama3.2, gemma3:12b, text-embedding-3-small`,
          display_name_label: `表示名`,
          display_name_placeholder: `省略するとモデル名が使われます`,
          num_ctx_label: `コンテキストウィンドウ上書き`,
          num_ctx_placeholder: `例: 8192 — 省略するとエンドポイントのデフォルトを使用`,
          text_capabilities_label: `有効な機能`,
          text_capabilities_description: `このテキストモデルが対応する機能にチェックを入れてください`,
          text_cap_tools: `ツール呼び出し`,
          text_cap_tools_description: `ツール/関数呼び出しリクエストを受け取り実行できる`,
          text_cap_vision: `画像入力`,
          text_cap_vision_description: `メッセージに添付された画像を解析できる`,
          text_cap_structoutput: `構造化出力`,
          text_cap_structoutput_description: `制約付きJSONスキーマ出力に対応している`,
          voice_mode_label: `音声ソースモード`,
          voice_mode_description: `アップロード済み参照音声を使うか、自然言語の声質プロンプトを使うか`,
          voice_mode_clone: `音声クローン`,
          voice_mode_clone_description: `アップロード済み音声サンプルを話者参照として使用`,
          voice_mode_design: `VoiceDesign`,
          voice_mode_design_description: `ペルソナの声質プロンプトを instruct として送信`,
          voice_mode_auto: `自動`,
          voice_mode_auto_description: `各ペルソナの設定に応じて、音声サンプルまたは VoiceDesign プロンプトを使用`,
          script_markup_label: `スクリプトマークアップ形式`,
          script_markup_description: `このエンドポイントに送信するスピーチテキストでのマークアップ形式`,
          script_markup_plain: `プレーン`,
          script_markup_plain_description: `プレーンテキストのみ送信 — マークアップタグはすべて除去`,
          script_markup_bracket_tags: `ブラケットタグ`,
          script_markup_bracket_tags_description: `[excited]、[whisper] などの配信タグをそのまま渡す`,
          script_markup_emoji: `絵文字`,
          script_markup_emoji_description: `絵文字感情キュー（😊、😢など）をそのまま渡す`,
          supports_instruct_label: `指示対応`,
          supports_instruct_description: `スピーチスクリプトと共に音声指示テキストを受け付けるか。VoiceDesign モードでは自動的に有効になります。`,
          transcription_model_label: `モデル識別子`,
          transcription_model_placeholder: `例: large-v3, whisper-1`,
          transcription_language_label: `言語ヒント`,
          transcription_language_placeholder: `例: en, ja — 自動検出の場合は空欄`,
          endpoint_url_label: `エンドポイントURL`,
          endpoint_url_placeholder: `省略すると現在のURLを維持します`,
          auth_token_label: `認証トークン`,
          auth_token_placeholder: `省略すると現在のトークンを維持します`,
          workflow_json_label: `ワークフローJSON`,
          workflow_json_description: `ComfyUIワークフローJSONファイル（任意）。ComfyUI APIスタイルの場合は必須です。`,
        },
      },
      openrouter_models: {
        description: `保存済みOpenRouterモデル登録を管理します。`,
        add: {
          description: `このサーバー用にOpenRouterモデルコードネームを登録します。`,
          capability_description: `このモデルを追加するOpenRouter機能リストを選びます。`,
          model_name_description: `登録する正確なOpenRouterモデルコードネーム。`,
          success_title: `OpenRouterモデルを追加しました`,
          success_description: `OpenRouterの{capability}モデル \`{model_name}\` をこのサーバーに登録しました。この機能の通常のOpenRouterモデル選択に表示されます。`,
          already_registered_title: `既に登録されています`,
          already_registered_description: `OpenRouterの{capability}モデル \`{model_name}\` はこのサーバーに既に登録されています。`,
          already_available_title: `最初から利用可能です`,
          already_available_description: `OpenRouterの{capability}モデル \`{model_name}\` は最初から組み込み済みです。追加登録は不要です。`,
          not_found_title: `モデルが見つかりません`,
          not_found_description: `OpenRouter モデル \`{model_name}\` が見つかりませんでした。正確なOpenRouterコードネームを入力して再試行してください。`,
        },
        remove: {
          description: `このサーバーから登録済みのOpenRouterモデルを削除します。`,
          none_title: `登録済みモデルがありません`,
          none_description: `このサーバーにはまだ追加のOpenRouterモデル登録がありません。`,
          too_many_title: `登録済みモデルが多すぎます`,
          too_many_description: `1つのモーダルで編集するには登録済みOpenRouterモデルが多すぎます。先に数を減らしてから再試行してください。最大グループ数: {max_groups}。`,
          modal_title: `OpenRouterモデルを削除`,
          checkbox_description: `登録を残すモデルはチェックしたままにし、削除したいモデルだけチェックを外してください。`,
          checkbox_text_label: `登録済みテキストモデル`,
          checkbox_text_label_continued: `登録済みテキストモデル（続き）`,
          checkbox_embedding_label: `登録済み埋め込みモデル`,
          checkbox_embedding_label_continued: `登録済み埋め込みモデル（続き）`,
          checkbox_image_label: `登録済み画像モデル`,
          checkbox_image_label_continued: `登録済み画像モデル（続き）`,
          checkbox_video_label: `登録済み動画モデル`,
          checkbox_video_label_continued: `登録済み動画モデル（続き）`,
          capability_text: `テキスト`,
          capability_embedding: `埋め込み`,
          capability_image: `画像`,
          capability_video: `動画`,
          no_removals_title: `削除はありません`,
          no_removals_description: `OpenRouterモデル登録は何も削除されませんでした。`,
          success_title: `OpenRouterモデルを削除しました`,
          success_description: `このサーバーから次のOpenRouter登録を削除しました: {models_removed}。`,
          success_still_referenced_description: `このサーバーから次のOpenRouter登録を削除しました: {models_removed}。すでにそれらを使っている既存の選択はそのまま残るため、不要なら手動で切り替えてください。`,
          already_available_title: `組み込みモデルです`,
          already_available_description: `OpenRouter モデル \`{model_name}\` は組み込みモデルなので、このコマンドでは削除できません。`,
        },
      },
      "openrouter-models": {
        description: `保存済みOpenRouterモデル登録を管理します。`,
        add: {
          description: `このサーバー用にOpenRouterモデルコードネームを登録します。`,
        },
        remove: {
          description: `このサーバーから登録済みのOpenRouterモデルコードネームを削除します。`,
        },
      },
      "notice-embeds": {
        description: `チャットに表示する通知埋め込みを管理します。`,
        visibility: {
          description: `チャットに残す通知埋め込みを選択します。`,
          modal_title: `通知埋め込みの表示設定`,
          checkbox_label: `表示する通知埋め込み`,
          checkbox_label_continued: `表示する通知埋め込み（続き）`,
          checkbox_description: `チェックした埋め込みはチャットに表示されます。外した埋め込みは非表示になります。ツール進行通知は許可されていれば thoughtlogs に送られます。`,
          no_changes_title: `変更はありません`,
          no_changes_description: `通知埋め込みの表示設定はすでにその状態です。`,
          success_title: `通知埋め込みの表示設定を更新しました`,
          success_description: `今回非表示にした項目（{hidden_count}）: {hidden_list}
今回再表示した項目（{restored_count}）: {restored_list}`,
          too_many_title: `通知埋め込みタイプが多すぎます`,
          too_many_description: `設定された通知埋め込みタイプは {count} 件あり、モーダル上限の {max_entries} 件（{max_groups} グループ）を超えています。`,
          notice_web_search_label: `ウェブ検索`,
          notice_web_search_description: `「ウェブを検索中...」通知を表示します。`,
          notice_image_search_label: `画像検索`,
          notice_image_search_description: `画像検索の進行通知を表示します。`,
          notice_video_search_label: `動画検索`,
          notice_video_search_description: `動画検索の進行通知を表示します。`,
          notice_news_search_label: `ニュース検索`,
          notice_news_search_description: `ニュース検索の進行通知を表示します。`,
          notice_web_fetch_label: `Web取得`,
          notice_web_fetch_description: `Webページ取得・読み取り通知を表示します。`,
          notice_document_reading_label: `ドキュメント読取`,
          notice_document_reading_description: `ドキュメント読み取り通知を表示します。`,
          notice_image_generation_label: `画像生成`,
          notice_image_generation_description: `画像生成通知を表示します。`,
          notice_video_generation_label: `動画生成`,
          notice_video_generation_description: `動画生成通知を表示します。`,
          notice_image_editing_label: `画像編集`,
          notice_image_editing_description: `画像編集・インペイント通知を表示します。`,
          notice_image_analysis_label: `画像解析`,
          notice_image_analysis_description: `画像解析通知を表示します。`,
          notice_gif_processing_label: `GIF処理`,
          notice_gif_processing_description: `GIF処理通知を表示します。`,
          notice_youtube_processing_label: `YouTube処理`,
          notice_youtube_processing_description: `YouTube視聴通知を表示します。`,
          notice_mcp_tool_call_label: `MCPツール呼び出し`,
          notice_mcp_tool_call_description: `汎用MCPツール呼び出し通知を表示します。`,
          notice_respond_embed_label: `応答成功`,
          notice_respond_embed_description: `/bot respond の成功埋め込みを表示します。`,
          notice_impersonation_notice_label: `なりすまし通知`,
          notice_impersonation_notice_description: `ペルソナ/ユーザーなりすまし通知埋め込みを表示します。`,
          notice_fallback_model_usage_label: `フォールバックモデル使用`,
          notice_fallback_model_usage_description: `先行モデル失敗後にフォールバックモデルが応答した際、Fallback Used ボタンを表示します。`,
        },
      },
      humanizer: {
        description: `私の応答がどれだけ「人間らしい」か設定します。カスタムプロンプトを設定するには \`/config system-prompt set\` を使用してください。`,
        modal_title: `ヒューマナイザーレベルの設定`,
        select_label: `ヒューマナイザーレベル`,
        select_description: `応答スタイルを選択してください（デフォルト: 1 ライト）。`,
        choice_none: `0: なし（一括返信）`,
        choice_light: `1: ライト（デフォルト、逐次送信）`,
        choice_medium: `2: ミディアム（タイピングシミュレーション）`,
        choice_heavy: `3: ヘビー（文単位チャンク＆小文字）`,
        desc_none: `有効なシステムプロンプトはそのまま使い、表示テキストはツール呼び出しのない区間ごとに1つの返信へまとめます。ライブ逐次送信やタイピング演出はありません。`,
        desc_light: `有効なシステムプロンプトをそのまま使い、返信は離散メッセージとして逐次送信します。タイピング演出はありません。`,
        desc_medium: `ライト機能 + タイピングインジケーターとメッセージ間のランダムな思考ポーズ。`,
        desc_heavy: `デフォルト機能 + 文単位のメッセージ分割とカジュアルなテキストスタイル（小文字、句読点の削減）。`,
        invalid_value_description: `ヒューマナイザーレベルは {min} から {max} の間でなければなりません。`,
        already_set_title: `ヒューマナイザーは既に設定済みです`,
        already_set_description: `ヒューマナイザーレベルは既に \`{value}\` に設定されています。`,
        success_title: `ヒューマナイザーレベルが更新されました`,
        success_description: `ヒューマナイザーレベルが \`{previous_value}\` から \`{value}\` に変更されました。`,
      },
      "thinking-level": {
        description: `有効なプロバイダー/モデルでは、推論・思考の強さを設定します。`,
        modal_title: `思考レベルの設定`,
        select_label: `思考レベル`,
        select_description: `対応している場合に要求する思考量を選択してください。`,
        choice_auto: `自動`,
        choice_none: `なし`,
        choice_low: `低`,
        choice_medium: `中`,
        choice_high: `高`,
        desc_auto: `プロバイダー側に自動/既定の思考動作がある場合は、それを使います。`,
        desc_none: `可能なら思考を無効化し、無理なら最も低い設定を使います。`,
        desc_low: `軽い推論量を要求して、より速い応答を狙います。`,
        desc_medium: `バランスの取れた推論量を要求します。`,
        desc_high: `利用可能な中で最も高い推論強度または予算を要求します。`,
        invalid_value_description: `有効な思考レベルを選択してください。`,
        already_set_title: `思考レベルは既に設定済みです`,
        already_set_description: `思考レベルは既に \`{value}\` に設定されています。`,
        success_title: `思考レベルを更新しました`,
        success_description: `思考レベルを \`{previous_value}\` から \`{value}\` に変更しました。有効なのは、現在のプロバイダー/モデルがリクエスト側の思考制御に対応している場合のみです。`,
      },
      cooldown: {
        type: {
          choice_off: `オフ`,
          choice_per_user: `ユーザーごと`,
          choice_per_channel: `チャンネルごと`,
          choice_server_wide: `サーバー全体`,
          choice_strict_server_wide: `厳密サーバー全体`,
        },
      },
      "trigger-cascade-limit": {
        description: `最初のペルソナ発動後、追加で何回まで発動を許可するかを設定します（デフォルト: 3）。`,
        limit_description: `最初の発動後に許可する追加発動回数 (0-10、0 = 最初の発動のみ、デフォルト: 3)`,
        limit: {
          invalid_range_title: `無効な上限値`,
          invalid_range_description: `上限は {min} 〜 {max} の範囲で指定してください。`,
          already_set_title: `既に設定済み`,
          already_set_description: `カスケード上限はすでに **{limit}** に設定されています。`,
          success_title: `カスケード上限を更新しました`,
          success_description: `カスケード上限を **{limit}** に設定しました（最初の発動後、{limit} 回まで追加発動を許可）。`,
          success_disabled_title: `カスケードを無効化しました`,
          success_disabled_description: `最初に発動したペルソナのみが応答します。追加の発動は許可されません。`,
        },
      },
      sendlimit: {
        description: `1回の応答で送信するメッセージ数の上限を設定します（デフォルト: 0 = 無制限）。`,
        limit_description: `応答あたりの最大メッセージ数 (0-40、0で無制限、デフォルト: 0)`,
        invalid_range_title: `無効な上限値`,
        invalid_range_description: `上限は {min} 〜 {max} の範囲で指定してください。`,
        already_set_title: `既に設定済み`,
        already_set_description: `送信メッセージ上限はすでに **{limit}** に設定されています。`,
        success_title: `送信上限を更新しました`,
        success_description: `応答は **{limit}** メッセージに制限されます。上限に達すると、文の区切りで自然に停止します。`,
        success_disabled_title: `送信上限を無効化しました`,
        success_disabled_description: `送信メッセージ上限を解除しました。応答は制限されなくなります。`,
      },
      "self-debug": {
        description: `私が送信した診断埋め込みをコンテキストに取り込むか切り替えます。`,
        set_description: `セルフデバッグ埋め込み取り込みを有効または無効にします。`,
        already_set_title: `セルフデバッグは既に設定済みです`,
        already_enabled_description: `セルフデバッグは既に**有効**です。`,
        already_disabled_description: `セルフデバッグは既に**無効**です。`,
        success_title: `セルフデバッグを更新しました`,
        enabled_success: `セルフデバッグを**有効**にしました。私のエラー埋め込みと診断埋め込みを [System: ...] メッセージとしてコンテキストに取り込みます。`,
        disabled_success: `セルフデバッグを**無効**にしました。私のエラー埋め込みと診断埋め込みはコンテキストに取り込みません。`,
      },
      "message-fetch-limit": {
        description: `コンテキスト取得メッセージ数を設定します (20-100、デフォルト: 80)。`,
        limit_description: `コンテキスト取得メッセージ数 (20-100、デフォルト: 80)。`,
        limit: {
          invalid_range_title: `無効な上限値`,
          invalid_range_description: `上限は {min} 〜 {max} の範囲で指定してください。`,
          already_set_title: `既に設定済み`,
          already_set_description: `メッセージ取得上限はすでに **{limit}** に設定されています。`,
          success_title: `メッセージ取得上限を更新しました`,
          success_description: `今後はコンテキスト用に最大 **{limit}** 件のメッセージを取得します。`,
        },
      },
      "trigger-match-limit": {
        description: `1つのメッセージでマッチできるペルソナ数を管理します（デフォルト: 3）。`,
        limit_description: `1メッセージあたりのマッチ上限 (1-10、デフォルト: 3)`,
        limit: {
          invalid_range_title: `無効な上限値`,
          invalid_range_description: `上限は {min} 〜 {max} の範囲で指定してください。`,
          already_set_title: `既に設定済み`,
          already_set_description: `マッチ上限はすでに **{limit}** に設定されています。`,
          success_title: `マッチ上限を更新しました`,
          success_description: `メッセージごとのマッチ上限を **{limit}** に設定しました。`,
        },
      },
      voice: {
        description: `ペルソナごとの音声設定を管理します。`,
        transcripts: {
          description: `音声トランスクリプトのチャットモードを切り替えます。`,
          set_description: `有効にするとトランスクリプトをチャットメッセージとして投稿します。無効にすると内部キャッシュを使用します。`,
          already_set_title: `既に設定済み`,
          already_enabled_description: `このサーバーでは音声トランスクリプトのチャットモードは既に有効になっています。`,
          already_disabled_description: `このサーバーでは音声トランスクリプトのチャットモードは既に無効になっています。`,
          success_title: `音声トランスクリプトモードを更新しました`,
          enabled_success: `音声トランスクリプトのチャットモードが**有効**になりました。音声メッセージはトランスクリプトされ、Webhookを通じてチャットメッセージとして投稿されます。音声ファイルはAIに直接渡されません。`,
          disabled_success: `音声トランスクリプトのチャットモードが**無効**になりました。トランスクリプトは従来通り内部で処理されます。`,
        },
        elevenlabs: {
          description: `ペルソナに使うElevenLabs音声を選択します。`,
          select_persona_title: `音声を設定するペルソナを選択`,
          no_key_title: `ElevenLabs APIキーが設定されていません`,
          no_key_description: `ペルソナの音声を選ぶにはElevenLabsキーが必要です。まず \`/speech elevenlabs\` で接続してください。`,
          voice_fetch_failed_title: `音声一覧を取得できませんでした`,
          voice_fetch_failed_description: `このサーバーで利用できるElevenLabs音声を読み込めませんでした。設定済みキーを確認して、もう一度お試しください。`,
          no_voices_title: `利用可能な音声がありません`,
          no_voices_description: `設定されているElevenLabsアカウントから利用可能な音声が返されませんでした。`,
          modal_title: `ElevenLabs音声を選択`,
          select_label: `音声`,
          select_description: `このペルソナが音声メッセージ生成で使う音声を選択してください。`,
          select_placeholder: `音声を選択...`,
          clear_choice_label: `音声を無効化`,
          clear_choice_description: `このペルソナの現在のElevenLabs音声設定を削除します。`,
          voice_available_description: `利用可能な音声`,
          success_title: `ペルソナの音声を更新しました`,
          success_description: `**{persona}** は今後、ElevenLabs音声メッセージで **{voice}** を使用します。`,
          cleared_title: `ペルソナの音声を解除しました`,
          cleared_description: `**{persona}** のElevenLabs音声設定を削除しました。`,
        },
      },
      setup: {
        description: `初期設定プロセスを開始します。AIプロバイダーとパーソナリティを設定します。`,
        no_presets_found: `データベースに人格プリセットが見つかりません。\`/support discord\`で報告してください。`,
        modal_title: `初期の設定`,
        api_provider_label: `APIプロバイダー`,
        api_provider_description: `お好みのLLMのプロバイダーを選択してください`,
        api_provider_placeholder: `選択してください...`,
        api_provider_custom_endpoint_label: `カスタムエンドポイント（セットアップ後に完了）`,
        api_provider_custom_endpoint_description: `先にセットアップだけを完了し、その後 /config custom-endpoint add と /config model text に進みます。`,
        api_provider_user_byok_label: `なし（ユーザーBYOK）`,
        api_provider_user_byok_description: `サーバー側のテキストプロバイダーなしで初期化します。メンバーは個人プロバイダーを使う必要があります。`,
        api_key_label: `APIキー`,
        api_key_description: `このキーは安全に保存されます。ユーザーBYOK または カスタムエンドポイント（セットアップ後に完了）を選んだ場合は空欄で構いません。取得方法が不明な場合は \`/help api-key\` を使用してください。`,
        api_key_description_with_custom: `APIキーまたはCustomエンドポイントURL。Bearerトークンはセットアップ後に追加可能。`,
        api_key_placeholder: `このキーは誰とも共有しないでください`,
        preset_label: `人格プリセット`,
        preset_description: `人格プリセットを選択してください`,
        preset_placeholder: `人格を選択...`,
        humanizer_label: `人間らしさの度合い`,
        humanizer_description: `どれくらい「人間らしく」返信すべきですか？`,
        humanizer_option_none_label: `なし`,
        humanizer_option_none_desc: `有効なシステムプロンプトを使い、表示テキストをツール呼び出しのない区間ごとに1つの返信へまとめます。`,
        humanizer_option_light_label: `軽`,
        humanizer_option_light_desc: `有効なシステムプロンプトを使い、返信を離散メッセージとして逐次送信します。タイピング演出はありません。`,
        humanizer_option_default_label: `デフォルト`,
        humanizer_option_default_desc: `ライト機能 + タイピングインジケーターとメッセージ間のランダムな思考ポーズ。`,
        humanizer_option_heavy_label: `重`,
        humanizer_option_heavy_desc: `デフォルト機能 + 文単位のメッセージ分割とカジュアルなテキストスタイル（小文字、句読点の削減）。`,
        humanizer_field: `人間らしさ`,
        humanizer_invalid: `無効な人間らしさの度合いです。なし、軽、デフォルト、または重を選択してください。`,
        timezone_label: `タイムゾーンオフセット`,
        timezone_description: `時間単位のUTCオフセット。例：8または+8（シンガポール）、-5（ニューヨーク）、0（ロンドン）。空欄の場合はUTC。`,
        timezone_placeholder: `例：8、-5、0`,
        timezone_invalid_format: `エラー: 無効なタイムゾーン形式です。8、-5、0のような数値を入力してください。入力値: {provided}`,
        timezone_out_of_range: `エラー: タイムゾーンオフセットは{min}から{max}の間でなければなりません。入力値: {provided}`,
        api_key_invalid: `エラー: 提供されたAPIキーは短すぎるか無効です。`,
        api_key_validating: `APIキーを検証中...`,
        api_key_invalid_api: `エラー: プロバイダーがAPIキーを拒否しました。正しいか確認してください。`,
        preset_invalid: `エラー: 無効なペルソナ名です。利用可能なペルソナ名を正確に入力してください: {available}`,
        config_invalid: `エラー: 内部設定の検証に失敗しました。これを報告してください。`,
        setup_failed_description: `エラー: 初期設定構成をデータベースに保存できませんでした。もう一度お試しください。`,
        modal_values_missing: `エラー: 必須入力項目の一部がセットアップフォームから受信されませんでした。もう一度セットアップコマンドをお試しください。`,
        provider_invalid: `エラー: 無効なAPIプロバイダーが選択されました。利用可能なオプションから選択してください。`,
        preset_not_found: `エラー: 選択されたペルソナがデータベースに見つかりませんでした。もう一度お試しください。`,
        success_title: `🟢 設定完了！`,
        success_desc: `このサーバー用に設定が完了しました。私の設定を変更するには、\`/config\`、\`/server\`、\`/persona\`、\`/memory\`コマンドを使用してください。任意ですが推奨：\`/server initialize\` コマンドで絵文字・スタンプのメタデータを最適化できます。データのエクスポートやリセットは\`/memory personal export\`、\`/memory server export\`、\`/personal config\`、\`/server config\`でいつでも可能です。概要は以下の通りです:`,
        success_desc_with_model: `このサーバー用に設定が完了しました。使用モデルは \`{model_name}\`（このプロバイダーのデフォルト）です。私の設定を変更するには、\`/config\`、\`/server\`、\`/persona\`、\`/memory\`コマンドを使用してください。任意ですが推奨：\`/server initialize\` コマンドで絵文字・スタンプのメタデータを最適化できます。データのエクスポートやリセットは\`/memory personal export\`、\`/memory server export\`、\`/personal config\`、\`/server config\`でいつでも可能です。概要は以下の通りです:`,
        success_desc_byok: `このサーバーはユーザーBYOKモードで設定されました。ユーザー発言に対する応答では、このモードを無効にするまで各メンバーの個人プロバイダーが必要になります。任意ですが推奨：\`/server initialize\` コマンドで絵文字・スタンプのメタデータを最適化できます。概要は以下の通りです:`,
        success_desc_custom_endpoint: `このサーバーのセットアップは完了しましたが、まだサーバー側のテキストプロバイダーは有効化されていません。次にカスタムエンドポイントの登録を完了すると、そのエンドポイントで応答できるようになります。概要は以下の通りです:`,
        success_desc_dm: `このダイレクトメッセージ用に設定が完了しました。データのエクスポートやリセットは\`/memory personal export\`と\`/personal config\`でいつでも可能です。概要は以下の通りです:`,
        success_desc_dm_with_model: `このダイレクトメッセージ用に設定が完了しました。使用モデルは \`{model_name}\`（このプロバイダーのデフォルト）です。データのエクスポートやリセットは\`/memory personal export\`と\`/personal config\`でいつでも可能です。概要は以下の通りです:`,
        next_steps_title: `🟢 私に何ができる？`,
        next_steps_description: `{helpFeatures}で全機能を確認するか、チャットで直接聞いてみてください！使えるスラッシュコマンドも教えられます。`,
        novelai_expressions_warning_field: `⚠️ 表現機能の無効化`,
        novelai_expressions_warning_value: `NovelAIのコンテキストを安定させるため、絵文字とスタンプの使用が自動的に無効化されました。でいつでも再有効化できます。`,
        zai_tos_warning_field: `⚠️ Z.ai利用規約について`,
        zai_tos_warning_value: `Z.aiの利用規約が更新され、コーディング/エージェントのユースケースのみが許可されるようになりました。Z.aiを一般チャットに使用する場合は自己責任となり、規約に違反する可能性があります。`,
        custom_bearer_hint_field: `🔑 Bearerトークン`,
        custom_bearer_hint_value: `エンドポイントに認証が必要な場合は、{apiKeySet}または{providerSwitch}でBearerトークンを追加してください。`,
        preset_field: `人格プリセット`,
        name_field: `私の名前`,
        byok_bootstrap_field: `ユーザーBYOK`,
        byok_bootstrap_value: `セットアップ中に有効化されました。今後、ユーザー発言に対する応答ではメンバーごとの個人プロバイダーが必要です。後で無効にするには {toggle_command} を使い、メンバー向けの設定手順は {help_personal_provider} を確認してください。`,
        custom_endpoint_bootstrap_field: `カスタムエンドポイント`,
        custom_endpoint_bootstrap_value: `次に {custom_models_add_command} でエンドポイントを登録し、{model_text_command} または対応するモデルコマンドで有効化してください。詳しい手順は {help_custom_models_command}、{help_speech_command}、{help_transcription_command} を確認してください。`,
        dm_context_explanation_title: `ダイレクトメッセージについて`,
        dm_context_explanation: `このダイレクトメッセージでも「サーバー」として参照します。つまり、すべての「サーバー」機能が同じように動作しますが、私たちだけのプライベートな空間です！このダイレクトメッセージを私との1対1サーバーと考えてください。「サーバーメモリー」はここでのみの私の記憶です。`,
        already_setup_title: `既に設定済みです`,
        already_setup_summary_description: `このサーバーは既に設定されています。現在のテキストプロバイダー状態と、すぐに変更するための手順を表示します。`,
        current_provider_field: `現在のテキストプロバイダー`,
        current_byok_field: `ユーザーBYOK`,
        current_byok_enabled_value: `有効。ユーザー発言に対する応答では各メンバーの個人プロバイダーが必要です。{toggle_command} で切り替えられます。`,
        current_byok_disabled_value: `無効。個人プロバイダーが有効でない場合は、ユーザー発言でもサーバープロバイダーを使えます。{toggle_command} で切り替えられます。`,
        already_setup_next_steps_field: `次のステップ`,
        already_setup_next_steps_value: `{provider_add_command} で別のサーバープロバイダーを保存し、{model_text_command} でアクティブなテキストモデルを切り替え、{byok_toggle_command} でBYOKモードを切り替えられます。メンバー向けの個人プロバイダー手順は {help_personal_provider} を確認してください。`,
        broken_state_title: `設定が破損しています`,
        broken_state_description: `このサーバーにはペルソナが存在しますが、設定が不完全です。サーバー設定またはAIモデルの参照が見つからないか、削除されています。\n\n{model_text_command} で有効なモデルを割り当てるか、{provider_add_command} で新しいプロバイダーを登録してください。問題が解決しない場合は、サーバー管理者にお問い合わせください。`,
        already_setup_description: `このサーバーでは既に設定が完了しています。設定を変更するには、\`/config\`、\`/persona\`、\`/memory\`、\`/server\`などの他のコマンドを使用してください。

				プロバイダーを変更したい場合は、\`/config provider add\`で新しいプロバイダーを登録し、\`/config model text\`でアクティブにしてください。`,
      },
      params: {
        description: `AI生成品質のサンプリングパラメーターを調整します。`,
        manage: {
          description: `現在のプロバイダーに送信するサンプリングパラメーターを選びます。`,
          modal_title: `サンプリングパラメーター管理`,
          checkbox_label: `サンプリングパラメーター`,
          checkbox_label_continued: `サンプリングパラメーター（続き）`,
          checkbox_description: `チェック済み = 有効、未チェック = 無効です。有効でもリクエスト時に省略される場合があります。`,
          checkbox_description_anthropic: `チェック済み = 有効、未チェック = 無効です。Anthropic では Temperature と Top-P を同時送信できないため、両方有効な場合は現在 Temperature が送信され、Top-P は省略されます。`,
          option_description_supported: `現在値: {value} ・ {status}`,
          option_description_unsupported: `現在値: {value} ・ {provider} では非対応`,
          state_disabled: `無効`,
          state_enabled_custom: `有効（カスタム値を送信）`,
          state_enabled_default: `有効（{provider} の既定値を使用）`,
          state_enabled_omitted_conflict: `有効（現在は {provider} に送信しません）`,
          no_changes_title: `パラメーター変更なし`,
          no_changes_description: `**{provider}** の送信/省略設定に変更はありませんでした。`,
          success_title: `サンプリングパラメーターを更新しました`,
          success_description: `**{provider}** へ送るサンプリングパラメーターを更新しました。
有効 ({enabled_count}): {enabled_list}
無効 ({omitted_count}): {omitted_list}`,
        },
        temperature: {
          description: `応答の創造性/ランダム性を設定します（0〜2.0、デフォルト: 1.0）。`,
          value_description: `0（決定的）から2.0（非常にランダム）の間の値。デフォルト: 1.0。`,
          invalid_value_title: `無効なTemperature`,
          invalid_value_description: `Temperatureは {min} から {max} の間でなければなりません。`,
          already_set_title: `Temperatureは既に設定済みです`,
          already_set_description: `Temperatureは既に \`{temperature}\` に設定されています。`,
          success_title: `Temperatureが更新されました`,
          success_description: `LLMのTemperatureが \`{previous_temperature}\` から \`{temperature}\` に変更されました。
**対応プロバイダー:** {supported_providers}`,
        },
        "top-p": {
          description: `Top-P（核サンプリング）のしきい値を設定します（デフォルト: 0.95）。`,
          value_description: `サンプリングする確率質量（0.0=非常に制限的、1.0=完全分布）。デフォルト: 0.95。`,
          invalid_value_title: `無効なTop-P値`,
          invalid_value_description: `Top-Pは {min} から {max} の間でなければなりません。`,
          already_set_title: `Top-Pは既に設定済みです`,
          already_set_description: `Top-Pは既に \`{top_p}\` に設定されています。`,
          success_title: `Top-Pが更新されました`,
          success_description: `Top-Pが \`{previous_top_p}\` から \`{top_p}\` に変更されました。
**対応プロバイダー:** {supported_providers}`,
        },
        "top-k": {
          description: `Top-K（候補トークン数）の上限を設定します（デフォルト: 0）。`,
          value_description: `サンプリングするトークン数（0=無効、最大40）。デフォルト: 0。`,
          invalid_value_title: `無効なTop-K値`,
          invalid_value_description: `Top-Kは {min} から {max} の間でなければなりません。`,
          already_set_title: `Top-Kは既に設定済みです`,
          already_set_description: `Top-Kは既に \`{top_k}\` に設定されています。`,
          success_title: `Top-Kが更新されました`,
          success_description: `Top-Kが \`{previous_top_k}\` から \`{top_k}\` に変更されました。
**対応プロバイダー:** {supported_providers}`,
        },
        "frequency-penalty": {
          description: `繰り返しトークンへの頻度ペナルティを設定します（デフォルト: 0.0）。`,
          value_description: `頻出トークンへのペナルティ（-2.0〜2.0、2.0は1.99で保存）。デフォルト: 0.0。`,
          invalid_value_title: `無効なFrequency Penalty`,
          invalid_value_description: `Frequency penaltyは {min} から {max} の間でなければなりません。`,
          already_set_title: `Frequency Penaltyは既に設定済みです`,
          already_set_description: `Frequency penaltyは既に \`{frequency_penalty}\` に設定されています。`,
          success_title: `Frequency Penaltyが更新されました`,
          success_description: `Frequency penaltyが \`{previous_frequency_penalty}\` から \`{frequency_penalty}\` に変更されました。
**対応プロバイダー:** {supported_providers}`,
        },
        "presence-penalty": {
          description: `繰り返しトピックへの存在ペナルティを設定します（デフォルト: 0.0）。`,
          value_description: `既出トピックへのペナルティ（-2.0〜2.0、2.0は1.99で保存）。デフォルト: 0.0。`,
          invalid_value_title: `無効なPresence Penalty`,
          invalid_value_description: `Presence penaltyは {min} から {max} の間でなければなりません。`,
          already_set_title: `Presence Penaltyは既に設定済みです`,
          already_set_description: `Presence penaltyは既に \`{presence_penalty}\` に設定されています。`,
          success_title: `Presence Penaltyが更新されました`,
          success_description: `Presence penaltyが \`{previous_presence_penalty}\` から \`{presence_penalty}\` に変更されました。
**対応プロバイダー:** {supported_providers}`,
        },
        "min-p": {
          description: `Min-P（最小確率）のしきい値を設定します（デフォルト: 0.0）。`,
          value_description: `上位トークンに対する最小トークン確率（0.0=無効、1.0=最も制限的）。デフォルト: 0.0。`,
          invalid_value_title: `無効なMin-P値`,
          invalid_value_description: `Min-Pは {min} から {max} の間でなければなりません。`,
          already_set_title: `Min-Pは既に設定済みです`,
          already_set_description: `Min-Pは既に \`{min_p}\` に設定されています。`,
          success_title: `Min-Pが更新されました`,
          success_description: `Min-Pが \`{previous_min_p}\` から \`{min_p}\` に変更されました。
**対応プロバイダー:** {supported_providers}`,
        },
      },
      timezone: {
        description: `サーバーのUTCオフセットを設定します（デフォルト: 0 / UTC）。`,
        value_description: `UTCオフセット（時間、デフォルト: 0）。例: 8、-5、0、9`,
        invalid_value_title: `無効なタイムゾーンオフセット`,
        invalid_value_description: `タイムゾーンオフセットは {min} から {max} 時間の間でなければなりません。`,
        already_set_title: `タイムゾーンは既に設定済みです`,
        already_set_description: `タイムゾーンは既に \`{timezone}\` に設定されています。`,
        success_title: `タイムゾーンが更新されました`,
        success_description: `サーバーのタイムゾーンが \`{previous_timezone}\` から \`{timezone}\` に変更されました。`,
      },
      "system-prompt": {
        description: `人格指示のためのカスタムシステムプロンプトを管理します`,
      },
      prompt: {
        change: {
          command_description: `行動を導くカスタムシステムプロンプトを設定します`,
          modal_title: `カスタムシステムプロンプトを設定`,
          part1_label: `システムプロンプト（1/4）`,
          part1_description: `Discord の 4000 文字制限により、プロンプト入力は 4 つに分割されています。`,
          part1_placeholder: `例：{bot} はフレンドリーで親切...`,
          part2_label: `システムプロンプト（2/4）- 任意`,
          part2_placeholder: `追加の指示...`,
          part3_label: `システムプロンプト（3/4）- 任意`,
          part3_placeholder: `さらに指示...`,
          part4_label: `システムプロンプト（4/4）- 任意`,
          part4_placeholder: `最後の指示...`,
          empty_prompt_title: `空のシステムプロンプト`,
          empty_prompt_description: `システムプロンプトは空にできません。少なくともパート1に指示を入力してください。`,
          success_title: `システムプロンプトが更新されました`,
          success_description: `カスタムシステムプロンプトを設定しました：
\`\`\`
{preview}...
\`\`\``,
        },
        clear: {
          command_description: `カスタムシステムプロンプトを削除してデフォルトプロンプトに戻します`,
          no_custom_prompt_title: `カスタムプロンプトは未設定です`,
          no_custom_prompt_description: `カスタムシステムプロンプトは設定されていません。現在はデフォルトのプロンプトを使用しています：
\`\`\`
{defaultPrompt}
\`\`\``,
          success_title: `システムプロンプトがクリアされました`,
          success_description: `カスタムシステムプロンプトをクリアしました。現在はデフォルトのプロンプトを使用します：
\`\`\`
{defaultPrompt}
\`\`\``,
        },
        preset: {
          command_description: `システムプロンプトのプリセットを適用します`,
          modal_title: `システムプロンプトプリセットを選択`,
          selection_label: `プリセットを選択`,
          selection_placeholder: `プリセットのプロンプトスタイルを選択...`,
          success_title: `✓ プリセットが適用されました`,
          success_description: `システムプロンプトプリセットを適用しました：**{presetName}**
プレビュー：
\`\`\`
{preview}...
\`\`\``,
          no_presets_title: `プリセットがありません`,
          no_presets_description: `システムプロンプトプリセットが見つかりません。ボット管理者にお問い合わせください。`,
          invalid_preset_title: `無効なプリセット`,
          invalid_preset_description: `選択されたプリセットが見つかりませんでした。もう一度お試しください。`,
        },
      },
      "context-note": {
        description: `会話履歴に注入するリマインダーを管理します`,
        set: {
          description: `会話履歴の特定の深さに短いリマインダーを設定します`,
          scope_description: `リマインダーの保存先（特定のペルソナまたはサーバー全体）`,
          persona_option: `ペルソナ（特定のペルソナに紐付け）`,
          global_option: `グローバル（ペルソナに設定がない場合のサーバー全体のフォールバック）`,
          modal_title: `コンテキストリマインダーを設定`,
          text_label: `リマインダー`,
          text_placeholder: `空白にすると削除されます。ドリフトを防ぐために会話履歴に挿入される短いプロンプト。`,
          depth_label: `深さ（0 = 返信に最も近い、最大100）`,
          depth_placeholder: `0 = 最新メッセージの直前`,
          success_set_title: `コンテキストリマインダーを更新しました`,
          success_set_description: `**スコープ：** {scope}
**深さ：** 最下部から {depth} メッセージ
**プレビュー：**
\`\`\`
{preview}
\`\`\``,
          success_removed_title: `コンテキストリマインダーを削除しました`,
          success_removed_description: `**{scope}** のコンテキストリマインダーをクリアしました。`,
          invalid_depth_title: `無効な深さ`,
          invalid_depth_description: `深さは **0** から **100** の整数で指定してください。`,
          no_personas_title: `ペルソナが見つかりません`,
          no_personas_description: `このサーバーにはまだペルソナが設定されていません。先に \`/config setup\` を使用してください。`,
        },
      },
      "random-trigger": {
        add: {
          description: `チャンネルに確率的なタイマーベースの自動トリガーを追加します。`,
          channel_description: `自発的なメッセージを送信するチャンネル。`,
          timer_hours_description: `サイコロを振る頻度（時間単位、最低1時間）。`,
          random_offset_range_description: `タイマーがリセットされるたびに加算/減算するランダムオフセット範囲（時間、任意、最小0）。`,
          chance_description: `各ロールで発火する確率（1〜100%）。`,
          silence_threshold_description: `このX時間以内にチャンネルに活動があった場合はスキップ（任意）。`,
          failure_threshold_description: `連続してサイコロを外れた回数がこの値に達したら強制発火し、カウンターをリセットします（任意）。`,
          modal_title: `ランダムトリガーの設定`,
          persona_select_label: `ペルソナ`,
          persona_select_placeholder: `ペルソナを選択...`,
          persona_random_label: `ランダム（毎回選択）`,
          respond_to_self_label: `自分への返答`,
          respond_to_self_description: `このペルソナが最後に発言した場合でも発火しますか？`,
          respond_to_self_yes: `はい`,
          prompt_label: `カスタムプロンプト（任意）`,
          prompt_description: `このトリガーのメッセージに注入される追加指示。`,
          prompt_placeholder: `例：天気について話題を始めて...`,
          cap_reached_title: `トリガー上限に達しました`,
          cap_reached_description: `このサーバーはランダムトリガーの最大数{max}に達しました。先に1つ削除してください。`,
          override_title: `トリガーが更新されました`,
          override_description: `{channel}の{persona}のトリガーが既に存在していたため、新しい設定で更新されました。`,
          success_title: `ランダムトリガーを追加しました`,
          success_description: `{channel}を**{timer_hours}時間**ごとに確認し、**{chance}%**の確率で**{persona}**として発言します。{offset_suffix}{silence_suffix}{failure_suffix}`,
          success_offset_suffix: ` リセットごとに最大**+/-{random_offset_range}時間**のランダムオフセットを加算/減算します。`,
          success_silence_suffix: ` **{silence_threshold}時間**以内に活動があった場合はスキップします。`,
          success_failure_suffix: ` **{failure_threshold}**回連続でミスした場合に強制発火します。`,
        },
        remove: {
          description: `このサーバーからランダムトリガーを削除します。`,
          modal_title: `ランダムトリガーの削除`,
          checkbox_label: `ランダムトリガー`,
          checkbox_label_continued: `ランダムトリガー（続き）`,
          checkbox_description: `削除したいランダムトリガーのチェックを外してください。`,
          select_label: `削除するトリガー`,
          select_description: `削除するランダムトリガーを選択します。`,
          select_placeholder: `トリガーを選択...`,
          none_title: `トリガーが見つかりません`,
          none_description: `このサーバーにはランダムトリガーが設定されていません。`,
          no_removals_title: `削除されたランダムトリガーはありません`,
          no_removals_description: `どのランダムトリガーも未チェックになっていません。変更は行われていません。`,
          success_title: `ランダムトリガーを更新しました`,
          success_description: `次のランダムトリガーを削除しました。
{triggers_removed}`,
        },
      },
      remove: {
        modeloverride: {
          description: `チャンネルとペルソナのモデル上書きを削除します。`,
          modal_title: `モデル上書きの削除`,
          channel_checkbox_label: `チャンネル上書き`,
          channel_checkbox_label_continued: `チャンネル上書き（続き）`,
          channel_checkbox_description: `削除したいチャンネル上書きのチェックを外してください。`,
          persona_checkbox_label: `ペルソナ上書き`,
          persona_checkbox_label_continued: `ペルソナ上書き（続き）`,
          persona_checkbox_description: `削除したいペルソナ上書きのチェックを外してください。`,
          none_title: `モデル上書きなし`,
          none_description: `このサーバーにはチャンネルまたはペルソナのモデル上書きが設定されていません。`,
          too_many_title: `モデル上書きが多すぎます`,
          too_many_description: `このサーバーにはチャンネル上書きが **{channel_count}** 件、ペルソナ上書きが **{persona_count}** 件（合計 **{total_count}** 件）あります。Discord のモーダルではチェックボックスグループを **{max_groups}** 個（合計 **{max_entries}** 項目）までしか表示できません。`,
          no_removals_title: `削除されたモデル上書きはありません`,
          no_removals_description: `どの上書きも未チェックになっていません。モデル上書きは変更されていません。`,
          success_title: `モデル上書きを更新しました`,
          success_description: `次のモデル上書きを削除しました。
{removed_overrides}`,
        },
      },
    },
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
    server: {
      "user-byok": {
        description: `このサーバーのメンバー持ち込みプロバイダーモードを管理します。`,
        toggle: {
          description: `ユーザー発言にメンバー自身の個人プロバイダーを必須にするか切り替えます。`,
          enabled_title: `ユーザーBYOKが有効になりました`,
          enabled_description: `ユーザーが発言したメッセージには、各メンバーの個人プロバイダー設定が必要になりました。サーバー起点のトリガーは引き続きサーバープロバイダーを使用します。`,
          disabled_title: `ユーザーBYOKが無効になりました`,
          disabled_description: `個人プロバイダーが有効でない場合でも、ユーザー発言でサーバープロバイダーを使えるようになりました。`,
        },
      },
      config: {
        description: `サーバー設定データを管理します。`,
        export: {
          description: `サーバー設定をエクスポートします（記憶、ペルソナ、個人設定を除く）。`,
        },
        import: {
          description: `サーバー設定をインポートします（記憶、ペルソナ、個人設定を除く）。`,
          file_description: `サーバー設定のJSONファイル。`,
          confirmation_description: `警告：インポートするファイルの内容に応じて、既存のサーバー設定が置き換えられる場合があります。続行しますか？`,
          confirmation_choice_yes: `はい、インポートする`,
          confirmation_choice_no: `いいえ、キャンセル`,
        },
        remove: {
          description: `このサーバーの設定をリセットします。`,
          confirmation_description: `このサーバーの設定をリセットしてよいか確認します。`,
          confirmation_choice_yes: `はい、リセットする`,
          confirmation_choice_no: `いいえ、キャンセル`,
        },
      },
      stm: {
        description: `全ペルソナのサーバー共有STMを管理`,
        "privacy-bypass": {
          description: `プライベートチャンネルのSTMが非プライベートチャンネルに漏れるかどうかを切り替えます。`,
          enabled_title: `STMプライバシーバイパス有効`,
          enabled_description: `プライベートチャンネルのSTMが非プライベートチャンネルにも表示されるようになりました。隔離ガードが解除されています。`,
          disabled_title: `STMプライバシーバイパス無効`,
          disabled_description: `プライベートチャンネルのSTMは再び隔離され、そのチャンネル外には表示されなくなりました。`,
        },
        manage: {
          description: `各ペルソナの有効なサーバー共有STMを確認してクリアします。`,
          modal_title: `有効なサーバーSTMを管理`,
          checkbox_label: `有効なSTM`,
          checkbox_label_continued: `有効なSTM（続き）`,
          checkbox_description: `このサーバーからクリアしたいSTMのチェックを外してください。`,
          none_title: `有効なSTMはありません`,
          none_description: `現在、このサーバーには有効なサーバー共有STMがありません。`,
          too_many_title: `有効なSTMが多すぎます`,
          too_many_description: `このサーバーには現在 **{count}** 件の有効なSTMがあります。Discordのモーダルではチェックボックスグループを **{max_groups}** 個まで（合計 **{max_entries}** 件まで）しか表示できません。`,
          no_changes_title: `STMはクリアされませんでした`,
          no_changes_description: `すべてのSTMがチェックされたままだったため、クリアされた項目はありません。`,
          success_title: `サーバーSTMをクリアしました`,
          success_description: `サーバー共有STMを **{cleared_count}** 件クリアしました:
{cleared_entries}`,
          unscoped_label: `未分類STM`,
          no_summary: `要約なし`,
          more_cleared: `- ...他 {count} 件`,
        },
      },
      "private-channels": {
        description: `STMを隔離し、思考ログを抑制するプライベートチャンネルを管理します`,
        modal_title: `プライベートチャンネルを管理`,
        checkbox_label: `プライベートチャンネル`,
        checkbox_label_continued: `プライベートチャンネル（続き）`,
        checkbox_description: `チェックしたチャンネルはプライベートのままです。外したチャンネルはプライベート設定から外れます。`,
        no_channels_title: `対象チャンネルはありません`,
        no_channels_description: `このサーバーには管理できるテキストチャンネルがありません。`,
        select_page_title: `プライベートチャンネルを管理`,
        select_page_description: `このサーバーには対象テキストチャンネルが **{channel_count}** 件あり、**{total_pages}** ページに分かれています。
現在プライベート: **{selected_count}**。`,
        done_button: `完了`,
        too_many_pages_title: `チャンネルが多すぎます`,
        too_many_pages_description: `このサーバーには対象テキストチャンネルが **{channel_count}** 件あります。このチェックリスト操作は1回につき **{max_pages}** ページまで対応します。`,
        no_changes_title: `プライベートチャンネルの変更はありません`,
        no_changes_description: `プライベートチャンネル設定は変更されませんでした。`,
        success_title: `プライベートチャンネルを更新しました`,
        success_description: `プライベート設定を有効化したチャンネル **{enabled_count}** 件: {enabled_channels}
プライベート設定を無効化したチャンネル **{disabled_count}** 件: {disabled_channels}
現在 **{selected_count}** 件のチャンネルがプライベートです。`,
      },
      "crosschannel-blocklist": {
        description: `ツールによるクロスチャンネル送信のチャンネルブロックリストを管理`,
        modal_title: `クロスチャンネルブロックリスト`,
        checkbox_label: `ブロック対象チャンネル`,
        checkbox_label_continued: `ブロック対象チャンネル（続き）`,
        checkbox_description: `チェックしたチャンネルにはツールによるクロスチャンネル送信を行えません。`,
        option_description_category: `カテゴリ: {category_name}`,
        channel_label_forum: `{channel_name} [フォーラム]`,
        channel_label_media: `{channel_name} [メディア]`,
        no_channels_title: `対象チャンネルはありません`,
        no_channels_description: `このサーバーには管理できるテキスト、告知、フォーラム、メディアチャンネルがありません。`,
        select_page_title: `クロスチャンネルブロックリストを管理`,
        select_page_description: `このサーバーには対象チャンネルが **{channel_count}** 件あり、**{total_pages}** ページに分かれています。
現在ブロック中: **{blocked_count}**。
確認したいページを選ぶか、完了したら「完了」を押してください。`,
        done_button: `完了`,
        too_many_pages_title: `チャンネルが多すぎます`,
        too_many_pages_description: `このサーバーには対象チャンネルが **{channel_count}** 件あります。このチェックリスト操作は1回につき **{max_pages}** ページまで対応します。`,
        no_changes_title: `ブロックリストの変更はありません`,
        no_changes_description: `クロスチャンネルブロックリストは変更されませんでした。`,
        success_title: `クロスチャンネルブロックリストを更新しました`,
        success_description: `ブロックを有効化したチャンネル **{enabled_count}** 件: {enabled_channels}
ブロックを無効化したチャンネル **{disabled_count}** 件: {disabled_channels}
現在 **{blocked_count}** 件のチャンネルがブロックされています。`,
      },
      "rp-channels": {
        description: `\`/delete turn\`が出来て絵文字とスタンプを常に抑制するチャンネルを管理します`,
        modal_title: `RPチャンネルを管理`,
        checkbox_label: `RPチャンネル`,
        checkbox_label_continued: `RPチャンネル（続き）`,
        checkbox_description: `チェックしたチャンネルはRPチャンネルのままです。外したチャンネルはRP設定から外れます。`,
        no_channels_title: `対象チャンネルはありません`,
        no_channels_description: `このサーバーには管理できるテキストチャンネルがありません。`,
        select_page_title: `RPチャンネルを管理`,
        select_page_description: `このサーバーには対象テキストチャンネルが **{channel_count}** 件あり、**{total_pages}** ページに分かれています。
現在RP設定中: **{selected_count}**。`,
        done_button: `完了`,
        too_many_pages_title: `チャンネルが多すぎます`,
        too_many_pages_description: `このサーバーには対象テキストチャンネルが **{channel_count}** 件あります。このチェックリスト操作は1回につき **{max_pages}** ページまで対応します。`,
        no_changes_title: `RPチャンネルの変更はありません`,
        no_changes_description: `RPチャンネル設定は変更されませんでした。`,
        success_title: `RPチャンネルを更新しました`,
        success_description: `RP設定を有効化したチャンネル **{enabled_count}** 件: {enabled_channels}
RP設定を無効化したチャンネル **{disabled_count}** 件: {disabled_channels}
現在 **{selected_count}** 件のチャンネルがRP設定中です。`,
      },
      "auto-trigger": {
        description: `自動チャット設定を管理`,
        channels: {
          description: `私が自動的にチャットするチャンネルの保存済みセットを管理するか、1つのチャンネルに使うペルソナを設定します。`,
          channel_description: `設定したい単一のテキストチャンネルです。空欄なら一括チェックリストを開きます。`,
          modal_title: `自動トリガーチャンネルを管理`,
          checkbox_label: `自動トリガーチャンネル`,
          checkbox_label_continued: `自動トリガーチャンネル（続き）`,
          checkbox_description: `チェックしたチャンネルは自動トリガー対象のままです。外したチャンネルは対象外になります。`,
          single_modal_title: `自動トリガーチャンネルを設定`,
          single_enabled_label: `自動トリガーを有効化`,
          single_enabled_description: `このチャンネルで自動トリガーを有効または無効にします。`,
          single_persona_label: `自動トリガーペルソナ`,
          single_persona_description: `このチャンネルで自動トリガーとチャンネル限定の常時応答に使うペルソナを選択します。`,
          single_persona_placeholder: `現在: {persona}`,
          main_persona_description: `メインペルソナ`,
          alter_persona_description: `オルタペルソナ`,
          no_channels_title: `対象チャンネルはありません`,
          no_channels_description: `このサーバーには管理できるテキストチャンネルがありません。`,
          invalid_channel_title: `無効なチャンネル`,
          invalid_channel_description: `自動トリガーに使えるサーバーのテキストチャンネルを選択してください。`,
          select_page_title: `自動トリガーチャンネルを管理`,
          select_page_description: `このサーバーには対象テキストチャンネルが **{channel_count}** 件あり、**{total_pages}** ページに分かれています。
現在有効: **{selected_count}**。`,
          done_button: `完了`,
          too_many_pages_title: `チャンネルが多すぎます`,
          too_many_pages_description: `このサーバーには対象テキストチャンネルが **{channel_count}** 件あります。このチェックリスト操作は1回につき **{max_pages}** ページまで対応します。`,
          no_changes_title: `自動トリガーチャンネルの変更はありません`,
          no_changes_description: `自動トリガーチャンネル設定は変更されませんでした。`,
          success_title: `自動トリガーチャンネルを更新しました`,
          success_description: `自動トリガーを有効化したチャンネル **{enabled_count}** 件: {enabled_channels}
自動トリガーを無効化したチャンネル **{disabled_count}** 件: {disabled_channels}
現在 **{selected_count}** 件のチャンネルが有効です。`,
          single_success_title: `自動トリガーチャンネルを更新しました`,
          single_success_enabled_description: `{channel} で自動トリガーを有効化し、**{persona}** を使うようにしました。`,
          single_success_disabled_description: `{channel} での自動トリガーを無効化しました。`,
        },
        threshold: {
          description: `設定済みの自動チャットチャンネル用の共有自動チャット範囲を設定します。`,
          threshold_description: `自動チャットまでの最小メッセージ数。0 で常時応答モードになります。`,
          max_description: `自動チャットまでの任意の最大メッセージ数。空欄なら最小値と同じになります。`,
          invalid_range_title: `無効な閾値`,
          invalid_range_specific_description: `常時応答モードには \`{always}\` を使用してください。それ以外は、両方の値を \`{min}\` から \`{max}\` の間にし、最大値を最小値以上にしてください。`,
          success_title: `自動チャット閾値が設定されました`,
          success_description: `指定されたチャンネルで \`{threshold}\` メッセージ後に自動的にチャットします。`,
          success_range_title: `自動チャット範囲が設定されました`,
          success_range_description: `指定されたチャンネルで、\`{min}\` から \`{max}\` メッセージのランダムな間隔で自動的にチャットします。`,
          success_always_title: `自動チャット常時応答モードを設定しました`,
          success_always_description: `自動チャットの閾値を \`{threshold}\` に設定しました。設定済みの自動チャットチャンネルでは、対象メッセージに対して常時応答のように動作します。無効化したい場合はそのチャンネルをリストから削除してください。`,
        },
      },
      trigger: {
        description: `トリガーワードを管理`,
        add: {
          description: `ペルソナのトリガーワードを追加します。`,
          modal_title: `トリガーワードを追加`,
          persona_select_label: `ペルソナ`,
          persona_select_description: `追加先のペルソナを選択してください。`,
          persona_select_placeholder: `ペルソナを選択...`,
          triggers_input_label: `トリガーワード`,
          triggers_input_description: `カンマ区切りで入力してください（"," または "、"）。`,
          triggers_input_placeholder: `例: ともり, トモリ`,
          main_persona_description: `メインペルソナ`,
          alter_persona_description: `オルタペルソナ`,
          no_triggers_title: `トリガーワードがありません`,
          no_triggers_description: `少なくとも1つのトリガーワードを入力してください。`,
          too_short_title: `トリガーワードが短すぎます`,
          too_short_description: `トリガーワードは少なくとも2文字以上である必要があります。`,
          content_too_long_title: `トリガーワードが長すぎます`,
          content_too_long_description: `トリガーワードは {max_length} 文字を超えることはできません。`,
          already_exists_title: `トリガーワードが存在します`,
          already_exists_description: `単語 \`{word}\` は既にトリガーリストにあります。`,
          already_exists_multiple_description: `これらのトリガーワードは既に存在します: {words}。`,
          limit_exceeded_title: `トリガーワード上限に達しました`,
          limit_exceeded_description: `このサーバーはトリガーワードを最大 {max_allowed} 個まで設定できます（現在 {current_count} 個）。新しいものを追加する前に、\`/server trigger remove\`でいくつかのトリガーワードを削除してください。`,
          success_title: `トリガーワードが追加されました`,
          success_description: `{persona_name} に {added_count} 個のトリガーワードを追加しました: {added_words}。現在 {word_count} 個のトリガーワードがあります。`,
        },
        remove: {
          description: `言及されたときに私が応答する単語を削除します。`,
          no_triggers_title: `トリガーワードがありません`,
          no_triggers_description: `削除するカスタムトリガーワードが設定されていません。\`/server trigger add\`で追加してください。`,
          select_description: `削除したいトリガーワードを選択してください`,
          modal_title: `トリガーワードの削除`,
          checkbox_label: `トリガーワード`,
          checkbox_label_continued: `トリガーワード（続き）`,
          checkbox_description: `削除したいトリガーワードのチェックを外してください。`,
          select_label: `トリガーワード`,
          select_placeholder: `削除するトリガーワードを選択してください`,
          no_removals_title: `削除されたトリガーワードはありません`,
          no_removals_description: `どのトリガーワードも未チェックになっていません。変更は行われていません。`,
          success_title: `トリガーワードを更新しました`,
          success_description: `次のトリガーワードを削除しました: {triggerWords}`,
        },
      },
      "user-blacklist": {
        description: `このサーバーのパーソナライズ用ブラックリストを管理します。`,
        add: {
          description: `メンバーをパーソナライズのブラックリストに追加します。`,
          member_description: `ブラックリストに追加するメンバー。`,
          personalization_disabled_title: `パーソナライズが無効です`,
          personalization_disabled_description: `現在、サーバー全体でパーソナライズが無効になっています。まず \`/config tools manage\` で有効にしてください。`,
          already_blacklisted_title: `既にブラックリストに登録されています`,
          already_blacklisted_description: `\`{user_name}\` は既にパーソナライズのブラックリストに登録されています。`,
          cannot_blacklist_bot_title: `ボットをブラックリスト登録できません`,
          cannot_blacklist_bot_description: `\`{user_name}\` はボットであり、パーソナライズのブラックリストに追加できません。`,
          success_title: `メンバーがブラックリストに登録されました`,
          success_description: `\`{user_name}\` をパーソナライズのブラックリストに追加しました。彼らの個人的な記憶とニックネームは使用されません。`,
        },
        remove: {
          description: `現在ブラックリスト中のメンバーを確認し、解除したいもののチェックを外します。`,
          none_title: `ブラックリスト中のメンバーはいません`,
          none_description: `現在管理するブラックリスト登録メンバーはいません。`,
          modal_title: `ユーザーブラックリストを管理`,
          checkbox_label: `ブラックリスト中のメンバー`,
          checkbox_label_continued: `ブラックリスト中のメンバー（続き）`,
          checkbox_description: `チェックしたメンバーはブラックリストのままです。外したメンバーはブラックリストから解除されます。`,
          select_page_title: `ユーザーブラックリストを管理`,
          select_page_description: `このサーバーにはブラックリスト登録メンバーが **{user_count}** 人おり、**{total_pages}** ページに分かれています。
現在ブラックリスト中: **{selected_count}**。`,
          done_button: `完了`,
          too_many_pages_title: `ブラックリスト登録メンバーが多すぎます`,
          too_many_pages_description: `このサーバーにはブラックリスト登録メンバーが **{user_count}** 人います。このチェックリスト操作は1回につき **{max_pages}** ページまで対応します。`,
          no_changes_title: `ブラックリストの変更はありません`,
          no_changes_description: `ユーザーブラックリストは変更されませんでした。`,
          success_title: `ユーザーブラックリストを更新しました`,
          success_description: `ブラックリストから **{removed_count}** 人を解除しました: {removed_users}
現在 **{selected_count}** 人がブラックリスト中です。`,
        },
      },
      "welcome-channel": {
        description: `新規メンバー向けの自動歓迎メッセージ設定を管理します。`,
        shared: {
          modal_title: `歓迎メッセージを設定`,
          persona_select_label: `歓迎ペルソナ`,
          persona_select_description: `新規メンバーを歓迎するペルソナを選択します。ランダムは参加ごとに選びます。`,
          persona_select_placeholder: `ペルソナを選択...`,
          persona_random_label: `ランダム（参加ごとに選択）`,
          main_persona_description: `メインペルソナ`,
          alter_persona_description: `オルタペルソナ`,
          prompt_label: `追加プロンプト`,
          prompt_description: `新しいユーザーをどのように歓迎しますか？`,
          prompt_placeholder: `新しいユーザーを歓迎する方法を入力...`,
          empty_prompt_title: `追加プロンプトが必要です`,
          empty_prompt_description: `新しいユーザーをどのように歓迎するか入力してください。`,
        },
        set: {
          description: `自動歓迎メッセージを送るチャンネルを設定します。`,
          channel_description: `新規メンバーを歓迎するテキストチャンネル。`,
          success_title: `歓迎チャンネルを更新しました`,
          success_description: `今後、新規メンバーを {channel} で **{persona}** として歓迎します。`,
        },
        remove: {
          description: `設定済みの歓迎チャンネルを削除し、自動歓迎を停止します。`,
          success_title: `歓迎チャンネルを削除しました`,
          success_description: `新規メンバー向けの自動歓迎メッセージは送信しなくなります。`,
          not_configured_title: `歓迎チャンネルは未設定です`,
          not_configured_description: `このサーバーには現在歓迎チャンネルが設定されていません。`,
        },
      },
      "thought-logs-channel": {
        description: `このサーバーの思考ログチャンネルを設定または解除します。`,
        channel_description: `推論サマリーを投稿するテキストチャンネルです。同じチャンネルをもう一度選ぶと無効化されます。`,
        invalid_channel_title: `無効なチャンネル`,
        invalid_channel_description: `サーバーのテキストチャンネルを選択してください。`,
        set_title: `思考ログを有効化しました`,
        set_description: `今後、思考ログは {channel} に投稿されます。`,
        updated_title: `思考ログを更新しました`,
        updated_description: `今後、思考ログは {channel} に投稿されます。`,
        cleared_title: `思考ログを無効化しました`,
        cleared_description: `今後、思考ログは投稿されません。`,
      },
      whitelist: {
        description: `トリガーホワイトリストを管理（チャンネル、ペルソナ別チャンネル制限、ロール。チャンネル設定はグローバルクールダウンを上書き）`,
        channel: {
          description: `チャンネルをホワイトリストに追加し、必要ならグローバルクールダウンを上書き`,
          channel_description: `ホワイトリストに追加するチャンネル`,
          type_description: `任意の上書き: このチャンネルのクールダウンタイプ`,
          length_description: `任意の上書き: クールダウンの長さ（秒）（0 = 即座、クールダウンなし）`,
          invalid_channel_title: `無効なチャンネルタイプ`,
          invalid_channel_description: `テキストチャンネルのみをホワイトリストに追加できます。`,
          already_set_title: `既に設定されています`,
          already_set_description: `チャンネル **{channel_name}** には既にこれらの正確なホワイトリスト設定があります。`,
          invalid_type_title: `無効なクールダウンタイプ`,
          invalid_type_description: `選択されたクールダウンタイプは無効です。有効なオプションを選択してください。`,
          invalid_length_title: `無効なクールダウンの長さ`,
          invalid_length_description: `クールダウンの長さは **{min}** ～ **{max}** 秒の間である必要があります。`,
          success_inherit_title: `チャンネルがホワイトリストに登録されました`,
          success_inherit_description: `チャンネル **{channel_name}** をホワイトリストに登録し、このサーバーのグローバルクールダウンを継承するように設定しました。

**注意:** いずれかのチャンネルがホワイトリストに登録されると、ホワイトリストに登録されたチャンネルのみがボットをトリガーできます。`,
          success_title: `チャンネルがホワイトリストに登録されました`,
          success_description: `チャンネル **{channel_name}** を、チャンネル固有の **{cooldown_type}** クールダウン（**{cooldown_length}** 秒）でホワイトリストに登録しました。

**注意:** いずれかのチャンネルがホワイトリストに登録されると、ホワイトリストに登録されたチャンネルのみがボットをトリガーできます。`,
          success_instant_title: `チャンネルがホワイトリストに登録されました（即座）`,
          success_instant_description: `チャンネル **{channel_name}** を、チャンネル固有の **{cooldown_type}** 上書き（0秒 = 即座、クールダウンなし）でホワイトリストに登録しました。

**注意:** いずれかのチャンネルがホワイトリストに登録されると、ホワイトリストに登録されたチャンネルのみがボットをトリガーできます。`,
        },
        persona: {
          description: `ペルソナがトリガーできるチャンネルを制限`,
          modal_title: `チャンネルをホワイトリスト`,
          checkbox_label: `ホワイトリスト中のチャンネル`,
          checkbox_label_continued: `ホワイトリスト中のチャンネル（続き）`,
          checkbox_description: `このペルソナがトリガーできるチャンネルにチェックを入れてください。すべて未チェックのままにすると、このペルソナは全チャンネルで制限なしになります。`,
          no_personas_title: `ペルソナがありません`,
          no_personas_description: `このサーバーにはホワイトリスト設定できるペルソナがまだありません。`,
          no_channels_title: `チャンネルがありません`,
          no_channels_description: `**{persona_name}** に対してホワイトリスト設定できるテキストチャンネルがありません。`,
          select_page_title: `チャンネルページを選択`,
          select_page_description: `**{persona_name}** のチャンネルホワイトリストを編集するページを選択してください。

選択中のチャンネル数: **{selected_count}** / **{channel_count}**（全 **{total_pages}** ページ）。
すべて未チェックのままにすると、このペルソナは全チャンネルで制限なしになります。`,
          done_button: `完了`,
          too_many_pages_title: `チャンネルページが多すぎます`,
          too_many_pages_description: `**{persona_name}** が対象にできるテキストチャンネルは **{channel_count}** 件あり、Discord の **{max_pages}** 個のページボタン上限を超えます。`,
          no_changes_title: `変更なし`,
          no_changes_description: `**{persona_name}** のチャンネルホワイトリストに変更はありませんでした。`,
          success_title: `ペルソナホワイトリストを更新しました`,
          success_description: `**{persona_name}** は今後 **{selected_count}** 個のチャンネルでのみトリガーできます: {selected_channels}`,
          success_clear_title: `ペルソナホワイトリストを解除しました`,
          success_clear_description: `**{persona_name}** は特定チャンネルへの制限が解除され、再び全チャンネルでトリガーできます。`,
          main_persona_description: `メインペルソナ`,
          alter_persona_description: `オルタペルソナ`,
        },
        role: {
          description: `ボットをトリガーできるロールホワイトリストを追加・削除`,
          role_description: `ホワイトリストに追加または削除するロール`,
          action_description: `このロールを追加するか削除するか選択`,
          action_add: `追加`,
          action_remove: `削除`,
          invalid_role_title: `無効なロール`,
          invalid_role_description: `@everyone ロールはロールホワイトリストに使用できません。`,
          already_set_title: `既に設定されています`,
          already_set_description: `ロール {role_mention} は既にホワイトリストに登録されています。`,
          not_set_title: `未設定`,
          not_set_description: `ロール {role_mention} はホワイトリストに登録されていません。`,
          success_add_title: `ロールがホワイトリストに登録されました`,
          success_add_description: `ロール {role_mention} は、ロールホワイトリストが有効なときにボットをトリガーできるようになりました。`,
          success_remove_title: `ロールがホワイトリストから削除されました`,
          success_remove_description: `ロール {role_mention} をホワイトリストから削除しました。`,
        },
        remove: {
          description: `ホワイトリストからペルソナ、チャンネル、またはロールを削除`,
          modal_title: `ホワイトリスト項目を削除`,
          persona_checkbox_label: `ホワイトリスト中のペルソナ`,
          persona_checkbox_label_continued: `ホワイトリスト中のペルソナ（続き）`,
          persona_checkbox_description: `削除したいペルソナホワイトリスト項目のチェックを外してください。`,
          checkbox_label: `ホワイトリスト中のチャンネル`,
          checkbox_label_continued: `ホワイトリスト中のチャンネル（続き）`,
          checkbox_description: `ホワイトリストから外したいチャンネルのチェックを外してください。`,
          role_checkbox_label: `ホワイトリスト中のロール`,
          role_checkbox_label_continued: `ホワイトリスト中のロール（続き）`,
          role_checkbox_description: `ホワイトリストから外したいロールのチェックを外してください。`,
          no_entries_title: `ホワイトリスト項目がありません`,
          no_entries_description: `削除するホワイトリスト中のペルソナ、チャンネル、またはロールがありません。`,
          too_many_entries_title: `ホワイトリスト項目が多すぎます`,
          too_many_entries_description: `このサーバーにはホワイトリスト中のペルソナが **{persona_count}** 件、チャンネルが **{channel_count}** 件、ロールが **{role_count}** 件あります。Discord のモーダルではチェックボックスグループを **{max_groups}** 個（合計 **{max_entries}** 項目）までしか表示できません。`,
          no_removals_title: `削除されたホワイトリスト項目はありません`,
          no_removals_description: `どのホワイトリスト項目も未チェックになっていません。変更は行われていません。`,
          success_title: `ホワイトリストを更新しました`,
          success_description: `次のホワイトリスト項目を削除しました。
**ペルソナ:** {personas_removed}
**チャンネル:** {channels_removed}
**ロール:** {roles_removed}`,
        },
      },
      cooldown: {
        description: `クールダウンの管理`,
        triggers: {
          description: `トリガーと /bot のクールダウンを設定します（デフォルト: オフ、5秒）。`,
          cooldown_type_description: `クールダウン適用方法（デフォルト: オフ、ユーザーごと等）。`,
          cooldown_length_description: `クールダウン時間（秒、1-86400、デフォルト: 5）。`,
          invalid_type_title: `無効なクールダウンタイプ`,
          invalid_type_description: `選択されたクールダウンタイプが無効です。有効なオプションを選択してください。`,
          invalid_length_title: `無効な時間`,
          invalid_length_description: `時間は {min} から {max} 秒（24時間）の間で指定してください。`,
          already_set_title: `既に設定済み`,
          already_set_description: `クールダウン設定は既に **{type}**（**{length}** 秒）です。`,
          success_title: `クールダウンを更新しました`,
          success_description: `クールダウンを **{previous_type}**（**{previous_length}** 秒）から **{type}**（**{length}** 秒）に更新しました。これはメッセージトリガーと \`/bot\` コマンドの両方に適用されます。`,
          success_disabled_title: `クールダウンが無効化されました`,
          success_disabled_description: `クールダウンを **{previous_type}**（**{previous_length}** 秒）から **{type}**（**{length}** 秒）に更新しました。メッセージトリガーと \`/bot\` コマンドのクールダウンは現在 **無効** です。`,
          type: {
            choice_off: `オフ`,
            choice_per_user: `ユーザーごと`,
            choice_per_channel: `チャンネルごと`,
            choice_server_wide: `サーバー全体`,
            choice_strict_server_wide: `厳密サーバー全体`,
          },
        },
      },
      quota: {
        description: `生成クォータを管理`,
        imagegen: {
          description: `このサーバーの日次画像生成クォータを設定します。`,
          unlimited: `無制限`,
          daily_user_quota_limit_description: `ユーザー1人あたりの日次画像数（0=無制限、1-100、デフォルト: 10）。`,
          daily_user_quota_success_title: `ユーザークォータが更新されました`,
          daily_user_quota_success_description: `ユーザークォータが1日あたり **{limit}** 枚の画像に設定されました。`,
          serverwide_quota_limit_description: `サーバー全体の画像数（0=無制限、1-99999、デフォルト: 0）。`,
          serverwide_quota_success_description: `サーバー全体のクォータが期間あたり **{limit}** 枚の画像に設定されました。`,
          serverwide_quota_resets_in_days_description: `リセットまでの日数（1-365、デフォルト: 365）。`,
          serverwide_quota_resets_in_success_description: `サーバー全体のクォータは **{days}** 日ごとにリセットされます。`,
        },
        textgen: {
          description: `このサーバーのテキスト生成トリガークォータを設定します。`,
          unlimited: `無制限`,
          daily_user_quota_limit_description: `ユーザー1人あたりの日次テキスト数（0=無制限、1-100、デフォルト: 0）。`,
          daily_user_quota_success_title: `ユーザークォータが更新されました`,
          daily_user_quota_success_description: `ユーザークォータが1日あたり **{limit}** 回のテキストトリガーに設定されました。`,
          serverwide_quota_limit_description: `サーバー全体のテキスト数（0=無制限、1-99999、デフォルト: 0）。`,
          serverwide_quota_success_description: `サーバー全体のクォータが期間あたり **{limit}** 回のテキストトリガーに設定されました。`,
          serverwide_quota_resets_in_days_description: `リセットまでの日数（1-365、デフォルト: 365）。`,
          serverwide_quota_resets_in_success_description: `サーバー全体のテキストクォータは **{days}** 日ごとにリセットされます。`,
        },
        videogen: {
          description: `このサーバーの動画生成クォータを設定します。`,
          unlimited: `無制限`,
          daily_user_quota_limit_description: `ユーザー1人あたりの日次動画数（0=無制限、1-100、デフォルト: 3）。`,
          daily_user_quota_success_title: `ユーザークォータが更新されました`,
          daily_user_quota_success_description: `ユーザークォータが1日あたり **{limit}** 本の動画に設定されました。`,
          serverwide_quota_limit_description: `サーバー全体の動画数（0=無制限、1-99999、デフォルト: 0）。`,
          serverwide_quota_success_description: `サーバー全体のクォータが期間あたり **{limit}** 本の動画に設定されました。`,
          serverwide_quota_resets_in_days_description: `リセットまでの日数（1-365、デフォルト: 365）。`,
          serverwide_quota_resets_in_success_description: `サーバー全体の動画クォータは **{days}** 日ごとにリセットされます。`,
        },
        reset: {
          description: `画像/テキスト/動画生成のクォータプールをリセットします。`,
          scope_description: `ユーザーの日次クォータをリセットするか、サーバー全体クォータをリセットするかを選択します。`,
          scope_choice_user: `ユーザー`,
          scope_choice_server: `サーバー`,
          quota_type_description: `リセットするクォータの種類を選択します。`,
          quota_type_choice_imagegen: `画像生成`,
          quota_type_choice_textgen: `テキスト生成`,
          quota_type_choice_videogen: `動画生成`,
          user_select_title: `ユーザーを選択`,
          user_select_description: `日次クォータをリセットするユーザーを選択してください。`,
          user_select_placeholder: `ユーザーを選択...`,
          success_title: `クォータをリセットしました`,
          success_user_imagegen_description: `{user} の日次画像生成クォータ使用量をリセットしました。`,
          success_user_textgen_description: `{user} の日次テキスト生成トリガークォータ使用量をリセットしました。`,
          success_user_videogen_description: `{user} の日次動画生成クォータ使用量をリセットしました。`,
          success_server_imagegen_description: `サーバー全体の画像生成クォータプールをリセットしました。`,
          success_server_textgen_description: `サーバー全体のテキスト生成トリガークォータプールをリセットしました。`,
          success_server_videogen_description: `サーバー全体の動画生成クォータプールをリセットしました。`,
        },
      },
      "member-permissions": {
        description: `管理者以外のメンバーが私に何を教えられるかを設定します。`,
        servermemories_option: `サーバーの記憶`,
        attributelist_option: `属性リスト`,
        sampledialogues_option: `サンプル対話`,
        promptsnapshot_option: `プロンプトスナップショット`,
        servermemories_desc: `サーバー記憶の追加・削除`,
        attributelist_desc: `性格属性の追加・削除`,
        sampledialogues_desc: `サンプル対話の追加・削除`,
        promptsnapshot_desc: `/tool prompt snapshot を使用`,
        select_placeholder: `メンバーに許可することを選択...`,
        select_embed_title: `メンバー教育権限`,
        select_embed_description: `管理者以外のメンバーが**教えられる**ことを選択してください。チェックあり = 許可。`,
        no_changes_title: `変更なし`,
        no_changes_description: `すべての権限はすでに選択した値に設定されています。`,
        success_title: `メンバー権限が更新されました`,
        success_description: `**{count}** 件の権限を更新しました。`,
      },
      avatar: {
        description: `このサーバーで選択したペルソナのアバターを設定または削除します。`,
        image_description: `アバターとして設定する画像。空白のまま送信すると、代わりに選択したペルソナのアバターをクリアします。`,
        image_label: `アバター画像`,
        persona_modal_title: `ペルソナを選択`,
        persona_select_label: `ペルソナ`,
        persona_select_description: `アバターを更新するペルソナを選択してください。`,
        persona_select_placeholder: `ペルソナを選択...`,
        main_persona_description: `メインペルソナ`,
        alter_persona_description: `オルタペルソナ`,
        success_title: `アバターが更新されました`,
        success_description: `このサーバー用のアバターの更新に成功しました。`,
        success_alter_description: `ペルソナ「{persona_name}」のアバターを更新しました。`,
        removed_title: `アバターがリセットされました`,
        removed_description: `このサーバー用のアバターをデフォルトにリセットしました。`,
        removed_alter_description: `ペルソナ「{persona_name}」のアバターをリセットしました。`,
        invalid_image_title: `無効な画像`,
        invalid_image_description: `有効な画像ファイルを提供してください。`,
        file_too_large_description: `画像ファイルが大きすぎます。最大ファイルサイズは8MBです。`,
        invalid_format_description: `PNG、JPG、JPEG、またはGIF画像ファイルを提供してください。`,
        conversion_error_title: `変換エラー`,
        conversion_error_description: `画像の処理に失敗しました。別の画像ファイルを試してください。`,
        api_error_title: `APIエラー`,
        api_error_description: `Discord APIを通じてアバターの更新に失敗しました。アバターを短時間で変更しすぎたことによるレート制限が原因であることが多いです。しばらく待ってから再度お試しください。\n-# {details}`,
        error_download_timeout: `アバターのダウンロードが15秒後にタイムアウトしました。もう一度お試しください。`,
        error_api_timeout: `Discord API呼び出しが15秒後にタイムアウトしました。もう一度お試しください。`,
      },
      initialize: {
        description: `AI分析を使用してサーバー機能を初期化します`,
        expressions: {
          description: `AIビジョンを使用してすべてのカスタム絵文字とスタンプを分析・分類します`,
          overwrite_description: `既存の表現データを削除して新しくやり直す`,
          success_title: `絵文字とスタンプを初期化しました`,
          success_description: `{emoji_count}個の絵文字と{sticker_count}個のスタンプ（合計{total}個）を分析・分類しました。`,
          model_incompatible_title: `互換性のないモデル`,
          model_incompatible_description: `現在のモデル（{model_name}）は{missing_capability}をサポートしていません。\`/config model text\`を使用して、画像ビジョンと構造化出力の両方をサポートするモデルに切り替えてください。`,
          vision_fallback_title: `互換性のあるモデルがありません`,
          vision_fallback_description: `チャットモデル（**{chat_model}**）もビジョンモデル（**{vision_model}**）も、絵文字初期化に必要な機能を満たしていません。画像ビジョンと構造化出力の両方をサポートするモデルが必要です。\`/config model text\`または\`/config model vision\`で切り替えてください。`,
          already_initialized_title: `初期化するものがありません`,
          already_initialized_description: `すべての絵文字とスタンプはすでに分析・分類されています。`,
          partial_success_title: `部分的に成功`,
          partial_success_description: `{total}個の絵文字/スタンプのうち{successful}個を分析しました。{failed}個は処理されませんでした。残りの絵文字/スタンプを処理するには、このコマンドを再度実行してください。`,
          no_matches_title: `一致するものが見つかりません`,
          no_matches_description: `AIは絵文字/スタンプを分析しましたが、データベースと一致する結果が見つかりませんでした。処理エラーの可能性があります。`,
          llm_error_title: `AI分析に失敗しました`,
          llm_error_description: `AIモデルが絵文字/スタンプの分析中にエラーに遭遇しました。後でもう一度お試しください。`,
          validation_error_title: `無効なAI応答`,
          validation_error_description: `AIが無効な応答形式を返しました。これはモデルの問題である可能性があります。`,
          progress_analyzing: `{total}枚の画像を分析中...`,
          progress_analyzing_batch: `{total_uninitialized}枚のうち{batch_size}枚の画像を分析中（バッチ処理中 - 残りの絵文字/スタンプを処理するには、このコマンドを再度実行してください）`,
        },
      },
      matrix: {
        link: {
          description: `DiscordチャンネルをMatrixルームに双方向リレーでリンクします`,
          channel_description: `リンクするDiscordチャンネル`,
          room_description: `リンクするMatrixルームID（例：!abc:matrix.org）`,
          success_title: `Matrixルームをリンクしました`,
          success_description: `<#{channel_id}>が\`{room_id}\`とブリッジされました。TomoriのメッセージがMatrixルームに表示され、Matrixのメッセージもここに表示されます。

セットアップ手順、Matrix側で使えるコマンド、現在の制限一覧は {help_matrix} を確認してください。`,
          invalid_room_title: `無効なルームID`,
          invalid_room_description: `MatrixルームIDは\`!\`で始まり\`:\`を含む必要があります（例：\`!abc:matrix.org\`）。ルームIDを確認して再試行してください。`,
          join_failed_description: `<#{channel_id}>が\`{room_id}\`にリンクされましたが、Matrixルームに自動的に参加できませんでした。\`{bot_user_id}\`をルームに手動で招待し、必要なら {help_matrix} でセットアップ手順と制限一覧を確認してください。`,
          encrypted_room_title: `暗号化されたルームはリンクできません`,
          encrypted_room_description: `\`{room_id}\`はエンドツーエンド暗号化が有効です。Matrixの暗号化は一度設定すると無効にできないため、このルームはブリッジに使用できません。暗号化なしの新しいMatrixルームを作成し、代わりに\`{bot_user_id}\`を招待してください。`,
          matrix_not_configured_title: `Matrixブリッジ利用不可`,
          matrix_not_configured_description: `このBotインスタンスではMatrixブリッジが設定されていません。有効にするにはBot管理者にお問い合わせください。`,
        },
        unlink: {
          description: `DiscordチャンネルからMatrixブリッジリンクを削除します`,
          channel_description: `Matrixルームからリンクを解除するDiscordチャンネル`,
          success_title: `Matrixルームのリンクを解除しました`,
          success_description: `<#{channel_id}>はどのMatrixルームともブリッジされていません。`,
          not_linked_title: `リンクされていません`,
          not_linked_description: `<#{channel_id}>にはMatrixルームがリンクされていません。`,
        },
      },
      alwaysreply: {
        description: `メインペルソナの常時応答モードを切り替えます。`,
        enabled_title: `常時応答が有効になりました`,
        enabled_description: `**{persona_name}** はトリガーワードなしでもこのサーバーのすべてのメッセージに返信します。オルタペルソナは引き続きトリガーワードが必要です — オルタがトリガーされた場合、**{persona_name}** は二重応答を避けるために応答しません。`,
        disabled_title: `常時応答が無効になりました`,
        disabled_description: `**{persona_name}** はトリガーワード、メンション、またはリプライでのみ応答します。`,
      },
      deliberatetriggermode: {
        description: `このサーバーの明示的トリガーモード（DTM）を切り替えます。`,
        enabled_title: `明示的トリガーモードが有効になりました`,
        enabled_description: `**{persona_name}** は直接的な呼びかけにのみ応答します：\`@{trigger}\`プレフィックス、リプライ、Discordメンション、または\`/bot respond\`。通常のトリガーワードだけでは起動しません。`,
        disabled_title: `明示的トリガーモードが無効になりました`,
        disabled_description: `**{persona_name}** は再びトリガーワードで応答します。`,
      },
      deliberatetoolmode: {
        description: `このサーバーの明示的ツールモードを切り替えます。`,
        enabled_title: `明示的ツールモードが有効になりました`,
        enabled_description: `**{persona_name}** は、ツールが必要だと明示されたメッセージの場合にのみツールを受け取ります。プロンプト量とローカルモデルの待ち時間を減らせます。`,
        disabled_title: `明示的ツールモードが無効になりました`,
        disabled_description: `対応モデルでは、ツール宣言が通常どおり利用可能になります。`,
      },
      "deliberate-tool-mode": {
        description: `このサーバーの明示的ツールモードを切り替えます。`,
      },
      "deliberate-tool-context": {
        description: `直近で使ったツールを何ターン利用可能に保つかを設定します。`,
        turns_description: `成功したツールを利用可能に保つ後続チャンネルターン数。0で無効化します。`,
        already_set_title: `ツールコンテキストは既に設定済みです`,
        already_set_description: `直近で使ったツールは既に後続 **{turns}** ターン利用可能に保たれます。`,
        updated_title: `ツールコンテキストを更新しました`,
        updated_description: `明示的ツールモードが有効な場合、成功したツールは後続 **{turns}** チャンネルターン利用可能になります。`,
        disabled_title: `ツールコンテキストを無効にしました`,
        disabled_description: `成功したツールは元のターンの後に利用可能なまま保持されません。`,
      },
      "deliberate-tool-trigger": {
        description: `明示的ツールモード用のカスタムトリガーフレーズを管理します。`,
        action_description: `カスタムツールトリガーを追加、削除、または一覧表示します。`,
        action_add: `追加`,
        action_remove: `削除`,
        action_list: `一覧`,
        add_modal_title: `ツールトリガーを追加`,
        remove_modal_title: `ツールトリガーを削除`,
        tool_label: `ツール対象`,
        tool_description: `このトリガーで利用可能にするツール対象。`,
        tool_placeholder: `ツール対象を選択...`,
        trigger_label: `トリガーフレーズ`,
        trigger_description: `メッセージ内で検出するフレーズ。例: pic や make a song。`,
        trigger_placeholder: `pic`,
        regex_trigger_label: `正規表現パターン`,
        regex_trigger_description: `通常のフレーズの代わりに検出する任意の正規表現パターン。フラグは大文字小文字を区別しないUnicode一致に固定されます。`,
        regex_trigger_placeholder: `\\b(draw|make) me\\b`,
        remove_checkbox_label: `設定済みツールトリガー`,
        remove_checkbox_label_continued: `設定済みツールトリガー（続き）`,
        remove_checkbox_description: `残すトリガーはチェックしたままにし、削除したいトリガーだけチェックを外してください。`,
        invalid_title: `無効なツールトリガー`,
        missing_tool_description: `追加または削除する場合はツール対象を選択してください。`,
        missing_trigger_description: `追加または削除する場合はトリガーフレーズを入力してください。`,
        exactly_one_trigger_description: `通常のトリガーフレーズまたは正規表現パターンのどちらか一方だけを入力してください。`,
        invalid_regex_title: `無効な正規表現パターン`,
        invalid_regex_description: `\`/{trigger}/\` は有効なJavaScript正規表現パターンではありません。`,
        none_title: `カスタムツールトリガーがありません`,
        none_description: `カスタム明示的ツールトリガーはまだ設定されていません。`,
        remove_too_many_title: `ツールトリガーが多すぎます`,
        remove_too_many_description: `カスタムツールトリガーが {count} 個あり、1つの削除モーダルで扱うには多すぎます。先に手動で減らすか、合計を {max_entries} 個以下（モーダルグループ {max_groups} 個以下）にしてください。`,
        duplicate_title: `トリガーは既に存在します`,
        duplicate_description: `\`{trigger}\` は既に **{tool}** を利用可能にします。`,
        too_many_title: `トリガーが多すぎます`,
        too_many_description: `**{tool}** には既に最大数の {max} 個のカスタムトリガーがあります。`,
        not_found_title: `トリガーが見つかりません`,
        not_found_description: `\`{trigger}\` は現在 **{tool}** に設定されていません。`,
        no_removals_title: `ツールトリガーは削除されませんでした`,
        no_removals_description: `設定済みツールトリガーがすべてチェックされたままだったため、削除はありませんでした。`,
        added_title: `ツールトリガーを追加しました`,
        added_description: `明示的ツールモードが有効な場合、\`{trigger}\` で **{tool}** が利用可能になります。`,
        removed_title: `ツールトリガーを削除しました`,
        removed_description: `\`{trigger}\` では **{tool}** が利用可能になりません。`,
        removed_bulk_description: `削除: {triggers}`,
        list_title: `カスタムツールトリガー`,
      },
    },
    personal: {
      description: `あなたの個人的な設定を管理します`,
      custom_models: {
        description: `自分用のラベル付きカスタムエンドポイントを管理します。`,
        add: {
          description: `個人用カスタムエンドポイントに1機能を登録します。`,
          label_description: `一致する機能で共有するバンドル用ラベル。例: ComfyUI。`,
          capability_description: `このエンドポイントが提供する機能。`,
          api_style_description: `このエンドポイントが使うAPI形式。`,
          endpoint_url_description: `エンドポイントのベースURL。`,
          auth_token_description: `保護されたエンドポイント用のBearerトークン（任意）。`,
          success_title: `個人用カスタムエンドポイントを追加しました`,
          success_description: `**{display_name}** を個人ラベル **{label}** の **{capability}** として追加しました。`,
        },
        edit: {
          description: `登録済みの個人用カスタムエンドポイントを編集します。`,
          none_title: `登録済みカスタムエンドポイントがありません`,
          none_description: `編集できる個人用カスタムエンドポイントがまだありません。`,
          select_modal_title: `個人用カスタムエンドポイントを編集`,
          select_label: `編集するエンドポイント`,
          select_description: `編集する個人用カスタムエンドポイントを選んでください。`,
          select_placeholder: `個人用カスタムエンドポイントを選択...`,
          success_title: `個人用カスタムエンドポイントを更新しました`,
          success_description: `個人ラベル **{label}** の **{capability}** にある **{display_name}** を更新しました。`,
        },
        remove: {
          description: `個人用カスタムエンドポイントから選んだ機能を削除します。`,
          label_description: `バンドル用ラベル。チェックを外した機能だけ削除されます。`,
          capability_description: `削除する機能。`,
          none_title: `登録済みカスタムエンドポイントがありません`,
          none_description: `まだ個人用カスタムエンドポイントの登録はありません。`,
          too_many_title: `登録済みカスタムエンドポイントが多すぎます`,
          too_many_description: `1つのモーダルで編集するには登録済みカスタムエンドポイントが多すぎます。先に数を減らしてから再試行してください。最大グループ数: {max_groups}。`,
          modal_title: `個人用カスタムエンドポイントを削除`,
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
          capability_text: `テキスト`,
          capability_embedding: `埋め込み`,
          capability_image: `画像`,
          capability_video: `動画`,
          capability_speech: `音声`,
          capability_transcription: `文字起こし`,
          no_removals_title: `削除はありません`,
          no_removals_description: `個人用カスタムエンドポイント登録は何も削除されませんでした。`,
          success_title: `個人用カスタムエンドポイントを削除しました`,
          success_description: `個人用プロバイダー一覧から次のカスタムエンドポイント登録を削除しました: {models_removed}。`,
        },
      },
      openrouter_models: {
        description: `自分用の保存済みOpenRouterモデル登録を管理します。`,
        add: {
          description: `個人用プロバイダー一覧にOpenRouterモデルコードネームを登録します。`,
          capability_description: `このモデルを追加するOpenRouter機能リストを選びます。`,
          model_name_description: `登録する正確なOpenRouterモデルコードネーム。`,
          success_title: `個人用OpenRouterモデルを追加しました`,
          success_description: `OpenRouterの{capability}モデル \`{model_name}\` を個人用プロバイダー一覧に登録しました。この機能の通常のOpenRouterモデル選択に表示されます。`,
          already_registered_title: `既に登録されています`,
          already_registered_description: `OpenRouterの{capability}モデル \`{model_name}\` は個人用プロバイダー一覧に既に登録されています。`,
          already_available_title: `最初から利用可能です`,
          already_available_description: `OpenRouterの{capability}モデル \`{model_name}\` は最初から組み込み済みです。追加登録は不要です。`,
          not_found_title: `モデルが見つかりません`,
          not_found_description: `OpenRouter モデル \`{model_name}\` が見つかりませんでした。正確なOpenRouterコードネームを入力して再試行してください。`,
        },
        remove: {
          description: `個人用プロバイダー一覧から登録済みのOpenRouterモデルを削除します。`,
          none_title: `登録済みモデルがありません`,
          none_description: `まだ追加の個人用OpenRouterモデル登録はありません。`,
          too_many_title: `登録済みモデルが多すぎます`,
          too_many_description: `1つのモーダルで編集するには登録済みOpenRouterモデルが多すぎます。先に数を減らしてから再試行してください。最大グループ数: {max_groups}。`,
          modal_title: `個人用OpenRouterモデルを削除`,
          no_removals_title: `削除はありません`,
          no_removals_description: `個人用OpenRouterモデル登録は何も削除されませんでした。`,
          success_title: `個人用OpenRouterモデルを削除しました`,
          success_description: `個人用プロバイダー一覧から次のOpenRouter登録を削除しました: {models_removed}。`,
          success_still_referenced_description: `個人用プロバイダー一覧から次のOpenRouter登録を削除しました: {models_removed}。すでにそれらを使っている既存の選択はそのまま残るため、不要なら手動で切り替えてください。`,
          already_available_title: `組み込みモデルです`,
          already_available_description: `OpenRouter モデル \`{model_name}\` は組み込みモデルなので、このコマンドでは削除できません。`,
        },
      },
      "openrouter-model": {
        description: `自分用の保存済みOpenRouterモデル登録を管理します。`,
        add: {
          description: `個人用プロバイダー一覧にOpenRouterモデルコードネームを登録します。`,
        },
        remove: {
          description: `個人用プロバイダー一覧から登録済みOpenRouterモデルコードネームを削除します。`,
        },
      },
      "custom-endpoint": {
        description: `自分用のラベル付きカスタムエンドポイントを管理します。`,
        add: {
          description: `個人用カスタムエンドポイントに1機能を登録します。`,
        },
        edit: {
          description: `登録済みの個人用カスタムエンドポイント項目を置き換えます。`,
        },
        remove: {
          description: `個人用カスタムエンドポイントから選んだ機能を削除します。`,
        },
      },
      provider: {
        description: `あなたの個人AIプロバイダーを管理します。`,
        no_saved_title: `個人プロバイダーがありません`,
        no_saved_description: `保存された個人プロバイダーがまだありません。\`/personal provider add\` で追加してください。`,
        capability_text: `テキスト`,
        capability_embedding: `埋め込み`,
        capability_image: `画像`,
        capability_video: `動画`,
        capability_vision: `ビジョン`,
        model_success_title: `個人モデルを更新しました`,
        add: {
          description: `個人用プロバイダーAPIキーを追加または更新します。`,
          modal_title: `個人プロバイダーを追加`,
          provider_label: `プロバイダー`,
          provider_description: `自分用に保存するプロバイダーを選択してください。`,
          provider_placeholder: `プロバイダーを選択...`,
          api_key_label: `APIキー`,
          api_key_description: `あなたのメッセージに使うAPIキーを入力してください。`,
          api_key_placeholder: `APIキーを貼り付け`,
          already_existing_suffix: `保存済み`,
          success_title: `個人プロバイダーを保存しました`,
          success_description: `{provider} を個人プロバイダー保管庫に追加しました。次に \`/personal provider toggle-models\` でモデル選択と有効化を行ってください。`,
          updated_description: `{provider} の個人プロバイダー設定を更新しました。`,
        },
        remove: {
          description: `保存済みの個人プロバイダーを削除します。`,
          no_saved_title: `個人プロバイダーがありません`,
          no_saved_description: `削除できる個人プロバイダーがありません。`,
          picker_title: `個人プロバイダーを削除`,
          picker_description: `削除する個人プロバイダーを選択してください。`,
          success_title: `個人プロバイダーを削除しました`,
          success_description: `個人 {provider} 設定を削除しました。`,
        },
        "model-text": {
          description: `個人プロバイダーのテキストモデルを選択します。`,
        },
        "model-embedding": {
          description: `個人プロバイダーの埋め込みモデルを選択します。`,
        },
        "model-image": {
          description: `個人プロバイダーの画像モデルを選択します。`,
        },
        "model-video": {
          description: `個人プロバイダーの動画モデルを選択します。`,
        },
        "model-vision": {
          description: `個人プロバイダーのビジョンモデルを選択します。`,
        },
        model_text: {
          success_description: `個人テキストプロバイダーを {provider} の \`{model}\` に設定しました。`,
        },
        model_embedding: {
          success_description: `個人埋め込みプロバイダーを {provider} の \`{model}\` に設定しました。`,
        },
        model_image: {
          success_description: `個人画像プロバイダーを {provider} の \`{model}\` に設定しました。`,
        },
        model_video: {
          success_description: `個人動画プロバイダーを {provider} の \`{model}\` に設定しました。`,
        },
        model_vision: {
          success_description: `個人ビジョンプロバイダーを {provider} の \`{model}\` に設定しました。`,
        },
        "toggle-models": {
          description: `どの機能で個人プロバイダーを使うか切り替えます。`,
          modal_title: `個人プロバイダー機能の切り替え`,
          group_label: `機能`,
          group_description: `個人プロバイダーへルーティングしたい機能をチェックしてください。`,
          provider_description: `割り当てプロバイダー: {provider}`,
          none_set_description: `未設定 — 先にモデルを選択してください`,
          missing_model_title: `モデルが必要です`,
          missing_model_description: `{capability} にはまだ個人モデルが設定されていません。`,
          success_title: `個人ルーティングを更新しました`,
          success_description: `個人機能のルーティングを更新しました。\n\n{active_summary}`,
        },
      },
      model: {
        description: `個人モデルのフェイルオーバーを管理します。`,
        fallback: {
          description: `有効な個人テキストプロバイダーのフォールバックモデルを設定し、なしで各スロットをクリアできます。`,
          no_provider_title: `有効な個人テキストプロバイダーがありません`,
          no_provider_description: `先に \`/personal provider model-text\` と \`/personal provider toggle-models\` で個人テキストプロバイダーを有効化してください。`,
          success_title: `個人フォールバックを更新しました`,
          success_description: `個人 {provider} テキストプロバイダーのフォールバックモデルを更新しました。\n\n{model_list}`,
          cleared_title: `個人フォールバックをクリアしました`,
          cleared_description: `個人 {provider} テキストプロバイダーのフォールバックモデルをクリアしました。`,
        },
      },
      parameters: {
        description: `個人プロバイダーのサンプラー設定を調整します。`,
        provider_description: `任意: 保存済みの個人プロバイダーを選択します。未指定の場合は有効な個人テキストプロバイダーを使用します。`,
        no_provider_title: `個人プロバイダーが選択されていません`,
        no_provider_description: `先に個人プロバイダーを保存するか、個人テキストプロバイダーを有効化してください。`,
        success_title: `個人サンプラーを更新しました`,
        success_description: `{provider} の個人サンプラー設定を更新しました: {settings}`,
      },
      config: {
        description: `個人設定データを管理します。`,
        export: {
          description: `個人設定をエクスポートします（サーバー設定、ペルソナ、記憶を除く）。`,
        },
        import: {
          description: `個人設定のみをインポートします（サーバー設定や記憶を除く）。`,
          file_description: `個人設定のJSONファイル。`,
          confirmation_description: `警告：インポートするファイルの内容に応じて、既存の個人設定が置き換えられる場合があります。続行しますか？`,
          confirmation_choice_yes: `はい、インポートする`,
          confirmation_choice_no: `いいえ、キャンセル`,
        },
        remove: {
          description: `個人設定をリセットします。`,
          confirmation_description: `個人設定をリセットしてよいか確認します。`,
          confirmation_choice_yes: `はい、リセットする`,
          confirmation_choice_no: `いいえ、キャンセル`,
        },
      },
      privacy: {
        description: `個人記憶の保存とプライバシー設定を管理します`,
        modal_title: `プライバシー設定`,
        select_label: `プライバシーレベル`,
        select_description: `プライバシー保護のレベルを選択してください`,
        choice_minimal: `なし`,
        desc_minimal: `完全なパーソナライズ：記憶、ステータス、カスタムニックネーム、ボットのトリガーが可能。`,
        choice_partial: `部分的`,
        desc_partial: `メッセージは表示されますが、個人記憶/ステータスはAIに表示されません。`,
        choice_full: `完全`,
        desc_full: `最大限のプライバシー：完全に非表示、メッセージ、記憶、ボットのトリガーはありません。`,
        success_title: `プライバシー設定が更新されました`,
        success_description: `プライバシーレベルが\`{previous_value}\`から\`{value}\`に変更されました。

\`/personal privacy\`を使用していつでも変更できます。`,
        already_set_title: `変更はありません`,
        already_set_description: `プライバシーレベルは既に\`{value}\`に設定されています。`,
        invalid_value_description: `無効なプライバシーレベルが選択されました。もう一度お試しください。`,
      },
      language: {
        description: `インターフェースの優先言語を設定します。`,
        value_description: `インターフェースの優先言語を選択してください。`,
        choice_english: `英語`,
        choice_japanese: `日本語`,
        invalid_value_title: `無効な言語`,
        invalid_value_description: `言語は次のいずれかでなければなりません: {supported}。`,
        already_set_title: `言語は既に設定済みです`,
        already_set_description: `あなたの言語設定は既に \`{value}\` に設定されています。`,
        success_title: `言語が更新されました`,
        success_description: `あなたのインターフェース言語が \`{previous_value}\` から \`{value}\` に変更されました。`,
      },
      nickname: {
        description: `私があなたを呼ぶ名前を変更します。`,
        option_description: `私があなたに使用すべきニックネーム（2〜32文字）。`,
        invalid_length_title: `無効なニックネームの長さ`,
        invalid_length: `ニックネームは {min}〜{max} 文字でなければなりません。`,
        success_title: `個人的なニックネームが更新されました`,
        success_description: `わかりました、これからはあなたのことを '{new_nickname}' と呼びます（以前は '{old_nickname}' でした）。`,
        success_but_disabled_description: `わかりました、あなたのことを '{new_nickname}' と呼ぶことを覚えておきます（以前は '{old_nickname}' でした）。

**警告:** 現在、このサーバーではパーソナライズが無効になっているため、このニックネームはここでは使用しません。パーソナライズが有効になっている他のサーバーでは使用します。`,
      },
      impersonate: {
        description: `ユーザーなりすまし設定を管理します。`,
        prompt: {
          description: `あなたをどうなりすますかを伝える再利用プロンプトを設定します。`,
          modal_title: `ユーザーなりすましプロンプト`,
          prompt_label: `ペルソナプロンプト`,
          prompt_description: `あなたのなりすましが呼び出されたときに使われます。空欄で送信するとクリアされます。`,
          prompt_placeholder: `砕けた口調で、短めに、全部小文字多め、友達には少しだけ煽り気味で...`,
          success_title: `なりすましプロンプトを更新しました`,
          success_description: `今後はどこでも、ユーザーなりすまし返信でこのプロンプトが使われます。`,
          cleared_title: `なりすましプロンプトをクリアしました`,
          cleared_description: `ユーザーなりすましプロンプトを削除しました。`,
          already_set_title: `変更はありません`,
          already_set_description: `ユーザーなりすましプロンプトは既にその内容に設定されています。`,
          already_cleared_title: `プロンプト未設定`,
          already_cleared_description: `現在、ユーザーなりすましプロンプトは設定されていません。`,
        },
      },
      stm: {
        description: `STM（短期記憶）の設定を構成します`,
        option_description: `設定するSTM項目を選んでください`,
        crossserver_option: `サーバー間STM共有`,
        clear_option: `個人用STMをクリア`,
        crossserver: {
          title: `サーバー間STM共有`,
          enabled: `サーバー間STM共有が**有効**になりました。他のサーバーでのあなたの会話を参照できるようになります。`,
          disabled: `サーバー間STM共有が**無効**になりました。このサーバーでのあなたの会話のみを参照します。`,
        },
        clear: {
          title: `STMがクリアされました`,
          success: `ユーザー固有のSTMがすべてのチャンネルでクリアされました。`,
        },
      },
      spotlight: {
        description: `個人用ペルソナスポットライト設定を管理します。`,
        set: {
          description: `1つのチャンネル用に個人スポットライトを設定します。`,
          hours_description: `スポットライトを有効にする時間です。0 で削除するまで永続になります。`,
          channel_description: `この個人スポットライトを適用するチャンネルです。`,
          modal_title: `個人スポットライトを設定`,
          checkbox_label: `スポットライト対象ペルソナ`,
          checkbox_label_continued: `スポットライト対象ペルソナ（続き）`,
          checkbox_description: `このチャンネルで許可したいペルソナをチェックしてください。許可しないペルソナは未チェックのままにします。`,
          no_personas_title: `ペルソナが見つかりません`,
          no_personas_description: `このサーバーにはまだペルソナがありません。`,
          too_many_personas_title: `ペルソナが多すぎます`,
          too_many_personas_description: `このサーバーには **{count}** 個のペルソナがあります。Discord のモーダルでは **{max_groups}** 個のチェックボックスグループ（合計 **{max_entries}** 個の選択肢）までしか表示できません。`,
          no_selection_title: `ペルソナが選択されていません`,
          no_selection_description: `送信前にスポットライトへ含めるペルソナを1つ以上選択してください。`,
          transaction_title: `個人スポットライトを確認`,
          transaction_prompt: `このまま完了するか、自動トリガーするペルソナを選ぶか決めてください。`,
          finish_button: `完了`,
          auto_trigger_button: `自動トリガーペルソナを選ぶ`,
          auto_modal_title: `自動トリガーペルソナを選択`,
          auto_select_label: `自動トリガーペルソナ`,
          auto_select_description: `このチャンネルで、あなたのすべてのメッセージに自動トリガーするスポットライト内ペルソナを選択してください。`,
          auto_select_placeholder: `自動トリガーペルソナを選択...`,
          success_title: `個人スポットライトを更新しました`,
          success_description: `個人スポットライトを保存しました。`,
          no_changes_title: `変更はありません`,
          no_changes_description: `この永続的な個人スポットライトは、選択内容とすでに一致しています。`,
          duration_permanent: `削除するまで永続`,
          duration_timed: `{hours}時間（{expires_at} まで）`,
          auto_trigger_none: `なし`,
          auto_trigger_pending: `下のボタンで選択するか、設定せずに完了できます`,
          summary_channel_line: `チャンネル: {channel}`,
          summary_duration_line: `期間: {duration}`,
          summary_personas_line: `スポットライト対象ペルソナ: {personas}`,
          summary_auto_trigger_line: `自動トリガーペルソナ: {persona}`,
          more_personas: `他 {count} 件`,
        },
        manage: {
          description: `有効な個人スポットライトを削除します。`,
          none_title: `個人スポットライトはありません`,
          none_description: `このサーバーには有効な個人スポットライトがありません。`,
          too_many_title: `個人スポットライトが多すぎます`,
          too_many_description: `ここには **{count}** 件の有効な個人スポットライトがあります。Discord のモーダルでは **{max_groups}** 個のチェックボックスグループ（合計 **{max_entries}** 個の選択肢）までしか表示できません。`,
          modal_title: `個人スポットライトを管理`,
          checkbox_label: `有効なスポットライト`,
          checkbox_label_continued: `有効なスポットライト（続き）`,
          checkbox_description: `チェックを残すと保持されます。チェックを外すと、その個人スポットライトが削除されます。`,
          no_changes_title: `変更はありません`,
          no_changes_description: `すべてチェックされたままだったため、個人スポットライトは削除されませんでした。`,
          success_title: `個人スポットライトを更新しました`,
          success_description: `個人スポットライトを **{removed_count}** 件削除しました。\n\n{removed_entries}`,
          more_removed: `他 {count} 件`,
          permanent_badge: `永続`,
          until_badge: `{expires_at} まで`,
          entry_description: `{duration} • 自動: {auto_trigger} • ペルソナ: {personas}`,
        },
      },
      deliberatetriggermode: {
        description: `個人の明示的トリガーモード（DTM）設定を変更します。`,
        mode_description: `DTMを個人的にどのように適用するか選択します。`,
        off_option: `オフ`,
        follow_option: `サーバーに従う`,
        on_option: `オン`,
        off_title: `個人DTM：オフ`,
        off_description: `サーバー設定に関わらず、あなたのDTMは**無効**です。サーバーがDTMを有効にしていても、通常のトリガーワードが使用できます。`,
        follow_title: `個人DTM：サーバーに従う`,
        follow_description: `DTMの動作が**サーバー設定に従う**ようになりました。サーバーがDTMを有効にしている場合は直接的な呼びかけが必要になり、そうでない場合は通常のトリガーワードが使用できます。`,
        on_title: `個人DTM：オン`,
        on_description: `サーバー設定に関わらず、DTMが**常に有効**です。直接的な呼びかけのみ機能します：\`@{trigger}\`プレフィックス、リプライ、Discordメンション、または\`/bot respond\`。`,
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
    "scheduled-task": {
      description: `スケジュール済みタスクとリマインダーを管理します。`,
      edit: {
        description: `スケジュール済みタスクまたはリマインダーを編集します。`,
        select_modal_title: `スケジュール済みタスクの編集`,
        select_label: `編集するスケジュール済みタスク`,
        select_description: `編集するスケジュール済みタスクまたはリマインダーを選択してください`,
        select_placeholder: `スケジュール済みタスクを選択...`,
        select_option_description: `[{persona_name}] {reminder_time} ({timezone}) {target_channel} | {reminder_type}{repeat_text}{manager_created_by_text}`,
        select_type_task: `タスク`,
        select_type_reminder: `{user_nickname}さんへのリマインダー`,
        select_repeat_text: ` | {hours}時間ごとに繰り返し`,
        select_manager_created_by_text: ` | 作成者: {creator_name}`,
        no_entries_title: `スケジュール済みタスクがありません`,
        no_entries: `編集するスケジュール済みタスクやリマインダーがありません。リマインドしてほしい内容を私に伝えるか、タスクを予定してください。`,
        confirm_title: `このスケジュール済みタスクを編集しますか？`,
        confirm_description: `**内容:** {reminder_purpose}
**次回実行:** {reminder_time}
**間隔（時間）:** {repetition_interval_hours}
**種類:** {reminder_type}
**対象ユーザー:** {target_user}
**チャンネル:** {target_channel}`,
        modal_title: `スケジュール済みタスクの編集`,
        purpose_input_label: `リマインダー/タスク内容`,
        purpose_input_description: `実行時にボットが見るテキストです。`,
        purpose_input_placeholder: `何を覚える、または実行しますか？`,
        time_input_label: `次回実行時刻`,
        time_input_description: `14:30 または 1430 のような24時間表記を使います。`,
        time_input_placeholder: `14:30`,
        interval_input_label: `間隔（時間）`,
        interval_input_description: `繰り返しを無効にするには0を設定します。`,
        interval_input_placeholder: `0`,
        reminder_checkbox_label: `自分宛てのリマインダーにする`,
        reminder_checkbox_description: `実行されるたびにあなたをメンションします。`,
        type_reminder: `リマインダー`,
        type_task: `タスク`,
        target_none: `なし`,
        invalid_content_title: `内容が無効です`,
        invalid_content_description: `スケジュール済みタスクの内容は空にできません。`,
        invalid_time_title: `実行時刻が無効です`,
        invalid_time_description: `\`14:30\`、\`1430\`、\`00:00\`、\`2400\` のような24時間表記を入力してください。`,
        invalid_interval_title: `間隔が無効です`,
        invalid_interval_description: `間隔は時間単位の整数である必要があります。繰り返しを無効にするには \`0\` を使ってください。`,
        no_changes_title: `変更はありません`,
        no_changes_description: `スケジュール済みタスクは変更されませんでした。`,
        success_title: `スケジュール済みタスクを更新しました`,
        success_description: `**内容:** {reminder_purpose}
**次回実行:** {reminder_time}
**間隔（時間）:** {repetition_interval_hours}
**種類:** {reminder_type}
**対象ユーザー:** {target_user}
**チャンネル:** {target_channel}`,
      },
      remove: {
        description: `スケジュール済みタスクまたはリマインダーを削除します。`,
        modal_title: `スケジュール済みタスクの削除`,
        select_label: `削除するスケジュール済みタスク`,
        select_description: `削除するスケジュール済みタスクまたはリマインダーを選択してください`,
        select_placeholder: `スケジュール済みタスクを選択...`,
        select_option_description: `[{persona_name}] {reminder_time} ({timezone}) #{target_channel}{repeat_text}{manager_created_by_text}`,
        select_repeat_text: ` | {hours}時間ごとに繰り返し`,
        select_manager_created_by_text: ` | 作成者: {creator_name}`,
        no_entries_title: `スケジュール済みタスクがありません`,
        no_entries: `削除するスケジュール済みタスクやリマインダーがありません。リマインドしてほしい内容を私に伝えるか、タスクを予定してください。`,
        success_title: `スケジュール済みタスクが削除されました`,
        success_description: `正常に削除しました: "{reminder_purpose}"`,
      },
    },
    memory: {
      description: `保存された記憶とドキュメントを管理します。`,
      document: {
        description: `ドキュメント記憶を管理します。`,
        add: {
          description: `ドキュメントを記憶に追加します。`,
          name_description: `選択したスコープ内で一意のドキュメント名。`,
          file_description: `アップロードするドキュメントファイル（.txt、.md、.pdf）。`,
          scope_description: `ドキュメントをペルソナ専用にするか、サーバー全体で共有するかを選択します。`,
          scope_choice_persona: `ペルソナ`,
          scope_choice_serverwide: `サーバー全体`,
          channels_description: `任意：特定チャンネルのみに制限（カンマ区切り、例: #general,#bot-chat）。空白の場合は全チャンネルで利用可能。`,
        },
        remove: {
          description: `ドキュメントを記憶から削除します。`,
          scope_description: `ペルソナスコープかサーバー全体スコープから削除するかを選択します。`,
          scope_choice_persona: `ペルソナ`,
          scope_choice_serverwide: `サーバー全体`,
        },
      },
      history: {
        description: `履歴から抽出したドキュメント記憶を管理します。`,
        import: {
          description: `AIを使ってこのチャンネルのメッセージ履歴から知識を抽出します。`,
          name_description: `生成するドキュメントの名前（選択したスコープ内でユニークである必要があります）。`,
          scope_description: `知識のスコープを選択: ペルソナ（デフォルト）、自動（ペルソナ検出）、またはグローバル。`,
          scope_choice_persona: `ペルソナ`,
          scope_choice_automatic: `自動`,
          scope_choice_global: `グローバル`,
          rag_disabled_title: `ドキュメントRAGが無効です`,
          rag_disabled_description: `文書の参照にはデータベースに [pgvector](https://github.com/pgvector/pgvector) PostgreSQL拡張が必要です。pgvector をインストールして TomoriBot を再起動してください（[セットアップガイド](https://github.com/Bredrumb/TomoriBot#readme)を参照）。`,
          no_permission_title: `権限がありません`,
          no_permission_description: `チャンネル履歴を抽出するには**サーバー管理**権限が必要です。`,
          model_incompatible_title: `モデルが非対応です`,
          model_incompatible_description: `現在のモデルは構造化出力をサポートしていないため、履歴抽出に使用できません。\`/config model text\`で対応モデルに切り替えてください。`,
          no_embedding_model_title: `埋め込みモデルが未設定です`,
          no_embedding_model_description: `埋め込みモデルが設定されていません。\`/config model embedding\`で設定してください。`,
          no_api_key_title: `APIキーが未設定です`,
          no_api_key_description: `履歴の抽出と埋め込みには保存済みの埋め込みプロバイダー認証情報が必要です。\`/config provider add\` で設定してください。`,
          no_messages_title: `メッセージが見つかりません`,
          no_messages_description: `このチャンネルには知識を抽出できるメッセージがありません。`,
          no_facts_extracted_title: `ファクトが抽出されませんでした`,
          no_facts_extracted_description: `AIはチャンネル履歴から有意義なファクトを抽出できませんでした。会話が短すぎるか、些細なメッセージのみの場合に発生します。`,
          duplicate_title: `ドキュメント名が既に存在します`,
          duplicate_description: `\`{name}\`という名前のドキュメントがこのスコープに既に存在します。別の名前を選んでください。`,
          limit_exceeded_title: `ドキュメント上限に達しました`,
          limit_exceeded_description: `このスコープ（{scope}）には既に{current_count}件のドキュメントがあります（最大{max_allowed}件）。\`/memory document remove\`または\`/memory history remove\`で削除してから追加してください。`,
          server_chunk_limit_title: `サーバーのチャンク上限に達しました`,
          server_chunk_limit_description: `このスコープ（{scope}）のチャンク上限 {max_chunks} を超えるため追加できません。先に文書を削除してください。`,
          progress_fetching: `チャンネルメッセージを取得中...`,
          progress_extracting: `{message_count}件のメッセージから知識を抽出中（ウィンドウ {current}/{total}）...`,
          progress_embedding: `{fact_count}件のファクトの埋め込みを生成中...`,
          success_title: `履歴を抽出しました`,
          success_description: `**{message_count}**件のメッセージから**{fact_count}**件のファクトを抽出し、**{name}**として{scope}に保存しました（{chunk_count}チャンク）。`,
          success_automatic_description: `**{message_count}**件のメッセージから**{fact_count}**件のファクトを抽出しました。

{persona_list}`,
          success_automatic_persona_line: `**{persona_name}**: **{doc_name}**として保存（{chunk_count}チャンク）`,
          success_automatic_global_fallback: `ペルソナが検出されませんでした。**{name}**としてサーバー全体スコープに保存しました。`,
          scope_label_persona: `ペルソナ「{persona_name}」`,
          scope_label_global: `サーバー全体`,
        },
        remove: {
          description: `履歴から抽出したドキュメントを記憶から削除します。`,
          scope_description: `ペルソナスコープかサーバー全体スコープかを選択します。`,
          scope_choice_persona: `ペルソナ`,
          scope_choice_serverwide: `サーバー全体`,
          modal_title: `履歴ドキュメントの削除`,
          select_label: `削除するドキュメント`,
          select_description: `削除する履歴ドキュメントを選択してください`,
          select_placeholder: `ドキュメントを選択...`,
          rag_disabled_title: `ドキュメントRAGが無効です`,
          rag_disabled_description: `文書の参照にはデータベースに [pgvector](https://github.com/pgvector/pgvector) PostgreSQL拡張が必要です。pgvector をインストールして TomoriBot を再起動してください（[セットアップガイド](https://github.com/Bredrumb/TomoriBot#readme)を参照）。`,
          none_title: `履歴ドキュメントがありません`,
          none_description: `このスコープには削除できる履歴ドキュメントがありません。\`/memory history import\`で抽出してください。`,
          success_title: `履歴ドキュメントが削除されました`,
          success_description: `履歴ドキュメントを正常に削除しました: "{name}"`,
        },
      },
      personal: {
        description: `個人記憶を管理します。`,
        add: {
          description: `個人記憶を追加します。`,
          scope_description: `記憶をペルソナ記憶にするか、グローバル記憶にするかを選択します。`,
          scope_choice_persona: `ペルソナ`,
          scope_choice_global: `グローバル`,
        },
        edit: {
          description: `個人記憶を編集します。`,
          scope_description: `ペルソナ記憶かグローバル記憶かを選択します。`,
          scope_choice_persona: `ペルソナ`,
          scope_choice_global: `グローバル`,
          select_modal_title: `個人記憶を選択`,
          select_label: `編集する記憶`,
          select_description: `編集する個人記憶を選択してください`,
          select_placeholder: `記憶を選択...`,
          confirm_title: `個人記憶を編集しますか？`,
          confirm_description: `次の個人記憶を選択しました:
> {memory}

**確認** を押すと編集モーダルを開きます。`,
          modal_title: `個人記憶を編集`,
          memory_input_label: `更新後の個人記憶`,
          memory_input_description: `選択した個人記憶を新しいテキストに置き換えます。`,
          memory_input_placeholder: `{user}はマンゴーが好き`,
          no_changes_title: `変更はありません`,
          no_changes_description: `その個人記憶は既にその内容に設定されています。`,
          duplicate_title: `重複した個人記憶`,
          duplicate_description: `この記憶 '{memory}' は既にあなたの個人的な記憶にあります。`,
          success_title: `個人記憶を更新しました`,
          success_description: `個人記憶を正常に更新しました: "{memory}"`,
        },
        export: {
          description: `個人記憶をJSONでエクスポートします。`,
          scope_description: `ペルソナ記憶かグローバル記憶かを選択します。`,
          scope_choice_persona: `ペルソナ`,
          scope_choice_global: `グローバル`,
        },
        import: {
          description: `個人記憶をJSONからインポートします。`,
          file_description: `個人記憶のJSONファイル。`,
          target_description: `ペルソナ記憶に入れるか、グローバル記憶に入れるかを選択します。`,
          target_choice_global: `グローバル`,
          target_choice_persona: `ペルソナ`,
          confirmation_description: `警告：選択したスコープの既存の個人メモリが置き換えられる場合があります。続行しますか？`,
          confirmation_choice_yes: `はい、インポートする`,
          confirmation_choice_no: `いいえ、キャンセル`,
        },
        remove: {
          description: `個人記憶を削除します。`,
          scope_description: `ペルソナ記憶かグローバル記憶かを選択します。`,
          scope_choice_persona: `ペルソナ`,
          scope_choice_global: `グローバル`,
        },
      },
      server: {
        description: `サーバー記憶を管理します。`,
        add: {
          description: `サーバー記憶を追加します。`,
        },
        edit: {
          description: `サーバー記憶を編集します。`,
          select_modal_title: `サーバー記憶を選択`,
          select_label: `編集する記憶`,
          select_description: `編集するサーバー記憶を選択してください`,
          select_placeholder: `記憶を選択...`,
          confirm_title: `サーバー記憶を編集しますか？`,
          confirm_description: `次のサーバー記憶を選択しました:
> {memory}

**確認** を押すと編集モーダルを開きます。`,
          modal_title: `サーバー記憶を編集`,
          memory_input_label: `更新後のサーバー記憶`,
          memory_input_description: `選択したサーバー記憶を新しいテキストに置き換えます。`,
          memory_input_placeholder: `このサーバーのメンバーはマンゴーが好き`,
          no_changes_title: `変更はありません`,
          no_changes_description: `そのサーバー記憶は既にその内容に設定されています。`,
          duplicate_title: `重複した記憶`,
          duplicate_description: `この記憶 '{memory}' は既にこのサーバーの私の記憶にあります。`,
          success_title: `サーバー記憶を更新しました`,
          success_description: `サーバー記憶を正常に更新しました: "{memory}"`,
        },
        export: {
          description: `サーバー記憶をJSONでエクスポートします。`,
        },
        import: {
          description: `サーバー記憶をJSONからインポートします。`,
          file_description: `サーバー記憶のJSONファイル。`,
          confirmation_description: `警告：選択したペルソナスコープの既存のサーバーメモリが置き換えられる場合があります。続行しますか？`,
          confirmation_choice_yes: `はい、インポートする`,
          confirmation_choice_no: `いいえ、キャンセル`,
        },
        remove: {
          description: `サーバー記憶を削除します。`,
        },
      },
      tagging: {
        description: `タグ付き記憶モードを管理します。`,
        set: {
          description: `タグ付き記憶モードに切り替えます`,
          modal_title: `記憶タグ設定`,
          select_label: `タグモード`,
          select_description: `有効にすると会話タグで記憶をフィルタリングし、無効にするとすべての記憶を含めます。`,
          select_placeholder: `モードを選択...`,
          channel_select_label: `チャンネルタグ`,
          channel_select_description: `有効にすると特定の#チャンネルに記憶をタグ付けできます。タグなしの記憶は引き続きすべてのチャンネルで機能します。`,
          channel_select_placeholder: `モードを選択...`,
          success_title: `記憶タグ設定が更新されました`,
          success_description: `記憶タグ設定が保存されました。`,
        },
      },
    },
    teach: {
      sampledialogue: {
        description: `私がどのように応答すべきかの例として、ユーザー/ボットの対話ペアを追加します。`,
        teaching_disabled_title: `サンプル対話の教育が無効です`,
        teaching_disabled_description: `現在、このサーバーではメンバーがサンプル対話を教える・取り除くことは許可されていません。\`サーバー管理\`権限を持つメンバーが\`/server member-permissions\`でこれを有効にできます。`,
        modal_title: `サンプル対話の追加`,
        persona_select_label: `ペルソナ`,
        persona_select_description: `この対話を追加するペルソナを選択してください。`,
        persona_select_placeholder: `ペルソナを選択...`,
        main_persona_description: `メインペルソナ`,
        alter_persona_description: `オルタペルソナ`,
        user_input_label: `ユーザーのセリフ`,
        user_input_description: `任意: 単発入力。.txt一括時は空欄にしてください。`,
        user_input_placeholder: `好きな食べ物は何ですか？`,
        bot_input_label: `私の応答`,
        bot_input_description: `任意: 単発入力。.txt一括時は空欄にしてください。`,
        bot_input_placeholder: `わ、わたしはマンゴーが好きです…`,
        batch_file_label: `一括 .txt ファイル`,
        batch_file_description: `任意: 2行で1組。1行目{user}:/{{user}}:, 2行目{bot}:/{{char}}:`,
        no_input_title: `入力がありません`,
        no_input_description: `手入力2欄を両方入力するか、.txtをアップロードしてください。`,
        manual_pair_required_description: `手入力は「ユーザーのセリフ」と「私の応答」の両方が必要です。`,
        invalid_file_title: `無効なファイル`,
        invalid_file_description: `.txtファイルをアップロードしてください。`,
        file_too_large_description: `.txtファイルが大きすぎます。最大 {max_size} MB です。`,
        download_failed_description: `アップロードされたファイルのダウンロードに失敗しました。もう一度お試しください。`,
        invalid_batch_format_title: `一括形式が無効です`,
        invalid_batch_format_description: `{line_number} 行目の形式が無効です。想定プレフィックス: {expected_prefix}`,
        duplicate_title: `新規の対話がありません`,
        duplicate_description: `入力された対話ペアはすべて既存です。`,
        limit_exceeded_title: `サンプル対話上限に達しました`,
        limit_exceeded_description: `このサーバーはサンプル対話の上限 {max_allowed} 個に達しました（現在 {current_count} 個）。新しいものを追加する前に、\`/persona sample-dialogue remove\`でいくつかのサンプル対話を削除してください。`,
        batch_limit_exceeded_title: `一括インポートが上限超過`,
        batch_limit_exceeded_description: `インポートに {import_count} 枠必要ですが、上限 {max_allowed} / 現在 {current_count} です。{remove_count} 件削除してから再試行してください。`,
        user_input_too_long_title: `ユーザー入力が長すぎます`,
        user_input_too_long_description: `ユーザー入力が長すぎます（{current_length} 文字）。最大許容長は {max_allowed} 文字です。`,
        bot_input_too_long_title: `ボットの応答が長すぎます`,
        bot_input_too_long_description: `ボットの応答が長すぎます（{current_length} 文字）。最大許容長は {max_allowed} 文字です。`,
        success_title: `サンプル対話が追加されました`,
        success_description: `新しいサンプル対話ペアを正常に追加しました:

**ユーザー:**
> {user_input}

**私:**
> {bot_input}`,
        batch_success_title: `サンプル対話を追加しました`,
        batch_success_description: `{added_count} 件のサンプル対話ペアを追加しました。`,
      },
      attribute: {
        description: `このサーバーでの私を表す人格属性を追加します。`,
        teaching_disabled_title: `属性の教育が無効です`,
        teaching_disabled_description: `現在、このサーバーではメンバーが人格属性を教える・取り除くことは許可されていません。\`サーバー管理\`権限を持つメンバーが\`/server member-permissions\`でこれを有効にできます。`,
        modal_title: `人格属性の追加`,
        persona_select_label: `ペルソナ`,
        persona_select_description: `この属性を追加するペルソナを選択してください。`,
        persona_select_placeholder: `ペルソナを選択...`,
        main_persona_description: `メインペルソナ`,
        alter_persona_description: `オルタペルソナ`,
        attribute_input_label: `新しい属性`,
        attribute_input_description: `任意: 単発入力。.txt一括時は空欄にしてください。`,
        attribute_input_placeholder: `{bot}はマンゴーが好き`,
        batch_file_label: `一括 .txt ファイル`,
        batch_file_description: `任意: 空でない各行を1属性として追加します。`,
        no_input_title: `入力がありません`,
        no_input_description: `属性を入力するか、.txtをアップロードしてください。`,
        invalid_file_title: `無効なファイル`,
        invalid_file_description: `.txtファイルをアップロードしてください。`,
        file_too_large_description: `.txtファイルが大きすぎます。最大 {max_size} MB です。`,
        download_failed_description: `アップロードされたファイルのダウンロードに失敗しました。もう一度お試しください。`,
        duplicate_title: `重複した属性`,
        duplicate_description: `この属性 '{attribute}' は既に私の属性リストにあります。`,
        limit_exceeded_title: `属性上限に達しました`,
        limit_exceeded_description: `このサーバーは属性の上限 {max_allowed} 個に達しました（現在 {current_count} 個）。新しいものを追加する前に、\`/persona attribute remove\`でいくつかの属性を削除してください。`,
        batch_limit_exceeded_title: `一括インポートが上限超過`,
        batch_limit_exceeded_description: `インポートに {import_count} 枠必要ですが、上限 {max_allowed} / 現在 {current_count} です。{remove_count} 件削除してから再試行してください。`,
        content_too_long_title: `属性の内容が長すぎます`,
        content_too_long_description: `属性の内容が長すぎます（{current_length} 文字）。最大許容長は {max_allowed} 文字です。`,
        success_title: `属性が追加されました`,
        success_description: `'{attribute}' を私の人格属性に正常に追加しました。`,
        batch_success_title: `属性を追加しました`,
        batch_success_description: `{added_count} 件の属性を追加しました。`,
      },
      document: {
        description: `Retrieval-Augmented Generationで参照できる文書を教えます。`,
        persona_modal_title: `ペルソナを選択`,
        persona_select_label: `ペルソナ`,
        persona_select_description: `この文書を保存するペルソナを選択してください。`,
        persona_select_placeholder: `ペルソナを選択...`,
        main_persona_description: `メインペルソナ`,
        alter_persona_description: `オルタペルソナ`,
        rag_disabled_title: `ドキュメントRAGが無効です`,
        rag_disabled_description: `文書の参照にはデータベースに [pgvector](https://github.com/pgvector/pgvector) PostgreSQL拡張が必要です。pgvector をインストールして TomoriBot を再起動してください（[セットアップガイド](https://github.com/Bredrumb/TomoriBot#readme)を参照）。`,
        teaching_disabled_title: `ドキュメントの教育が無効です`,
        teaching_disabled_description: `現在、このサーバーではメンバーが文書を教える・削除することは許可されていません。\`サーバー管理\`権限を持つメンバーが\`/server member-permissions\`で有効にできます。`,
        no_embedding_model_title: `埋め込みモデルが設定されていません`,
        no_embedding_model_description: `このプロバイダーには埋め込みモデルが設定されていません。\`/config model embedding\`で設定してください。`,
        no_api_key_title: `APIキーがありません`,
        no_api_key_description: `文書を埋め込むには保存済みの埋め込みプロバイダー認証情報が必要です。\`/config provider add\` を使用してください。`,
        invalid_name_title: `無効な文書名`,
        invalid_name_description: `有効な文書名を入力してください（1〜64文字）。`,
        duplicate_title: `文書名が既に存在します`,
        duplicate_description: `「{name}」という名前の文書は既に存在します。別の名前を選んでください。`,
        limit_exceeded_title: `文書の上限に達しました`,
        limit_exceeded_description: `このスコープ（{scope}）は文書の上限 {max_allowed} 件に達しました（現在 {current_count} 件）。\`/memory document remove\`で削除してください。`,
        invalid_file_title: `無効なファイル`,
        file_too_large_title: `ファイルが大きすぎます`,
        file_too_large_description: `最大ファイルサイズは {max_size} MB です。`,
        download_failed_title: `ダウンロードに失敗しました`,
        download_failed_description: `アップロードされたファイルのダウンロードに失敗しました。もう一度試してください。`,
        empty_title: `文書が空です`,
        empty_description: `読み取れるテキストが見つかりませんでした。`,
        too_long_title: `文書が長すぎます`,
        too_long_description: `文書のテキストが長すぎます。最大 {max_length} 文字です。`,
        too_many_chunks_title: `チャンクが多すぎます`,
        too_many_chunks_description: `チャンク数が上限を超えました。1文書あたり最大 {max_chunks} チャンクです。`,
        server_chunk_limit_title: `サーバーのチャンク上限に達しました`,
        server_chunk_limit_description: `このスコープ（{scope}）のチャンク上限 {max_chunks} を超えるため追加できません。先に文書を削除してください。`,
        success_title: `文書を追加しました`,
        success_description: `**{name}** を {scope} に保存しました（{chunk_count} チャンク）。`,
        scope_label_persona: `ペルソナ「{persona_name}」`,
        scope_label_serverwide: `サーバー全体`,
      },
      personaprompt: {
        description: `system-prompt の後ろに追記するペルソナ専用プロンプトを設定します`,
        no_permission_title: `🔴 権限がありません`,
        no_permission_description: `ペルソナプロンプトを設定するには**サーバー管理**権限が必要です。`,
        persona_select_label: `ペルソナ`,
        persona_select_description: `更新するペルソナを選択してください。`,
        persona_select_placeholder: `ペルソナを選択...`,
        main_persona_description: `メインペルソナ`,
        alter_persona_description: `オルタペルソナ`,
        modal_title: `ペルソナプロンプトを設定`,
        part1_label: `ペルソナプロンプト（1/4）`,
        part1_description: `Discord の 4000 文字制限により、プロンプト入力は 4 つに分割されています。`,
        part1_placeholder: `例: ベテラン戦術家のように、簡潔で落ち着いた口調で話して。`,
        part2_label: `ペルソナプロンプト（2/4）- 任意`,
        part2_placeholder: `追加のペルソナ指示...`,
        part3_label: `ペルソナプロンプト（3/4）- 任意`,
        part3_placeholder: `さらにペルソナ指示...`,
        part4_label: `ペルソナプロンプト（4/4）- 任意`,
        part4_placeholder: `最後のペルソナ指示...`,
        success_title: `ペルソナプロンプトを更新しました`,
        success_description: `「{persona_name}」のペルソナプロンプトを更新しました。`,
      },
      memory: {
        description: `私の記憶を管理`,
        personal: {
          description: `どのサーバーでも私が覚えているあなたの個人的な記憶を追加します。`,
          modal_title: `個人的な記憶の追加`,
          persona_select_label: `ペルソナ`,
          persona_select_description: `この記憶を適用するペルソナを選択してください。`,
          persona_select_placeholder: `ペルソナを選択...`,
          main_persona_description: `メインペルソナ`,
          alter_persona_description: `オルタペルソナ`,
          memory_input_label: `新しい個人的な記憶`,
          memory_input_description: `任意: 単発入力。.txt一括時は空欄にしてください。`,
          memory_input_placeholder: `{user}はマンゴーが好き`,
          batch_file_label: `一括 .txt ファイル`,
          batch_file_description: `任意: 空でない各行を1記憶として追加します。`,
          no_input_title: `入力がありません`,
          no_input_description: `記憶を入力するか、.txtをアップロードしてください。`,
          invalid_file_title: `無効なファイル`,
          invalid_file_description: `.txtファイルをアップロードしてください。`,
          file_too_large_description: `.txtファイルが大きすぎます。最大 {max_size} MB です。`,
          download_failed_description: `アップロードされたファイルのダウンロードに失敗しました。もう一度お試しください。`,
          duplicate_title: `重複した個人的な記憶`,
          duplicate_description: `この記憶 '{memory}' は既にあなたの個人的な記憶にあります。`,
          limit_exceeded_title: `個人的な記憶の上限に達しました`,
          limit_exceeded_description: `あなたは個人的な記憶の上限 {max_allowed} 件に達しました（現在 {current_count} 件）。新しい記憶を追加する前に、\`/memory personal remove\`でいくつかの記憶を削除してください。`,
          batch_limit_exceeded_title: `一括インポートが上限超過`,
          batch_limit_exceeded_description: `インポートに {import_count} 枠必要ですが、上限 {max_allowed} / 現在 {current_count} です。{remove_count} 件削除してから再試行してください。`,
          content_too_long_title: `記憶の内容が長すぎます`,
          content_too_long_description: `記憶の内容が長すぎます。最大許容長は {max_length} 文字です。`,
          success_title: `個人的な記憶が追加されました`,
          success_description: `'{memory}' をあなたの個人的な記憶に正常に追加しました。`,
          batch_success_title: `個人的な記憶を追加しました`,
          batch_success_description: `{added_count} 件の個人的な記憶を追加しました。`,
          success_but_disabled_description: `'{memory}' をあなたの個人的な記憶に正常に追加しました。

**警告:** 現在、このサーバーではパーソナライズが無効になっているため、この記憶はここでは使用されません。パーソナライズが有効になっている他のサーバーでは引き続き利用可能です。`,
          batch_success_but_disabled_description: `{added_count} 件の個人的な記憶を追加しました。

**警告:** 現在、このサーバーではパーソナライズが無効になっているため、これらの記憶はここでは使用されません。パーソナライズが有効な他サーバーでは引き続き利用可能です。`,
          success_but_blacklisted_description: `'{memory}' をあなたの個人的な記憶に正常に追加しました。

**警告:** あなたは現在、このサーバーのパーソナライズ機能のブラックリストに登録されているため、この記憶はここでは使用されません。ブラックリストに登録されていない他のサーバーでは引き続き利用可能です。`,
          batch_success_but_blacklisted_description: `{added_count} 件の個人的な記憶を追加しました。

**警告:** あなたは現在、このサーバーのパーソナライズ機能のブラックリスト対象のため、これらの記憶はここでは使用されません。`,
          opted_out_error_title: `プライバシー保護が有効`,
          opted_out_error_description: `あなたはプライバシー上の理由から個人記憶の保存をオプトアウトしています。再び個人記憶を許可したい場合は、\`/personal privacy\`を使用してオプトインしてください。`,
        },
        server: {
          description: `私の知識ベースにサーバーの記憶を追加します。`,
          teaching_disabled_title: `サーバーの記憶の教育が無効です`,
          teaching_disabled_description: `現在、このサーバーではメンバーがサーバーの記憶を追加・取り除くすることは許可されていません。\`サーバー管理\`権限を持つメンバーが\`/server member-permissions\`でこれを有効にできます。`,
          modal_title: `サーバーの記憶の追加`,
          persona_select_label: `ペルソナ`,
          persona_select_description: `このサーバー記憶を適用するペルソナを選択してください。`,
          persona_select_placeholder: `ペルソナを選択...`,
          main_persona_description: `メインペルソナ`,
          alter_persona_description: `オルタペルソナ`,
          memory_input_label: `新しいサーバーの記憶`,
          memory_input_description: `任意: 単発入力。.txt一括時は空欄にしてください。`,
          memory_input_placeholder: `このサーバーのメンバーはマンゴーが好き`,
          batch_file_label: `一括 .txt ファイル`,
          batch_file_description: `任意: 空でない各行を1記憶として追加します。`,
          no_input_title: `入力がありません`,
          no_input_description: `記憶を入力するか、.txtをアップロードしてください。`,
          invalid_file_title: `無効なファイル`,
          invalid_file_description: `.txtファイルをアップロードしてください。`,
          file_too_large_description: `.txtファイルが大きすぎます。最大 {max_size} MB です。`,
          download_failed_description: `アップロードされたファイルのダウンロードに失敗しました。もう一度お試しください。`,
          duplicate_title: `重複した記憶`,
          duplicate_description: `この記憶 '{memory}' は既にこのサーバーの私の記憶にあります。`,
          limit_exceeded_title: `サーバーの記憶の上限に達しました`,
          limit_exceeded_description: `このサーバーは記憶の上限 {max_allowed} 件に達しました（現在 {current_count} 件）。新しい記憶を追加する前に、\`/memory server remove\`でいくつかの記憶を削除してください。`,
          batch_limit_exceeded_title: `一括インポートが上限超過`,
          batch_limit_exceeded_description: `インポートに {import_count} 枠必要ですが、上限 {max_allowed} / 現在 {current_count} です。{remove_count} 件削除してから再試行してください。`,
          content_too_long_title: `記憶の内容が長すぎます`,
          content_too_long_description: `記憶の内容が長すぎます。最大許容長は {max_length} 文字です。`,
          success_title: `サーバーの記憶が追加されました`,
          success_description: `'{memory}' を私のサーバーの記憶に正常に追加しました。`,
          batch_success_title: `サーバーの記憶を追加しました`,
          batch_success_description: `{added_count} 件のサーバー記憶を追加しました。`,
        },
      },
    },
    forget: {
      sampledialogue: {
        description: `私の記憶からサンプルユーザー/ボットの対話ペアを削除します。`,
        modal_title: `サンプル対話の削除`,
        select_label: `削除する対話`,
        select_description: `削除する対話ペアを選択してください`,
        select_placeholder: `対話を選択...`,
        no_dialogues_title: `サンプル対話がありません`,
        no_dialogues: `削除するサンプル対話が保存されていません。\`/persona sample-dialogue add\`で追加してください。`,
        success_title: `サンプル対話が削除されました`,
        success_description: `対話ペアを正常に削除しました: ユーザー: "{input}" → ボット: "{output}"`,
      },
      attribute: {
        description: `私の記憶から人格属性を削除します。`,
        modal_title: `属性の削除`,
        select_label: `削除する属性`,
        select_description: `私の人格から削除する属性を選択してください`,
        select_placeholder: `属性を選択...`,
        no_attributes_title: `属性がありません`,
        no_attributes: `削除する人格属性がありません。\`/persona attribute add\`で追加してください。`,
        success_title: `属性が削除されました`,
        success_description: `属性を正常に削除しました: "{attribute}"`,
      },
      document: {
        description: `サーバーの文書を削除します。`,
        modal_title: `文書の削除`,
        select_label: `削除する文書`,
        select_description: `削除する文書を選択してください`,
        select_placeholder: `文書を選択...`,
        rag_disabled_title: `ドキュメントRAGが無効です`,
        rag_disabled_description: `文書の参照にはデータベースに [pgvector](https://github.com/pgvector/pgvector) PostgreSQL拡張が必要です。pgvector をインストールして TomoriBot を再起動してください（[セットアップガイド](https://github.com/Bredrumb/TomoriBot#readme)を参照）。`,
        none_title: `文書がありません`,
        none_description: `このスコープには削除できる文書がありません。\`/memory document add\`で追加してください。`,
        success_title: `文書が削除されました`,
        success_description: `文書を正常に削除しました: "{name}"`,
      },
      personaprompt: {
        description: `ペルソナ専用プロンプトをクリアします`,
        no_permission_title: `🔴 権限がありません`,
        no_permission_description: `ペルソナプロンプトをクリアするには**サーバー管理**権限が必要です。`,
        success_title: `ペルソナプロンプトをクリアしました`,
        success_description: `「{persona_name}」のペルソナプロンプトをクリアしました。`,
      },
      memory: {
        personal: {
          description: `個人的な記憶を削除します。`,
          modal_title: `個人的な記憶の削除`,
          select_label: `削除する記憶`,
          select_description: `削除する個人的な記憶を選択してください`,
          select_placeholder: `記憶を選択...`,
          no_memories_title: `個人的な記憶がありません`,
          no_memories: `あなたには個人的な記憶が保存されていません。\`/memory personal add\`で追加してください。`,
          success_title: `個人的な記憶が削除されました`,
          success_description: `個人的な記憶を正常に削除しました: "{memory}"`,
          warning_disabled_title: `パーソナライズが無効です`,
          warning_disabled_description: `記憶は正常に削除されました。

**警告:** 現在、このサーバーではパーソナライズが無効になっているため、この変更はここでの私の行動に影響しません。パーソナライズが有効になっている他のサーバーでは反映されます。`,
        },
        server: {
          description: `私の知識からサーバーの記憶を削除します。`,
          modal_title: `サーバーの記憶の削除`,
          select_label: `削除する記憶`,
          select_description: `削除するサーバーの記憶を選択してください`,
          select_placeholder: `記憶を選択...`,
          no_memories_title: `サーバーの記憶がありません`,
          no_memories: `このサーバーにはサーバーの記憶が保存されていません。\`/memory server add\`で追加してください。`,
          no_owned_memories: `あなたが所有していて削除できるサーバーの記憶はありません。`,
          memory_not_found: `選択された記憶が見つかりませんでした。`,
          success_title: `サーバーの記憶が削除されました`,
          success_description: `サーバーの記憶を正常に削除しました: "{memory}"`,
        },
      },
    },
    generate: {
      image: {
        description: `Google GeminiまたはOpenRouterを使用してAI画像を生成する`,
        modal: {
          title: `画像生成のリクエスト`,
          prompt_label: `画像プロンプト`,
          prompt_description: `生成したい画像を説明してください`,
          prompt_placeholder: `バナナを食べている、ショートヘアの可愛いエルフの美少女、マンガ風`,
          image_upload_label: `参照画像（オプション）`,
          image_upload_2_label: `参照画像2（オプション）`,
          image_upload_3_label: `参照画像3（オプション）`,
          image_upload_description: `画像間生成のために参照画像をアップロードできます`,
          aspect_ratio_label: `アスペクト比`,
          aspect_ratio_description: `希望するアスペクト比を選択してください`,
        },
        success_title: `🟢 画像生成が完了しました！`,
        field_prompt: `プロンプト`,
        field_model: `モデル`,
        field_generation_time: `生成時間`,
        field_aspect_ratio: `アスペクト比`,
        zai_no_img2img_warning: `Z.aiは画像から画像への生成に対応していません。参照画像は無視されましたが、テキストプロンプトから画像は生成されます。`,
        nvidia_no_img2img_warning: `NVIDIA NIMは画像から画像への生成に対応していません。参照画像は無視されましたが、テキストプロンプトから画像は生成されます。`,
        disabled_title: `🔴 画像生成が無効です`,
        disabled_description: `このサーバーでは画像生成が無効になっています。\`/config tools manage\` で有効にできます（管理権限が必要）。`,
        wrong_provider_title: `🔴 サポートされていないプロバイダー`,
        wrong_provider_description: `画像生成にはネイティブ画像生成に対応したプロバイダーが必要です。現在のプロバイダーは**{current_provider}**です。`,
        no_api_key_title: `🔴 APIキーがありません`,
        no_api_key_description: `設定済みの画像プロバイダー認証情報がありません。\`/config provider add\` を使用してください。`,
        api_key_decrypt_failed_title: `🔴 APIキーエラー`,
        api_key_decrypt_failed_description: `設定済みの画像プロバイダー認証情報の復号化に失敗しました。\`/config provider add\` で再設定してください。`,
        no_diffusion_model_title: `🔴 画像モデルがありません`,
        no_diffusion_model_description: `プロバイダーに対して画像拡散モデルが設定されていません。`,
        error_billing_title: `🔴 課金が必要です`,
        error_billing_description: `画像生成を使用するには、APIキーの課金を有効にする必要があります。`,
        error_safety_title: `🔴 コンテンツがブロックされました`,
        error_safety_description: `プロンプトが安全フィルターによってブロックされました。別のプロンプトを試してください。`,
        error_generation_failed_title: `🔴 生成に失敗しました`,
        error_generation_failed_description: `画像生成に失敗しました: {error}`,
        invalid_image_title: `🔴 無効な画像`,
        invalid_image_description: `有効な画像ファイル（PNG、JPGなど）をアップロードしてください。`,
        quota_exceeded_title: `🔴 画像クォータを超過しました`,
        quota_exceeded_description: `画像生成クォータに達しました。{reset_info}`,
        user_quota_exceeded_description: `日次画像生成クォータに達しました。{reset_info}`,
        serverwide_quota_exceeded_description: `このサーバーはこの期間の画像生成クォータに達しました。{reset_info}`,
        quota_resets_in_hours: `クォータは {hours} 時間後にリセットされます。`,
        quota_resets_in_days: `クォータは {days} 日後にリセットされます。`,
        quota_exceeded_footer: `このクォータは、このサーバーの管理者が \`/server quota\` で設定しています。`,
      },
      video: {
        description: `Google Veo、OpenRouter、またはZ.aiを使用してAI動画を生成します`,
        modal: {
          title: `動画を生成`,
          prompt_label: `動画プロンプト`,
          prompt_description: `生成したい動画の内容を説明してください`,
          prompt_placeholder: `山の湖に朝日が差し込み、水面に穏やかな波紋が広がる静かな風景`,
          image_upload_label: `参照画像（オプション）`,
          image_upload_description: `画像から動画を生成するための参照画像をアップロード`,
          aspect_ratio_label: `アスペクト比`,
          aspect_ratio_description: `希望のアスペクト比を選択してください`,
        },
        success_title: `🟢 動画が正常に生成されました！`,
        success_description: `\`{model}\` で {elapsed}秒で生成しました。
**プロンプト:** {prompt}`,
        generating_title: `🎬 動画を生成中...`,
        generating_description: `動画を生成しています。通常1〜3分かかります。しばらくお待ちください...`,
        disabled_title: `🔴 動画生成が無効です`,
        disabled_description: `このサーバーでは動画生成が無効になっています。\`Manage Server\`権限を持つメンバーが \`/config tools manage\` で有効にできます。`,
        wrong_provider_title: `🔴 サポートされていないプロバイダー`,
        wrong_provider_description: `動画生成にはGoogle、OpenRouter、またはZ.aiが必要です。現在のプロバイダーは **{current_provider}** です。`,
        no_api_key_title: `🔴 APIキーがありません`,
        no_api_key_description: `設定済みの動画プロバイダー認証情報がありません。\`/config provider add\` を使用してください。`,
        api_key_decrypt_failed_title: `🔴 APIキーエラー`,
        api_key_decrypt_failed_description: `設定済みの動画プロバイダー認証情報の復号に失敗しました。\`/config provider add\` で再設定してください。`,
        no_video_model_title: `🔴 動画モデルがありません`,
        no_video_model_description: `プロバイダーに動画モデルが設定されていません。\`/config model video\` で設定してください。`,
        error_title: `🔴 動画生成に失敗しました`,
        unsupported_provider_description: `プロバイダー **{provider}** では動画生成がサポートされていません。`,
        no_data_description: `APIから動画データを受信できませんでした。生成がブロックされたか失敗した可能性があります。`,
        file_too_large_title: `🔴 動画が大きすぎます`,
        file_too_large_description: `生成された動画（{size_mb} MB）がDiscordの25 MBファイルサイズ制限を超えています。短いプロンプトや異なるアスペクト比をお試しください。`,
        invalid_image_title: `🔴 無効な画像`,
        invalid_image_description: `アップロードされた参照画像を処理できませんでした。別の画像をお試しください。`,
        timeout_description: `動画生成がタイムアウトしました。プロバイダーに負荷がかかっている可能性があります。後でもう一度お試しください。`,
        blocked_description: `プロバイダーのコンテンツ安全フィルターにより動画生成がブロックされました。別のプロンプトをお試しください。`,
        generic_error_description: `動画生成中に予期しないエラーが発生しました。後でもう一度お試しください。`,
        quota_exceeded_title: `🔴 動画クォータ超過`,
        quota_exceeded_description: `動画生成クォータに達しました。{reset_info}`,
        user_quota_exceeded_description: `日次動画生成クォータに達しました。{reset_info}`,
        serverwide_quota_exceeded_description: `このサーバーはこの期間の動画生成クォータに達しました。{reset_info}`,
        quota_resets_in_hours: `クォータは {hours} 時間後にリセットされます。`,
        quota_resets_in_days: `クォータは {days} 日後にリセットされます。`,
        quota_exceeded_footer: `このクォータは、このサーバーの管理者が \`/server quota\` で設定しています。`,
      },
    },
    model: {
      providerPicker: {
        title: `プロバイダーを選択`,
        description: `このモデルスロットで使う保存済みプロバイダーを選択してください。`,
        placeholder: `保存済みプロバイダーを選択...`,
        no_providers_title: `保存済みプロバイダーがありません`,
        no_providers_description: `この機能で使える保存済みプロバイダーがありません。先に \`/config provider add\` で追加してください。`,
      },
      speech: {
        description: `有効な音声生成エンドポイントを選択します。`,
        no_endpoints_title: `音声エンドポイントがありません`,
        no_endpoints_description: `まず \`/provider custom-endpoint add\` または \`/speech elevenlabs\` で音声エンドポイントを登録してください。`,
        modal_title: `音声エンドポイントを選択`,
        select_label: `音声エンドポイント`,
        select_description: `ペルソナのボイスメッセージ生成に使うエンドポイントを選択します。`,
        select_placeholder: `音声エンドポイントを選択...`,
        endpoint_description: `{api_style} endpoint {active}({label})`,
        active_marker: `[active] `,
        already_selected_title: `音声エンドポイントは既に選択済みです`,
        already_selected_description: `**{endpoint}** は既に有効な音声エンドポイントです。`,
        success_title: `音声エンドポイントを更新しました`,
        success_description: `ボイスメッセージは今後 **{endpoint}** を使用します。`,
        success_source_changed_description: `ボイスメッセージは今後 **{endpoint}** を使用します。音声ソース種別が変わったため、必要なペルソナには {voice_assign_command} で対応する音声を割り当ててください。`,
      },
      transcription: {
        description: `有効な文字起こしエンドポイントを選択します。`,
        no_endpoints_title: `文字起こしエンドポイントがありません`,
        no_endpoints_description: `まず \`/provider custom-endpoint add\` または \`/speech elevenlabs\` で文字起こしエンドポイントを登録してください。`,
        modal_title: `文字起こしエンドポイントを選択`,
        select_label: `文字起こしエンドポイント`,
        select_description: `音声添付の文字起こしに使うエンドポイントを選択します。`,
        select_placeholder: `文字起こしエンドポイントを選択...`,
        endpoint_description: `{api_style} endpoint {active}({label})`,
        active_marker: `[active] `,
        already_selected_title: `文字起こしエンドポイントは既に選択済みです`,
        already_selected_description: `**{endpoint}** は既に有効な文字起こしエンドポイントです。`,
        success_title: `文字起こしエンドポイントを更新しました`,
        success_description: `音声添付は今後 **{endpoint}** で文字起こしされます。`,
      },
      text: {
        description: `私が使用する基盤となるAIモデルを変更します。`,
        modal_title: `AIモデルの選択`,
        select_label: `AIモデル`,
        select_description: `私が使用するAIモデルを選択してください。無料でないモデルの価格については、各AIプロバイダーの公式サイトをご確認ください。`,
        select_placeholder: `モデルを選択...`,
        no_models_title: `モデルが見つかりません`,
        no_models_description: `データベースから利用可能なAIモデルを読み込めませんでした。`,
        invalid_model_title: `無効なモデル`,
        invalid_model_description: `選択されたモデル名は無効か、利用できません。`,
        already_selected_title: `モデルは既に選択済みです`,
        already_selected_description: `私は既に \`{model_name}\` モデルを使用しています。`,
        success_title: `モデルが更新されました`,
        success_description: `テキストモデルを \`{model_name}\`（{provider}）に更新しました。変更前：\`{previous_model}\`。`,
        custom_updated_title: `カスタムモデルの機能が更新されました`,
        custom_updated_description: `カスタムモデルが再設定されました。

**モデル名:** \`{model_name}\`
**有効な機能:** {capabilities}`,
        scope_description: `このモデル変更のスコープを設定します（グローバル、チャンネル、またはペルソナ）。`,
        scope_global: `グローバル（サーバーデフォルト）`,
        scope_channel: `チャンネル（このチャンネルのみ）`,
        scope_persona: `ペルソナ（特定のペルソナのみ）`,
        scope_set_channel_success: `{channel} のモデルを **{model}** に設定しました`,
        scope_set_persona_success: `**{persona}** のモデルを **{model}** に設定しました`,
        other_model_prompt_description: `**other-model** を選択しました。

下のボタンをクリックして、OpenRouter モデルのコードネームを入力してください（例：\`xai/grok-2\`、\`openrouter/free\`、\`nvidia/nemotron-4-340b-instruct\`）。`,
        other_model_modal_title: `OpenRouter モデルを入力`,
        other_model_model_label: `OpenRouter モデルコードネーム`,
        other_model_model_placeholder: `xai/grok-2`,
        other_model_validating_title: `モデルを検証中`,
        other_model_validating_description: `OpenRouter で \`{model_name}\` の機能を取得しています...`,
        other_model_validation_failed_title: `モデルが見つかりません`,
        other_model_validation_failed_description: `OpenRouter で \`{model_name}\` が見つかりませんでした。モデルIDが正しいか確認して再試行してください。`,
        other_model_configured_title: `カスタムモデルの設定が完了`,
        other_model_configured_description: `カスタム OpenRouter モデルが \`{model_name}\` に設定されました。

**検出された機能:** {capabilities}`,
      },
      embedding: {
        description: `文書検索に使用する埋め込みモデルを変更します。`,
        modal_title: `埋め込みモデルを選択`,
        select_label: `埋め込みモデル`,
        select_description: `文書検索に使用する埋め込みモデルを選択してください。`,
        select_placeholder: `モデルを選択...`,
        no_api_key_title: `APIキーが設定されていません`,
        no_api_key_description: `埋め込みモデルを変更するには保存済みプロバイダーが必要です。先に \`/config provider add\` を使用してください。`,
        no_models_title: `埋め込みモデルがありません`,
        no_models_description: `プロバイダー {provider} で利用可能な埋め込みモデルが見つかりませんでした。`,
        invalid_model_title: `無効なモデル`,
        invalid_model_description: `選択された埋め込みモデルは無効です。`,
        already_selected_title: `既に選択されています`,
        already_selected_description: `既に \`{model_name}\` を使用しています。`,
        reembed_started_title: `再埋め込み中`,
        reembed_started_description: `新しいモデルで文書の埋め込みを再生成しています。しばらくお待ちください...`,
        success_title: `埋め込みモデルを更新しました`,
        success_description: `埋め込みモデルを \`{model_name}\` に変更しました（以前: \`{previous_model}\`）。`,
        current_none: `なし`,
      },
      fallback: {
        description: `プライマリモデルが失敗した場合に使うバックアップモデルを設定し、なしで各スロットをクリアできます。`,
        modal_title: `フォールバックモデルの設定`,
        slot_1_label: `フォールバックモデル1`,
        slot_2_label: `フォールバックモデル2`,
        slot_3_label: `フォールバックモデル3`,
        slot_4_label: `フォールバックモデル4`,
        slot_5_label: `フォールバックモデル5`,
        select_placeholder: `モデルを選択...`,
        current_placeholder: `現在: {model}`,
        current_placeholder_with_provider: `現在: {model} ({provider})`,
        custom_provider_label: `カスタム`,
        clear_option_label: `なし（このスロットをクリア）`,
        clear_option_description: `このフォールバックスロットを空にします。`,
        no_models_title: `モデルが見つかりません`,
        no_models_description: `選択したプロバイダーで利用可能なモデルがありません。`,
        no_providers_title: `プロバイダーが設定されていません`,
        no_providers_description: `このサーバーにはテキストプロバイダーが設定されていません。先に \`/config provider add\` を使用してください。`,
        custom_provider_title: `非対応`,
        custom_provider_description: `カスタムプロバイダーではフォールバックモデルはサポートされていません。`,
        primary_conflict_title: `選択が無効です`,
        primary_conflict_description: `選択したフォールバックモデルの一つ以上がサーバーのプライマリモデル \`{model}\` と一致しています。別のモデルを選択してください。`,
        success_title: `フォールバックモデルを更新しました`,
        success_description: `フォールバック順:
{model_list}`,
        cleared_title: `フォールバックモデルをクリアしました`,
        cleared_description: `このサーバーにフォールバックモデルは設定されていません。`,
      },
      image: {
        description: `このサーバーの画像生成モデルを変更します。`,
        modal_title: `画像生成モデルの選択`,
        select_label: `画像モデル`,
        select_description: `画像生成モデルを選択してください。価格については各AIプロバイダーをご確認ください。`,
        select_placeholder: `画像モデルを選択...`,
        clear_description: `任意: 新しいモデルを選ぶ代わりに、保存済み画像モデルスロットをクリアします。`,
        clear_standard_option: `通常の画像スロット`,
        clear_nai_option: `NovelAI画像スロット`,
        clear_all_option: `すべての画像スロット`,
        no_api_key_title: `APIキーが設定されていません`,
        no_api_key_description: `画像モデルを変更するには保存済みプロバイダーが必要です。先に \`/config provider add\` を使用してください。`,
        no_models_title: `画像モデルが利用できません`,
        no_models_description: `プロバイダー {provider} で利用可能な画像生成モデルがありません。`,
        invalid_model_description: `選択された画像モデルは無効か、利用できません。`,
        already_selected_title: `モデルは既に選択済みです`,
        already_selected_description: `既に \`{model_name}\` 画像モデルを使用しています。`,
        success_title: `画像モデルが更新されました`,
        success_description: `画像生成には \`{model_name}\` モデルを使用します（以前は \`{previous_model}\`）。`,
        slot_cleared_title: `画像モデルスロットをクリアしました`,
        slot_cleared_description: `**{target}** の画像モデルスロットをクリアしました。`,
        current_none: `なし`,
        nai_only_title: `NovelAI画像モデル`,
        nai_only_description: `保存済みの画像プロバイダーはNovelAIのみです。ここで設定したモデルは、\`generate_image_nai\` 用の専用NovelAI画像スロットに保存されます。`,
        nai_picker_note: `ここでNovelAI画像モデルを設定すると、\`generate_image_nai\` 用の専用NovelAIスロットに保存されます。画像生成ツールを1つだけ使わせたい場合は、\`/config model image clear\` を使ってください。`,
      },
      video: {
        description: `このサーバーの動画生成モデルを変更します。`,
        modal_title: `動画生成モデルの選択`,
        select_label: `動画モデル`,
        select_description: `動画生成モデルを選択してください。価格については各AIプロバイダーをご確認ください。`,
        select_placeholder: `動画モデルを選択...`,
        no_api_key_title: `APIキーが設定されていません`,
        no_api_key_description: `動画モデルを変更するには保存済みプロバイダーが必要です。先に \`/config provider add\` を使用してください。`,
        no_models_title: `動画モデルが利用できません`,
        no_models_description: `プロバイダー {provider} で利用可能な動画生成モデルがありません。`,
        invalid_model_description: `選択された動画モデルは無効か、利用できません。`,
        already_selected_title: `モデルは既に選択済みです`,
        already_selected_description: `既に \`{model_name}\` 動画モデルを使用しています。`,
        success_title: `動画モデルが更新されました`,
        success_description: `動画生成には \`{model_name}\` モデルを使用します（以前は \`{previous_model}\`）。`,
        current_none: `なし`,
      },
      vision: {
        description: `チャットモデルが画像を見られない場合に画像分析用のビジョンモデルを設定します。`,
        modal_title: `ビジョンモデルの選択`,
        select_label: `ビジョンモデル`,
        select_description: `チャットモデルの代わりに画像を分析するビジョン対応モデルを選択してください。`,
        select_placeholder: `ビジョンモデルを選択...`,
        no_api_key_title: `APIキー未設定`,
        no_api_key_description: `ビジョンモデルを設定するには保存済みプロバイダーが必要です。先に \`/config provider add\` を使用してください。`,
        no_models_title: `ビジョンモデルがありません`,
        no_models_description: `現在のプロバイダー（{provider}）にはビジョン対応モデルがありません。先にビジョンモデルのあるプロバイダーに切り替えてください。`,
        invalid_model_title: `無効なモデル`,
        invalid_model_description: `選択されたビジョンモデルは無効または利用できません。`,
        already_selected_title: `モデルは既に選択済みです`,
        already_selected_description: `既に \`{model_name}\` をビジョンモデルとして使用しています。`,
        success_title: `ビジョンモデルが更新されました`,
        success_description: `ビジョン非対応のチャットモデルは \`{model_name}\` を使用して \`analyze_image\` ツールで画像を分析します。`,
        success_no_tools_description: `ビジョンモデルを \`{model_name}\` に設定しましたが、現在のチャットモデル（\`{chat_model}\`）は**ツール呼び出し**に対応していません。ビジョンモデルは \`analyze_image\` ツールが必要です — ツール対応のチャットモデルに切り替えてください。`,
        cleared_title: `ビジョンモデルを削除しました`,
        cleared_description: `ビジョンモデルが削除されました。ビジョン非対応のチャットモデルは画像を分析できなくなります。`,
        clear_option: `なし（ビジョンツールを無効化）`,
      },
      "stop-strings": {
        description: `サーバーの停止文字列を管理します。`,
        add: {
          description: `サーバー全体の停止文字列を追加します。`,
          strings_description: `追加する停止文字列。複数指定する場合はカンマで区切ります。改行は \\n を使えます。`,
          invalid_title: `停止文字列がありません`,
          invalid_description: `空でない停止文字列を1つ以上入力してください。複数指定する場合はカンマで区切ります。`,
          too_long_title: `停止文字列が長すぎます`,
          too_long_description: `停止文字列は {max_length} 文字以下にしてください。長すぎる項目: \`{stop_string}\``,
          too_many_title: `停止文字列が多すぎます`,
          too_many_description: `このサーバーに保存できる停止文字列は最大 {max_count} 件です。現在 {current_count} 件あり、このコマンドでは {added_count} 件追加されます。`,
          no_changes_title: `追加する停止文字列はありません`,
          no_changes_description: `指定された停止文字列はすでにこのサーバーに保存されています。`,
          success_title: `停止文字列を追加しました`,
          success_description: `サーバー全体の停止文字列を {added_count} 件追加しました: {stop_strings}`,
          more_added: `ほか {count} 件`,
        },
        manage: {
          description: `サーバー全体の停止文字列と話者パターン停止を管理します。`,
          modal_title: `停止文字列の管理`,
          speaker_pattern_checkbox_label: `\\n{string}: パターンで生成を停止`,
          speaker_pattern_checkbox_description: `デフォルトはオフです。"\\nName:" のような話者ラベル停止を有効にします。`,
          stop_strings_checkbox_label: `保存済み停止文字列`,
          stop_strings_checkbox_label_continued: `保存済み停止文字列（続き）`,
          stop_strings_checkbox_description: `チェックした文字列は残ります。削除する文字列はチェックを外してください。`,
          stop_string_option_description: `停止文字列 #{index}`,
          too_many_title: `停止文字列が多すぎます`,
          too_many_description: `このサーバーには {count} 件の停止文字列があり、モーダル上限の {max_entries} 件を超えています。`,
          no_changes_title: `変更はありません`,
          no_changes_description: `停止文字列設定はすでにその状態です。`,
          success_title: `停止文字列を更新しました`,
          success_description: `サーバー全体の停止文字列設定を更新しました。
削除 ({removed_count}): {removed_stop_strings}
話者パターン停止: **{speaker_pattern_state}**`,
          more_removed: `ほか {count} 件`,
        },
      },
      "logit-bias": {
        description: `対応モデル向けのlogit bias項目を管理します。`,
        add: {
          description: `共通のbias値で、カンマ区切りのlogit bias項目を追加します。`,
          modal_title: `Logit Biasを追加`,
          terms_label: `単語 / トークンID`,
          terms_description: `カンマ区切りで入力。単語は現在のモデル向けにトークン化され、モデル変更時に再計算されます。例: Sorry, apology, 50256`,
          terms_placeholder: `例: Sorry, apology, 50256`,
          bias_label: `Bias値`,
          bias_description: `-100〜100の数値。例: -100`,
          bias_placeholder: `例: -100`,
          empty_terms_title: `項目がありません`,
          empty_terms_description: `少なくとも1つ、カンマ区切りの単語またはトークンIDを入力してください。`,
          term_too_long_title: `項目が長すぎます`,
          term_too_long_description: `各項目は最大{max_length}文字までです。`,
          invalid_bias_title: `無効なBias値`,
          invalid_bias_description: `Biasは {min} から {max} の数値でなければなりません。`,
          already_set_title: `変更はありません`,
          already_set_description: `入力された項目はすべて、同じbias値で既に保存されています。`,
          success_title: `Logit Biasを更新しました`,
          success_description: `新規 **{added_count}** 件を追加し、既存 **{updated_count}** 件を更新しました。
保存合計: **{total_count}** 件
現在のモデルで実行時に使える項目: **{runtime_ready_count}** 件`,
        },
        remove: {
          description: `保存済みのlogit bias項目を削除します。`,
          clearall_description: `モーダルを開かずに、保存済みのlogit bias項目をすべて削除します。`,
          modal_title: `Logit Biasを削除`,
          checkbox_label: `Logit Bias項目`,
          checkbox_label_continued: `Logit Bias項目（続き）`,
          checkbox_description: `削除したい項目のチェックを外してください。`,
          none_title: `Logit Bias項目はありません`,
          none_description: `このサーバーには保存済みのlogit bias項目がありません。`,
          select_page_title: `Logit Biasページを選択`,
          select_page_description: `このサーバーには保存済みのlogit bias項目が **{total_entries}** 件あり、**{total_pages}** ページに分かれています。編集するページを選んでください。`,
          too_many_title: `Logit Biasページが多すぎます`,
          too_many_description: `このサーバーには保存済みのlogit bias項目が **{total_entries}** 件あり、**{total_pages}** ページに分かれています。現在のページ選択UIは **{max_pages}** ページまで対応しています。`,
          no_removals_title: `削除された項目はありません`,
          no_removals_description: `どの項目も未チェックになっていません。保存済みのlogit bias項目は変更されていません。`,
          success_title: `Logit Bias項目を更新しました`,
          success_description: `**{removed_count}** 件を削除しました。保存済みの項目は **{remaining_count}** 件残っています。`,
          clearall_success_title: `Logit Biasをクリアしました`,
          clearall_success_description: `保存済みのlogit bias項目をすべて削除しました（**{removed_count}** 件）。`,
        },
        upload: {
          description: `SillyTavern形式のlogit bias JSONをアップロードします。`,
          file_description: `text と value フィールドを持つ logit bias オブジェクトの .json ファイル。`,
          invalid_file_title: `無効なファイル`,
          file_too_large_title: `ファイルが大きすぎます`,
          file_too_large_description: `アップロードするファイルは {max_size} MB 以下である必要があります。`,
          download_failed_title: `ダウンロード失敗`,
          download_failed_description: `アップロードされたファイルをダウンロードできませんでした。もう一度お試しください。`,
          invalid_json_title: `無効なJSON`,
          invalid_json_description: `アップロードされたファイルは有効なJSONではありません。`,
          invalid_schema_title: `無効なLogit Bias形式`,
          invalid_schema_description: `\`text\` と \`value\` を持つSillyTavern形式の項目、またはその配列が必要です。Biasは {min} から {max}、text は最大 {max_length} 文字までです。`,
          no_entries_title: `項目が見つかりません`,
          no_entries_description: `アップロードされたファイルには有効なlogit bias項目がありませんでした。`,
          already_set_title: `変更はありません`,
          already_set_description: `アップロードされた項目はすべて、同じbias値で既に保存されています。`,
          success_title: `Logit Biasをインポートしました`,
          success_description: `新規 **{added_count}** 件を追加し、既存 **{updated_count}** 件を更新しました。
保存合計: **{total_count}** 件
現在のモデルで実行時に使える項目: **{runtime_ready_count}** 件`,
        },
      },
      override: {
        remove: { description: `チャンネルまたはペルソナのモデル上書きを削除します。` },
        description: `チャンネルとペルソナのモデル上書きを管理します。`,
      },
      parameters: {
        description: `プロバイダーごとの保存済みサンプラー設定を更新します。`,
        provider_description: `更新するプロバイダーを指定します。未指定なら現在のテキストプロバイダーです。`,
        temperature_description: `このプロバイダーの Temperature 上書き値（0〜2）。`,
        top_p_description: `このプロバイダーの Top-P 上書き値（0〜1）。`,
        top_k_description: `このプロバイダーの Top-K 上書き値（0〜40）。`,
        frequency_penalty_description: `このプロバイダーの頻度ペナルティ上書き値（-2〜2）。`,
        presence_penalty_description: `このプロバイダーの出現ペナルティ上書き値（-2〜2）。`,
        min_p_description: `このプロバイダーの Min-P 上書き値（0〜1）。`,
        thinking_level_description: `このプロバイダーの思考レベル上書き値。`,
        max_output_tokens_description: `このプロバイダーの最大出力トークン数（1〜131072）。未設定の場合はプロバイダーのデフォルト値を使用します。`,
        sampler_temperature_label: `温度`,
        sampler_top_p_label: `Top-P`,
        sampler_top_k_label: `Top-K`,
        sampler_frequency_penalty_label: `頻度ペナルティ`,
        sampler_presence_penalty_label: `存在ペナルティ`,
        sampler_min_p_label: `Min-P`,
        sampler_max_output_tokens_label: `最大出力トークン数`,
        provider_not_saved_title: `保存済みプロバイダーが見つかりません`,
        provider_not_saved_description: `**{provider}** の保存済み設定がありません。先に \`/config provider add\` で追加してください。`,
        picker_description: `新しいサンプラー設定を適用する保存済みプロバイダーを選択してください。`,
        no_changes_title: `サンプラーの変更はありません`,
        no_changes_description: `サンプラー設定は変更されませんでした。`,
        success_title: `サンプラー設定を更新しました`,
        success_description: `**{provider}** のサンプラー設定を更新しました: {settings}`,
      },
    },
    mcp: {
      description: `リモートMCP（Model Context Protocol）ツールサーバーを管理`,
      add: {
        description: `このギルドに新しいリモートMCPサーバーを登録します。/help mcp でセットアップガイドを確認できます。`,
        modal_title: `MCPサーバーを追加`,
        name_label: `サーバー名`,
        name_placeholder: `my-mcp-server`,
        url_label: `サーバーURL`,
        url_placeholder: `https://mcp.example.com/sse`,
        auth_token_label: `認証トークン（任意）`,
        auth_token_placeholder: `BearerトークンまたはSmithery APIキー（不要な場合は空白）`,
        server_type_label: `サーバータイプ（任意）`,
        server_type_description: `このサーバーが置き換える機能（対応する内蔵ツールを無効化）`,
        none_option: `汎用`,
        none_option_description: `内蔵ツールは無効化されません`,
        web_search_option: `ウェブ検索`,
        web_search_option_description: `内蔵のBraveおよびDuckDuckGo検索ツールを無効化`,
        url_fetcher_option: `URL取得`,
        url_fetcher_option_description: `内蔵のURL取得ツールを無効化`,
        invalid_input_title: `入力不足`,
        invalid_input_description: `サーバー名とURLの両方が必要です。`,
        invalid_name_title: `無効なサーバー名`,
        invalid_name_description: `サーバー名は英数字とハイフンのみ使用可能（1〜32文字）で、英数字で始まる必要があります。`,
        invalid_url_title: `無効なURL`,
        invalid_url_invalid_format_description: `MCPサーバーURLの形式が正しくありません。`,
        invalid_url_protocol_description: `MCPサーバーURLはHTTPまたはHTTPSを使用する必要があります。`,
        invalid_url_http_localhost_only_description: `開発環境では、HTTPはlocalhostのMCPサーバーにのみ使用できます。リモートサーバーにはHTTPSを使ってください。`,
        invalid_url_https_required_description: `本番環境ではTLS付きのHTTPS MCPサーバーのみ許可されています。`,
        invalid_url_localhost_blocked_description: `本番環境ではlocalhostのMCPサーバーは使用できません。`,
        invalid_url_dns_failed_description: `ホスト名 \`{hostname}\` をこのサーバーから解決できませんでした。`,
        invalid_url_private_address_description: `本番環境では公開ルーティング可能なMCPホストのみ許可されています。このホスト名はブロック対象アドレス \`{address}\` に解決されました。`,
        limit_reached_title: `サーバー上限に達しました`,
        limit_reached_description: `このギルドはMCPサーバーの上限（{max}台）に達しています。新しいサーバーを追加する前に既存のサーバーを削除してください。`,
        connection_failed_title: `接続失敗`,
        connection_failed_description: `MCPサーバーに接続できませんでした。
**エラー:** {error}`,
        duplicate_name_title: `名前が重複`,
        duplicate_name_description: `"{name}"という名前のMCPサーバーはこのギルドに既に存在します。`,
        success_title: `MCPサーバーを追加しました`,
        success_description: `**{name}**の登録に成功しました。
**URL:** \`{url}\`
**発見されたツール:** {tool_count}件 ({tool_names})

信頼できるMCPサーバーだけを追加してください。
悪意のあるサーバーは、まぎらわしい指示を返したり、ツールに送られた情報を集めたり、危険または誤った結果を返すおそれがあります。`,
      },
      remove: {
        description: `このギルドから登録済みのMCPサーバーを削除します。`,
        modal_title: `MCPサーバーを削除`,
        checkbox_label: `登録済みMCPサーバー`,
        checkbox_label_continued: `登録済みMCPサーバー（続き）`,
        checkbox_description: `削除したいMCPサーバーのチェックを外してください。`,
        too_many_title: `MCPサーバーが多すぎます`,
        too_many_description: `このギルドには登録済みMCPサーバーが **{count}** 台あります。Discord のモーダルではチェックボックスグループを **{max_groups}** 個（合計 **{max_entries}** 項目）までしか表示できません。`,
        no_removals_title: `削除されたMCPサーバーはありません`,
        no_removals_description: `どのMCPサーバーも未チェックになっていません。登録済みサーバーは変更されていません。`,
        success_title: `MCPサーバーを更新しました`,
        success_description: `次のMCPサーバーを削除して切断しました。
{servers_removed}`,
      },
      list: {
        description: `このギルドの登録済みMCPサーバーを一覧表示します。`,
        empty_title: `MCPサーバーなし`,
        empty_description: `このギルドにはMCPサーバーが登録されていません。\`/config mcp add\`で登録してください。`,
        title: `登録済みMCPサーバー`,
        header_description: `**{count}**台のサーバーが登録済み:

{servers}`,
      },
      toggle: {
        description: `登録済みMCPサーバーの有効/無効を切り替えます。`,
        modal_title: `MCPサーバーの切り替え`,
        select_label: `サーバーを選択`,
        select_description: `切り替えるMCPサーバーを選択してください`,
        select_placeholder: `切り替えるサーバーを選択...`,
        state_label: `有効/無効`,
        state_description: `サーバーを有効にするか無効にするかを選択`,
        currently_enabled: `有効`,
        currently_disabled: `無効`,
        enable_option: `有効にする`,
        enable_option_description: `このMCPサーバーをツール呼び出しに有効化`,
        not_found_title: `サーバーが見つかりません`,
        not_found_description: `"{name}"という名前のMCPサーバーはこのギルドに見つかりませんでした。`,
        enabled_success_title: `MCPサーバーを有効化しました`,
        enabled_success_description: `MCPサーバー"{name}"が有効化され、ツール呼び出しに使用可能になりました。`,
        disabled_success_title: `MCPサーバーを無効化しました`,
        disabled_success_description: `MCPサーバー"{name}"が無効化され、切断されました。`,
      },
    },
    capabilities: {
      description: `ツール使用と特定の機能を管理します。`,
      toggle: {
        description: `ツールや関数呼び出しの使用を切り替えます。`,
        success_title: `ツール使用を更新しました`,
        enabled_success: `ツール使用を**有効**にしました。再びツールや関数を呼び出せます。`,
        disabled_success: `ツール使用を**無効**にしました。モデルの能力に関わらず、ツールや関数は一切使用しません。`,
      },
      manage: {
        description: `このサーバーでの私のコアな行動権限を設定します。`,
        selfteaching_option: `自己学習`,
        personalization_option: `パーソナライズ (記憶/ニックネーム)`,
        emojiusage_option: `絵文字の使用`,
        stickerusage_option: `スタンプの使用`,
        websearch_option: `ウェブ検索権限`,
        managemessage_option: `メッセージ管理`,
        threadcreation_option: `スレッド作成`,
        imagegen_option: `画像生成`,
        videogen_option: `動画生成`,
        hiderespondembed_option: `応答埋め込みを非表示`,
        hideimpersonationembeds_option: `なりすまし埋め込みを非表示`,
        voicemessage_option: `ボイスメッセージ（ElevenLabs）`,
        selfteaching_desc: `サーバーの会話から学習する`,
        personalization_desc: `個人記憶とニックネーム`,
        emojiusage_desc: `返答に絵文字を使用する`,
        stickerusage_desc: `スタンプを送信する`,
        websearch_desc: `ウェブで情報を検索する`,
        managemessage_desc: `最近のメッセージの固定と、ボットやキャラクター名義の最近のメッセージ編集・削除を許可する`,
        threadcreation_desc: `公開スレッドを作成し、最初のメッセージを送信する`,
        imagegen_desc: `リクエストに応じて画像生成`,
        videogen_desc: `リクエストに応じて短い動画を生成`,
        hiderespondembed_desc: `/bot respond の成功埋め込みを非表示`,
        hideimpersonationembeds_desc: `なりすまし通知を非表示`,
        voicemessage_desc: `ElevenLabs TTSボイスメッセージを送信`,
        select_placeholder: `有効にする権限を選択...`,
        checkbox_label_continued: `権限（続き）`,
        select_embed_title: `権限の設定`,
        select_embed_description: `**有効にする**権限を選択してください。チェックあり = 有効、チェックなし = 無効。`,
        no_changes_title: `変更なし`,
        no_changes_description: `すべての権限はすでに選択した値に設定されています。`,
        success_title: `権限が更新されました`,
        success_description: `**{count}** 件の権限を更新しました。`,
      },
    },
    provider: {
      description: `保存されたプロバイダー設定を管理`,
      add: {
        description: `切り替えずに保存済みプロバイダー設定を追加または更新します。`,
        modal_title: `保存済みプロバイダーを追加`,
        success_title: `プロバイダーを保存しました`,
        success: `**{provider}** の認証情報を保存しました。\`/config model text\`でテキストモデルに選択するか、\`/config model embedding|image|video|vision\`でその他の機能に設定できます。`,
        updated_existing: `**{provider}** の保存済み認証情報を更新しました。`,
        custom_moved_title: `カスタムエンドポイントは移動しました`,
        custom_moved_description: `旧来のカスタムエンドポイント用プロバイダーフローは非推奨です。{custom_models_add_command} でエンドポイントを登録し、{model_text_command} で有効化してください。更新後の案内は {help_custom_models_command} を参照してください。`,
        provider_label: `対象プロバイダー`,
        provider_description: `認証情報を追加またはローテーションするプロバイダーを選択してください。`,
        provider_placeholder: `プロバイダーを選択...`,
        already_existing_suffix: `Already Existing`,
        already_existing_description: `このプロバイダーは既に設定済みです。送信すると認証情報が更新されます。`,
        custom_deprecated_description: `/config custom-endpoint add に移動しました。リダイレクト案内を見るときだけ選択してください。`,
        api_key_description: `このキーは安全に保存されます。カスタムエンドポイントを選んでリダイレクト案内だけ確認したい場合は空欄で構いません。`,
        api_key_label: `APIキー`,
        api_key_description_with_custom: `APIキー、またはCustomの場合はOpenAIエンドポイントURL（例：http://localhost:11434/v1）`,
        api_key_placeholder: `このキーは誰とも共有しないでください`,
        bearer_token_label: `Bearerトークン（任意）`,
        bearer_token_description: `Customエンドポイントの認証トークン。Authorization: Bearerヘッダーとして送信されます。`,
        bearer_token_placeholder: `認証不要の場合は空欄`,
      },
      remove: {
        description: `保存されたプロバイダー設定を削除します。`,
        no_saved_title: `保存済み設定がありません`,
        no_saved_description: `削除する保存済みプロバイダー設定がありません。先に\`/config provider add\`でプロバイダーを追加してください。`,
        picker_title: `プロバイダー設定を削除`,
        picker_description: `削除するプロバイダーを選択してください。保存されたAPIキーが削除され、依存するモデル選択がリセットされます。`,
        active_provider_note: `**{provider}**は現在のアクティブプロバイダーであるため、使用中は削除できません。先に\`/config model\`で別のプロバイダーに切り替えてください。`,
        custom_endpoint_note: `カスタムエンドポイント（ElevenLabsやローカルサーバーなど）を削除するには、代わりに\`/config custom-endpoint remove\`を使用してください。`,
        select_placeholder: `削除するプロバイダーを選択...`,
        success_title: `保存済み設定を削除しました`,
        success_description: `**{provider}**の保存済み設定を削除しました。再度使用するには\`/config provider add\`で登録してください。`,
        auto_reassigned_description: `**{provider}** の保存済み設定を削除しました。\n\n依存していた選択も更新しました:\n{reassignments}`,
        confirm_title: `保存済み設定を削除しますか？`,
        confirm_description: `**{provider}**の保存済み設定を削除してもよろしいですか？保存されたAPIキーとモデル選択が削除されます。`,
      },
      "api-key": {
        description: `AIプロバイダーのAPIキーを管理`,
        set: {
          description: `選択したAIプロバイダーのAPIキーを設定します。`,
          modal_title: `APIキーの設定`,
          provider_label: `AIプロバイダー`,
          provider_description: `APIキーに対応するAIプロバイダーを選択してください`,
          provider_placeholder: `プロバイダーを選択...`,
          api_key_label: `APIキーまたはエンドポイントURL`,
          api_key_description: `このキーは安全に保存されます。取得方法については、'/help api-key'コマンドを使用してください。`,
          api_key_description_with_custom: `APIキー、またはCustomの場合はOpenAIエンドポイントURL（例：http://localhost:11434/v1）`,
          api_key_placeholder: `このキーは誰とも共有しないでください`,
          bearer_token_label: `Bearerトークン（任意）`,
          bearer_token_description: `Customエンドポイントの認証トークン。Authorization: Bearerヘッダーとして送信されます。`,
          bearer_token_placeholder: `認証不要の場合は空欄`,
          no_providers_title: `利用可能なプロバイダーがありません`,
          no_providers_description: `データベースに利用可能なAIプロバイダーがありません。\`/support discord\` で報告してください。`,
          invalid_key_title: `無効なAPIキー形式`,
          invalid_key_description: `提供されたAPIキーは短すぎるか無効のようです。有効なキーを提供してください。`,
          unsupported_provider_title: `サポートされていないプロバイダー`,
          unsupported_provider_description: `プロバイダー「{provider}」は現在APIキーの検証をサポートしていません。`,
          validation_error_title: `検証エラー`,
          validation_error_description: `APIキーの検証中にエラーが発生しました。もう一度お試しください。`,
          key_validation_failed_title: `APIキーの検証に失敗しました`,
          key_validation_failed_description: `{provider}に対して提供されたAPIキーは無効です。キーを確認してもう一度お試しください。`,
          no_default_model_title: `デフォルトモデルが見つかりません`,
          no_default_model_description: `{provider}プロバイダーのデフォルトモデルが見つかりませんでした。この問題を\`/support discord\`で報告してください。`,
          success_title: `APIキーが設定されました`,
          success_description: `{provider}のAPIキーが正常に検証、暗号化、保存されました。`,
          success_with_model_description: `{provider}のAPIキーが正常に検証、暗号化、保存されました。モデルは自動的に\`{model_name}\`（このプロバイダーのデフォルト）に変更されました。`,
          custom_success_with_model_description: `カスタムのOpenAI互換エンドポイントが正常に保存されました。このエンドポイントへのリクエストでは \`{model_name}\` を使用します。`,
          novelai_success_with_model_description: `NovelAIのAPIキーが正常に検証、暗号化、保存されました。モデルは自動的に\`{model_name}\`に変更されました。⚠️ **絵文字とスタンプの使用は自動的に無効化されました**。NovelAIのコンテキストを安定させるためです。\`/config tools manage\`でいつでも再有効化できます。`,
          zai_success_description: `{provider}のAPIキーが正常に検証、暗号化、保存されました。⚠️ **注意：** Z.aiの利用規約がコーディング/エージェントのシナリオのみに制限されました — 一般チャットでの使用は自己責任です。`,
          zai_success_with_model_description: `{provider}のAPIキーが正常に検証、暗号化、保存されました。モデルは自動的に\`{model_name}\`に変更されました。⚠️ **注意：** Z.aiの利用規約がコーディング/エージェントのシナリオのみに制限されました — 一般チャットでの使用は自己責任です。`,
        },
        delete: {
          description: `現在設定されているAIプロバイダーのAPIキーを削除します。`,
          no_key_title: `APIキーが設定されていません`,
          no_key_description: `現在削除するAPIキーが設定されていません。`,
          success_title: `APIキーが削除されました`,
          success_description: `AIプロバイダーのAPIキーが正常に削除されました。新しいキーが設定されるまで、私のチャット機能は無効になります。`,
        },
        rotation: {
          description: `負荷分散とフェイルオーバー用のAPIキーローテーションを管理します。`,
          action_description: `アクションを選択：キーを追加するか、すべてのキーを削除`,
          action_add: `キーを追加`,
          action_purge: `すべてのキーを削除`,
          key_description: `ローテーションプールに追加するAPIキー（追加アクションに必要）`,
          no_main_key_title: `メインAPIキーがありません`,
          no_main_key_description: `ローテーションキーを追加する前に、\`/config provider add\`で有効なプロバイダー認証情報を登録する必要があります。`,
          custom_provider_title: `サポートされていません`,
          custom_provider_description: `カスタムプロバイダーではAPIキーローテーションはサポートされていません。`,
          key_required_title: `キーが必要です`,
          key_required_description: `「追加」アクションを使用する場合は、APIキーを入力してください。`,
          add_success_title: `ローテーションキーが追加されました`,
          add_success_description: `新しいAPIキーがローテーションプールに正常に追加されました。現在、{provider}に**{count}**個のローテーションキーがあります。キーはラウンドロビン順序で自動フェイルオーバーとともに使用されます。`,
          purge_success_title: `ローテーションキーが削除されました`,
          purge_success_description: `ローテーションプールから**{count}**個のキーが正常に削除されました。メインAPIキーのみが使用されます。`,
          no_keys_title: `ローテーションキーがありません`,
          no_keys_description: `削除するローテーションキーがありません。メインAPIキーのみが設定されています。`,
        },
      },
      "custom-endpoint": {
        description: `ラベル付きカスタムエンドポイントを管理します。`,
        add: {
          description: `ラベル付きカスタムエンドポイントに1機能を登録します。`,
        },
        edit: {
          description: `登録済みカスタムエンドポイントの項目を置き換えます。`,
        },
        remove: {
          description: `ラベル付きカスタムエンドポイントから選んだ機能を削除します。`,
        },
      },
    },
  },
  events: {
    addBot: {
      rejoin_title: `TomoriBotが戻ってきました！`,
      rejoin_description: `このサーバーに再追加されたようです。以前の設定と人格はそのままです！\`/config\`、\`/persona\`、\`/memory\`、\`/server\`コマンドで私を管理できます。\`/memory personal export\`、\`/memory server export\`、\`/personal config\`、\`/server config\`でいつでもデータのエクスポートやリセットができます。

			プロバイダーを変更したい場合は、\`/config provider add\`で新しいプロバイダーを登録し、\`/config model text\`でアクティブにしてください。

			**TomoriBotを使用することで、[利用規約](https://github.com/Bredrumb/TomoriBot/blob/main/legal/ja/terms-of-service.md)と[プライバシーポリシー](https://github.com/Bredrumb/TomoriBot/blob/main/legal/ja/privacy-policy.md)に同意したことになります。**\`/legal terms\`と\`/legal privacy\`でいつでも確認できます。`,
      setup_prompt_title: `TomoriBotの追加が完了しました`,
      setup_prompt_description: `追加してくれてありがとうございます！始めるには、**サーバー管理**権限を持つ方が\`/config setup\`コマンドを実行して、私の初期の人格を選択し、AI機能を設定する必要があります。\`/memory personal export\`、\`/memory server export\`、\`/personal config\`、\`/server config\`でいつでもデータのエクスポートやリセットができます。

			選択したAIプロバイダーのAPIキーの作成方法が不明な場合は、\`/help api-key\`コマンドを使用してください。APIキーは暗号化されて保存されますが、公開されているDiscordボットに提供することに不安がある場合（通常そうあるべきです）、[リポジトリのガイド](https://github.com/Bredrumb/TomoriBot)を使用してご自身でTomoriBotを実行することもできます。

			**TomoriBotを使用することで、[利用規約](https://github.com/Bredrumb/TomoriBot/blob/main/legal/ja/terms-of-service.md)と[プライバシーポリシー](https://github.com/Bredrumb/TomoriBot/blob/main/legal/ja/privacy-policy.md)に同意したことになります。**\`/legal terms\`と\`/legal privacy\`でいつでも確認できます。`,
    },
  },
  reminders: {
    reminder_set_title: `⏰ {persona_nickname}がリマインダーを設定しました`,
    reminder_set_description: `{user_nickname}さんに「**{reminder_purpose}**」について\`{reminder_time}\`にリマインドします`,
    reminder_set_footer: `{time_remaining}後にメンションを送信します。リマインダーは\`/scheduled-task remove\`で削除できます。`,
    reminder_set_footer_recurring: `最初のメンションは{time_remaining}後です。{repetition_interval_hours}時間ごとに繰り返します。リマインダーは\`/scheduled-task remove\`で削除できます。`,
    recurring_task_set_title: `🔁 {persona_nickname}が定期タスクを設定しました`,
    recurring_task_set_description: `「**{reminder_purpose}**」を\`{reminder_time}\`から実行し、{repetition_interval_hours}時間ごとに繰り返します。`,
    recurring_task_set_footer: `リマインダーは\`/scheduled-task remove\`で削除できます。`,
    task_set_title: `✅ {persona_nickname}がタスクを設定しました`,
    task_set_description: `「**{reminder_purpose}**」を\`{reminder_time}\`に実行します`,
    task_set_footer: `{time_remaining}後にタスクを実行します。リマインダーは\`/scheduled-task remove\`で削除できます。`,
    reminder_triggered_title: `🔵 リマインダー通知`,
    task_triggered_title: `🔵 タスク通知`,
    triggered_description: `{reminder_purpose}`,
    triggered_footer: `生成中にエラーが発生したため、代わりに生のリマインダーを送信しました`,
  },
  tools: {
    generate_image: {
      quota_exceeded_generic: `画像生成クォータを超過しました。`,
      user_quota_exceeded: `日次画像生成クォータに達しました。{reset_info}`,
      serverwide_quota_exceeded: `このサーバーはこの期間の画像生成クォータに達しました。{reset_info}`,
      quota_resets_in_hours: `クォータは {hours} 時間後にリセットされます。`,
      quota_resets_in_days: `クォータは {days} 日後にリセットされます。`,
      quota_remaining: `本日はあと {remaining} 枚の画像を生成できます。`,
    },
    generate_video: {
      disabled: `このサーバーでは動画生成が無効になっています。`,
      quota_exceeded_generic: `動画生成クォータを超過しました。`,
      user_quota_exceeded: `日次動画生成クォータに達しました。{reset_info}`,
      serverwide_quota_exceeded: `このサーバーはこの期間の動画生成クォータに達しました。{reset_info}`,
      quota_resets_in_hours: `クォータは {hours} 時間後にリセットされます。`,
      quota_resets_in_days: `クォータは {days} 日後にリセットされます。`,
      quota_remaining: `本日はあと {remaining} 本の動画を生成できます。`,
      file_too_large: `生成された動画（{size_mb} MB）がDiscordの25 MBファイルサイズ制限を超えています。`,
    },
    generate_image_nai: {
      no_google_api_key: `インペインティングには画像セグメンテーション用のGoogleプロバイダー認証情報が必要です。\`/config provider add\` で追加するか、Googleプロバイダーに切り替えてください。`,
      model_not_configured: `現在、NovelAI画像生成は無効です。まず \`/config model image\` でNovelAI画像モデルを選択してください。`,
      provider_quota_exceeded: `このアカウントではNovelAI画像生成クォータを使い切っています。Anlasを補充するか、クォータのリフレッシュ後に再試行してください。`,
      characters_require_v4: `キャラクター配置にはNovelAI V4以降の拡散モデルが必要です。`,
      character_requires_id_or_tags: `キャラクター項目 #{index} には id か tags のどちらかが必要です。`,
      invalid_character_identity: `無効なキャラクターIDです: {id}。persona:<id>、短い数値のペルソナID、またはDiscordのユーザースノーフレークを使用してください。`,
    },
  },
  matrix: {
    notices: {
      invited: `TomoriBotがこのルームに参加しました。

セットアップを完了するには:
1. Discordで、ブリッジしたいチャンネルで {link_command} を実行します。
2. {room_id_path} にあるこのルームの Internal Room ID を貼り付けます。

重要:
- このルームは非暗号化のままにしてください。
- リンク後は、このルームで普通に話しかければ使えます。
- Matrix側で使えるテキストコマンドは {kill_command} と {refresh_command} のみです。

詳しい手順と制限一覧は、Discordで {help_command} を確認してください。`,
      linked: `このルームはDiscordチャンネル {channel_name} とブリッジされました。

クイックヒント:
- ここで普通に話しかければTomoriBotと会話できます。
- Matrix側で使えるテキストコマンドは {kill_command} と {refresh_command} のみです。
- Slash Command、DM、ピン留めはMatrixから使えません。
- カスタム絵文字/Markdownは安定して描画されず、Embedはプレーンテキストとして転送されます。
- Matrixユーザーの個人メモリはサーバーメモリにフォールバックします。

詳しい手順と現在の制限は、Discordで {help_command} を確認してください。`,
    },
  },
};
