---
title: "whisper.cpp 语音转写"
sidebar:
  order: 2
---

当 whisper.cpp 的 HTTP 服务器暴露 OpenAI 兼容的 `POST /v1/audio/transcriptions` 端点时，就可以使用它。

## 设置

启动你的 whisper.cpp HTTP 服务器，并确认它暴露了 OpenAI 兼容的转写端点：

- `POST /v1/audio/transcriptions`
- `GET /v1/models` 或 `GET /models`

在 TomoriBot 使用它期间，请让该服务器保持运行。端点 URL 是服务器根地址，例如 `http://127.0.0.1:8022`。

如果你的 whisper.cpp 构建暴露的是另一种端点形态，请在它前面放一个轻量封装程序，把请求映射成 TomoriBot 期望的 OpenAI 兼容形态。

## 在 TomoriBot 中注册

运行 `/providers`，选择`添加新自定义端点`，并使用语音识别专用的 API 兼容性：

- API 兼容性：`openai-compatible-transcription`
- `endpoint_url`：你的 whisper.cpp 服务器根地址

保存连接后，选中它，并用它的模型下拉菜单把服务器上报的模型名称添加为语音识别模型。

端点注册和模型设置都在 `/providers` 里做，之后打开 `/config` > 模型 > 切换模型，选中并激活已注册的端点。

## 使用转写内容

注册之后，TomoriBot 会在后台转写音频附件，并把文字加入聊天上下文。只有当你还想把转写内容公开发到聊天里时，才需要用到 `/config` > 行为 > 提示。
