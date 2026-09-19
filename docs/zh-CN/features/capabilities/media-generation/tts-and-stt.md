---
title: "语音：TTS 与 STT"
sidebar:
  order: 3
---

TomoriBot 能**说**（文本转语音）也能**听**（语音转文字）：

- **TTS** 让她能用 Discord 原生语音消息回复。
- **STT** 把用户的音频附件转成文字，供她当作对话上下文使用。

两者都走同一套端点系统。最快的路是 **ElevenLabs**（云端，
下面有完整说明）。如果你更想在自己的硬件上跑语音，就用本地引擎，
按自部署指南操作。

## 文本转语音

### ElevenLabs（云端，最省事）

1. 从 [ElevenLabs](https://elevenlabs.io/app/settings/api-keys) 获取 API 密钥。
2. 运行 `/providers`，选择 **Add New Provider**，选 **ElevenLabs**，粘贴密钥。这个流程会：
   - 登记 ElevenLabs 的**语音**端点（同时还有**转写**端点），
   - 把它们选为当前生效，
   - 还可以当场给一个人格指定语音。
3. 在 `/config` 的 人格 > 语音 里给更多人格指定语音。在
   [ElevenLabs 语音库](https://elevenlabs.io/app/voice-library) 浏览语音，那里也可以
   克隆你自己的声音。

在 `/providers` 里选中 ElevenLabs，然后随时选 **Edit Endpoint** 更新密钥。

注意事项：

- 在**免费档位下只有预置语音能用**。浏览
  [预置语音列表](https://elevenlabs-sdk.mintlify.app/voices/premade-voices)。
- 她生成和朗读语音消息时按字符计费；免费档位有
  每月上限，请查看你的 ElevenLabs 后台。
- 语音回复由 `voice_message_enabled` 控制，并要求当前生效的人格已经
  指定了语音。
- 在服务器里，`/config` 的 人格 > 语音 需要管理服务器权限；在以私信为依托的工作区里，所有者仍可使用。

在 `/help` 里选择 **功能**，再选 **语音生成**，可以看到 Discord 里的同一份讲解。

### 本地语音克隆引擎（自部署）

在自部署实例上，你可以改为跑一个本地语音克隆服务器。大致流程是：
启动包装服务器，用 `/providers` 登记它的连接和模型，用
`/providers` 选中它，在 `/config` 的 模型 > TTS 参数与语音 里上传样本，然后在
`/config` 的 人格 > 语音 里指定它。任何音频格式都接受（会自动转成单声道 WAV）；10 到 20
秒、没有背景音乐的片段效果最好。

每个引擎都有自己的设置指南：

- [Chatterbox-Turbo/Nano](/en/self-hosting/local-endpoints/text-to-speech/chatterbox/)：快速、仅英语的语音克隆，支持 `[laugh]` 之类的情绪事件标签。
- [Qwen3-TTS](/en/self-hosting/local-endpoints/text-to-speech/qwen3tts/)：多语言（10 种语言），另有
  自然语言的 VoiceDesign 模式。
- [MOSS-TTS](/en/self-hosting/local-endpoints/text-to-speech/moss/)：试用性质的自动端点，用于多语言克隆或英语与中文的语音设计。
- [IrodoriTTS](/en/self-hosting/local-endpoints/text-to-speech/irodoritts/)：专精日语，会把 emoji
  读成情绪提示。

完整清单与硬件建议见[文本转语音对照表](/en/self-hosting/local-endpoints/text-to-speech/)。

## 语音转文字

转写端点把用户的音频附件转成文字，作为后台的对话
上下文。转写内容是否**公开发到聊天里**由
`/config` > 行为 > 通知 单独控制。

### ElevenLabs（云端）

上面已经讲过：从 `/providers` 添加 ElevenLabs 会连语音端点一起登记好转写端点。
用 `/providers` 在多个转写端点之间挑选。

### 本地引擎（自部署）

- [WhisperX](/en/self-hosting/local-endpoints/speech-to-text/whisperx/)：推荐的本地方案；约 100
  种语言、GPU 加速、多种模型尺寸。
- [KoboldCPP](/en/self-hosting/local-endpoints/speech-to-text/koboldcpp/)：如果你的构建暴露了
  OpenAI 兼容的转写端点就能用。
- [whisper.cpp](/en/self-hosting/local-endpoints/speech-to-text/whispercpp/)。

完整清单见[语音转文字](/en/self-hosting/local-endpoints/speech-to-text/)汇总页。想看
Discord 里的说明，运行 `/help`，然后选择 **功能** 和 **Transcription**。
