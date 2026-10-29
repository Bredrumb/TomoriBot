---
title: "Chatterbox TTS"
aiGenerated: true
---

使用本地 [Chatterbox](https://github.com/resemble-ai/chatterbox) 语音合成服务器克隆带有情感标签的英语语音。

Chatterbox 通过 `servers/tts/chatterbox/server.py` 在本地运行。它默认为快速的 Chatterbox-Turbo 模型（350M 参数），支持内联情感事件标签，例如 `[laugh]` 和 `[sigh]`。你也可以针对 CPU 部署环境配置轻量级的 Chatterbox-Nano 模型（110M 参数），或配置标准 0.5B 模型以使用无分类器引导（`cfg_weight`）和情感夸张程度（`exaggeration`）调节。此包装脚本不加载 Chatterbox Multilingual V3。

## 安装

在 TomoriBot 代码仓库根目录（克隆 TomoriBot 的文件夹）运行以下命令：

### Windows PowerShell

```powershell
python -m venv servers\tts\chatterbox\.venv
servers\tts\chatterbox\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install numpy
pip install -r servers\tts\chatterbox\requirements.txt
python servers\tts\chatterbox\server.py
```

### Linux/macOS Bash

```bash
python3 -m venv servers/tts/chatterbox/.venv
source servers/tts/chatterbox/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install numpy
python -m pip install -r servers/tts/chatterbox/requirements.txt
python servers/tts/chatterbox/server.py
```

在 TomoriBot 使用 Chatterbox 期间，请保持该终端窗口开启。默认端点 URL 为 `http://127.0.0.1:8011`；设置 `CHATTERBOX_PORT` 可使用其他端口。

### 可选：使用 Chatterbox-Nano

Nano 需要带有 `nano=True` 加载选项的 Chatterbox 构建版本。完成上方的常规配置后，在同一个虚拟环境中安装指定的上游版本。提交哈希固定了兼容的源码版本；这并非安全保证。该命令需要 `git` 并保留已安装的运行时依赖：

```sh
python -m pip install --no-deps --force-reinstall "git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
```

然后在启动包装脚本前设置 `CHATTERBOX_FAST_MODEL=nano`。使用 Turbo 时无需设置该变量。在 Windows PowerShell 中使用 `$env:CHATTERBOX_FAST_MODEL = "nano"` 进行设置；在 Linux 或 macOS 中使用 `CHATTERBOX_FAST_MODEL=nano python servers/tts/chatterbox/server.py`。`/health` 响应中包含 `fast_model`，便于你核实已加载的模型选择。Nano 和 Turbo 使用相同的克隆请求和支持的事件标签，且两者均仅支持英语。

若要使用 Nano 或 Turbo，必须在 `/config` 中保持启用快速模型切换项。将其关闭将选择标准 Chatterbox 0.5B 模型，以进行 CFG 权重和夸张程度调节。

### 标准 Chatterbox

若要使用标准模型，请在 `/config` > 模型 > TTS 参数与语音下关闭“Chatterbox 快速模型”。标准模型支持调节 `cfg_weight` 与 `exaggeration`，但不支持方括号事件标签。

## 在 TomoriBot 中注册

请在端点标签或模型名称中包含 `Chatterbox`。TomoriBot 仅通过该名称（或包含该名称的端点 URL）识别 Chatterbox 端点，因此 Turbo 的标签白名单、标准模型的标签剥离以及 `/generate voice-message` 中的 Chatterbox 选项仅在该名称存在时才会生效。

运行 `/providers`，选择 `+ 添加新自定义端点`，并选择语音合成的 API 兼容性：

- API 兼容性：`tts-clone`
- `endpoint_url`：`http://127.0.0.1:8011`

保存连接之后，选中它，并使用其模型下拉菜单添加语音合成模型。将语音源模式设为“声音克隆”，脚本标记设为“方括号标签”，以便发送时保留表达标签。

在 `/providers` 中完成端点注册和模型配置。然后打开 `/config` > 模型 > 切换模型，选中并激活已注册的端点。

## 参考样本

1. 准备一段干净的 10 秒语音片段，仅包含单人说话且无背景音乐。
2. 打开 `/config` 下的模型 > TTS 参数与语音并上传该音频。
3. 打开 `/config` 下的人格 > 语音，选择对应人格与该语音样本。

Chatterbox 需要超过 5 秒的音频。建议时长为 10 秒；对于更长的音频，模型仅截取其中有限的部分用于调节。

## 可选参数调节

在 `/config` > 模型 > TTS 参数与语音下，可针对标准模型调整 `cfg_weight` 和 `exaggeration`。两者的默认值均为 `0.5`；调高数值分别可使生成音频更贴近参考音色速度，以及增强表达的情感与戏剧性。

支持的 Turbo/Nano 事件标签包括 `[clear throat]`、`[sigh]`、`[shush]`、`[cough]`、`[groan]`、`[sniff]`、`[gasp]`、`[chuckle]` 和 `[laugh]`。不支持的描述符（例如 `[excited]`、`[whisper]` 或 `[smiles]`）会被自动剥离，而不会发送给 TTS。
