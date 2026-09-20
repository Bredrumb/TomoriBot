---
title: "Qwen3-TTS"
---

用 `servers/tts/qwen3tts/server.py` 可同时运行 Qwen3-TTS 12Hz 1.7B 的两种模式，它是目前 TomoriBot 各项选择中体积较大但也最准确的语音合成。默认情况下它以自动模式启动，会根据每个请求的形态在 Base 语音克隆模型与 VoiceDesign 模型之间做出选择。

## 设置

请在 TomoriBot 仓库根目录，也就是你克隆 TomoriBot 的那个文件夹里运行这些命令：

### 使用 Windows PowerShell

```powershell
python -m venv servers\tts\qwen3tts\.venv
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r servers\tts\qwen3tts\requirements.txt
python servers\tts\qwen3tts\server.py
```

### 使用 Linux/macOS Bash

```bash
python3 -m venv servers/tts/qwen3tts/.venv
source servers/tts/qwen3tts/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r servers/tts/qwen3tts/requirements.txt
python servers/tts/qwen3tts/server.py
```

默认的自动模式端点 URL 是 `http://127.0.0.1:8012`。你也可以显式指定自动模式：

```powershell
python servers\tts\qwen3tts\server.py --mode auto
```

自动模式会检查每个 `/synthesize` 请求：带 `ref_audio` 的请求使用克隆模型，带 `instruct` 的请求则使用 VoiceDesign 模型。它一次只保持一个模型处于加载状态，并在请求类型变化时切换模型，所以切换后的第一个请求可能会更慢。

## 在 TomoriBot 中注册

对大多数用户来说，请注册自动模式的服务器，这样一个端点就能同时支持语音克隆与 VoiceDesign 两种人格。

运行 `/providers`，选择**添加新自定义端点**，并使用语音合成的 API 兼容性：

- API 兼容性：`tts-clone`
- `endpoint_url`：`http://127.0.0.1:8012`

保存连接后，选中它并用它的模型下拉菜单添加一个 Speech 模型。模型表单会询问**语音来源模式**与**脚本标记风格**；自动模式的服务器请选择 `Auto` 与 `Plain`。

端点注册与模型设置请用 `/providers`。然后打开 `/config` > 模型 > 切换模型，选中并启用已注册的端点。

## 设置人格语音

### 语音克隆

适用于应当模仿参考片段的人格：

1. 准备一段干净的 10-20 秒语音片段，只有一位说话者，没有背景音乐。
2. 打开 `/config`，进入模型 > TTS 参数与语音，上传该片段。
3. 打开 `/config`，进入人格 > 语音，然后选择人格与语音样本。

### VoiceDesign

适用于应当使用文字语音描述而不是样本的人格：

1. 打开 `/config`，进入人格 > 语音，选择 VoiceDesign。
2. 选择人格。
3. 输入一段自然语言的语音提示词，例如说话者的年龄、语气、口音与表达方式。

要移除某个人格的 VoiceDesign 提示词，请在 `/config` 的人格 > 语音 里操作。生成时，TomoriBot 会把保存的提示词作为 `instruct` 放进 `/synthesize` 的 JSON 请求体；来自工具的一次性 `voice_instructions` 会追加在后面

自动模式会保留这两种设置。在 `/config` 的人格 > 语音 下配置好的人格，会按自己的选择使用克隆合成或 VoiceDesign 合成。

## （可选）仅 VoiceDesign 的服务器

在服务 `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign` 时，用 VoiceDesign 模式启动同一个服务器。

Windows PowerShell：

```powershell
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
$env:TOMORI_TTS_MODE = "voice-design"
python servers\tts\qwen3tts\server.py
```

Bash：

```bash
source servers/tts/qwen3tts/.venv/bin/activate
TOMORI_TTS_MODE=voice-design python servers/tts/qwen3tts/server.py
```

你也可以传入 `--mode voice-design` 来代替设置 `TOMORI_TTS_MODE`。仅 VoiceDesign 模式的默认端点 URL 是 `http://127.0.0.1:8014`。

注册方式与自动模式相同，但端点 URL 用 `http://127.0.0.1:8014`，并在 Speech 模型上把 `VoiceDesign` 选为语音来源模式。
