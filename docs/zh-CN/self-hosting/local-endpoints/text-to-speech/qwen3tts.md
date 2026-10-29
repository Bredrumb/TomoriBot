---
title: "Qwen3-TTS"
aiGenerated: true
---

在语音克隆与文本描述的 VoiceDesign 模式下使用 [Qwen3-TTS](https://github.com/QwenAudio/Qwen3-TTS) 合成高精度的多语言人格语音。

Qwen3-TTS 12Hz 1.7B 提供高精度的本地语音合成。在默认的自动模式下运行 `servers/tts/qwen3tts/server.py`，会根据每个传入的请求动态选择基础语音克隆模型或 VoiceDesign 模型。

## 安装

在 TomoriBot 代码仓库根目录（克隆 TomoriBot 的文件夹）运行以下命令：

### Windows PowerShell

```powershell
python -m venv servers\tts\qwen3tts\.venv
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r servers\tts\qwen3tts\requirements.txt
python servers\tts\qwen3tts\server.py
```

### Linux 与 macOS Bash

```bash
python3 -m venv servers/tts/qwen3tts/.venv
source servers/tts/qwen3tts/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r servers/tts/qwen3tts/requirements.txt
python servers/tts/qwen3tts/server.py
```

默认自动模式端点 URL 为 `http://127.0.0.1:8012`；设置 `QWEN3TTS_PORT` 可使用其他端口。你也可以显式指定自动模式：

```powershell
python servers\tts\qwen3tts\server.py --mode auto
```

自动模式会检查每个 `/synthesize` 请求：带有 `ref_audio` 的请求使用克隆模型，带有 `instruct` 的请求使用 VoiceDesign 模型。GPU 显存中一次仅保持加载一个模型，当请求类型发生变化时会进行模型互换，因此互换后的首次请求耗时可能会稍长。

## 在 TomoriBot 中注册

对大多数用户而言，注册自动模式服务器即可让单一端点同时支持语音克隆与 VoiceDesign 两种人格。

运行 `/providers`，选择 `+ 添加新自定义端点`，并选择语音合成的 API 兼容性：

- API 兼容性：`tts-clone`
- `endpoint_url`：`http://127.0.0.1:8012`

保存连接之后，选中它并使用其模型下拉菜单添加语音模型。模型表单会询问“语音源模式”与“脚本标记”；对于自动模式服务器，请分别选择 `Auto` 与 `Plain`。

在 `/providers` 中完成端点注册与模型配置。然后打开 `/config` > 模型 > 切换模型，选中并激活已注册的端点。

## 设置人格语音

### 语音克隆

用于需要模仿参考音频的人格：

1. 准备一段干净的 10 到 20 秒语音片段，仅包含单人说话且无背景音乐。
2. 打开 `/config` 下的模型 > TTS 参数与语音并上传音频片段。
3. 打开 `/config` 下的人格 > 语音，选择对应人格与该语音样本。

Qwen3-TTS 支持短至 3 秒的参考音频片段。

### 语音设计

用于需要使用文本描述而非参考音频的人格：

1. 打开 `/config` 下的人格 > 语音并选择“语音设计”。
2. 选择对应人格。
3. 输入自然语言语音提示词，例如说话人的年龄、语气、口音和表达方式。

## 可选：仅运行 VoiceDesign 的服务器

当仅提供 `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign` 服务时，可以以 VoiceDesign 模式启动同一服务器。

Windows PowerShell：

```powershell
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
$env:TOMORI_TTS_MODE = "voice-design"
python servers\tts\qwen3tts\server.py
```

Linux 与 macOS Bash：

```bash
source servers/tts/qwen3tts/.venv/bin/activate
TOMORI_TTS_MODE=voice-design python servers/tts/qwen3tts/server.py
```

你也可以传入 `--mode voice-design` 代替设置 `TOMORI_TTS_MODE`。默认的仅 VoiceDesign 端点 URL 为 `http://127.0.0.1:8014`。

注册流程与自动模式相同，但在配置端点 URL 时填写 `http://127.0.0.1:8014`，并在语音模型上将语音源模式选择为 `VoiceDesign`。
