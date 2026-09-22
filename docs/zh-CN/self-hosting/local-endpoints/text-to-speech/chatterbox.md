---
title: "Chatterbox TTS"
---

用 `servers/tts/chatterbox/server.py` 做带事件标签的英语语音克隆。快速模型路径默认使用 Chatterbox-Turbo（350M 参数）。如果是更小、偏向 CPU 的部署，可以选用 Chatterbox-Nano（110M 参数）。这个封装程序不会加载 Chatterbox Multilingual V3。

## 安装

在 TomoriBot 仓库根目录（也就是你克隆 TomoriBot 的那个文件夹）里运行以下命令：

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

TomoriBot 使用 Chatterbox 期间，请让这个终端一直开着。默认端点 URL 是 `http://127.0.0.1:8011`。

### 可选：使用 Chatterbox-Nano

Nano 需要带 `nano=True` 加载选项的 Chatterbox 构建。做完上面的常规安装后，在同一个虚拟环境里安装固定版本的上游代码。这个提交哈希用来锁定可用的源码版本，并不构成安全保证。这条命令需要 `git`，并且会保留已经装好的运行时依赖：

```sh
python -m pip install --no-deps --force-reinstall "git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
```

然后在启动封装程序之前设置 `CHATTERBOX_FAST_MODEL=nano`。想用 Turbo 就不要设置这个变量。在 Windows PowerShell 里用 `$env:CHATTERBOX_FAST_MODEL = "nano"` 设置；在 Linux 或 macOS 上用 `CHATTERBOX_FAST_MODEL=nano python servers/tts/chatterbox/server.py`。`/health` 的响应会报告 `fast_model`，你可以用它确认实际加载的是哪一个。Nano 和 Turbo 使用相同的克隆请求和相同的事件标签，两者都只支持英语。

要用 Nano 或 Turbo，`/config` 里的快速模型开关必须保持开启。关掉它会改用标准 Chatterbox 0.5B 模型，以便调节 CFG 权重与夸张程度。

### 标准 Chatterbox（0.5B，带 CFG 与夸张程度）

最初的 0.5B 基础 Chatterbox 模型（`ChatterboxTTS`）直接内置在这个服务端封装程序里。它不再使用 Turbo 的行内方括号事件标签，改用**无分类器引导**（Classifier-Free Guidance，`cfg_weight`）与情绪强度 **`exaggeration`** 来做细粒度的人声控制。

要使用标准模型：

1. 照常启动服务端封装程序。
2. 在 Discord 里运行 `/config` > **模型** > **TTS 参数与语音**。
3. 把 **快速模型（Turbo）** 选项切换为 **关闭**。
4. 下一次生成时，封装程序会按需下载标准 0.5B 模型并加载进内存。

这两个值都是**编辑参数**弹窗里的文本字段。它们始终可以编辑，页面上也注明，快速模型开启时这两个值会被忽略：

- **`cfg_weight`**（默认 `0.5`）：调节合成音频在多大程度上贴合参考音频的节奏与人声风格。
- **`exaggeration`**（默认 `0.5`）：控制情绪强度以及表达上的戏剧性起伏。

> [!NOTE]
> 标准 Chatterbox 不支持行内方括号事件标签（例如 `[laughs]` 或 `[sigh]`）。快速模型开关关闭时，TomoriBot 会自动去掉提示词文本里的方括号标签。

## 在 TomoriBot 中注册

在端点标签或模型名称里包含 `Chatterbox`。TomoriBot 只通过这个名称（或包含它的端点 URL）来识别 Chatterbox 端点，所以 Turbo 的标签白名单、标准模型的标签剔除，以及 `/generate voice-message` 里的 Chatterbox 选项，只有在这个名称存在时才会生效。

运行 `/providers`，选择**添加新自定义端点**，并使用语音合成的 API 兼容性：

- API 兼容性：`tts-clone`
- `endpoint_url`：`http://127.0.0.1:8011`

保存连接后，选中它，用它的模型下拉菜单添加一个语音合成模型。把语音来源模式选为 `Voice Clone`，把脚本标记风格选为 `Bracket Tags`，这样表达标签在发送时才会保留下来。

端点注册和模型设置都在 `/providers` 里做，之后打开 `/config` > 模型 > 切换模型，选中并启用已注册的端点。

## 设置人格语音

1. 准备一段干净的语音片段，10 到 20 秒，只有一个人说话，没有背景音乐。
2. 打开 `/config`，进入模型 > TTS 参数与语音，上传这段片段。
3. 打开 `/config`，进入人格 > 语音，然后选择人格与语音样本。

更长的片段对 Chatterbox 没有帮助。它的运行时会截断参考音频，解码器条件只用前 10 秒，编码器条件只用前 6 秒（[`tts.py`](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/tts.py)），所以超过约 10 秒的片段会被上传、存储，然后有一部分被忽略。说话人嵌入仍然根据整段片段计算。

快速模型开关开启时，Turbo 和 Nano 可以使用 `[laugh]`、`[sigh]` 这类方括号事件标签。

## 可选调优

用 `/config` 的模型 > TTS 参数与语音来调节 Chatterbox 请求负载：

- 快速模型开关默认开启。封装程序调用 `ChatterboxTurboTTS.generate(...)` 之前，TomoriBot 会保留受支持的 Turbo/Nano 事件标签，并去掉不受支持的方括号描述。
- `cfg_weight` 默认是 `0.5`。最小值是 `0`；TomoriBot 不设硬性上限。它只在 `turbo` 为 `false` 时生效；更低的数值有助于放慢语速偏快的参考音频，更高的数值则更贴近参考音频。
- `exaggeration` 默认是 `0.5`。最小值是 `0`；TomoriBot 不设硬性上限。它只在 `turbo` 为 `false` 时生效；更高的数值让表达更有感染力或更戏剧化，也可能让语速变快。

受支持的 Turbo/Nano 事件标签有 `[clear throat]`、`[sigh]`、`[shush]`、`[cough]`、`[groan]`、`[sniff]`、`[gasp]`、`[chuckle]` 和 `[laugh]`。`[excited]`、`[whisper]`、`[smiles]` 这类不受支持的描述不会发往 TTS，而是会被去掉。

`turbo` 关闭时，TomoriBot 会在把文本发往 TTS 之前去掉所有方括号描述，之后封装程序会按需加载标准 `ChatterboxTTS` 模型，并调用 `model.generate(..., cfg_weight, exaggeration)`。
