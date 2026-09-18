---
title: "KoboldCPP 语音转写"
sidebar:
  order: 3
---

> **关于这份翻译：** 本页是英文版[KoboldCPP 语音转写](https://docs.tomoribot.app/en/self-hosting/local-endpoints/speech-to-text/koboldcpp/)的翻译，仅为方便阅读而提供，内容以英文版为准。若本页与英文版有任何不一致，一律以英文版为准。

KoboldCPP 有基于 Whisper 的语音识别支持，但端点形态会因构建而异。TomoriBot 的 Phase 4 适配器期望 OpenAI 兼容的 `POST /v1/audio/transcriptions`。

## 设置

在启用 Whisper/STT 的情况下启动 KoboldCPP，并确认你的构建暴露了以下端点：

- `POST /v1/audio/transcriptions`
- `GET /v1/models` 或 `GET /models`

在 TomoriBot 使用它期间，请让 KoboldCPP 保持运行。如果你的构建只暴露了 `/api/extra/transcribe` 或其他自定义形态，请先用一个封装程序，直到 TomoriBot 有专用适配器为止。

## 在 TomoriBot 中注册

运行 `/providers`，选择**添加新自定义端点**，并使用语音识别专用的 API 兼容性：

- API 兼容性：`openai-compatible-transcription`
- `endpoint_url`：你的 KoboldCPP 服务器根地址

保存连接后，选中它，并用它的模型下拉菜单把服务器上报的模型名称添加为语音识别模型。

端点注册和模型设置都在 `/providers` 里做，之后打开 `/config` > 模型 > 切换模型，选中并激活已注册的端点。

## 使用转写内容

注册之后，TomoriBot 会在后台转写音频附件，并把文字加入聊天上下文。只有当你还想把转写内容公开发到聊天里时，才需要用到 `/config` > 行为 > 提示。
