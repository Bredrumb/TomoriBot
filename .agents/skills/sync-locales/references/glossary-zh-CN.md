# Glossary: Simplified Chinese (zh-CN)

## Conventions

- **Register**: 使用大陆简体中文的书面口语体，句子求短、求直白，贴近 Discord 中文用户的日常说法。不用文言腔，不用港台地区用语（如「伺服器」「使用者」「訊息」「貼圖」）。
- **Addressing the user**: 一律用「你」，不用「您」。bot 自称「我」；提到 Tomori 时按英文 she 用「她」，或用名字。管理员与普通成员不区分称谓，不用「阁下」「亲」这类称呼。
- **Sentence types**: 错误提示先讲发生了什么，再讲用户可以做什么（例如「我现在连不上数据库，请稍后再试」）。不堆感叹号。
- **Capitalization**: 中文没有大小写。英文专有名词和产品名保持原样且大小写照抄：`TomoriBot`、`Tomori`、`Discord`、`OpenRouter`、`NovelAI`、`ElevenLabs`、`ComfyUI`、`Ollama`、`LM Studio`、`pgvector`、`BYOK`。
- **Discord UI labels**: 面板路径（例如 Models > Switch Models）、按钮和字段名、链接与卡片标题，一律采用本 locale 自己的 `src/locales/zh-CN/` 译值，不得临时另译。斜杠指令、参数名、代码、标识符、URL、环境变量保持英文：`/config`、`/persona create`、`/providers`、`{user_nickname}`、`STM`。
- **Punctuation**: 正文用全角标点（，。：；！？「」（））。中英夹杂时不加空格。代码、指令和英文原名用反引号包住。不使用破折号或连接号代替标点。百分比写「90%」，范围写「1 到 100 秒」。
- **Plural**: 中文不标复数。需要强调多个时加「多个」「几位」「数个」或具体数量，例如 server memories 写「服务器记忆」即可，不写「服务器记忆们」。英文的 `(s)` 一律去掉，按名词补量词，量词不随数值变化，例如 `{count} message(s)` 写成 `{count} 条消息`。
- **Gender**: 人称和身份名词尽量中性。用户性别未知时写「对方」或「该成员」，不默认「他」。人格之间的称呼规则见术语表的 main persona 与 alter 两行。
- **Term scope**: 本表以用户可见文字的译法为准。代码内部标识符（字段名、类型名、DB 列名）不翻译，仅供对照，不列入本表。

## Terminology

| English Term | Chosen Translation | Usage Note |
|---|---|---|
| persona | 人格 | RP 社群既有说法，指 bot 扮演的角色。人格名字（`Mirri`、`Juno`）是专名，不译。**性格与人格的分工**：指成员本人、心理学意义上的性格时用「性格」；指 bot 扮演对象时用「人格」，包括 `personality presets`（「人格预设集」）、`Personality Preset`、`Default Persona`。唯一的例外是 `page_persona_general: Identity & Personality`，按页面标题的既有读法写「身份与性格」。判断标准是看它指的是不是扮演对象，而不是看英文用了哪个词。 |
| default persona | 默认人格 | `/persona default` 的目标（`type_choice_default`），指当前的主人格槽位。不要与 server default 的「服务器默认」混用，也不要写成「默认人设」。 |
| alter / alter persona | 副人格 | 对应 UI 的 Alter persona（`role_alter`），指不占用服务器身份的那一个，与「主人格」成对使用。首次出现可写「副人格（alter）」，之后用「副人格」。 |
| main persona | 主人格 | 对应 UI 的 Main persona（`role_main`），指占用服务器身份和头像的那一个。不要写「主要人格」。 |
| server default | 服务器默认 | 名词用「服务器默认」，需要名词化时写「服务器默认值」。不可与 preset 的译法混用。 |
| personal override | 个人覆盖 | 跟随用户跨服务器生效的覆盖设置（概念名，`personal.ts` 的 `models_description: Personal overrides follow you across servers.`）。UI 上的具体标签是 Persona override / Channel override / Text Model Override，分别写「人格覆盖」「频道覆盖」「文本模型覆盖」。 |
| provider | 提供方 | AI 后端服务（Google、OpenRouter、NovelAI、Custom 等）。官方客户端用「提供方」；同一段文字内不要混用「供应商」「提供者」。 |
| model | 模型 | 一般技术名词。模型代号如 `kayra-v1`、`llama-3-erato-v1` 保持原文。 |
| memory | 记忆 | 单条记忆称「一条记忆」。不用「内存」（那是 RAM）。 |
| server memory | 服务器记忆 | 全服务器共用的长期记忆。 |
| personal memory | 个人记忆 | 跟随用户跨服务器的记忆。 |
| short-term memory | 短期记忆 | 指 STM 时写「短期记忆（STM）」，之后用「短期记忆」。不用「短期内存」。面板上的固定搭配按缩写落地，与来源一致：面板小标题 `stm_parameters_title: Short-Term Memory Parameters` 写「短期记忆参数」，按钮 `edit_stm_parameters_button: Edit STM Parameters` 写「编辑 STM 参数」，另有「STM 分类」「STM 提示词」。同页出现标题与按钮两种写法时不要各自改写。 |
| teach / teaching | 教导 | 用户主动写入记忆或知识的动作，涵盖 `/teach` 的五个子指令：sample dialogue、attribute、document、persona prompt、memory。名词化写「教导功能」，成员权限里的禁用提示写「教导已关闭」。不用「教学」（偏课堂义）。 |
| tag | 标签 | 来源标签只有 `image_tags_title: Image Tags`（「图像标签」）与 `memory_tagging_label: Memory tagging`（「记忆标签」），没有独立的 Channel Tags 标签，所以不要写「频道标签」。不用「标记」（易与 Markdown 与批注语义混淆）。 |
| category | 分类 | 两个意思要分开：Discord 的频道分类写「频道分类」，短期记忆的分类写「分类」（`STM Categories` 写「STM 分类」）。 |
| timezone | 时区 | 面板标题 Server Timezone 写「服务器时区」，决定回复与提醒使用哪个本地时间。 |
| UTC offset | UTC 偏移 | 与「时区」不可混用。字段 `UTC offset` 收的是整数小时数（例如 `8`、`-5`），不是时区名，校验提示也要按整数小时写。 |
| trigger | 触发 | 统称用「触发」，页面标签 `page_persona_triggers` 写「触发设置」。细分必须逐项定：「自动触发」（Auto-Trigger）、「随机触发」（Random Trigger）、「触发冷却」（Trigger Cooldown）、「触发匹配」（Trigger Matching）、「级联上限」（Cascade limit）、「匹配上限」（Match limit）、「触发行为」（Trigger Behavior）、「始终回复」（Always Reply）、「⚅ Random」写「随机」。不要与「触发词」混用，后者只指词。 |
| trigger word | 触发词 | 让某个人格加入对话的词。不用「关键词」。 |
| sticker | 贴纸 | Discord 官方大陆简中译法「贴纸」，与 emoji 的「表情」是两个不同功能，不要互换。不用「表情包」，也不要写「贴图」（繁体「貼圖」是台湾译法）。 |
| sprite | 立绘 | 人格的表情图片，社群惯称「立绘」，来源里另有人格级写法的 `sprites_title: Persona Sprites`，写「人格立绘」。不要用带「表情」的备选说法，那会与 emoji 的「表情」冲突。 |
| voice design | 语音设计 | 用 VoiceDesign 提示词控制音色。`VoiceDesign` 作为产品名保持英文，说明文字里的 `Voice Design Prompt` 写「语音设计提示词」。 |
| transcription | 转写 | 语音转文字。`Speech to Text` 与 `STT` 写「语音识别」，`Reference transcript` 写「参考文本」。 |
| Chatterbox | Chatterbox | 产品名保持英文。`Chatterbox fast model` 写「Chatterbox 快速模型」，`Voice Cloning & Library` 写「语音克隆与语音库」。 |
| humanizer | 回复自然度 | 控制回复自然程度的档位（0 到 3），同时被人格覆盖设置引用（`response_style_title`、`response_style_description`）。面板标签 Humanizer 写「回复自然度」，弹窗标题 Humanizer Degree 写「回复自然度数值」，`Humanizer Level` 写「回复自然度等级」，三种不要混成同一个词。不写「拟人化」，该词会被理解成把 bot 变成人的功能。 |
| capability | 功能 | 指 bot 可使用的功能与工具集合（UI 的 Bot Capabilities 译作「bot 功能」）。权限另有其词，见 permission；模型能力（Tool Calling、Image Input 等）写「能力」，两级用词不要混。 |
| tool | 工具 | 模型可调用的函数。工具名保持英文。 |
| cooldown | 冷却 | 设置项名称用「冷却」，讲到等待秒数时写「冷却时间」。下拉选项（`cooldown_*`）写「关闭」「按用户」「按频道」「全服务器」「严格全服务器」；页脚提示（`message_cooldown_footer_*`）在同样说法前加前缀，写「服务器设置：按用户」等，两处用词必须完全一致。不写「冷却期」。 |
| self-hosting | 自部署 | 大陆通行说法，动词写「自部署」，名词写「自部署实例」。也见「自托管」，但本 locale 统一用「自部署」，不写「自架设」。 |
| BYOK | BYOK | 缩写保留英文，首次出现写「BYOK（bring your own key，自备密钥）」。UI 标签 User BYOK 译作「用户 BYOK」。 |
| webhook | Webhook | 保留英文，Discord 中文社群直接说 webhook。权限标签 Manage Webhooks 写「管理 Webhook」，全篇只用这一个说法，不写「网络钩子」。 |
| preset | 预设集 | 可应用的现成配置，UI 按钮 Apply Preset 写「应用预设集」。人格预设集写「人格预设集」，系统提示词预设集写「系统提示词预设集」。不要只写「预设」，会与 server default 的「服务器默认」撞词。 |
| lineage | 记忆谱系 | 共用同一份记忆的一组人格或作用域（DB 的 persona lineage），出现在 `/memories` 与 `/personal` 的共享计数里，也出现在导入记忆的目的地选择里。首次出现写「记忆谱系（lineage）」，之后可用「谱系」。不写「同源人格」。 |
| deliberate trigger mode | 明确触发模式 | 对应 UI 的 Deliberate Trigger Mode（DTM），首次出现可写「明确触发模式（DTM）」。不用「刻意」。 |
| deliberate tool mode | 明确工具模式 | 对应 UI 的 Deliberate Tool Mode。 |
| attributes | 属性 | 人格的性格事实条目。不用「特质」。 |
| sample dialogue | 示例对话 | 用户消息与人格回复成对出现。不用「对话样例」。 |
| response style | 回复风格 | 人格覆盖服务器回复自然度档位的设置。 |
| thought log | 思考日志 | 服务器日志频道里的推理内容。不用「思维记录」。 |
| conditioning | 奖励与惩罚 | `/reward` 与 `/punish` 累积的偏好。名词统一用「奖励与惩罚」，分组写「奖励与惩罚组」，动词写「调整偏好」（例如「用 `/reward` 或 `/punish` 调整偏好」）。不写「条件训练」，UI 里没有训练这个动作。 |
| endpoint | 端点 | 自定义 API 地址。不用「端点服务」，赘字。 |
| sampler | 采样器 | 大陆软件圈用「采样」。温度、top-p 等项目统称「采样参数」。 |
| fallback model | 备用模型 | 主模型失败后依次尝试的模型。不用「回退模型」。 |
| randomizer | 模型随机 | UI 的 Model Randomizer 标签写「模型随机」，全篇只用这一个说法，不用「随机模型」。 |
| permission | 权限 | Discord 权限（Manage Server、Manage Webhooks 等）。不要与「功能」互换。 |
| server | 服务器 | 大陆标准用语。不要写「伺服器」。 |
| channel | 频道 | 文字频道、子区（thread）分别写「频道」「子区」。 |
| role | 身份组 | Discord 的 role 在大陆简中客户端是「身份组」。不要用「角色」（保留给 RP 意义的角色）。 |
| member | 成员 | 服务器成员。 |
| user | 用户 | 不要写「使用者」。 |
| avatar | 头像 | 人格或服务器的显示图片。 |
| message | 消息 | 不要写「訊息」。 |
| document | 文档 | RAG 知识库的文件。 |
| context | 上下文 | 提示词中的上下文。指代码内部的 context 对象时保持英文。 |
| prompt | 提示词 | 系统提示词、人格提示词、频道提示词。不用「提示语」。 |
| system prompt | 系统提示词 | 所有人格共同遵循的指令。 |
| context note | 上下文提醒 | 插在提示词靠近末尾位置的短提醒。UI 的 Context Reminder 同此译法。不要缩写成「提醒」，那是 reminder（`/scheduled-task`）的译法。 |
| self-teaching | 自我教导 | bot 自己从服务器对话里学习（`Self-Teaching`，`Learn from server conversations`），与 teach 的「用户教导 bot」方向相反，两个词不要互换。 |
| warning | 警告 | 这是消息与弹窗里的前缀写法，不是功能名。来源里的 `Warning:` 一律写「警告：」，用于破坏性操作与状态提示（`stm_categories_disclosure_modal: Warning: saving clears active STM in {scope}.`、`alter_avatar_warning`）。一般性提醒写「注意」。不要写成「敏感提示」。 |
| nsfw content | NSFW 内容 | 年龄限制内容的统称（`plugins_nsfw_jailbreaks_title` 与页面选择器 `page_plugins_nsfw_jailbreaks`，两处英文都是 `NSFW Content`）。NSFW 保持英文。需要单独指年龄门槛时写「年龄限制」。 |
| welcome messages | 欢迎消息 | 新成员入群时的问候（Welcome Messages、Welcome channel、Welcome persona、Welcome prompt），统称用「欢迎消息」，不用「迎新」。 |
| reminder | 提醒 | 定时发送的消息（`/scheduled-task`）。名词统一用「提醒」，重复执行的写「重复提醒」。与「上下文提醒」不是一回事，见 context note。 |
| nickname | 昵称 | Discord 服务器昵称。称呼本身写「称呼」，人格如何称呼别人的规则写「称呼习惯」。 |
| Direct Message | 私信 | 首次出现写「私信（DM）」，之后用「私信」。不用「私聊」（指会话行为），也不用「短信」。 |
| character card | 角色卡 | SillyTavern / CHARX 角色卡是既有叫法，这里的「角色」是固定搭配，不违反 role 译作「身份组」的规定。 |
| image generation | 图像生成 | 用「图像」不用「图片」。模型槽位对应 `capability_*`：文本 / 视觉 / 嵌入 / 标准图像 / NovelAI 图像 / 视频 / 语音合成 / 语音识别。 |
| video generation | 视频生成 | 与「图像生成」成对。 |
| voice sample | 语音样本 | 本地上传的参考音频。 |
| speech transcript | 语音转写 | 语音消息对应的文字稿。`Reference transcript` 是固定搭配「参考文本」，语音输出的文字稿一律写「语音转写」。 |
| logit bias | 词元偏置 | 两种写法只能选一种：用中文时词条写「词元偏置条目」，保留英文时写「Logit Bias 条目」（`logit_manage_checkbox_label: Logit Bias Entries`）。 |
| stop string | 停止字符串 | 让生成提前结束的字符串；另有 Speaker Pattern，写「说话人模式」。 |
| rate limit | 速率限制 | 与「冷却」不是同一件事：速率限制是自动保护的拒绝，冷却是服务器设置的等待时间。 |
| quota | 配额 | 每日用量上限，与「速率限制」分开。 |
| notice embed | 提示嵌入 | 回复下方的过程提示。`Embedding` 模型槽位写「嵌入」，端点写「嵌入端点」；「提示嵌入」不得缩写成「嵌入」，也不引入「向量嵌入」。 |
| workaround | 兼容处理 | 面板标题 `compatibility_title: Compatibility` 写「兼容性」，其中的单项写「兼容处理」（`edit_workarounds_button: Edit Workarounds` 写「编辑兼容处理」）。不用「变通方法」。 |
| blocklist | 屏蔽名单 | 跨频道工具不可进入的频道（`channels_rules_blocklist_title: Cross-Channel Blocklist` 写「跨频道屏蔽名单」）。不要写成「白名单」，两者含义相反。 |
| whitelist | 白名单 | 与「屏蔽名单」是两个功能，不要互换：管理面板的频道与身份组白名单是允许清单，跨频道屏蔽名单是禁止清单。 |
| private channel | 私密频道 | 短期记忆与思考日志不外流的频道。 |
| roleplay channel | 角色扮演频道 | 抑制表情与贴纸、启用 `/tool delete turn` 的频道。 |

## UI label mapping

面板与按钮名称必须取自本 locale 的 `src/locales/zh-CN/`，本表为基准译值，实现时以 locale 文件为准。
本表只收真实存在的 en-US 标签；概念名（例如 personal override）只在术语表里出现，不列在这里。
Manage Server 与 Manage Webhooks 是 Discord 权限名而不是面板标签，两行的中文必须与 Discord 简中客户端一致（与第 11 项同一个待验证依赖）。

| English label | zh-CN label |
|---|---|
| Main persona | 主人格 (`persona_main`, `role_main`) |
| Default Persona | 默认人格 (`type_choice_default`) |
| Alter persona | 副人格 (`persona_alter`, `role_alter`) |
| Server default | 服务器默认 |
| Persona override | 人格覆盖 |
| Channel override | 频道覆盖 |
| Text Model Override | 文本模型覆盖 |
| Persona | 人格 |
| Behavior | 行为 |
| Plugins | 插件 |
| Channels | 频道 |
| Permissions | 权限 |
| Models | 模型 |
| Switch Models | 切换模型 |
| Identity & Personality | 身份与性格 |
| Triggers | 触发设置 |
| Memories | 记忆 |
| Overrides | 覆盖 |
| Sprites | 立绘 (`page_persona_sprites`；`sprites_title` 实际是「Persona Sprites」，写「人格立绘」) |
| Bot Capabilities | bot 功能 |
| Tool Use | 工具使用 |
| Available Tools | 可用工具 |
| Long-Term Memory | 长期记忆 |
| Short-Term Memory | 短期记忆 |
| Server Memories | 服务器记忆 (`open_server_memories_button`；`server_memory_count` 是整句「服务器记忆：{count}」) |
| Personal Memories | 个人记忆 (`open_personal_memories_button`；`personal_memory_count` 是整句「你的个人记忆：{count}」) |
| Trigger Words | 触发词 |
| Attributes | 属性 |
| Sample Dialogues | 示例对话 |
| Humanizer | 回复自然度 |
| Humanizer Degree | 回复自然度数值（`humanizer.modal_title` 实际值是 `Set Humanizer Degree`，独立标签见 `setup.ts` 的 `settings_humanizer_label`） |
| Humanizer Level | 回复自然度等级（`humanizer.select_label`） |
| Apply Preset | 应用预设集 |
| NSFW Content | NSFW 内容 (`page_plugins_nsfw_jailbreaks`, `plugins_nsfw_jailbreaks_title`) |
| Manage Server | 管理服务器 |
| Manage Webhooks | 管理 Webhook |
| User BYOK | 用户 BYOK |
| Self-Teaching | 自我教导 |

## Names and literal strings

- `Tomori`、`TomoriBot` 是专有名称，任何情况都不翻译。`general.defaults.bot_name` 的默认值保持 `Tomori`。
- 人格名称（`Mirri`、`Juno`、`Bau (@bau_h)` 等）是专有名称，不翻译、不改写、不加音译。
- 斜杠指令路径、选项名、环境变量、URL、模型代号、提供方名称保持英文。
- 基础触发词 `tomori`、`tomo` 保持英文小写，翻译时不得改成中文。
- `STM`、`DTM`、`BYOK`、`TTS`、`STT`、`NSFW`、`MCP`、`RAG` 等缩写保留英文，顺序统一为中文在前、缩写括注在后，例如「短期记忆（STM）」「明确触发模式（DTM）」。首次出现之后用哪一个，逐个词在术语表里写明：「短期记忆」按术语表用中文，「STM 分类」「STM 参数」等固定搭配用缩写，不在同一段里两种混用。

