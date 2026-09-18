---
title: "WhisperX 语音转写"
sidebar:
  order: 1
---

> **关于这份翻译：** 本页是英文版[WhisperX 语音转写](https://docs.tomoribot.app/en/self-hosting/local-endpoints/speech-to-text/whisperx/)的翻译，仅为方便阅读而提供，内容以英文版为准。若本页与英文版有任何不一致，一律以英文版为准。

WhisperX 是推荐的、适合初学者的本地转写方案。

## 设置

请在 TomoriBot 仓库根目录（也就是你克隆 TomoriBot 的那个文件夹）里运行这些命令。第一条命令会进入语音识别服务器文件夹：

### Windows PowerShell

```powershell
cd servers/stt
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python whisperx_server.py
```

### Linux/macOS Bash

```bash
cd servers/stt
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python whisperx_server.py
```

在 TomoriBot 使用 WhisperX 期间，请让那个终端保持打开。默认端点 URL 是 `http://127.0.0.1:8021`。

## 在 TomoriBot 中注册

运行 `/providers`，选择**添加新自定义端点**，并使用语音识别专用的 API 兼容性：

- API 兼容性：`openai-compatible-transcription`
- `endpoint_url`：`http://127.0.0.1:8021`

保存连接后，选中它，并用它的模型下拉菜单把 `large-v3`（或者 `WHISPERX_MODEL` 所设的值）添加为语音识别模型。

端点注册和模型设置都在 `/providers` 里做，之后打开 `/config` > 模型 > 切换模型，选中并激活已注册的端点。

## 使用转写内容

注册之后，TomoriBot 会在后台转写音频附件，并把文字加入聊天上下文。只有当你还想把转写内容公开发到聊天里时，才需要用到 `/config` > 行为 > 提示。
