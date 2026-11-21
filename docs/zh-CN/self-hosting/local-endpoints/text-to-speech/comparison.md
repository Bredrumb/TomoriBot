---
title: "TTS 引擎对比"
sidebar:
  order: 1
aiGenerated: false
---

在下方对比来自同一测试环境的合成耗时与音频样本。

## 多语言与英语语音克隆

### 基准测试文本

- 标准文本（*用于 Chatterbox Standard/Turbo/Nano、MOSS-TTS、CosyVoice 3、VoxCPM2、Qwen3-TTS*）：
  > *"Pain and pleasure are two sides of the same coin. Go on now... flip it. Either way, I'll let you feel all of me."*
- Fish Audio S2 Pro 文本（*测试时带方括号表达标签*）：
  > *"Pain and pleasure are two sides of the same coin. [laughs] Go on now... flip it. [whispers] Either way, I'll let you feel all of me."*

### 性能与音频对比

耗时同时给出完整生成时间（从发出请求到音频生成完毕的总实际秒数）和实时率（RTF），后者的定义是生成时间除以音频时长：

- **RTF < 1.0（加粗）**：引擎生成语音的速度快于实时（例如 `0.50× RTF` 表示一个 10 秒的片段用 5 秒生成完）。只有这些引擎有可能跟上实时语音通话，而 TomoriBot 目前并没有实现这个功能。
- **RTF > 1.0**：生成所需的时间比说出来的音频更长。TomoriBot 把每条语音消息作为完整文件发送，所以 RTF 更高只意味着等得更久。

| 引擎 | Windows 原生<sup>(1)</sup><br/>（RTX 4070 Ti SUPER） | Linux / WSL2 | macOS<br/>（Apple Silicon） | 音频样本 |
|---|---|---|---|---|
| [Fish Audio S2 Pro](/self-hosting/local-endpoints/text-to-speech/fishs2/) | 约 8-10 分钟<sup>(2)</sup><br/>*（约 65× RTF）* | 未测试 | 未测试 | <audio controls preload="none" src="/audio/tts/fish-s2-pro.wav"></audio> |
| [Chatterbox（Turbo，默认）](/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 约 5.0 秒 *（8.7 秒片段）*<br/>0.57× RTF | 未测试 | 未测试 | <audio controls preload="none" src="/audio/tts/chatterbox-turbo.wav"></audio> |
| [Chatterbox（Nano）](/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 约 3.0 秒 *（8.0 秒片段）*<br/>0.38× RTF | 未测试 | 未测试 | <audio controls preload="none" src="/audio/tts/chatterbox-nano.wav"></audio> |
| [Chatterbox（Standard）](/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 约 6.0 秒 *（7.8 秒片段）*<br/>0.77× RTF | 未测试 | 未测试 | <audio controls preload="none" src="/audio/tts/chatterbox.wav"></audio> |
| [MOSS-TTS](/self-hosting/local-endpoints/text-to-speech/moss/) | 约 12.0 秒 *（8.8 秒片段）*<br/>1.36× RTF | 未测试 | 未测试 | <audio controls preload="none" src="/audio/tts/moss-tts.wav"></audio> |
| [CosyVoice 3](/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) | 约 6.0 秒 *（13.9 秒片段）*<br/>0.43× RTF | 未测试 | 未测试 | <audio controls preload="none" src="/audio/tts/cosy-voice-3.wav"></audio> |
| [VoxCPM2](/self-hosting/local-endpoints/text-to-speech/voxcpm2/) | 约 8.0 秒 *（7.4 秒片段）*<br/>1.09× RTF | 未测试 | 未测试 | <audio controls preload="none" src="/audio/tts/voxcpm2.wav"></audio> |
| [Qwen3-TTS](/self-hosting/local-endpoints/text-to-speech/qwen3tts/) | 约 10.0 秒 *（9.2 秒片段）*<br/>1.09× RTF | 未测试 | 未测试 | <audio controls preload="none" src="/audio/tts/qwen3-tts.wav"></audio> |

- <sup>(1)</sup> 测试环境：Windows 11（原生运行）上的 NVIDIA GeForce RTX 4070 Ti SUPER（16 GB GDDR6X、Ada Lovelace），使用一段 26.6 秒、24 kHz 的单声道参考音频样本，并配有逐字对应的参考文本。
- <sup>(2)</sup> Fish Audio S2 Pro：在 Windows 上以未编译的 eager 模式运行（约 65× RTF），原因是每个 token 都要经过 76 层求值，CUDA kernel 启动延迟累积起来很可观。建议在 Linux 或 WSL2 上配合 OpenAI Triton 的编译器融合（`torch.compile`）运行，以避免这种调度停顿。

---

## 日语语音克隆

### 日语基准测试文本

> *「そんな顔して……ほんとは私にやられたいんでしょ？ざぁこざぁこ～♡」*

### 日语性能与音频对比

| 引擎 | Windows 原生<sup>(1)</sup><br/>（RTX 4070 Ti SUPER） | Linux / WSL2 | macOS<br/>（Apple Silicon） | 音频样本 |
|---|---|---|---|---|
| [IrodoriTTS](/self-hosting/local-endpoints/text-to-speech/irodoritts/) | 约 4.0 秒 *（8.5 秒片段）*<br/>0.47× RTF | 未测试 | 未测试 | <audio controls preload="none" src="/audio/tts/irodori.wav"></audio> |

- <sup>(1)</sup> 在同一个 RTX 4070 Ti SUPER、Windows 11 测试环境中测得。

---

## 对比各引擎

TomoriBot 返回完整的 WAV 文件。模型体积统计的是参数量；显存数值仅为配置参考。上方的测速数据来自一台 Windows 机器。

参考片段长度包含上游推荐值与运行时限制。具体细节请参见各引擎的对应指南。

| 引擎 | 模型体积；16 GB GPU | 语言 | 参考片段 | 语音来源与控制方式 | 速度 / 流式路径 | 适合场景 |
|---|---|---|---|---|---|---|
| [Chatterbox](/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 350M Turbo（默认）、110M Nano 或 500M Standard；可以，Nano 能用 CPU | 英语 | 10 秒；更长的内容一旦超出提示的 10 秒窗就会被静默忽略 | 参考音频克隆，受支持的事件标签；标准模型提供 CFG 与夸张程度 | 主打快速与轻量；包装脚本返回完整 WAV | 小体积的英语克隆搭建，或在 CPU 上做实验 |
| [Qwen3-TTS](/self-hosting/local-endpoints/text-to-speech/qwen3tts/) | 每种模式 1.7B；可以，模型会切换 | 10 种，含英语与日语 | 3 秒起；没有文档记载的上限 | 克隆，或用文字描述的 VoiceDesign | 主打质量；上游支持流式，包装脚本会缓冲 | 通用多语言克隆与日语 VoiceDesign |
| [MOSS-TTS](/self-hosting/local-endpoints/text-to-speech/moss/) | 4B 克隆模型加约 1.7B 设计模型，二者会切换；16 GB 只是未经验证的试验目标；8B 旗舰模型大概跑不动 | 克隆：31 种，含日语；设计：英语与中文 | 上游没有文档；运行时也没有上限 | 克隆，或用文字描述的 VoiceGenerator；克隆支持语言标签 | 试验性；本地克隆有上游流式后端，包装脚本会缓冲 | 对比 MOSS 的克隆质量，或做英语与中文语音设计 |
| [IrodoriTTS](/self-hosting/local-endpoints/text-to-speech/irodoritts/) | 当前 v4.1 Small 约 0.8B；一次本地运行中观察到约 3-4 GB 显存 | 仅日语 | 约 30 秒；会按检查点的 120 秒上限裁剪 | 克隆或 VoiceDesign；emoji 风格提示 | 用采样步数在质量与速度之间取舍；包装脚本会缓冲 | 小体积的日语语音，以及由 emoji 驱动的表达方式 |
| [Fish S2 Pro](/self-hosting/local-endpoints/text-to-speech/fishs2/) | 4B；默认官方 BF16（约 16-18 GB），16 GB 可选 INT8 | 上游声称 83 种 | 10-30 秒；运行时没有上限 | 参考音频克隆（需要参考文本），自由格式的方括号表达标签 | 重型 Dual-AR 模型；想快速合成需要 Linux/WSL2 加 Triton（Windows eager 模式下约 65× RTF） | 细粒度、富有表现力的克隆；请留意研究许可条款 |
| [VoxCPM2](/self-hosting/local-endpoints/text-to-speech/voxcpm2/) | 2B；上游报告 BF16 约 8 GB | 30 种 | 5-30 秒；这是文档记载的范围，运行时没有上限 | 克隆、语音设计、参考文本辅助的 Ultimate Cloning、表达方式指令 | 上游 RTX 4090 上约 0.30 RTF；上游支持流式，包装脚本会缓冲 | 一个多语言模型，提供最丰富的语音来源控制方式 |
| [CosyVoice 3](/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) | 核心 0.5B；16 GB 够用，下载体积与运行时占用更大 | 9 种，含日语，另有中文方言 | 3-30 秒；更长会被截到最前面的 30 秒 | 克隆、跨语言克隆、自然语言表达方式 | 主打低延迟；上游原生支持文本与音频流式，包装脚本会缓冲 | 将来做流式传输的候选方案，支持跨语言克隆 |

模型体积与语言数量来自 [Chatterbox](https://github.com/resemble-ai/chatterbox)、[Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS)、[MOSS](https://github.com/OpenMOSS/MOSS-TTS)、[Irodori](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small)、[Fish S2 Pro](https://huggingface.co/fishaudio/s2-pro)、[VoxCPM2](https://huggingface.co/openbmb/VoxCPM2) 和 [CosyVoice 3](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512) 的上游页面。操作系统、驱动、许可、模型版本和内存等细节请查看各篇指南。16 GB 显卡不一定能同时跑一个语音合成模型和一个大型本地 LLM。

Qwen3-TTS 自动端点的第一次请求包含模型加载时间。MOSS 会在安装时预先下载两个模型，默认还会在启动时预热克隆模型，但切换到另一种模式后，这两个自动服务器都仍需加载另一个模型。对每个完整响应，TomoriBot 最多等待 `TTS_SYNTHESIZE_TIMEOUT_MS`（默认 240000 毫秒）。
