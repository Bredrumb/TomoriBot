# Glossary for vi (Vietnamese)

## Localization Rules

* The bot refers to itself as **`mình`** and addresses the user as **`bạn`**. The pair
  reads as a friendly peer. Rejected and not to be
  reintroduced: `tôi/bạn` (cold, corporate, customer service), `em` with `anh`/`chị` (imposes an age and
  gender hierarchy that changes per user and makes the bot subservient), `tớ/cậu` (Northern youth slang,
  jarring for adult communities), `tao/mày` (vulgar), `quý khách` (e-commerce).
* The address pair does not change per persona. A bratty or a shy persona varies its tone, sentence
  length and particles, never its pronouns: switching pronouns per persona would make the same user
  addressed inconsistently across a server, which reads as an error rather than as characterisation.
* Full diacritics everywhere in user-facing prose. The one exception is intent detector packs, which
  must register both the diacritic and the undiacritic spelling of every phrase, because Vietnamese
  users routinely type without diacritics (`nho` alongside `nhớ`). This mirrors what es-419 did with
  `acuérdate` and `acuerdate`.
* Loanword policy: keep the English term when Vietnamese Discord and AI communities say the English
  term in ordinary conversation (`persona`, `model`, `sticker`, `preset`, `webhook`, `sprite`,
  `cooldown`). Translate when a fully nativised Vietnamese term already exists and is what the platform
  itself shows (`máy chủ`, `bộ nhớ`, `công cụ`, `nhà cung cấp`). Do not calque a term into a long
  descriptive phrase: Vietnamese runs longer than English and the Discord caps are tight.
* Capitalization follows Vietnamese rules, which means sentence case. Do not apply English title case to
  headings, buttons or labels. Proper nouns and acronyms keep their own casing.
* Vietnamese has no plural inflection, so a count is carried by the numeral and a classifier
  (`3 persona`, not a pluralised noun). Do not invent a plural suffix. A bare UI label needs no
  classifier; a sentence with a count does.
* Tomori and all persona names are proper names and never change.
* No em dashes, en dashes, or spaced double hyphens in Vietnamese prose. Use a colon when the second
  half explains the first, a comma plus a connective when causal, parentheses for an aside, or a period
  between independent clauses.

## Terminology Glossary

| English Term | Chosen Translation | Usage Note |
|---|---|---|
| persona | persona | `nhân vật` means a fictional character and collides with Discord members; `nhân cách` is clinical. |
| alter | alter | A secondary persona. Kept in English to match every other locale in this programme, including es-419 and zh-TW. `bản thể` was proposed once and reads as a philosophical essence. |
| main persona | persona chính | |
| server | máy chủ | A Discord server (guild). This is the term the Discord client itself shows in Vietnamese, so the bot's words match the interface around them. Casual speech says "server", which is acceptable inside persona dialogue but not in panel, command or error text. |
| server default | mặc định của máy chủ | The baseline settings applied to the whole server. |
| personal override | tùy chỉnh cá nhân | A user's own setting that replaces a server default. **Not** `ghi đè cá nhân`: `ghi đè` is literally "overwrite" and reads as data loss. es-419 made the same call, choosing `ajuste personal` over a literal "override". |
| provider | nhà cung cấp | The service hosting the AI model. |
| model | model | The underlying AI model. Vietnamese AI and developer communities say "model"; `mô hình` reads as an abstract model in a short dropdown. |
| memory | bộ nhớ | |
| server memory | bộ nhớ máy chủ | Memories shared across the entire server. |
| personal memory | bộ nhớ cá nhân | Memories belonging to one user. |
| short-term memory | bộ nhớ ngắn hạn | |
| teach | dạy | The `/teach` command. **Not** `ghi nhớ` ("memorise"), which collides with `bộ nhớ` and blurs the distinction between the act of teaching and the stored result. |
| trigger word | từ kích hoạt | |
| sticker | sticker | What Vietnamese Discord users say. Discord's own Vietnamese interface may render this as `nhãn dán`; if a native reviewer confirms that, switch for consistency with the client, the same reasoning that decided `máy chủ`. |
| sprite | sprite | A persona expression image. No concise Vietnamese equivalent. |
| humanizer | humanizer | The feature that makes output read as less robotic. Kept in English: the descriptive alternative offered was six syllables and would breach the 100 character description cap. |
| capability | tính năng | A toggleable bot feature. Chosen for brevity under the Discord caps. `khả năng` is closer to "capability" in the abstract, and a reviewer should confirm `tính năng` does not read as a plain "feature" in panels that list capabilities and tools side by side. |
| tool | công cụ | Distinct from `tính năng`: a tool is something the model calls. |
| cooldown | cooldown | The wait before the bot can be triggered again. **Not** `thời gian chờ`, which reads as a timeout rather than a throttle. es-419 rejected its exact cognate `tiempo de espera` for this reason. Vietnamese gamers say "cooldown". |
| self-hosting | self-hosting | Running the bot on your own hardware. `tự lưu trữ` is ambiguous with file storage; `tự host` is a hybrid that Vietnamese developers do say. Kept in English because the audience for these pages reads English documentation anyway. |
| BYOK | BYOK | Bring Your Own Key. Expand on first use in prose. |
| webhook | webhook | Standard Discord term, never translated. |
| preset | preset | A saved configuration that can be imported or applied. |
| lineage | nguồn gốc | The origin and version history of a persona or preset. `phả hệ` was proposed once and reads as biological genealogy. |

