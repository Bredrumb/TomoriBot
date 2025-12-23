// locales/ja.ts

// ロケール構造全体をデフォルトオブジェクトとしてエクスポートします
export default {
	general: {
		// デフォルト設定値
		defaults: {
			bot_name: `ともり`,
			base_trigger_words: ["トモリ", "ともり"],
		},

		// クールダウンメッセージ
		cooldown_title: `⌛ お待ちください！`,
		cooldown: `再度 \`/{category}\` コマンドを使用するまで {seconds} 秒待つ必要があります。`,

		// 標準的なインタラクションの応答（ボタン、セレクトメニュー）
		interaction: {
			cancel_title: `🔴 コマンドがキャンセルされました`,
			cancel_description: `コマンドはキャンセルされました。`,
			timeout_title: `⏰ コマンドがタイムアウトしました`,
			timeout_description: `時間内に応答しませんでした。もう一度お試しください。`,
		},

		// ページネーションコンポーネントのメッセージ
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
		},

		// 一般的なエラーメッセージ
		errors: {
			guild_only_title: `サーバー専用コマンド`,
			guild_only_description: `このコマンドはサーバー内でのみ使用できます。`,
			guild_only_command_title: `サーバー専用コマンド`,
			guild_only_command_description: `このコマンドはサーバー内でのみ使用でき、ダイレクトメッセージでは使用できません。`,
			channel_only_title: `チャンネルが必要です`,
			channel_only_description: `このコマンドは正常に動作するためにチャンネルが必要です。`,
			channel_not_supported_title: `サポートされていないチャンネルタイプ`,
			channel_not_supported_description: `申し訳ありませんが、サーバーのテキストチャンネルまたはダイレクトメッセージでのみ動作します。グループDMやその他のチャンネルタイプはサポートされていません。`,
			tomori_not_setup_title: `初期設定が必要です`,
			tomori_not_setup_description: `このサーバーではまだ私の設定が行われていないようです。\`サーバー管理\`権限を持つメンバーが最初に\`/config setup\`を使用する必要があります。`,
			tomori_not_setup_dm_footer: `DMは「ミニサーバー」として扱われ、私はあなたのメッセージに個人的に応答します。ほとんどのサーバー関連コマンドは意図通りに動作します。`,
			api_key_missing_title: `APIキーがありません`,
			api_key_missing_description: `機能するにはAPIキーが必要ですが、このサーバーには設定されていません。\`サーバー管理\`権限を持つメンバーが\`/config apikey set\`を使用して設定できます。`,
			api_key_error_title: `APIキーエラー`,
			api_key_error_description: `設定されたAPIキーへのアクセスまたは復号化で問題が発生しました。\`/config apikey set\`を使用して正しく設定されているか確認してください。`,
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
			brave_api: {
				missing_key: {
					title: `Brave APIキーがありません`,
					description: `検索を実行するにはBrave Search APIキーが必要ですが、このサーバーには設定されていません。\`サーバー管理\`権限を持つメンバーが\`/config braveapi set\`を使用して設定できます。`,
					footer: `/help apikeyで詳細を確認してください`,
				},
			},
			duckduckgo_rate_limit: {
				title: `DuckDuckGoがレート制限されています`,
				description: `DuckDuckGo検索は現在レート制限されています。より信頼性の高い検索のために、\`サーバー管理\`権限を持つメンバーが\`/config braveapi set\`を使用してBrave Searchを設定できます。`,
				footer: `/help apikeyで詳細を確認してください`,
			},
			operation_failed_title: `操作に失敗しました`,
			operation_failed_description: `要求された操作を完了できませんでした。もう一度お試しください。`,
			provider_not_supported_title: `サポートされていないプロバイダー`,
			provider_not_supported_description: `選択されたAIプロバイダーは現在サポートされていません。`,
			user_blacklisted_title: `ユーザーがブラックリスト登録済み`,
			user_blacklisted_description: `あなたは現在このサーバーのパーソナライズ機能のブラックリストに登録されており、この操作を実行できません。`,
		},
		tomori_busy_title: "他の人に返信中です！",
		tomori_busy_replying:
			"現在このメッセージに返信中です: {message_link}。あなたのメッセージはキューに追加されました。",
	},

	rate_limit: {
		// ユーザーレベルのレート制限（DM通知）
		user_exceeded_title: `🟡️ レート制限に達しました`,
		user_exceeded_description: `現在、全サーバーで多数のアクティブなメッセージを処理中です。不正利用を防ぐため、最新のトリガー試行は破棄されました。メッセージの処理が完了するまでお待ちください。`,

		// サーバーレベルのレート制限（パブリックチャンネル通知）
		server_exceeded_title: `🟡️ サーバー過負荷`,
		server_exceeded_description: `このサーバーでは現在多数のアクティブなメッセージを処理中です。現在キャパシティに達しています！しばらく待ってから再度お試しいただくか、他のサーバーやダイレクトメッセージでご利用ください。`,

		error_memory_critical_title: `🔴 システム過負荷`,
		error_memory_critical_description: `現在メモリ使用率が高く、ファイルアップロードができません。しばらく後にお試しください。`,

		error_quota_exceeded_title: `🔴 1日の上限に達しました`,
		error_quota_exceeded_description: `このコマンドの1日の上限に達しました。クォータは**{reset_time}**にリセットされます。\n\nリセット時刻以降に再度お試しください。`,
	},

	genai: {
		// LLM API生成に関するエラー
		generic_error_title: `生成エラー`,
		generic_error_description: `申し訳ありません、応答を生成中にエラーが発生しました ({error_message})。`,
		generic_error_footer:
			"`/tool refresh`を実行してからもう一度お試しください。問題が解決しない場合は、`/support discord`で報告してください。",
		error_stream_timeout_title: "接続タイムアウト",

		// プロバイダーエラー形式テンプレート
		provider_error_format:
			"{providerName} エラーコード {errorCode}: {apiMessage}。{tip}",
		error_stream_timeout_description:
			"この問題が続く場合、選択したAIプロバイダーに一時的な問題がある可能性があります。後でもう一度お試しいただくか、`/tool refresh`を使用してコンテキスト履歴をリフレッシュしてください。",

		// APIからの空の応答
		empty_response_title: `空の応答`,
		empty_response_description: `AIから空の応答を受け取りました。この問題が解決しない場合は、\`/tool refresh\`を使用してください。`,
		// 新規: 関数呼び出しの最大反復回数
		max_iterations_title: "思考ループ",
		max_iterations_streaming_description:
			"思考ループに陥り、リクエストを完了できませんでした。この問題が解決しない場合は、`/tool refresh`を使用してください。",

		// 一般的な応答なし警告（不明なステータスまたは未処理のケース用）
		no_response_title: `応答なし`,
		no_response_description: `応答がありませんでした - これはAIからの空の応答またはタイムアウトが原因である可能性があります。`,

		// 検索関連メッセージ
		search: {
			web_search_title: `🔍 ウェブで \`{query}\` を検索中...`,
			image_search_title: `🔍 \`{query}\` の画像を検索中...`,
			video_search_title: `🔍 \`{query}\` の動画を検索中...`,
			news_search_title: `🔍 ニュースで \`{query}\` を検索中...`,
			disclaimer_description: `AIによる生成応答と検索結果は不正確または不完全な場合があります。**重要な情報は再確認してください**。`,
		},

		// YouTube動画処理メッセージ
		video: {
			youtube_processing_title: "👁️ YouTube動画を視聴中...",
			youtube_processing_description:
				"現在、YouTube動画を視聴しています: {video_url}",
			youtube_processing_footer:
				"動画の長さに応じて、少し時間がかかる場合があります",
		},

		// 新規: ストリーム固有のエラーメッセージ
		stream: {
			response_stopped_title: "応答が中断されました",
			response_stopped_description:
				"次の理由で応答が中断されました: {reason}。送信されたコンテンツがAIプロバイダーにとって大きすぎないか確認してください。`/tool refresh`で会話コンテンツをクリアしてください。",
			prohibited_content_title: "コンテンツポリシー違反",
			prohibited_content_description:
				"禁止コンテンツが検出されたため、応答はブロックされました。",
			prohibited_content_admin_notice_title: "管理者への通知",
			prohibited_content_admin_notice_description:
				"送信されたコンテンツ（メディア、会話メッセージ、記憶）がAIプロバイダーのコンテンツポリシーに準拠していることを確認してください。`/tool refresh`で会話コンテンツをクリアしてください。",
			streaming_failed_description:
				"応答をストリーミング中に問題が発生しました。",

			// エラーインタラクションメッセージ
			provider_error_interaction:
				"ストリーム応答がブロック/停止されました。理由: {reason}。",
			retry_message: "これは一時的なエラーです。後でもう一度お試しください。",

			// 汎用プロバイダーエラータイトルとヒント（genai.googleから移動）
			api_error_title: "🔴 APIエラー",
			api_error_tip:
				"APIキーを確認して再度お試しください。このエラーが解決しない場合は、`/support discord`で報告してください。",

			rate_limit_title: "🟡 レート制限を超過",
			rate_limit_tip: "数分お待ちいただいてから再度お試しください",

			content_blocked_title: "🔴️ コンテンツがブロックされました",
			content_blocked_tip:
				"コンテンツポリシーに準拠するようメッセージを言い換えてください",

			timeout_title: "🟡️ リクエストタイムアウト",
			timeout_tip: "メッセージを短くするか再度お試しください",

			provider_overloaded_title: "🔴 プロバイダーの過負荷",
			provider_overloaded_tip:
				"プロバイダーが現在過負荷状態です。しばらく後に再度お試しいただくか、別のプロバイダーに変更してください",

			unknown_title: "🔴 プロバイダーエラー",
			unknown_tip:
				"再度お試しいただくか、この問題が続く場合は `/support discord` をご利用ください",

			flush_limit_title: "🟡️ 応答の長さ制限に達しました",
			flush_limit_description:
				"この応答はメッセージの最大長制限に達したため停止されました。必要に応じて `/bot respond` を使用して手動で応答を続けることができます。",
		},

		// Google固有のエラーメッセージ（プロバイダー固有のデフォルトメッセージのみ）
		google: {
			// 400 INVALID_ARGUMENT
			"400_default_message": "リクエスト形式にエラーがありました",

			// 400 FAILED_PRECONDITION (billing)
			"400_billing_default_message": "このサービスには課金が必要です",

			// 403 PERMISSION_DENIED
			"403_default_message": "APIキーに必要な権限がありません",

			// 404 NOT_FOUND
			"404_default_message": "参照されたリソースが見つかりませんでした",

			// 429 RESOURCE_EXHAUSTED
			"429_default_message": "短時間に多くのリクエストを送信しすぎました",

			// 500 INTERNAL
			"500_default_message": "Googleのサーバーで予期しないエラーが発生しました",

			// 503 UNAVAILABLE
			"503_default_message": "AIモデルが現在過負荷状態です",

			// 504 DEADLINE_EXCEEDED
			"504_default_message": "リクエストの処理時間が長すぎました",

			// Content blocked errors
			content_blocked_default_message:
				"あなたのコンテンツは安全フィルターによってブロックされました",

			// Generic fallback for unknown Google errors
			unknown_default_message: "予期しないエラーが発生しました",
		},

		// NovelAI固有のエラーメッセージ（プロバイダー固有のデフォルトメッセージのみ）
		novelai: {
			// 401 UNAUTHORIZED
			"401_default_message": "NovelAIのAPIキーが無効または期限切れです",

			// 402 PAYMENT_REQUIRED
			"402_default_message": "Anlasクレジットが不足しています",

			// 429 TOO_MANY_REQUESTS
			"429_default_message":
				"リクエストを送信しすぎています。ペースを落としてください",

			// 503 SERVICE_UNAVAILABLE
			"503_default_message": "NovelAIサーバーが現在過負荷状態です",

			// 504 GATEWAY_TIMEOUT
			"504_default_message": "リクエストの処理時間が長すぎました",

			// Generic fallback for unknown NovelAI errors
			unknown_default_message: "予期しないエラーが発生しました",
		},

		// OpenRouter固有のエラーメッセージ（プロバイダー固有のデフォルトメッセージのみ）
		openrouter: {
			// 400 BAD_REQUEST
			"400_default_message":
				"不正なリクエスト：無効または欠落したパラメータ、またはCORSの問題",

			// 401 UNAUTHORIZED
			"401_default_message":
				"無効な認証情報：OAuthセッションの期限切れ、または無効/無効化されたAPIキー",

			// 402 PAYMENT_REQUIRED
			"402_default_message":
				"アカウントまたはAPIキーのクレジットが不足しています。クレジットを追加して再試行してください。",

			// 403 FORBIDDEN
			"403_default_message":
				"選択したモデルはモデレーションが必要で、入力がフラグされました",

			// 404 NOT_FOUND
			"404_default_message":
				"要求された機能（ツール/画像）をサポートするエンドポイントが見つかりません。別のモデルをお試しください。",

			// 408 REQUEST_TIMEOUT
			"408_default_message": "リクエストがタイムアウトしました",

			// 413 PAYLOAD_TOO_LARGE
			"413_default_message":
				"リクエストボディが大きすぎます（コンテキスト/メディアがプロバイダーの制限を超えています）。`/tool refresh`で会話履歴をクリアするか、コンテキスト内のメディア/記憶の量を減らしてください。",

			// 429 TOO_MANY_REQUESTS
			"429_default_message":
				"レート制限中です。しばらくしてから再試行するか、無料ではないモデルを使用してください。",

			// 502 BAD_GATEWAY
			"502_default_message":
				"選択したモデルがダウンしているか、無効な応答を受信しました",

			// 503 SERVICE_UNAVAILABLE
			"503_default_message":
				"ルーティング要件を満たす利用可能なモデルプロバイダーがありません",

			// Generic fallback for unknown OpenRouter errors
			unknown_default_message: "予期しないエラーが発生しました",
		},

		self_teach: {
			server_memory_learned_title: "🧠 新しいことを学びました！ (サーバー全体)",
			server_memory_learned_description:
				'このサーバーについて、次のことを学びました: "{memory_content}"',
			personal_memory_learned_title:
				"💡 新しいことを学びました！ (ユーザー固有)",
			personal_memory_learned_description:
				'{user_nickname}さんについて、次のことを学びました: "{memory_content}"',
			server_memory_footer:
				"サーバー管理者は`/teach`と`/forget`コマンドでこの記憶を管理できます。",
			personal_memory_footer_manage:
				"あなたの個人的な記憶は`/teach`と`/forget`コマンドで管理できます。個人記憶の保存は`/personal privacy`でオプトアウトできます。",
			personal_memory_footer_personalization_disabled:
				"この記憶は保存されましたが、現在このサーバーではパーソナライズ機能が無効になっているため、すぐには効果がありません。個人記憶の保存は`/personal privacy`でオプトアウトできます。",
			personal_memory_footer_user_blacklisted:
				"この記憶は保存されましたが、対象のユーザーは現在このサーバーのパーソナライズ機能のブラックリストに登録されているため、すぐには効果がありません。個人記憶の保存は`/personal privacy`でオプトアウトできます。",
		},
	},

	commands: {
		// 一般的なオプションに使用される再利用可能な選択肢のローカライゼーション
		choices: {
			add: "追加",
			remove: "削除",
			enable: "有効にする",
			disable: "無効にする",
			enabled: "有効",
			disabled: "無効",
			on: "オン",
			off: "オフ",
			yes: "はい",
			no: "いいえ",
			true: "真",
			false: "偽",
			opt_out: "記憶の保存をブロック",
			opt_in: "記憶の保存を許可",
			none: "なし",
		},

		// 一般的なユーティリティコマンド
		tool: {
			ping: {
				description: `ボットの遅延を確認します`,
				title: `Pong! 🏓`,
				response_fast: `応答時間: \`{response_time}ms\``,
				response_slow: `応答時間: \`{response_time}ms\``,
			},
			refresh: {
				description: `最近の会話履歴をクリアします。`,
				title: `🧹 会話履歴がクリアされました`,
				response: `コンテキストがリフレッシュされました。これより上のすべてのメッセージは無視されます。`,
			},
			status: {
				description: `現在の個人またはサーバーのステータスを表示します。`,
				type_description: `どのステータスタイプを表示しますか？`,
				type_choice_personal: `個人`,
				type_choice_server: `サーバー`,
				personal_title: `個人ステータス`,
				personal_description: `あなたの個人設定と記憶`,
				server_title: `サーバーステータス`,
				server_description: `サーバー設定、人格、記憶`,
				field_model: `AIモデル`,
				field_temperature: `Temperature`,
				field_humanizer: `ヒューマナイザーレベル`,
				field_timezone: `サーバータイムゾーン`,
				field_autoch_threshold: `自動チャット閾値`,
				field_autoch_channels: `自動チャットチャンネル`,
				field_trigger_words: `トリガーワード`,
				field_personalization: `パーソナライズ`,
				field_blacklisted_members: `ブラックリスト登録済みメンバー`,
				field_self_teach: `自己学習`,
				field_api_key_set: `APIキー設定済み`,
				field_brave_api_key_set: `Brave APIキー設定済み`,
				field_emoji_usage: `絵文字使用`,
				field_sticker_usage: `スタンプ使用`,
				field_web_search: `ウェブ検索`,
				field_image_generation: `画像生成`,
				field_server_memteaching: `サーバー記憶の学習`,
				field_attribute_memteaching: `属性の学習`,
				field_sampledialogue_memteaching: `サンプル対話の学習`,
				field_nickname: `ニックネーム`,
				field_dialogue_count: `サンプル対話`,
				field_attributes: `属性`,
				field_user_nickname: `ユーザーニックネーム`,
				field_language_pref: `言語設定`,
				field_privacy: `プライバシーモード`,
				field_reminders_count: `アクティブなリマインダー`,
				field_personal_memories: `個人の記憶`,
				field_server_memories: `サーバーの記憶`,
				item_count: `{count} 件`,
				none: `なし`,
				disabled: `無効`,
				unknown_channel: `不明なチャンネルID:`,
				not_available: `N/A`,
				see_all_memories_prompt: `すべての記憶を表示するには \`/data export\` コマンドを使用してください`,
				memories_omitted: `...他 {count} 件の記憶が省略されました`,
				export_footer: `完全な記憶を表示するには \`/data export\` コマンドを使用してください`,
				export_footer_full: `すべての詳細を表示するには \`/data export\` コマンドを使用してください`,
				field_personal_memories_with_count: `個人の記憶 ({current}/{max} 枠使用中)`,
				field_trigger_words_with_count: `トリガーワード ({current}/{max} 枠使用中)`,
				field_attributes_with_count: `属性 ({current}/{max} 枠使用中)`,
				field_slot_usage: `{current}/{max} 枠使用中`,
				field_server_memories_with_count: `サーバーの記憶 ({current}/{max} 枠使用中)`,
				field_dialogue_count_with_count: `{current}/{max} 枠使用中`,
				field_blacklisted_members_with_count: `{current} 人`,
			},
		},

		// データ管理コマンド
		data: {
			description: `データのエクスポートとインポートを管理する`,
			export: {
				description: `個人データまたはサーバーデータをJSONファイルにエクスポートする`,
				type_description: `どのタイプのデータをエクスポートしますか？`,
				type_choice_personal: `個人データ`,
				type_choice_server: `サーバーデータ`,
				type_choice_personality: `性格情報`,
				success_title: `🟢 エクスポート成功`,
				success_description: `{type}データがDMに送信されました！`,
				success_description_personality: `私の性格がエクスポートされ、DMに送信されました！\n\n**注意:** このエクスポートは情報提供のみを目的としています。性格をインポートするには、代わりに\`/persona\`コマンドを使用してください。`,
				failed_title: `🔴 エクスポート失敗`,
				failed_description: `データのエクスポートに失敗しました。後でもう一度お試しください。`,
				dm_title: `データエクスポート`,
				dm_description: `リクエストされた{type}データをお送りします！`,
				dm_description_server: `リクエストされたサーバーデータをお送りします！\n\n**注意:** セキュリティのため、トリガーワードとAPIキーは除外されています。インポート後に手動で再設定する必要があります。`,
				dm_description_personality: `リクエストされた性格情報をお送りします！\n\n**注意:** このテキストファイルは情報提供のみを目的としています。サーバーに性格をインポートするには、代わりに\`/persona\`コマンドを使用してください。`,
				dm_failed_title: `🔴 DMを送信できませんでした`,
				dm_failed_description: `DMを送信できませんでした。サーバーメンバーからのDMを有効にしてから、もう一度お試しください。`,
				no_permission_title: `🔴 権限がありません`,
				no_permission_description: `サーバーデータをエクスポートするには**サーバー管理**権限が必要です。`,
				// dataExportユーティリティからのエラーメッセージ
				error_no_user_data: `ユーザーデータが見つかりません。まずボットとやり取りする必要があるかもしれません。`,
				error_no_server_data: `サーバーがデータベースに見つかりません。まず /config setup を実行してください。`,
				error_no_server_config: `サーバー設定が見つかりません。まず /config setup を実行してください。`,
				error_no_personality_data: `このサーバーの性格データが見つかりません。まず /config setup を実行してください。`,
				error_validation_failed: `エクスポートデータ構造の検証に失敗しました`,
				error_export_failed: `データのエクスポートに失敗しました`,
			},
			import: {
				description: `バックアップJSONファイルからデータをインポートする`,
				file_description: `データをインポートするJSONファイル`,
				confirmation_description: `警告：データが置き換えられます。サーバーインポート時の除外：トリガー、APIキー、性格。続行？`,
				confirmation_description_server: `警告：サーバー設定と記憶が置き換えられます。復元されないもの：トリガーワード、APIキー、性格、アバター。`,
				confirmation_choice_yes: `はい、理解した上で続行します`,
				confirmation_choice_no: `いいえ、インポートをキャンセルします`,
				success_title: `🟢 インポート成功`,
				success_description: `{type}データを正常にインポートしました！\nインポートされたメモリ: {memories_count}\n 更新された設定フィールド: {config_count}`,
				success_description_server: `サーバーデータを正常にインポートしました！\n記憶: {memories_count}\n 設定: {config_count}\n\n**注意:** トリガーワードとAPIキーはインポートされませんでした。必要に応じて別途設定してください。`,
				failed_title: `🔴 インポート失敗`,
				failed_description: `データのインポートに失敗しました。ファイルを確認してもう一度お試しください。`,
				cancelled_title: `🔴 インポートがキャンセルされました`,
				cancelled_description: `インポートがキャンセルされました。データは変更されていません。`,
				invalid_file_type_title: `🔴 無効なファイルタイプ`,
				invalid_file_type_description: `有効な.jsonファイルをアップロードしてください。`,
				file_too_large_title: `🔴 ファイルが大きすぎます`,
				file_too_large_description: `ファイルが大きすぎます。最大ファイルサイズは1MBです。`,
				parse_failed_title: `🔴 無効なJSON`,
				parse_failed_description: `ファイルが有効なJSONファイルではありません。ファイル形式を確認してください。`,
				invalid_file_title: `🔴 無効なインポートファイル`,
				invalid_file_description: `インポートファイルの形式が無効または互換性がありません。`,
				no_permission_title: `🔴 権限がありません`,
				no_permission_description: `サーバーデータをインポートするには**サーバー管理**権限が必要です。`,
				error_download_timeout: `ファイルのダウンロードがタイムアウトしました。もう一度お試しください。`,
				error_download_failed: `インポートファイルのダウンロードに失敗しました。`,
				// dataImportユーティリティからのエラーメッセージ
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
				error_unknown_type: `不明なインポートタイプ: {type}。"personal"または"server"である必要があります`,
			},
			delete: {
				description: `個人データまたはサーバーデータを完全に削除する`,
				type_description: `どのタイプのデータを削除しますか？`,
				type_choice_personal: `個人データ`,
				type_choice_server: `サーバーデータ`,
				confirmation_description: `完全削除を確認（これは元に戻せません！）`,
				confirmation_yes: `はい、完全に削除します - 元に戻せないことを理解しています`,
				confirmation_no: `いいえ、削除をキャンセルします`,
				confirmation_required_title: `確認が必要です`,
				confirmation_required_description: `削除を確認するには確認オプションを選択する必要があります。`,
				success_personal_title: `🟢 個人データが削除されました`,
				success_personal_description: `すべての個人データが完全に削除されました。再び私とやり取りすると、デフォルト設定で新規開始します。`,
				success_server_title: `🟢 サーバーデータが削除されました`,
				success_server_description: `すべてのサーバーデータが完全に削除されました。再び私を使用するには \`/config setup\` を実行する必要があります。`,
				no_data_title: `🟡️ データが見つかりません`,
				no_data_description: `データベースに個人データが保存されていません。`,
				no_server_data_title: `🟡️ サーバーデータが見つかりません`,
				no_server_data_description: `このサーバーにはデータが保存されていません。まず \`/config setup\` を実行してください。`,
				no_permission_title: `🔴 権限がありません`,
				no_permission_description: `サーバーデータを削除するには**サーバー管理**権限が必要です。`,
			},
		},

		// ペルソナコマンド
		persona: {
			description: `人格プリセットを管理する`,
			export: {
				description: `の人格を共有可能なPNGファイルとしてエクスポートする`,
				success_title: `🟢 ペルソナのエクスポートに成功しました`,
				success_description: `ペルソナ **{nickname}** がエクスポートされました！このPNGファイルを他の人と共有して、人格設定を広めましょう。`,
				failed_title: `🔴 エクスポートに失敗しました`,
				failed_description: `ペルソナのエクスポートに失敗しました。後でもう一度お試しください。`,
				avatar_failed_title: `🔴 アバターのダウンロードに失敗しました`,
				avatar_failed_description: `サーバーアバターのダウンロードに失敗しました。後でもう一度お試しください。`,
				embed_failed_title: `🔴 PNG処理に失敗しました`,
				embed_failed_description: `PNGファイルへのメタデータの埋め込みに失敗しました。もう一度お試しください。`,
				// Error messages from presetExport utility
				error_no_server_data: `データベースにサーバーが見つかりません。まず \`/config setup\` を実行してください。`,
				error_no_preset_data: `ペルソナデータが見つかりません。まず /config setup を実行してください。`,
				error_validation_failed: `エクスポートデータ構造の検証に失敗しました`,
				error_export_failed: `ペルソナデータのエクスポートに失敗しました`,
			},
			import: {
				description: `PNGファイルから人格をインポートする`,
				file_description: `ペルソナデータを含むPNGファイル`,
				confirmation_description: `警告：現在の人格設定が置き換えられます。続行しますか？`,
				confirmation_choice_yes: `はい、現在のペルソナを置き換えます`,
				confirmation_choice_no: `いいえ、インポートをキャンセルします`,
				success_title: `🟢 ペルソナのインポートに成功しました`,
				success_description: `ペルソナ **{nickname}** が正常にインポートされました！\n属性: {attribute_count}\nサンプル対話: {dialogue_count}\nトリガーワード: {trigger_word_count}\n\n権限が許可されている場合、サーバーアバターとニックネームも更新されました。`,
				failed_title: `🔴 インポートに失敗しました`,
				failed_description: `ペルソナのインポートに失敗しました。ファイルを確認してもう一度お試しください。`,
				cancelled_title: `🔴 インポートがキャンセルされました`,
				cancelled_description: `インポートがキャンセルされました。私のペルソナに変更はありませんでした。`,
				invalid_file_type_title: `🔴 無効なファイル形式`,
				invalid_file_type_description: `ペルソナデータを含む有効な.pngファイルをアップロードしてください。`,
				file_too_large_title: `🔴 ファイルが大きすぎます`,
				file_too_large_description: `ファイルが大きすぎます。最大ファイルサイズは10MBです。`,
				download_failed_title: `🔴 ダウンロードに失敗しました`,
				download_failed_description: `添付ファイルのダウンロードに失敗しました。もう一度お試しください。`,
				invalid_png_title: `🔴 無効なPNGファイル`,
				invalid_png_description: `アップロードされたファイルは有効なPNG画像ではありません。`,
				no_metadata_title: `🔴 ペルソナデータが見つかりません`,
				no_metadata_description: `このPNGファイルにはペルソナデータが含まれていません。\`/persona export\`でエクスポートされたファイルを使用してください。`,
				invalid_file_title: `🔴 無効なペルソナファイル`,
				invalid_file_description: `ペルソナファイル形式が無効または互換性がありません。`,
				no_permission_title: `🔴 権限がありません`,
				no_permission_description: `ペルソナをインポートするには**サーバー管理**権限が必要です。`,
				error_download_timeout: `ファイルのダウンロードがタイムアウトしました。もう一度お試しください。`,
				error_download_failed: `ペルソナファイルのダウンロードに失敗しました。`,
				// Error messages from presetImport utility
				error_invalid_attribute: `無効な属性内容: {details}`,
				error_invalid_dialogue_in: `無効なサンプル対話(入力): {details}`,
				error_invalid_dialogue_out: `無効なサンプル対話(出力): {details}`,
				error_invalid_trigger_word: `無効なトリガーワード: {details}`,
				error_dialogue_mismatch: `サンプル対話配列の長さが一致しません`,
				error_invalid_config: `ペルソナデータに無効な設定フィールドがあります`,
				error_no_server_data: `データベースにサーバーが見つかりません。まず \`/config setup\` を実行してください。`,
				error_import_failed: `ペルソナデータのインポートに失敗しました`,
				error_not_json: `ペルソナファイルには有効なJSONデータが含まれている必要があります`,
				error_incompatible_version: `互換性のないペルソナバージョン。期待: {expected}、実際: {actual}`,
				error_invalid_format: `無効なペルソナファイル形式`,
				error_invalid_type: `無効なペルソナタイプ: {type}。"preset"が期待されます`,
				avatar_update_skipped_dm: `ペルソナが正常にインポートされましたが、アバターとニックネームの更新はダイレクトメッセージでは利用できません。`,
			},
			default: {
				description: `人格設定のペルソナを適用します`,
				modal_title: `人格プリセットの適用`,
				select_label: `人格プリセット`,
				select_description: `適用するプリセットを選択してください。これにより、現在の属性と対話が上書きされます。`,
				select_placeholder: `プリセットを選択...`,
				no_presets_title: `利用可能なプリセットがありません`,
				no_presets_description: `あなたの言語で利用可能な人格プリセットがありません。\`/support discord\`で報告してください。`,
				preset_not_found: `選択されたプリセットが見つかりませんでした。`,
				success_title: `プリセットが適用されました`,
				success_description: `'{preset_name}'ペルソナが正常に適用されました。`,
				avatar_update_failed: `🟡️ Discord APIエラーによりサーバーアバターを更新できませんでしたが、ペルソナは正常に適用されました。`,
				avatar_update_skipped_dm: `プリセットは正常に適用されましたが、アバター更新はダイレクトメッセージでは利用できません`,
			},
			generate: {
				description: `Google GeminiまたはOpenRouterを使用した人格生成`,
				// Modal fields
				modal: {
					title: `AI人格生成`,
					character_name_label: `キャラクター名`,
					character_name_placeholder: `キャラクターの名前`,
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
					file_upload_label: `キャラクター画像 (任意)`,
					file_upload_description: `エクスポート用およびキャラクター生成の補助のために画像をアップロード`,
				},
				// Field labels for memory critical error preservation
				field_character_name: `キャラクター名`,
				field_character_info: `キャラクター情報と話し方の例`,
				field_web_search: `ウェブ検索を使用しますか？`,
				field_additional_inst: `追加の指示`,
				// Error messages
				wrong_provider_title: `🔴 互換性のないプロバイダー`,
				wrong_provider_description: `ペルソナ生成にはGoogle GeminiまたはOpenRouterが必要です。現在のプロバイダーは **{current_provider}** です。\`/config apikey set\`を使用してプロバイダーを切り替えてください。`,
				no_api_key_title: `🔴 APIキーがありません`,
				no_api_key_description: `APIキーが設定されていません。\`/config apikey set\`を使用してプロバイダーのAPIキーを設定してください。`,
				model_incompatible_title: `互換性のないモデル`,
				model_incompatible_description: `現在のモデル（{model_name}）は{missing_capability}をサポートしていません。\`/config model text\`を使用して、画像ビジョンと構造化出力の両方をサポートするモデルに切り替えてください。`,
				web_search_tools_required_title: `🔴 ウェブ検索を利用できません`,
				web_search_tools_required_description: `ウェブ検索が選択されましたが、現在のモデル（{model_name}）はツールに対応していません。ツール対応モデルに切り替えるか、ウェブ検索で「いいえ」を選択してください。`,
				api_key_decrypt_failed_title: `🔴 APIキーエラー`,
				api_key_decrypt_failed_description: `APIキーの復号化に失敗しました。\`/config apikey set\`を使用して再設定してください。`,
				invalid_image_title: `🔴 無効な画像`,
				invalid_image_description: `有効な画像ファイル(PNG、JPG、JPEGなど)をアップロードしてください。`,
				image_download_failed_title: `🔴 画像のダウンロードに失敗しました`,
				image_download_failed_description: `添付画像のダウンロードに失敗しました。もう一度お試しください。`,
				error_file_too_large: `アバター画像は8MB以下である必要があります。`,
				error_download_timeout: `アバターのダウンロードがタイムアウトしました。もう一度お試しください。`,
				error_download_failed: `アバター画像のダウンロードに失敗しました。`,
				// Processing
				processing_title: `人格を生成しています...`,
				processing_description: `これには1～2分かかる場合があります。キャラクターを生成していますので、お待ちください...\n\nこれは予期しない結果が生成される場合があります。必要に応じて再生成できます。`,
				// Generation errors
				generation_failed_title: `🔴 生成に失敗しました`,
				generation_failed_description: `人格の生成に失敗しました：{error}\n\n異なる入力で再度お試しいただくか、APIキーを確認してください。`,
				validation_failed_title: `🔴 検証に失敗しました`,
				validation_failed_description: `生成された人格データの検証に失敗しました。もう一度お試しください。`,
				image_processing_failed_title: `🔴 画像処理に失敗しました`,
				image_processing_failed_description: `アップロードされた画像の処理に失敗しました。別の画像をお試しください。`,
				avatar_fetch_failed_title: `🔴 アバターの取得に失敗しました`,
				avatar_fetch_failed_description: `エクスポート用のサーバーアバターの取得に失敗しました。代わりに画像をアップロードしてみてください。`,
				metadata_embed_failed_title: `🔴 エクスポートに失敗しました`,
				metadata_embed_failed_description: `画像に人格データを埋め込むことができませんでした。もう一度お試しください。`,
				// Success
				success_title: `🟢 {character_name} の生成に成功しました！`,
				success_description: `**{character_name}** の人格を生成しました！\n\n**属性プレビュー:**\n{attribute_preview}\n\n**サンプル対話:**\n{dialogue_preview}`,
				success_next_steps_title: `次のステップ`,
				success_next_steps_description: `1. 添付されたPNGファイルをダウンロード\n2. PNGファイルと共に\`/persona import\`を使用してこのキャラクターをインポート\n3. 進行中の会話に新しい人格を適用するには\`/tool refresh\`を実行\n4. (任意) 必要に応じて\`/server avatar\`でアバターを変更`,
				avatar_update_skipped_dm: `アバターとニックネームの更新はダイレクトメッセージでインポートできませんのでご注意ください。`,
			},
			create: {
				description: `シンプルな人格プリセットを手動で作成`,
				// Modal fields
				modal: {
					title: `ペルソナ作成`,
					character_name_label: `キャラクター名`,
					character_name_description: `ヒント: より良い結果を得るには、/persona generate を使用してください`,
					character_name_placeholder: `キャラクター名を入力`,
					character_desc_label: `キャラクター説明`,
					character_desc_placeholder: `キャラクターを説明してください（性格、外見、背景など）`,
					example_user_label: `ユーザーメッセージの例`,
					example_user_description: `ヒント: インポート後に /teach sampledialogue で例を追加できます`,
					example_user_placeholder: `こんにちは、{bot}！`,
					example_bot_label: `ボット返信の例`,
					example_bot_placeholder: `こんにちは、{user}！お元気ですか？`,
					file_upload_label: `キャラクター画像 (任意)`,
					file_upload_description: `キャラクターエクスポート用の画像をアップロード`,
				},
				// Field labels for memory critical error preservation
				field_character_name: `キャラクター名`,
				field_character_desc: `キャラクター説明`,
				field_example_user: `ユーザーメッセージの例`,
				field_example_bot: `ボット返信の例`,
				// Error messages
				invalid_image_title: `🔴 無効な画像`,
				invalid_image_description: `有効な画像ファイル(PNG、JPG、JPEGなど)をアップロードしてください。`,
				image_download_failed_title: `🔴 画像のダウンロードに失敗しました`,
				image_download_failed_description: `添付画像のダウンロードに失敗しました。もう一度お試しください。`,
				error_file_too_large: `アバター画像は8MB以下である必要があります。`,
				error_download_timeout: `アバターのダウンロードがタイムアウトしました。もう一度お試しください。`,
				error_download_failed: `アバター画像のダウンロードに失敗しました。`,
				validation_failed_title: `🔴 検証に失敗しました`,
				validation_failed_description: `ペルソナデータの検証に失敗しました。もう一度お試しください。`,
				image_processing_failed_title: `🔴 画像処理に失敗しました`,
				image_processing_failed_description: `アップロードされた画像の処理に失敗しました。別の画像をお試しください。`,
				avatar_fetch_failed_title: `🔴 アバターの取得に失敗しました`,
				avatar_fetch_failed_description: `エクスポート用のサーバーアバターの取得に失敗しました。代わりに画像をアップロードしてみてください。`,
				metadata_embed_failed_title: `🔴 エクスポートに失敗しました`,
				metadata_embed_failed_description: `画像に人格データを埋め込むことができませんでした。もう一度お試しください。`,
				// Success
				success_title: `🟢 {character_name} の作成に成功しました！`,
				success_description: `**{character_name}** のペルソナが作成されました！\n\n**説明:**\n{character_description}`,
				success_dialogue_title: `サンプル対話`,
				success_next_steps_title: `次のステップ`,
				success_next_steps_description: `1. 添付されたPNGファイルをダウンロード\n2. PNGファイルと共に\`/persona import\`を使用してこのキャラクターをインポート\n3. 進行中の会話に新しい人格を適用するには\`/tool refresh\`を実行\n4. (任意) 必要に応じて\`/server avatar\`でアバターを変更`,
				avatar_update_skipped_dm: `アバターとニックネームの更新はダイレクトメッセージでは利用できませんのでご注意ください。`,
			},
		},

		// ヘルプコマンド
		help: {
			// /help features
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
- 画像、動画、ニュース検索も可能です（\`/config braveapi set\`経由）
- URLからコンテンツを取得して読むことができます`,
				personality_title: `パーソナリティ＆カスタマイズ`,
				personality_description: `- \`/config rename\`と\`/server avatar\`で名前とアバターを変更できます
- \`/persona\`で異なるペルソナに切り替えられます（\`/persona export\`でペルソナを共有・保存もできます！）
- \`/teach\`で行動やトーンを調整できます
- 詳しくは\`/help customization\`をご覧ください`,
				memory_title: `記憶＆パーソナライゼーション`,
				memory_description: `- ユーザーやサーバーに関する事実を記憶し、会話を跨いで保持します
- 個人的な記憶は全サーバーで保持されます（他のサーバーでも私に話しかけてみて！）
- \`/personal nickname\`であなたを呼ぶ名前を変更できます
- \`/teach\`で手動で記憶させ、\`/forget\`で削除できます
- 詳しくは\`/help memory\`をご覧ください`,
				time_title: `時間認識`,
				time_description: `- サーバーの現在時刻を認識しています（\`/config timezone\`経由）
- リマインダーを設定できます（何かを思い出させるように頼んでみて！）`,
				footer: `すべての機能がすべてのAIプロバイダーで利用できるわけではありません。GoogleのGeminiの使用を推奨します`,
			},

			// /help cost
			cost: {
				description: `有料AIプロバイダーのAPI費用を見積もる`,
				title: `推定API費用`,
				embed_description: `Discordチャンネルでのトリガーあたりの**非常におおまかな**推定費用です。費用は**{provider}**の例を使用して推定されています（入力：{inputPrice}/百万トークン、出力：{outputPrice}/百万トークン）`,
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
				footer: `Google Gemini（無料プラン）や一部のOpenRouterモデルなどの無料プロバイダーは費用がかかりません！NovelAIはサブスクリプション制で無制限に使用できます。プロバイダーの詳細は\`/help apikey\`をご覧ください。`,
			},

			// /help setup
			setup: {
				description: `TomoriBotの初期設定方法を学ぶ`,
				title: `TomoriBotを始める`,
				embed_description: `サーバー（またはDM）でTomoriBotを設定する方法：`,
				step1_title: `ステップ1：APIキーを取得`,
				step1_description: `TomoriBotはGoogle Gemini、NovelAI、OpenRouterなどのAIプロバイダーを使用します。いずれかのAPIキーが必要です。
- {helpApikey}で取得方法を確認
  - GoogleのGemini = 汎用、無料、すべての機能を実行可能
  - NovelAI = 無検閲なロールプレイとストーリーテリング特化
  - OpenRouter = 様々なAIモデルが利用可能
- このAPIキーを**他人と共有しないでください**`,
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
				step4_description: `- {persona}コマンドで私のパーソナリティを完全に変更
- {server}、{personal}、{config}コマンドで設定を調整
- {teach}で手動で物事を教えることもできます`,
				need_help_title: `ヘルプが必要ですか？`,
				need_help_description: `- {helpFeatures} - 私ができることを見る
- {helpMemory} - 記憶システムについて学ぶ
- {helpCustomization} - パーソナリティのカスタマイズについて学ぶ
- {supportServer} - 公式TomoriBotサポートサーバーに参加

TomoriBotをセットアップすることで、あなたとサーバーメンバーは\`/legal terms\`と\`/legal privacy\`の通知に同意したことになります`,
			},

			// /help data
			data: {
				description: `データ管理とプライバシーについて学ぶ`,
				title: `データの管理`,
				embed_description: `データの管理方法と保存内容：`,
				export_title: `データのエクスポート`,
				export_description: `{dataExport}を使用してデータをダウンロード：
- **個人データ**：記憶、設定、ユーザー設定
- **サーバーデータ**：サーバーの記憶、設定、ボット設定
- **パーソナリティデータ**：作成したカスタムペルソナ（他の人と共有する場合は{personaExport}を使用）
- データはJSONまたはテキストファイルとしてDMに送信されます`,
				import_title: `データのインポート`,
				import_description: `{dataImport}を使用してエクスポートしたデータを復元：
- サーバー間で個人データを復元
- サーバー設定を新しいサーバーに転送
- コマンド使用時にエクスポートしたファイルを添付するだけ`,
				delete_title: `データの削除`,
				delete_description: `{dataDelete}を使用してデータを完全に削除：
- **個人削除**：すべてのユーザーデータ、記憶、設定を削除
- **サーバー削除**：すべてのサーバーデータを削除
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

			// /help apikey
			apikey: {
				description: `AIプロバイダーのAPIキー設定方法を学ぶ`,
				provider_description: `AIプロバイダーを選択`,
				// Brave Search
				brave_title: `Brave Search APIキーの設定`,
				brave_description: `Brave Searchはオプションで、検索機能を強化するだけです。これは私のAIを動かすものではありません（それはメインプロバイダーが担当します）。
- 画像、動画、ニュース検索を有効化
- インターネットからリアルタイム情報を提供
- 最新の質問に答える能力を強化
- 無料プランには月2,000クエリが含まれます`,
				brave_getting_key_title: `APIキーの取得：`,
				brave_getting_key_description: `1. [Brave Search API](https://brave.com/search/api/)にアクセス
2. 無料アカウントに登録
3. ダッシュボードの[APIキー](https://api-dashboard.search.brave.com/app/keys)セクションに移動
4. 新しいAPIキーを作成
5. {configBraveapiSet}コマンドでAPIキーをコピーして入力`,
				brave_important_title: `重要な注意事項：`,
				brave_important_description: `- これはメインAIプロバイダーとは別です
- Brave APIキーがなくても、組み込みウェブ検索で機能します`,
				brave_footer: `メインAIプロバイダーの設定については、他の\`/help apikey\`オプションを確認してください`,
				// Google Gemini
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
				// NovelAI
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
				// OpenRouter
				openrouter_title: `OpenRouter APIキーの設定`,
				openrouter_description: `OpenRouterは従量課金制で複数のプロバイダーの様々なAIモデルへのアクセスを提供します。
- 最新かつ最も強力なAIモデルへのアクセス（無料もあります）
- 現在、TomoriBotの全機能をサポートしていません
- [OpenRouter利用規約](https://openrouter.ai/terms)`,
				openrouter_getting_key_title: `APIキーの取得：`,
				openrouter_getting_key_description: `1. [OpenRouter](https://openrouter.ai/settings/keys)にアクセス
2. \`APIキーを作成\`をクリック
3. このAPIキーを{configSetup}または{configApikeySet}にコピー`,
				openrouter_model_selection_title: `モデルの選択：`,
					openrouter_model_selection_description: `OpenRouterは多くの異なるAIモデルへのアクセスを提供します。
	- 現在利用可能なモデルは人気と性能に基づいており、区別のためのタグが付いています：
	  - (TOOLS) = ツール使用をサポート（ウェブ検索、自己学習、ステッカーなど）
	  - (IMAGES) = 画像を認識
	  - (STRUCT) = 構造化出力をサポート（ペルソナ生成や表情の初期化に必要）
	  - (FREE) = 無料ですが、レート制限がある場合があります
	- 希望のモデルが見つからない場合は、\`account-setting\`プロバイダーオプションを試してみてください
	- {supportServer}で追加のモデルを提案してください`,
				openrouter_pricing_title: `重要な価格に関する注意事項：`,
				openrouter_pricing_description: `- **無料モデルは厳格なレート制限があります** - より信頼性の高い有料モデルをお勧めします
- 予期しないコストを避けるため、モデルを選択する前に**OpenRouterで必ず価格を確認してください**
- モデルによってコストが大きく異なります`,
				openrouter_settings_title: `OpenRouterアカウント設定：`,
				openrouter_settings_description: `OpenRouterアカウントで設定された設定（モデルの優先順位、レート制限など）は、TomoriBotを使用する際にも適用されます`,
				openrouter_footer: `このプロバイダーを設定したら、{configModel}でデフォルトモデルを変更できます`,
			},

			// /help memory
			memory: {
				description: `TomoriBotの記憶システムについて学ぶ`,
				title: `記憶の仕組み`,
				embed_description: `会話を跨いでユーザーやサーバーに関する事実や情報を記憶する永続的な記憶システムがあります！これは**私が知っていること**（事実、コンテキスト、情報）についてです。**私がどう振る舞うか**（パーソナリティ、トーン、設定）については、代わりに{helpCustomization}をご覧ください！`,
				teaching_title: `物事を教える`,
				teaching_description: `{teach}を使用して**事実と情報**を記憶させます：
- **個人的な記憶**（{teachMemoryPersonal}）：個々のユーザーに関する事実
  - 例：「Alexは猫が好き」、「ダークモードを好む」、「ピーナッツアレルギー」
- **サーバーの記憶**（{teachMemoryServer}）：サーバー全体に関連する情報
  - 例：「ゲームナイトは毎週金曜日午後8時」、「NSFWの投稿禁止」、「お知らせには#generalを使用」`,
				forgetting_title: `忘れること`,
				forgetting_description: `{forget}を使用して記憶を削除：
- {forgetMemoryPersonal} - ユーザーに関する個人的な事実を削除
- {forgetMemoryServer} - サーバー全体の情報を削除`,
				how_it_works_title: `仕組み：`,
				how_it_works_description: `- **個人的な記憶**は全サーバーであなた専用に紐付けられ、あなたが積極的に参加している会話で返信する際にのみ記憶します
- **サーバーの記憶**はサーバー内にのみ留まり、サーバー内の会話で返信する際に常に記憶します
- 記憶は\`/forget\`コマンドを使用するまで保持されます`,
				tips_title: `記憶のヒント：`,
				tips_description: `- 好み、ニックネーム、重要な事実を教えてください
- サーバーの記憶には共有情報、内輪ネタ、サーバー文化を使用
- {dataExport}または{status}で定期的に記憶を確認
- 最良の結果を得るために記憶を簡潔明瞭に保つ

**プライバシー:** データ処理の詳細は\`/legal privacy\`をご覧ください`,
			},

			// /help customization
			customization: {
				description: `TomoriBotのパーソナリティと動作をカスタマイズする方法を学ぶ`,
				// Embed 1: Overview + Personas
				embed1_title: `TomoriBotのカスタマイズ`,
				embed1_description: `TomoriBotは高度にカスタマイズ可能です！私を本当にあなたのものにするために設定できるすべてがここにあります。これは**私がどう振る舞うか**（パーソナリティ、トーン、設定）についてです。**私が記憶していること**（事実、記憶）については、代わりに{helpMemory}をご覧ください！`,
				embed1_personas_title: `パーソナリティペルソナ`,
				embed1_personas_description: `私の核となるパーソナリティと動作を制御：

**ペルソナコマンド：**
- {personaCreate} - ゼロからカスタムパーソナリティを作成
- {personaGenerate} - 説明に基づいてAIがパーソナリティを生成（GeminiまたはOpenRouterが必要）
- {personaDefault} - デフォルトのパーソナリティに切り替え
- {personaExport} - ペルソナを共有またはバックアップ用にエクスポート
- {personaImport} - ファイルからペルソナをインポート
- {teach} - 話し方や行動を教える
- {serverAvatar} - プロフィール画像を変更`,
				embed1_what_personas_include_title: `ペルソナに含まれるもの：`,
				embed1_what_personas_include_description: `- パーソナリティ属性（特性、特徴、癖）
- サンプル対話（話し方を教える会話例）
- そのパーソナリティ用のカスタムサーバーアバター
- 動作とトーンの設定`,
				embed1_footer: `次：教えるコマンド`,
				// Embed 2: Teaching System
				embed2_title: `教えるコマンド `,
				embed2_description: `## 教えるコマンド（\`/teach\`）
パーソナリティと知識を微調整：

**パーソナリティの形成：**
- {teachAttribute} - パーソナリティの特性を追加（例：「フレンドリー」、「皮肉っぽい」、「フォーマル」）
- {teachSampledialogue} - 話し方を形作る会話例を追加
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
				// Embed 3: Configuration & Management
				embed3_title: `設定＆管理`,
				embed3_description: `## 忘れるコマンド（\`/forget\`）
パーソナリティのカスタマイズを削除：

- {forgetAttribute} - 特定のパーソナリティ属性を削除
- {forgetSampledialogue} - サンプル対話の例を削除

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
- {serverTriggerAdd} - 反応するカスタムトリガーワードを追加
- {serverTriggerDelete} - トリガーワードを削除
- {serverAvatar} - このサーバー用のカスタムプロフィール画像を設定`,
				embed3_footer: `次：ボット設定`,
				// Embed 4: Advanced Settings
				embed4_title: `詳細設定`,
				embed4_description: `## ボット設定（\`/config\`）
個人的なボット設定：

**AI設定：**
- {configModel} - 使用するAIモデルを選択
- {configTemperature} - 創造性/ランダム性を調整。高いほど応答がより多様に（1.0-2.0）
- {configHumanizer} - 応答の人間らしさを変更

**APIキー：**
- {configApikeySet} - AIプロバイダーのAPIキーを設定
- {configApikeyDelete} - APIキーを削除
- {configBraveapiSet} - Brave Search APIキーを設定（オプション）
- {configBraveapiDelete} - Brave Search APIキーを削除

**パーソナライゼーション：**
- {configRename} - 自分を何と呼ぶかを変更
- {configTimezone} - 時間認識応答とリマインダー用のタイムゾーンを設定
- {configPermissions} - 許可される操作を設定`,
				embed4_footer: `次：プロのヒント`,
				// Embed 5: Pro Tips
				embed5_title: `プロのヒント`,
				embed5_description: `- ペルソナ（デフォルトまたは生成）を基盤として始める
- 素早くパーソナリティを調整するには\`/teach attribute\`を使用
- サンプル対話では、属性や特性も示す例を使用すると効果的：
\`\`\`
ユーザーメッセージ：{user}：お気に入りの趣味は？
ボットの応答：{bot}：ふふ〜小さなぬいぐるみに小さな服を編むのが好きです〜♥
\`\`\`
- チャットして変更をテストし、しっくりくるまで繰り返す
- ペルソナをエクスポートしてバックアップするか、他のサーバーと共有！`,
			},
		},

		// 法的文書コマンド
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

		// ボットの手動制御コマンド
		bot: {
			respond: {
				description: `このチャンネルの最新メッセージに手動で応答をトリガーします。`,
				success_title: `手動応答がトリガーされました`,
				success_description: `このチャンネルの最新メッセージに応答しています...`,
			},
			reason: {
				description: `現在のAIプロバイダーの最も賢い推論モデルを使用して、オプションのクエリで応答します。`,
				query_description: `推論を集中させるためのオプションのクエリ。`,
				success_title: `推論モードが有効になりました`,
				success_description: `高度な推論を使用して応答します{query}...`,
				no_smart_model_title: `推論モデルが見つかりません`,
				no_smart_model_description: `現在のAIプロバイダーに推論モデルが見つかりませんでした。\`/config apikeyset\`を使用して、推論モデルをサポートするプロバイダーに切り替えてください。`,
			},
		},

		// サポートコマンド
		support: {
			discord: {
				description: `バグ報告、フィードバック、コミュニティチャットのための公式Discordサーバーリンクを取得します。`,
				title: `Discordサーバーに参加`,
				description_text: `TomoriBotのヘルプが必要ですか？またはコミュニティと交流したいですか？\n\n🔗 **Discordサーバー**: https://discord.gg/bjCfHm9QsB\n\n参加して:\n• バグや問題を報告\n• フィードバックや提案を共有\n• 他のユーザーや開発チームとチャット\n• 新機能の最新情報を入手`,
			},
		},

		// 貢献コマンド
		contribute: {
			github: {
				description: `GitHubリポジトリのリンクを取得し、TomoriBotへの貢献方法を学びます。`,
				title: `TomoriBotに貢献する`,
				description_text: `TomoriBotをより良くするお手伝いをしたいですか？貢献をお待ちしています！\n\n🔗 **GitHubリポジトリ**: https://github.com/Bredrumb/TomoriBot\n\n貢献方法:\n• GitHubでリポジトリにスターを付ける ⭐\n• バグ報告や機能リクエストを送信\n• コードの改善や新機能を貢献\n• TomoriBotを他の言語に翻訳するお手伝い\n• ドキュメントの改善`,
			},
		},

		// 寄付コマンド
		donate: {
			kofi: {
				description: `Ko-fiを通じてTomoriBotの開発を支援します。`,
				title: `TomoriBotの開発を支援`,
				description_text: `TomoriBotを使うのが好きですか？無料で維持し、継続的な開発を支援してください！\n\n🔗 **Ko-fi**: https://ko-fi.com/bredrumb\n\nあなたの寄付は以下に役立ちます:\n• TomoriBotの運営と保守\n• 新機能と改善の追加\n• サーバーコストと開発時間のサポート\n• TomoriBotを完全に無料で維持\n\n大小問わず、すべての貢献に心から感謝します！ ❤️`,
			},
		},

		// 設定コマンド（管理者のみ）
		config: {
			options: {
				add: `追加`,
				remove: `削除`,
				enable: `有効化`,
				disable: `無効化`,
			},
			// APIキー管理（サブコマンドグループ）
			apikey: {
				description: `AIプロバイダーのAPIキーを管理`,
				set: {
					description: `選択したAIプロバイダーのAPIキーを設定します。`,
					modal_title: `APIキーの設定`,
					provider_label: `AIプロバイダー`,
					provider_description: `APIキーに対応するAIプロバイダーを選択してください`,
					provider_placeholder: `プロバイダーを選択...`,
					api_key_label: `プロバイダーAPIキー`,
					api_key_description: `このキーは安全に保存されます。取得方法については、'/help apikey'コマンドを使用してください。`,
					api_key_placeholder: `このキーは誰とも共有しないでください`,
					no_providers_title: `利用可能なプロバイダーがありません`,
					no_providers_description: `データベースに利用可能なAIプロバイダーがありません。ボットの管理者に連絡してください。`,
					invalid_key_title: `無効なAPIキー形式`,
					invalid_key_description: `提供されたAPIキーは短すぎるか無効のようです。有効なキーを提供してください。`,
					validating_key: `APIキーを検証中...`,
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
				},
				delete: {
					description: `現在設定されているAIプロバイダーのAPIキーを削除します。`,
					no_key_title: `APIキーが設定されていません`,
					no_key_description: `現在削除するAPIキーが設定されていません。`,
					success_title: `APIキーが削除されました`,
					success_description: `AIプロバイダーのAPIキーが正常に削除されました。新しいキーが設定されるまで、私のチャット機能は無効になります。`,
				},
			},
			// Brave Search APIキー管理（サブコマンドグループ）
			braveapi: {
				description: `Brave Search APIキーを管理`,
				set: {
					description: `このサーバーのBrave Search APIキーを設定します。`,
					key_description: `あなたのBrave Search APIキー。`,
					invalid_key_title: `無効なAPIキー形式`,
					invalid_key_description: `提供されたAPIキーは短すぎるか無効のようです。有効なキーを提供してください。`,
					validating_key: `Brave Search APIキーを検証中...`,
					validation_error_title: `APIキーの検証エラー`,
					validation_error_description: `Brave Search APIキーの検証中にエラーが発生しました。再度お試しいただくか、接続を確認してください。`,
					key_validation_failed_title: `Brave APIキーの検証に失敗しました`,
					key_validation_failed_description: `提供されたBrave Search APIキーは無効です。キーを確認してもう一度お試しください。`,
					success_title: `Brave APIキーが設定されました`,
					success_description: `Brave Search APIキーが正常に検証、暗号化、保存されました。`,
				},
				delete: {
					description: `現在設定されているBrave Search APIキーを削除します。`,
					no_key_title: `Brave APIキーが設定されていません`,
					no_key_description: `現在削除するBrave Search APIキーが設定されていません。`,
					success_title: `Brave APIキーが削除されました`,
					success_description: `Brave Search APIキーが正常に削除されました。`,
				},
			},
			humanizer: {
				description: `私の応答がどれだけ「人間らしい」か設定します。カスタムプロンプトを設定するには \`/config prompt change\` を使用してください。`,
				modal_title: `ヒューマナイザーレベルの設定`,
				select_label: `ヒューマナイザーレベル`,
				select_description: `私の応答がどれだけ人間らしく感じられるかを選択してください`,
				select_placeholder: `レベルを選択...`,
				choice_none: `0: なし (生のAI出力)`,
				choice_light: `1: ライト (プロンプトインジェクション)`,
				choice_medium: `2: ミディアム (タイピングシミュレーション＆チャンキング)`,
				choice_heavy: `3: ヘビー (小文字＆句読点なし - デフォルト)`,
				desc_none: `人間化なし。フォーマルなトーンと構造の標準的なAI応答。`,
				desc_light: `システムプロンプトを追加。絵文字を制限（0-2個）、簡潔な応答を優先。\`/config prompt change\` でカスタマイズ可能。`,
				desc_medium: `ライト機能 + タイピングシミュレーションと自然な流れのためのメッセージチャンキングの改善。`,
				desc_heavy: `全機能 + カジュアルなテキスト処理（小文字、句読点の削減）でインフォーマルなトーンに。`,
				invalid_value_description: `ヒューマナイザーレベルは {min} から {max} の間でなければなりません。`,
				already_set_title: `ヒューマナイザーは既に設定済みです`,
				already_set_description: `ヒューマナイザーレベルは既に \`{value}\` に設定されています。`,
				success_title: `ヒューマナイザーレベルが更新されました`,
				success_description: `ヒューマナイザーレベルが \`{previous_value}\` から \`{value}\` に変更されました。`,
			},
			model: {
				text: {
					description: `私が使用する基盤となるAIモデルを変更します。`,
					modal_title: `AIモデルの選択`,
					select_label: `AIモデル`,
					select_description: `私が使用するAIモデルを選択してください。無料でないモデルの価格については、各AIプロバイダーの公式サイトをご確認ください。`,
					select_placeholder: `モデルを選択...`,
					no_api_key_title: `APIキーが設定されていません`,
					no_api_key_description: `モデルを変更する前にAPIキーを設定する必要があります。まず \`/config apikeyset\` を使用してAPIキーを設定してください。`,
					no_models_title: `モデルが見つかりません`,
					no_models_description: `データベースから利用可能なAIモデルを読み込めませんでした。`,
					invalid_model_description: `選択されたモデル名は無効か、利用できません。`,
					already_selected_title: `モデルは既に選択済みです`,
					already_selected_description: `私は既に \`{model_name}\` モデルを使用しています。`,
					validating_api_key_compatibility: `新しいプロバイダーとのAPIキー互換性を検証中...`,
					api_key_incompatible_title: `APIキーに互換性がありません`,
					api_key_incompatible_description: `現在のAPIキーは{provider}の{model_name}モデルと互換性がありません。\`/config apikeyset\`を使用して{provider}の有効なAPIキーを設定してください。`,
					validation_error_title: `検証エラー`,
					validation_error_description: `APIキーの互換性検証中にエラーが発生しました。もう一度お試しください。`,
					success_title: `モデルが更新されました`,
					success_description: `これからは \`{model_name}\` モデルを使用します（以前は \`{previous_model}\`）。`,
				},
				image: {
					description: `このサーバーの画像生成モデルを変更します。`,
					modal_title: `画像生成モデルの選択`,
					select_label: `画像モデル`,
					select_description: `画像生成モデルを選択してください。価格については各AIプロバイダーをご確認ください。`,
					select_placeholder: `画像モデルを選択...`,
					no_api_key_title: `APIキーが設定されていません`,
					no_api_key_description: `画像モデルを変更する前にAPIキーを設定する必要があります。`,
					no_models_title: `画像モデルが利用できません`,
					no_models_description: `現在のテキストモデルプロバイダー（{provider}）は画像生成をサポートしていません。まず \`/config apikey set\` を使用してGoogleまたはOpenRouterに切り替えてください。`,
					invalid_model_description: `選択された画像モデルは無効か、利用できません。`,
					already_selected_title: `モデルは既に選択済みです`,
					already_selected_description: `既に \`{model_name}\` 画像モデルを使用しています。`,
					success_title: `画像モデルが更新されました`,
					success_description: `画像生成には \`{model_name}\` モデルを使用します（以前は \`{previous_model}\`）。`,
					current_none: `なし`,
				},
			},
			rename: {
				description: `このサーバーでの私の名前を変更します。`,
				option_description: `私の新しい名前（2〜32文字）。`,
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
			setup: {
				description: `初期設定プロセスを開始します。AIプロバイダーとパーソナリティを設定します。`,
				no_presets_found: `エラー: あなたの言語用の人格プリセットが見つかりません。設定を続行できません。`,
				modal_title: `初期の設定`,
				api_provider_label: `APIプロバイダー`,
				api_provider_description: `お好みのLLMのプロバイダーを選択してください`,
				api_provider_placeholder: `選択してください...`,
				api_key_label: `APIキー`,
				api_key_description: `選択したLLMプロバイダーのAPIキーを入力してください。このキーは安全に保存されます。取得方法が不明な場合は、\`/help apikey\`コマンドを使用してください。`,
				api_key_placeholder: `このキーは誰とも共有しないでください`,
				preset_label: `人格プリセット`,
				preset_description: `人格プリセットを選択してください`,
				preset_placeholder: `人格を選択...`,
				humanizer_label: `人間らしさの度合い`,
				humanizer_description: `どれくらい「人間らしく」返信すべきですか？`,
				humanizer_placeholder: `人間らしさのレベルを選択...`,
				humanizer_option_none_label: `なし`,
				humanizer_option_none_desc: `生のAI出力。遅延なし、完全な句読点、即時応答。`,
				humanizer_option_light_label: `軽`,
				humanizer_option_light_desc: `基本的なガイダンス：絵文字0〜2個、簡潔に応答。タイピングシミュレーションなし。`,
				humanizer_option_default_label: `デフォルト`,
				humanizer_option_default_desc: `バランス型：リアルなタイピングインジケーターとメッセージ間の思考ポーズ。`,
				humanizer_option_heavy_label: `重`,
				humanizer_option_heavy_desc: `最大：タイピング遅延付きの文単位のチャンク化、カジュアルな小文字テキスト。`,
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
				success_desc: `このサーバー用に設定が完了しました。私の設定を変更するには、\`/config\`と\`/server\`コマンドを使用してください。任意ですが推奨：\`/server initialize\` コマンドで絵文字・スタンプのメタデータを最適化できます。データの管理や削除は\`/data\`でいつでも可能です。概要は以下の通りです:`,
				success_desc_dm: `このダイレクトメッセージ用に設定が完了しました。データの管理や削除は\`/data\`でいつでも可能です。概要は以下の通りです:`,
				preset_field: `人格プリセット`,
				name_field: `私の名前`,
				dm_context_explanation_title: `ダイレクトメッセージについて`,
				dm_context_explanation: `このダイレクトメッセージでも「サーバー」として参照します。つまり、すべての「サーバー」機能が同じように動作しますが、私たちだけのプライベートな空間です！このダイレクトメッセージを私との1対1サーバーと考えてください。「サーバーメモリー」はここでのみの私の記憶です。`,
				already_setup_title: `既に設定済みです`,
				already_setup_description: `このサーバーでは既に設定が完了しています。設定を変更するには、\`/config humanizer\`、\`/config temperature\`、\`/teach attribute\`などの他のコマンドを使用してください。

				プロバイダーを変更したい場合は、\`/config apikeyset\`コマンドを使用してください。`,
			},
			temperature: {
				description: `私の応答の創造性/ランダム性を設定します（0.1〜2.0）。`,
				value_description: `1.0（予測可能）から2.0（非常にランダム）の間の値。デフォルト: 1.5。`,
				invalid_value_title: `無効なTemperature`,
				invalid_value_description: `Temperatureは {min} から {max} の間でなければなりません。`,
				already_set_title: `Temperatureは既に設定済みです`,
				already_set_description: `Temperatureは既に \`{temperature}\` に設定されています。`,
				success_title: `Temperatureが更新されました`,
				success_description: `LLMのTemperatureが \`{previous_temperature}\` から \`{temperature}\` に変更されました。`,
			},
			timezone: {
				description: `サーバーのUTCからのタイムゾーンオフセットを設定します。`,
				value_description: `時間単位のUTCオフセット。例：8（シンガポール/北京）、-5（ニューヨーク）、0（ロンドン）、9（東京）`,
				invalid_value_title: `無効なタイムゾーンオフセット`,
				invalid_value_description: `タイムゾーンオフセットは {min} から {max} 時間の間でなければなりません。`,
				already_set_title: `タイムゾーンは既に設定済みです`,
				already_set_description: `タイムゾーンは既に \`{timezone}\` に設定されています。`,
				success_title: `タイムゾーンが更新されました`,
				success_description: `サーバーのタイムゾーンが \`{previous_timezone}\` から \`{timezone}\` に変更されました。`,
			},
			permissions: {
				description: `このサーバーでの私のコアな行動権限を設定します。`,
				option_description: `設定する特定の権限。`,
				selfteaching_option: `自己学習`,
				personalization_option: `パーソナライズ (記憶/ニックネーム)`,
				emojiusage_option: `絵文字の使用`,
				stickerusage_option: `スタンプの使用`,
				websearch_option: "ウェブ検索権限",
				pinmessage_option: "メッセージのピン留め",
				imagegen_option: "画像生成",
				permission_choice_selfteaching: `自己学習`,
				permission_choice_personalization: `パーソナライズ (記憶/ニックネーム)`,
				permission_choice_emojiusage: `絵文字の使用`,
				permission_choice_stickerusage: `スタンプの使用`,
				permission_choice_websearch: "ウェブ検索権限",
				permission_choice_pinmessage: "メッセージのピン留め",
				permission_choice_imagegen: "画像生成",
				set_description: `私のためにこの権限を有効または無効にします。`,
				already_set_title: `権限は既に設定済みです`,
				already_enabled_description: `権限 \`{permission_type}\` は既に**有効**です。`,
				already_disabled_description: `権限 \`{permission_type}\` は既に**無効**です。`,
				success_title: `権限が更新されました`,
				enabled_success: `\`{permission_type}\` の権限が**有効**になりました。`,
				disabled_success: `\`{permission_type}\` の権限が**無効**になりました。`,
			},

			// システムプロンプト管理
			prompt: {
				description: `人格指示のためのカスタムシステムプロンプトを管理します`,
				change: {
					description: `私の振る舞いを導くカスタムシステムプロンプトを設定します`,
					modal_title: `カスタムシステムプロンプトを設定`,
					part1_label: `システムプロンプト（1/4）`,
					part1_description: `主な指示。{bot} は私の名前、{user} はトリガーしたユーザーとして使用できます`,
					part1_placeholder: `例：{bot} はフレンドリーで親切...`,
					part2_label: `システムプロンプト（2/4）- 任意`,
					part2_description: `指示の続き（任意）`,
					part2_placeholder: `追加の指示...`,
					part3_label: `システムプロンプト（3/4）- 任意`,
					part3_description: `指示の続き（任意）`,
					part3_placeholder: `さらに指示...`,
					part4_label: `システムプロンプト（4/4）- 任意`,
					part4_description: `指示の続き（任意）`,
					part4_placeholder: `最後の指示...`,
					empty_prompt_title: `空のシステムプロンプト`,
					empty_prompt_description: `システムプロンプトは空にできません。少なくともパート1に指示を入力してください。`,
					success_title: `システムプロンプトが更新されました`,
					success_description: `カスタムシステムプロンプトを設定しました：\n\`\`\`\n{preview}...\n\`\`\``,
				},
				clear: {
					description: `カスタムシステムプロンプトを削除し、デフォルトのシステムプロンプトを使用します`,
					no_custom_prompt_title: `カスタムプロンプトは未設定です`,
					no_custom_prompt_description: `カスタムシステムプロンプトは設定されていません。現在はデフォルトのプロンプトを使用しています：\n\`\`\`\n{defaultPrompt}\n\`\`\``,
					success_title: `システムプロンプトがクリアされました`,
					success_description: `カスタムシステムプロンプトをクリアしました。現在はデフォルトのプロンプトを使用します：\n\`\`\`\n{defaultPrompt}\n\`\`\``,
				},
				preset: {
					description: `プリセットシステムプロンプトを適用します`,
					modal_title: `システムプロンプトプリセットを選択`,
					selection_label: `プリセットを選択`,
					selection_placeholder: `プリセットのプロンプトスタイルを選択...`,
					success_title: `✓ プリセットが適用されました`,
					success_description: `システムプロンプトプリセットを適用しました：**{presetName}**\n\nプレビュー：\n\`\`\`\n{preview}...\n\`\`\``,
					no_presets_title: `プリセットがありません`,
					no_presets_description: `システムプロンプトプリセットが見つかりません。ボット管理者にお問い合わせください。`,
					invalid_preset_title: `無効なプリセット`,
					invalid_preset_description: `選択されたプリセットが見つかりませんでした。もう一度お試しください。`,
				},
			},
		},

		// サーバー設定コマンド（管理者専用）
		server: {
			// 自動チャット設定（サブコマンドグループ）
			autotrigger: {
				description: `自動チャット設定を管理`,
				channels: {
					description: `私が自動的にチャットするチャンネルを追加または削除します。`,
					channel_description: `追加または削除するテキストチャンネル。`,
					action_description: `チャンネルを追加するか削除するか。`,
					invalid_channel_title: `無効なチャンネルタイプ`,
					invalid_channel_description: `標準のテキストチャンネルを選択してください。`,
					already_added_title: `チャンネルは既に追加されています`,
					already_added_description: `チャンネル \`{channel_name}\` は既に自動チャットリストにあります。`,
					not_in_list_title: `チャンネルが見つかりません`,
					not_in_list_description: `チャンネル \`{channel_name}\` は自動チャットリストにありません。`,
					added_title: `自動チャットチャンネルが追加されました`,
					added_description: `\`{channel_name}\` を自動チャットチャンネルに正常に追加しました。`,
					removed_title: `自動チャットチャンネルが削除されました`,
					removed_description: `\`{channel_name}\` を自動チャットチャンネルから正常に削除しました。`,
				},
				threshold: {
					description: `私が自動チャットするためのメッセージ数の閾値を設定します（0で無効）。`,
					threshold_description_v2: `自動チャットまでのメッセージ数（0で無効、または30-100）。`,
					invalid_range_title: `無効な閾値`,
					invalid_range_specific_description: `閾値は正確に \`{min}\`（無効にする場合）または \`{range_start}\` と \`{max}\` の間でなければなりません。`,
					success_title: `自動チャット閾値が設定されました`,
					success_description: `指定されたチャンネルで \`{threshold}\` メッセージ後に自動的にチャットします。`,
					success_disabled_title: `自動チャットが無効になりました`,
					success_disabled_description: `自動チャット機能は現在無効です（閾値が \`{threshold}\` に設定されました）。`,
				},
			},
			// トリガーワード管理（サブコマンドグループ）
			trigger: {
				description: `トリガーワードを管理`,
				add: {
					description: `言及されたときに私が応答する単語を追加します。`,
					word_description: `トリガーとして追加する単語。`,
					too_short_title: `トリガーワードが短すぎます`,
					too_short_description: `トリガーワードは少なくとも2文字以上である必要があります。`,
					content_too_long_title: `トリガーワードが長すぎます`,
					content_too_long_description: `トリガーワードは {max_length} 文字を超えることはできません。`,
					already_exists_title: `トリガーワードが存在します`,
					already_exists_description: `単語 \`{word}\` は既にトリガーリストにあります。`,
					limit_exceeded_title: `トリガーワード上限に達しました`,
					limit_exceeded_description: `このサーバーはトリガーワードの上限 {max_allowed} 個に達しました（現在 {current_count} 個）。新しいものを追加する前に、\`/server trigger delete\`でいくつかのトリガーワードを削除してください。`,
					success_title: `トリガーワードが追加されました`,
					success_description: `\`{word}\` をトリガーワードとして正常に追加しました。現在 {word_count} 個のトリガーワードがあります。`,
				},
				delete: {
					description: `言及されたときに私が応答する単語を削除します。`,
					no_triggers_title: `トリガーワードがありません`,
					no_triggers_description: `削除するカスタムトリガーワードが設定されていません。\`/server trigger add\`で追加してください。`,
					select_title: `トリガーワードの削除`,
					select_description: `削除したいトリガーワードを選択してください`,
					trigger_words_label: `トリガーワード`,
					modal_title: `トリガーワードの削除`,
					select_label: `トリガーワード`,
					select_placeholder: `削除するトリガーワードを選択してください`,
					success_title: `トリガーワードが削除されました`,
					success_description: `サーバー設定からトリガーワード「{triggerWord}」を正常に削除しました。`,
				},
			},
			blacklist: {
				description: `パーソナライズのブラックリストにメンバーを追加または削除します。`,
				member_description: `ブラックリストに追加または削除するメンバー。`,
				action_description: `メンバーを追加するか削除するか。`,
				personalization_disabled_title: `パーソナライズが無効です`,
				personalization_disabled_description: `現在、サーバー全体でパーソナライズが無効になっています。まず \`/config permissions\` で有効にしてください。`,
				already_blacklisted_title: `既にブラックリストに登録されています`,
				already_blacklisted_description: `\`{user_name}\` は既にパーソナライズのブラックリストに登録されています。`,
				not_blacklisted_title: `ブラックリストに登録されていません`,
				not_blacklisted_description: `\`{user_name}\` はパーソナライズのブラックリストに登録されていません。`,
				added_title: `メンバーがブラックリストに登録されました`,
				added_description: `\`{user_name}\` をパーソナライズのブラックリストに追加しました。彼らの個人的な記憶とニックネームは使用されません。`,
				removed_title: `メンバーがブラックリストから解除されました`,
				removed_description: `\`{user_name}\` をパーソナライズのブラックリストから削除しました。彼らの個人的な記憶とニックネームが使用できるようになります。`,
				user_registration_failed_title: `ユーザー登録に失敗しました`,
				user_registration_failed_description: `データベースへのユーザー登録に失敗しました。もう一度お試しください。`,
				cannot_blacklist_bot_title: `ボットをブラックリスト登録できません`,
				cannot_blacklist_bot_description: `\`{user_name}\` はボットであり、パーソナライズのブラックリストに追加できません。`,
			},
			memberpermissions: {
				description: `管理者以外のメンバーが私に何を教えられるかを設定します。`,
				option_description: `メンバーが教えることができる記憶の種類。`,
				servermemories_option: `サーバーの記憶`,
				attributelist_option: `属性リスト`,
				sampledialogues_option: `サンプル対話`,
				option_choice_servermemories: `サーバーの記憶`,
				option_choice_attributelist: `属性リスト`,
				option_choice_sampledialogues: `サンプル対話`,
				set_description: `メンバーに対してこの権限を有効または無効にします。`,
				success_title: `メンバー権限が更新されました`,
				enabled_success: `メンバーは \`{permission_type}\` を教えることができます。`,
				disabled_success: `メンバーはもう \`{permission_type}\` を教えることはできません。`,
				already_set_title: `権限は既に設定済みです`,
				already_enabled_description: `メンバーは既に \`{permission_type}\` を教えることが許可されています。`,
				already_disabled_description: `メンバーは既に \`{permission_type}\` を教えることが禁止されています。`,
			},
			avatar: {
				description: `このサーバー用のカスタムアバターを設定または削除します。`,
				image_description: `アバターとして設定する画像（空白にするとカスタムアバターを削除）`,
				success_title: `アバターが更新されました`,
				success_description: `このサーバー用のアバターの更新に成功しました。`,
				removed_title: `アバターがリセットされました`,
				removed_description: `このサーバー用のアバターをデフォルトにリセットしました。`,
				invalid_image_title: `無効な画像`,
				invalid_image_description: `有効な画像ファイルを提供してください。`,
				file_too_large_title: `ファイルサイズが大きすぎます`,
				file_too_large_description: `画像ファイルが大きすぎます。最大ファイルサイズは8MBです。`,
				invalid_format_title: `無効な形式`,
				invalid_format_description: `PNG、JPG、JPEG、またはGIF画像ファイルを提供してください。`,
				conversion_error_title: `変換エラー`,
				conversion_error_description: `画像の処理に失敗しました。別の画像ファイルを試してください。`,
				api_error_title: `APIエラー`,
				api_error_description: `Discord APIを通じてアバターの更新に失敗しました。後でもう一度お試しください。`,
				error_download_timeout: `アバターのダウンロードが15秒後にタイムアウトしました。もう一度お試しください。`,
				error_api_timeout: `Discord API呼び出しが15秒後にタイムアウトしました。もう一度お試しください。`,
			},
		// 初期化サブコマンドグループ
		initialize: {
			description: `AI分析を使用してサーバー機能を初期化します`,
			expressions: {
				description: `AIビジョンを使用してすべてのカスタム絵文字とスタンプを分析・分類します`,
				// 成功メッセージ
				success_title: `絵文字とスタンプを初期化しました`,
				success_description: `{emoji_count}個の絵文字と{sticker_count}個のスタンプ（合計{total}個）を分析・分類しました。`,
				// エラーメッセージ
				model_incompatible_title: `互換性のないモデル`,
				model_incompatible_description: `現在のモデル（{model_name}）は{missing_capability}をサポートしていません。\`/config model text\`を使用して、画像ビジョンと構造化出力の両方をサポートするモデルに切り替えてください。`,
				already_initialized_title: `初期化するものがありません`,
				already_initialized_description: `すべての絵文字とスタンプはすでに分析・分類されています。`,
				partial_success_title: `部分的に成功`,
				partial_success_description: `{total}個の絵文字/スタンプのうち{successful}個を分析しました。{failed}個は処理できませんでした。`,
				no_matches_title: `一致するものが見つかりません`,
				no_matches_description: `AIは絵文字/スタンプを分析しましたが、データベースと一致する結果が見つかりませんでした。処理エラーの可能性があります。`,
				llm_error_title: `AI分析に失敗しました`,
				llm_error_description: `AIモデルが絵文字/スタンプの分析中にエラーに遭遇しました。後でもう一度お試しください。`,
				validation_error_title: `無効なAI応答`,
				validation_error_description: `AIが無効な応答形式を返しました。これはモデルの問題である可能性があります。`,
				// 進行状況メッセージ
				progress_fetching: `未初期化の絵文字/スタンプを取得中...`,
				progress_building: `{emoji_count}個の絵文字と{sticker_count}個のスタンプが見つかりました...`,
				progress_analyzing: `{total}枚の画像を分析中...`,
				progress_saving: `結果をデータベースに保存中...`,
			},
		},
		},

		// 個人的なユーザー設定コマンド
		personal: {
			description: `あなたの個人的な設定を管理します`,
			privacy: {
				description: `個人記憶の保存とプライバシー設定を管理します`,

				// モーダルUI
				modal_title: `プライバシー設定`,
				select_label: `プライバシーレベル`,
				select_description: `プライバシー保護のレベルを選択してください`,
				select_placeholder: `プライバシーレベルを選択...`,

				// レベル 0 (最小限のプライバシー - 全機能)
				choice_minimal: `なし`,
				desc_minimal: `完全なパーソナライズ：記憶、ステータス、カスタムニックネーム、ボットのトリガーが可能。`,

				// レベル 1 (部分的なプライバシー)
				choice_partial: `部分的`,
				desc_partial: `メッセージは表示されますが、個人記憶/ステータスはAIに表示されません。`,

				// レベル 2 (完全なプライバシー - 最大限の保護)
				choice_full: `完全`,
				desc_full: `最大限のプライバシー：完全に非表示、メッセージ、記憶、ボットのトリガーはありません。`,

				// 成功/エラーメッセージ
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
				"value_choice_en-US": `英語`,
				value_choice_ja: `日本語`,
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
		},

		// Tomoriに教えるためのコマンド
		teach: {
			sampledialogue: {
				description: `私がどのように応答すべきかの例として、ユーザー/ボットの対話ペアを追加します。`,
				teaching_disabled_title: `サンプル対話の教育が無効です`,
				teaching_disabled_description: `現在、このサーバーではメンバーがサンプル対話を教える・取り除くことは許可されていません。\`サーバー管理\`権限を持つメンバーが\`/config memberpermissions\`でこれを有効にできます。`,
				modal_title: `サンプル対話の追加`,
				user_input_label: `ユーザーのセリフ`,
				user_input_description: `ボットへのサンプル質問`,
				user_input_placeholder: `好きな食べ物は何ですか？`,
				bot_input_label: `私の応答`,
				bot_input_description: `ボットがどのように応答すべきか`,
				bot_input_placeholder: `わ、わたしはマンゴーが好きです…`,
				limit_exceeded_title: `サンプル対話上限に達しました`,
				limit_exceeded_description: `このサーバーはサンプル対話の上限 {max_allowed} 個に達しました（現在 {current_count} 個）。新しいものを追加する前に、\`/forget sampledialogue\`でいくつかのサンプル対話を削除してください。`,
				success_title: `サンプル対話が追加されました`,
				success_description: `新しいサンプル対話ペアを正常に追加しました:

**ユーザー:**
> {user_input}

**私:**
> {bot_input}`,
			},
			attribute: {
				description: `このサーバーでの私を表す人格属性を追加します。`,
				teaching_disabled_title: `属性の教育が無効です`,
				teaching_disabled_description: `現在、このサーバーではメンバーが人格属性を教える・取り除くことは許可されていません。\`サーバー管理\`権限を持つメンバーが\`/config memberpermissions\`でこれを有効にできます。`,
				modal_title: `人格属性の追加`,
				modal_description: `このサーバーでの私の人格特性。名前のプレースホルダーとして使用する場合は\`{bot}\`を使用してください。`,
				attribute_input_label: `新しい属性`,
				attribute_input_placeholder: `{bot}はマンゴーが好き`,
				duplicate_title: `重複した属性`,
				duplicate_description: `この属性 '{attribute}' は既に私の属性リストにあります。`,
				limit_exceeded_title: `属性上限に達しました`,
				limit_exceeded_description: `このサーバーは属性の上限 {max_allowed} 個に達しました（現在 {current_count} 個）。新しいものを追加する前に、\`/forget attribute\`でいくつかの属性を削除してください。`,
				success_title: `属性が追加されました`,
				success_description: `'{attribute}' を私の人格属性に正常に追加しました。`,
			},
			memory: {
				description: `私の記憶を管理`,
				personal: {
					description: `どのサーバーでも私が覚えているあなたの個人的な記憶を追加します。`,
					modal_title: `個人的な記憶の追加`,
					modal_description: `どのサーバーでも私が覚えているあなたの記憶。`,
					memory_input_label: `新しい個人的な記憶`,
					memory_input_placeholder: `{user}はマンゴーが好き`,
					duplicate_title: `重複した個人的な記憶`,
					duplicate_description: `この記憶 '{memory}' は既にあなたの個人的な記憶にあります。`,
					limit_exceeded_title: `個人的な記憶の上限に達しました`,
					limit_exceeded_description: `あなたは個人的な記憶の上限 {max_allowed} 件に達しました（現在 {current_count} 件）。新しい記憶を追加する前に、\`/forget memory personal\`でいくつかの記憶を削除してください。`,
					content_too_long_title: `記憶の内容が長すぎます`,
					content_too_long_description: `記憶の内容が長すぎます。最大許容長は {max_length} 文字です。`,
					success_title: `個人的な記憶が追加されました`,
					success_description: `'{memory}' をあなたの個人的な記憶に正常に追加しました。`,
					success_but_disabled_description: `'{memory}' をあなたの個人的な記憶に正常に追加しました。

**警告:** 現在、このサーバーではパーソナライズが無効になっているため、この記憶はここでは使用されません。パーソナライズが有効になっている他のサーバーでは引き続き利用可能です。`,
					success_but_blacklisted_description: `'{memory}' をあなたの個人的な記憶に正常に追加しました。

**警告:** あなたは現在、このサーバーのパーソナライズ機能のブラックリストに登録されているため、この記憶はここでは使用されません。ブラックリストに登録されていない他のサーバーでは引き続き利用可能です。`,
					opted_out_error_title: `プライバシー保護が有効`,
					opted_out_error_description: `あなたはプライバシー上の理由から個人記憶の保存をオプトアウトしています。再び個人記憶を許可したい場合は、\`/personal privacy\`を使用してオプトインしてください。`,
				},
				server: {
					description: `私の知識ベースにサーバーの記憶を追加します。`,
					teaching_disabled_title: `サーバーの記憶の教育が無効です`,
					teaching_disabled_description: `現在、このサーバーではメンバーがサーバーの記憶を追加・取り除くすることは許可されていません。\`サーバー管理\`権限を持つメンバーが\`/config memberpermissions\`でこれを有効にできます。`,
					modal_title: `サーバーの記憶の追加`,
					modal_description: `このサーバーだけで私が覚えている記憶。`,
					memory_input_label: `新しいサーバーの記憶`,
					memory_input_placeholder: `このサーバーのメンバーはマンゴーが好き`,
					duplicate_title: `重複した記憶`,
					duplicate_description: `この記憶 '{memory}' は既にこのサーバーの私の記憶にあります。`,
					limit_exceeded_title: `サーバーの記憶の上限に達しました`,
					limit_exceeded_description: `このサーバーは記憶の上限 {max_allowed} 件に達しました（現在 {current_count} 件）。新しい記憶を追加する前に、\`/forget memory server\`でいくつかの記憶を削除してください。`,
					content_too_long_title: `記憶の内容が長すぎます`,
					content_too_long_description: `記憶の内容が長すぎます。最大許容長は {max_length} 文字です。`,
					success_title: `サーバーの記憶が追加されました`,
					success_description: `'{memory}' を私のサーバーの記憶に正常に追加しました。`,
				},
			},
		},

		// Tomoriに物事を忘れさせるためのコマンド
		forget: {
			sampledialogue: {
				description: `私の記憶からサンプルユーザー/ボットの対話ペアを削除します。`,
				modal_title: `サンプル対話の削除`,
				select_label: `削除する対話`,
				select_description: `削除する対話ペアを選択してください`,
				select_placeholder: `対話を選択...`,
				no_dialogues_title: `サンプル対話がありません`,
				no_dialogues: `削除するサンプル対話が保存されていません。\`/teach sampledialogue\`で追加してください。`,
				select_title: `サンプル対話の削除`,
				dialogue_label: `対話ペア`,
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
				no_attributes: `削除する人格属性がありません。\`/teach attribute\`で追加してください。`,
				select_title: `属性の削除`,
				attribute_label: `属性`,
				success_title: `属性が削除されました`,
				success_description: `属性を正常に削除しました: "{attribute}"`,
			},
			memory: {
				description: `私の記憶を管理`,
				personal: {
					description: `個人的な記憶を削除します。`,
					modal_title: `個人的な記憶の削除`,
					select_label: `削除する記憶`,
					select_description: `削除する個人的な記憶を選択してください`,
					select_placeholder: `記憶を選択...`,
					no_memories_title: `個人的な記憶がありません`,
					no_memories: `あなたには個人的な記憶が保存されていません。\`/teach memory personal\`で追加してください。`,
					select_title: `個人的な記憶の削除`,
					memory_label: `個人的な記憶`,
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
					no_memories: `このサーバーにはサーバーの記憶が保存されていません。\`/teach memory server\`で追加してください。`,
					no_owned_memories: `あなたが所有していて削除できるサーバーの記憶はありません。`,
					memory_not_found: `選択された記憶が見つかりませんでした。`,
					select_title: `サーバーの記憶の削除`,
					memory_label: `サーバーの記憶`,
					success_title: `サーバーの記憶が削除されました`,
					success_description: `サーバーの記憶を正常に削除しました: "{memory}"`,
				},
			},
		},

		generate: {
			image: {
				// コマンド
				description: "Google GeminiまたはOpenRouterを使用してAI画像を生成する",

				// モーダル
				modal: {
					title: "画像生成のリクエスト",
					prompt_label: "画像プロンプト",
					prompt_description: "生成したい画像を説明してください",
					prompt_placeholder:
						"バナナを食べている、ショートヘアの可愛いエルフの美少女、マンガ風",
					image_upload_label: "参照画像（オプション）",
					image_upload_description:
						"画像間生成のために参照画像をアップロードできます",
					aspect_ratio_label: "アスペクト比",
					aspect_ratio_description: "希望するアスペクト比を選択してください",
					aspect_ratio_placeholder: "アスペクト比を選択...",
				},

				// 成功埋め込み
				success_title: "🟢 画像生成が完了しました！",
				success_description: "AI生成画像の準備ができました！",
				field_prompt: "プロンプト",
				field_model: "モデル",
				field_generation_time: "生成時間",
				field_aspect_ratio: "アスペクト比",

				// エラー
				disabled_title: "🔴 画像生成が無効です",
				disabled_description:
					"このサーバーでは画像生成が無効になっています。`/config permissions` で有効にできます（管理権限が必要）。",
				wrong_provider_title: "🔴 サポートされていないプロバイダー",
				wrong_provider_description:
					"画像生成にはGoogle GeminiまたはOpenRouterが必要です。現在のプロバイダーは**{current_provider}**です。",
				no_api_key_title: "🔴 APIキーがありません",
				no_api_key_description:
					"APIキーが設定されていません。`/config apikey set`を使用してください。",
				api_key_decrypt_failed_title: "🔴 APIキーエラー",
				api_key_decrypt_failed_description:
					"APIキーの復号化に失敗しました。`/config apikey set`を使用して再設定してください。",
				no_diffusion_model_title: "🔴 画像モデルがありません",
				no_diffusion_model_description:
					"プロバイダーに対して画像拡散モデルが設定されていません。",
				error_billing_title: "🔴 課金が必要です",
				error_billing_description:
					"画像生成を使用するには、APIキーの課金を有効にする必要があります。",
				error_safety_title: "🔴 コンテンツがブロックされました",
				error_safety_description:
					"プロンプトが安全フィルターによってブロックされました。別のプロンプトを試してください。",
				error_generation_failed_title: "🔴 生成に失敗しました",
				error_generation_failed_description: "画像生成に失敗しました: {error}",
				invalid_image_title: "🔴 無効な画像",
				invalid_image_description:
					"有効な画像ファイル（PNG、JPGなど）をアップロードしてください。",
			},
		},
	},

	events: {
		// ボットがサーバーに追加されたときのメッセージ
		addBot: {
			rejoin_title: `TomoriBotが戻ってきました！`,
			rejoin_description: `このサーバーに再追加されたようです。以前の設定と人格はそのままです！\`/config\`、\`/teach\`、\`forget\`コマンドで私を管理できます。

			プロバイダーを変更したい場合は、\`/config apikeyset\`コマンドを使用してください。

			**TomoriBotを使用することで、[利用規約](https://github.com/Bredrumb/TomoriBot/blob/main/legal/ja/terms-of-service.md)と[プライバシーポリシー](https://github.com/Bredrumb/TomoriBot/blob/main/legal/ja/privacy-policy.md)に同意したことになります。**\`/legal terms\`と\`/legal privacy\`でいつでも確認できます。`,
			setup_prompt_title: `TomoriBotの追加が完了しました`,
			setup_prompt_description: `追加してくれてありがとうございます！始めるには、**サーバー管理**権限を持つ方が\`/config setup\`コマンドを実行して、私の初期の人格を選択し、AI機能を設定する必要があります。

			選択したAIプロバイダーのAPIキーの作成方法が不明な場合は、\`/help apikey\`コマンドを使用してください。APIキーは暗号化されて保存されますが、公開されているDiscordボットに提供することに不安がある場合（通常そうあるべきです）、[リポジトリのガイド](https://github.com/Bredrumb/TomoriBot)を使用してご自身でTomoriBotを実行することもできます。

			**TomoriBotを使用することで、[利用規約](https://github.com/Bredrumb/TomoriBot/blob/main/legal/ja/terms-of-service.md)と[プライバシーポリシー](https://github.com/Bredrumb/TomoriBot/blob/main/legal/ja/privacy-policy.md)に同意したことになります。**\`/legal terms\`と\`/legal privacy\`でいつでも確認できます。`,
		},
	},

	// リマインダーシステムメッセージ
	reminders: {
		// リマインダー設定時の確認埋め込み
		reminder_set_title: `⏰ リマインダー設定完了`,
		reminder_set_description: `{user_nickname}さんに「**{reminder_purpose}**」について\`{reminder_time}\`にリマインドします`,
		reminder_set_footer: `{time_remaining}後にメンションを送信します。`,

		// リマインダー配信失敗時のエラー埋め込み（実行時のユーザー向けメッセージのみ）
		reminder_error_title: `リマインダー配信失敗`,
		reminder_error_description: `{user_mention}さんの「**{reminder_purpose}**」のリマインダーに問題が発生しました: {error_reason}。{lateness}。`,
		reminder_error_footer: `技術的問題により手動でリマインダーを配信しました。`,
	},
};
