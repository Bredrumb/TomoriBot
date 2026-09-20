---
title: "提供方与模型"
sidebar:
  order: 1
---

TomoriBot 没有内置的 AI 模型，你需要从一个提供方接一个进来。**提供方**是一项 AI
服务（Google Gemini、OpenRouter、NovelAI、本地端点……），而**模型**是该提供方上的一个
具体模型。你至少需要一个提供方才能使用她。

## API 密钥 {#api-keys}

在首次设置时用 `/setup` 添加提供方密钥，或者之后用 `/providers` 选择
**+ 添加新提供方**。密钥会在**静态存储时加密**，所以没有任何人，包括服务器管理员，能把它
读回来。

`/setup` 会先问回复应该怎么到达模型，这个答案决定了它
收集什么：

| 模式 | 它收集什么 |
|---|---|
| **AI Provider (Recommended)** | 从目录里选一个提供方，加上它的 API 密钥，校验并加密为草稿。 |
| **Custom Endpoint (Advanced)** | 端点的连接信息和一个文本模型，都在向导里登记。见[自定义端点](#自定义端点)。 |
| **User BYOK**（仅服务器） | 什么都不收集：工作区不保有自己的提供方，所以成员必须自备个人提供方。 |

在按下 **Finish Setup** 之前不会写入任何东西，所以一个被放弃或过期的向导不会动到工作区
已有的提供方记录。要替换已经存好的密钥，请用 `/providers`，因为
`/setup` 会拒绝在已经配置好的工作区上运行。

每个提供方都有自己的密钥获取步骤。运行 **`/help`**，选择 **设置**，再选 **获取 API 密钥**，然后挑你的
提供方看确切的讲解，或者用下面这些起点：

| 提供方 | 说明 | 获取密钥 |
|---|---|---|
| **Google Gemini** | 有免费档位，能跑所有功能。推荐的首次设置选择。 | [AI Studio](https://aistudio.google.com/apikey) |
| **OpenRouter** | 一把密钥，许多模型（有些免费）。 | [OpenRouter keys](https://openrouter.ai/settings/keys) |
| **NovelAI** | 订阅制；无审查的故事创作与角色扮演（仅文本）。 | [NovelAI](https://novelai.net/) |
| **DeepSeek** | 按量付费的推理模型。 | [DeepSeek](https://platform.deepseek.com/api_keys) |
| **NVIDIA NIM** | 托管式文本、嵌入与图像。 | [NVIDIA Build](https://build.nvidia.com/) |
| **Anthropic** | 通过 API 使用 Claude 模型（不是 Claude Code）。 | 无 |
| **Z.ai** | GLM 系列。⚠️ 服务条款把使用限制在编码与智能体场景。 | [Z.ai](https://z.ai/) |
| **Vertex AI** | 通过 `gcloud` ADC 访问 Google Cloud（最适合本地运行与开发环境）。 | 见下文 |
| **Vertex AI Express** | Google Cloud API 密钥 BYOK（预览，Gemini 子集）。 | [Express Mode](https://console.cloud.google.com/expressmode) |
| **Custom** | 任何 OpenAI 兼容端点（Ollama、vLLM、LiteLLM……）。 | 见[自定义端点](#自定义端点) |

:::caution
永远不要把你的 API 密钥分享给别人。要添加或替换自定义端点的 Bearer 认证令牌，请用 `/providers` 里的
**编辑端点** 操作。
:::

**Vertex AI** 用应用默认凭据（ADC）认证，而不是存下来的密钥。
本地托管时，ADC 可以来自 `gcloud`；托管部署应该用工作负载身份
或服务账号。只有 AI Studio 的 API 密钥无法认证完整的 Vertex AI。所选
项目必须已启用结算和 Vertex AI API，宿主身份也需要有 Vertex 访问权限。
设置指南可以从 `/help` 的 **API 密钥** 页面里的 **Google Vertex AI** 打开。

Google 系提供方的设置会通过需要认证的模型列表端点来校验凭据。它
不会生成文本，也不依赖当前哪个聊天模型被标为
目录默认值，所以一个已下线的默认值不会妨碍有效凭据被保存。

### 可选：Brave Search 密钥

Brave Search 与你的 AI 提供方是分开的，只用来增强网页搜索（增加图像、
视频和新闻搜索）。用 `/providers` 设置它。⚠️ Brave 每月含 5 美元
免费额度，所以请在 Brave 后台设置 5 美元的用量上限，以免产生扣费。

## 选择模型

`/providers` 管理服务器凭据、模型目录和端点登记，而
`/config` > 模型 > 切换模型 选择这个服务器每位成员共用的功能指派。两者都需要所需的服务器权限。
个别成员用 `/personal providers` 管理自己的凭据
和模型目录，然后在 `/personal config` 里选择个人模型。
个人设置会跟着他们走过每个使用 TomoriBot 的服务器。那一边的说明见
[个性化](/zh-CN/features/knowledge/personalization/#your-own-providers)。

两个面板分别命名为 **服务器提供方** 和 **个人提供方**，这样在指令交互打开之后，它们的归属关系仍然看得清。

设置好提供方之后，用 `/config` > 模型 > 切换模型 选择共用的功能指派。
六个普通槽位从提供方目录里挑选模型记录：

- `/config` > 模型 > 切换模型：主聊天模型
- `/config` > 模型 > 切换模型：视觉模型（在聊天模型读不了图像时用来读图）
- `/config` > 模型 > 切换模型：用于[文档知识库](/zh-CN/features/knowledge/memory/#document-knowledge-base-rag)的嵌入
- `/config` > 模型 > 切换模型：标准图像生成（见[图像生成](/zh-CN/features/capabilities/media-generation/image-generation/)）
- `/config` > 模型 > 切换模型：NovelAI 图像生成
- `/config` > 模型 > 切换模型：视频生成
- `/config` > 模型 > 切换模型：文本转语音（TTS）端点
- `/config` > 模型 > 切换模型：语音转文字（STT）端点

前六个条目选择的是模型目录记录。TTS 和 STT 槽位选择的是工作区范围的
端点，所以它们激活的是所选端点，而不是写入一个模型列。在 `/providers` 里登记
和编辑这些端点；它的端点激活控件仍然有效。`/personal config`
保留六个个人模型路由槽位，不新增个人 TTS 与 STT 端点选择器。

你也可以用 `/providers` 管理这个服务器的备用密钥，用于自动故障转移和负载均衡。

## 自定义端点 {#custom-endpoints}

自定义端点让你把自行部署或经代理的服务（Ollama、LM Studio、
LiteLLM、vLLM、ComfyUI、本地 TTS 与 STT）登记为**带标签的提供方组合**。

- **服务器范围：** 打开 `/providers` 进行工作区端点的登记和编辑。
- **个人范围：** 打开 `/personal providers` 管理个人模型目录（只属于你：见
  [个性化](/zh-CN/features/knowledge/personalization/#your-own-providers)）。个人语音端点
  不能从 `/personal config` 选择。

**标签**是面向用户的菜单名称，当多项功能共用同一个端点 URL 时，它把它们归到一个组合下。
它永远不会被发送给远端端点。由不同 URL 提供的功能
需要不同的标签。选择 **+ 添加新自定义端点**，选择
API 兼容性，然后保存连接。保存会按该协议准备好所支持的功能，但不登记任何模型。接着选中这个新端点，用它下面的模型
下拉菜单登记一个确切的模型代号和功能。添加模型会为该项功能激活它。
用同一个下拉菜单挂上更多模型，或者编辑工作区添加的登记。
文本模型在该表单里声明自己的能力，图像模型则声明它们支持哪些请求模式。

对于 TTS 和 STT，在 `/providers` 里登记端点和它的模型，然后在 `/config` > 模型 > 切换模型 里选择并激活
该端点。那些语音槽位选择的是端点，而不是
模型目录条目。`/providers` 仍然是端点登记、模型设置和编辑界面。

API 兼容性决定该服务实现的请求路径和载荷，所以它也决定这个连接会准备好哪些
功能槽位。为这些槽位登记确切的模型是另一个步骤，而且
协议无法从端点 URL 可靠地推断出来。

`/setup` 的 **Custom Endpoint (Advanced)** 模式在向导内完成同样的两个步骤：
**Configure Connection** 在一次可达性检查之后保存 API 兼容性、标签、URL 和可选的认证令牌，
**Configure Text Model** 登记确切的文本模型及其能力
声明。模型按钮会一直禁用，直到某个连接校验通过，而重新保存
连接会清空模型声明，因为这些声明依赖 API 兼容性。
你在按下 **Finish Setup** 时，向导会一起创建连接、已保存的提供方、模型和当前生效模型记录，
所以它绝不会留下一个没有可用文本模型的连接。它只登记
文本模型；图像、视频、TTS 和 STT 功能仍然在 `/providers` 里登记。

运行这些服务器的完整讲解见：

- [设置：本地 LLM](/zh-CN/self-hosting/local-endpoints/setup-local-llm/)：Ollama、KoboldCPP、LM Studio、vLLM、LiteLLM。
- [设置：ComfyUI](/zh-CN/self-hosting/local-endpoints/setup-comfyui/)：本地图像与视频生成。
- [设置：ChatMock](/zh-CN/self-hosting/local-endpoints/setup-chatmock/)：ChatGPT 账号与 Codex CLI。

## 支持的提供方 {#supported-providers}

如果你没有自己托管模型的硬件，TomoriBot 支持多种
服务。并不是每项功能在每个提供方上都可用。

### LLM 提供方

| 提供方 | 流式输出 | 工具调用 | 图像输入 | 嵌入 | 说明 |
|---|---|---|---|---|---|
| **Google Gemini** | ✅ | ✅ | ✅ | ✅ | 有免费模型可用 |
| **OpenRouter** | ✅ | ✅ | ✅ | ✅ | 有免费模型可用 |
| **Anthropic (API)** | ✅ | ✅ | ✅ | 无 | 不是 Claude Code |
| **NovelAI** | ✅ | ✅ | 无 | 无 | 只有 GLM 4.6 能使用工具 |
| **NVIDIA NIM** | ✅ | ✅ | ✅ | ✅ | 有免费模型可用 |
| **DeepSeek** | ✅ | ✅ | 无 | 无 | 无 |
| **Z.ai** | ✅ | ✅ | ✅ | 无 | 有免费模型；⚠️ 服务条款限定仅限编码与智能体用途 |
| **Z.ai Coding** | ✅ | ✅ | 无 | 无 | 订阅方案 |
| **Google Vertex AI** | ✅ | ✅ | ✅ | ✅ | 包含「免费」的 Express 版本 |
| **Codex CLI (via ChatMock)** | ✅ | ✅ | ✅ | 无 | [设置](/zh-CN/self-hosting/local-endpoints/setup-chatmock/) |

### 图像生成

| 提供方 | 文生图 | 图生图 | 局部重绘 | 说明 |
|---|---|---|---|---|
| **Google** | ✅ | ✅ | 无 | 无 |
| **OpenRouter** | ✅ | ✅ | 无 | 无 |
| **NovelAI** | ✅ | ✅ | ✅ | 可以和其他提供方组合 |
| **NVIDIA** | ✅ | 无 | 无 | 仅文生图；参考图会被忽略 |
| **Z.ai** | ✅ | 无 | 无 | 无 |

这些是提供方图像模型的**默认值**起点，而 NovelAI 走的是它自己的流程，
不经过这张表。通过 `/providers` 登记图像模型可以让你声明该模型自己的
模式，这也是你在 ComfyUI 工作流上、或者在一个 API 支持
遮罩编辑的提供方模型上开启局部重绘的方式。你从未声明过的模型会一直沿用上面的默认值，
所以之后对默认值的修正会自动作用到它。只声明模型真正会做的事：Tomori 会把你勾选的模式
原样提供给工具，而 API 拒绝的模式会变成一次失败的生成。

### 视频生成

| 提供方 | 文生视频 | 图生视频 | 说明 |
|---|---|---|---|
| **Google** | ✅ | ✅ | 异步轮询流程 |
| **OpenRouter** | ✅ | ✅ | 异步轮询流程 |
| **Z.ai** | ✅ | ✅ | 异步轮询流程 |

### 语音与音频

| 提供方 | 文本转语音 | 语音转文字 |
|---|---|---|
| **ElevenLabs** | ✅ | ✅ |

本地语音引擎在[自部署](/zh-CN/self-hosting/)里介绍。内置的网页
搜索与 URL 抓取引擎见[工具与扩展](/zh-CN/features/capabilities/tools-and-extensions/#网页搜索与-url-读取)。
