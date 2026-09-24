# Glossary: Japanese (ja)

## Conventions
- **Register**: Polite (です/ます). The bot interface addresses users respectfully.
- **Addressing the user**: Using `{user_nickname}さん` (e.g., `{user_nickname}さんに...`).
- **Katakana long vowels**: Prolonged sound marks are retained (e.g., ユーザー, サーバー, プロバイダー).
- **Punctuation**: Full-width Japanese punctuation (、 。 ！ ？) is used.
- **Spacing**: No space between Japanese characters and Latin text/numbers (e.g., `APIキー`, `Webhookの管理権限`), as seen in existing shipped strings.
- **Proper names**: "Tomori" and "TomoriBot" stay in Latin script in UI and docs prose (39 shipped uses). `ともり` is only the value of `general.defaults.bot_name`, the default display nickname, and is not a replacement in prose. Persona names are proper names.
- **Rejected renderings**: ステッカー, ケーパビリティ, and 個人用オーバーライド each contradict shipped ja usage (see rows).

## Terminology

| English Term | Chosen Translation | Usage Note |
|---|---|---|
| persona | ペルソナ | Established term in `ja` locale. |
| alter / alter persona | オルタ / オルタペルソナ | Established term in `ja` locale. |
| main persona | メインペルソナ | Established term in `ja` locale. |
| server default | サーバーデフォルト | Standard technical term; "サーバーのデフォルト" is also acceptable. |
| personal override | 個人設定 | Established (11 shipped uses). When the override meaning must be explicit, write 個人設定で上書き. |
| provider | プロバイダー | Established term in `ja` locale. |
| model | モデル | Standard technical term. |
| memory | 記憶 | Established term in `ja` locale. |
| server memory | サーバーの記憶 | Established term in `ja` locale. |
| personal memory | 個人の記憶 | Established term in `ja` locale. |
| short-term memory | 短期記憶 | Established term in `ja` locale. |
| teach | 教える | Standard verb. Ambiguous if it should be more specific like "記憶させる" (unconfirmed by a native speaker). |
| trigger word | トリガーワード | Established term in `ja` locale. |
| sticker | スタンプ | Discord's own Japanese client calls stickers スタンプ; established (19 shipped uses, 1 stray ステッカー). |
| sprite | スプライト | Established term in `ja` locale. |
| humanizer | ヒューマナイザー | Kept as phonetic Katakana; unconfirmed whether "人間味" is better. |
| capability | 機能 | Established (43 shipped uses; ケーパビリティ never shipped). Use 権限 only for Discord permissions, never for capabilities. |
| tool | ツール | Standard technical term. |
| cooldown | クールダウン | Established term in `ja` locale. |
| self-hosting | セルフホスト | Standard technical term. |
| BYOK | BYOK | Acronym kept in English (Bring Your Own Key). |
| webhook | Webhook | Established term in `ja` locale. |
| preset | プリセット | Standard technical term. |
| lineage | 派生元 | Meaning "origin" or "lineage" in context of presets/personas. "系譜" or "Lineage" could be used. Unconfirmed by a native speaker. |
| deliberate (trigger/tool mode) | 明示的 | Matches the shipped UI labels 明示的トリガーモード and 明示的ツールモード; docs follow the UI. |
