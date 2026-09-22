---
title: "Fish Audio S2 Pro"
---

Fish Audio S2 Pro 是一个多语言的 4B 语音合成模型，专注于高保真语音克隆与富有表现力的表达方式。TomoriBot 通过 `servers/tts/fishs2/` 里的本地封装程序来使用它。

TomoriBot 的默认设置使用官方 BF16 权重（`fishaudio/s2-pro`），以提供最高的合成保真度并避免量化不兼容问题。对于显存受限的消费级 GPU 用户，可以通过环境变量覆盖来启用可选的 INT8 仅权重量化（`Imagilux/fishaudio-s2-pro`）。

Fish S2 Pro 支持 `[whisper]`、`[excited]`、`[angry]` 这样的方括号表达标签。请把端点配置为 **Bracket Tags** 标记，这样 TomoriBot 会在生成的语音脚本里保留这些控制。

## 许可证

Fish Speech 代码与 S2 Pro 模型权重按 Fish Audio Research License 分发。根据其条款，研究与不可商用用途是被允许的；商业用途需要单独的 Fish Audio 许可。

TomoriBot 不分发模型权重。每位自部署用户都直接从 Hugging Face 下载 Fish S2 Pro，并自行负责遵守 Fish Audio Research License。要求的署名是：**Built with Fish Audio**。

## 硬件与操作系统

> [!IMPORTANT]
> **请为 Fish Speech 使用 Linux 或 WSL2：** Fish Audio 官方以 Linux 与 WSL2 为目标平台。Fish S2 Pro 使用双自回归（Dual-AR）架构（36 层慢速 transformer + 10 次快速码本迭代 = 每个 token 76 次层求值）。在 Linux 上，OpenAI Triton 可以把这种嵌套循环编译成融合的 GPU 内核（`torch.compile(backend="inductor")`），上游基准测试表明，这能在 Linux 服务器 GPU 上实现实时合成。封装程序默认关闭编译，所以要使用它请设置 `FISH_S2_COMPILE=1`。
>
> 在原生 Windows 上，Triton 不受支持，PyTorch 只能工作在未编译的 eager 模式，并通过 Windows WDDM 驱动执行超过 120,000 次顺序 CUDA 内核调度。这会造成严重的调度停顿，对完全相同的片段来说，生成速度会慢到**约 8-10 分钟**（每秒音频约需 65 秒计算）。想要得到可用的推理，**请在 Linux 或 WSL2 中运行 Fish S2 Pro**。

推荐的硬件：

- **Linux 或 WSL2（强烈推荐）**
- NVIDIA GPU，**16 GB 到 24 GB 显存**（在启用 KV 缓存与卸载的情况下，BF16 可以轻松放进约 16-18 GB 显存）
- 推荐 Python 3.12
- `git`、`ffmpeg`，以及 Fish Speech 所需的标准音频库

## 设置

### Linux / WSL2（推荐）

从 TomoriBot 仓库根目录：

```bash
bash servers/tts/fishs2/install-fishs2.sh
servers/tts/fishs2/.venv/bin/python servers/tts/fishs2/server.py
```

安装程序会：

1. 把 `Imagilux/fish-speech` 克隆到 `servers/tts/fishs2/fish-speech/`，并检出固定的运行时提交；
2. 创建独立的 `.venv`；
3. 安装 Fish Speech 以及 TomoriBot 封装程序的依赖；
4. 把官方 BF16 `fishaudio/s2-pro` 检查点下载到 `fish-speech/checkpoints/fish-speech-s2-pro/`。

正常的重新安装会停留在固定的运行时提交 `2225e924e7d35cc0a1d24dbc67cd1819e6cf429f` 上，而不会跟随一个不断变动的分支。模型修订版默认是 `main`；当一次部署需要可复现时，请把 `FISH_S2_MODEL_REVISION` 固定到一个不可变的 Hugging Face 修订版。安装程序设置列在[安装器变量](#安装器变量)下。

这个 Hugging Face 模型是受限访问的。请先在 Hugging Face 上接受它的许可。如果下载时要求身份验证，请运行：

```bash
servers/tts/fishs2/.venv/bin/hf auth login
```

然后重新运行安装程序。

### Windows PowerShell（仅尽力而为）

原生 Windows 仅用于评估。由于未编译 eager 模式下的驱动调度延迟，生成会极其缓慢（每段片段约 8-10 分钟）：

```powershell
.\servers\tts\fishs2\install-fishs2.ps1
.\servers\tts\fishs2\.venv\Scripts\python.exe servers\tts\fishs2\server.py
```

PowerShell 安装程序默认面向 CUDA GPU 加速（`cu124`）。要在没有 NVIDIA GPU 的纯 CPU 机器上安装，请传入 `-Cpu`：

```powershell
.\servers\tts\fishs2\install-fishs2.ps1 -Cpu
```

如果 Windows 上的 PyTorch 需要手动安装或更新为 CUDA 支持版本，请运行：

```powershell
.\servers\tts\fishs2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

在超过 `TTS_SYNTHESIZE_TIMEOUT_MS`（默认 240000 ms）之后，TomoriBot 会停止等待语音消息，而这个时间比原生 Windows 生成一段片段所需的时间更短。在 Windows 上评估时，请在 TomoriBot 的 `.env` 里把它调大（例如 `TTS_SYNTHESIZE_TIMEOUT_MS=900000`）。

## 必需的参考文本

> [!WARNING]
> **语音克隆必须提供参考文本（`ref_text`）：** Fish S2 Pro 的交叉注意力机制需要参考音频的语音转写，才能把语音 token 与声学编码对齐。
>
> 如果你上传了语音样本，却没有提供与之匹配的参考语音转写，Fish Speech 会**静默丢弃参考音频 token**，退回随机的零参考语音。为防止意外进行无条件生成，TomoriBot 的 Fish 封装程序会校验并拒绝缺少参考文本的合成请求，并返回 `400 Bad Request`。

在 `/config` 的**模型 > TTS 参数与语音**下添加人格语音时，请始终在**参考文本**字段里填入你的参考音频片段中逐字说出的文本。

## 在 TomoriBot 中注册

在 `/providers` 中选择**添加新自定义端点**并配置：

- 功能：`Speech`
- API 兼容性：`tts-clone`
- 端点 URL：`http://127.0.0.1:8015`
- 语音来源模式：`Clone`
- 脚本标记风格：`Bracket Tags`
- API 密钥：默认的回环设置请留空。如果启用了 bearer 认证，请输入完全一致的 `FISH_S2_API_KEY` 值。

然后添加该端点的模型条目，并通过 `/config` 的 模型 > 切换模型 启用它。

## 添加人格语音

1. 准备一段干净的 10-20 秒参考片段，只有一位说话者，背景噪音很小或没有。
2. 在 `/config` 中打开 模型 > TTS 参数与语音 并上传语音样本。
3. **输入参考片段中逐字说出的文本**，填进参考文本字段。
4. 在 `/config` 中打开 人格 > 语音 并把样本指定给该人格。
5. 用 `/generate voice-message` 生成语音消息，或让 TomoriBot 通过它的语音消息工具生成一条。

上游说明，通常可以用 10-30 秒的参考样本进行准确克隆。Fish S2 Pro 自身的运行时不对参考音频时长设上限，所以更长的片段会被接受而不是被裁剪，但文档所述的克隆质量来自 10-30 秒这个区间。

## 表达控制

Fish S2 Pro 可以用方括号标签在同一句话内部改变表达方式。例如：

```text
[whisper] Keep your voice down. [excited] Wait, you actually found it?
```

因为端点使用 `Bracket Tags` 标记，TomoriBot 会保留这些标签，而不是在合成前把它们去掉。

## 配置

| 变量 | 默认值 | 用途 |
|---|---|---|
| `FISH_SPEECH_DIR` | `servers/tts/fishs2/fish-speech` | Fish Speech 运行时目录 |
| `FISH_S2_MODEL_DIR` | `fish-speech/checkpoints/fish-speech-s2-pro` | S2 Pro 检查点目录 |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | 模型仓库，以及已配置检查点的健康检查元数据标签 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | TomoriBot 封装程序的绑定地址 |
| `FISH_S2_PORT` | `8015` | Fish 封装程序端口；未设置时回退到 `TOMORI_TTS_PORT` |
| `TOMORI_TTS_PORT` | 未设置 | 向后兼容的共享端口覆盖项 |
| `FISH_S2_API_KEY` | 未设置 | 可选的 bearer 令牌，进行需要认证的远程绑定时也必须提供 |
| `TOMORI_TTS_API_KEY` | 未设置 | `FISH_S2_API_KEY` 未设置时使用的共享 bearer 令牌回退项 |
| `FISH_S2_ALLOW_INSECURE_REMOTE` | `0` | 在没有 bearer 令牌的情况下明确允许非回环绑定 |
| `FISH_S2_MAX_REF_AUDIO_BYTES` | `10485760` | 解码后的参考 WAV 最大体积 |
| `TOMORI_TTS_MAX_REF_AUDIO_BYTES` | 未设置 | 共享的解码后参考音频大小上限回退项 |
| `FISH_S2_UPSTREAM_HOST` | `127.0.0.1` | 内部 Fish API 绑定地址 |
| `FISH_S2_UPSTREAM_PORT` | `8025` | 内部 Fish API 端口 |
| `FISH_S2_COMPILE` | `0` | 启用 Fish Speech 的 `torch.compile`（需要带 Triton 的 Linux/WSL2） |
| `FISH_S2_HALF` | `0` | 请求 FP16 运行时模式 |
| `FISH_S2_CHUNK_LENGTH` | `200` | Fish 迭代式提示词分块长度 |
| `FISH_S2_TOP_P` | `0.8` | 采样 top-p |
| `FISH_S2_TEMPERATURE` | `0.8` | 采样温度 |
| `FISH_S2_REPETITION_PENALTY` | `1.1` | 重复惩罚 |
| `FISH_S2_MAX_NEW_TOKENS` | `1024` | 每个请求生成的最大语义 token 数 |
| `FISH_S2_USE_MEMORY_CACHE` | `on` | 在 Fish 运行时中缓存已编码的参考语音 |
| `TOMORI_TTS_MAX_TEXT_CHARS` | `2000` | 封装程序接受的最大脚本长度 |
| `FISH_S2_STARTUP_TIMEOUT_SECONDS` | `180` | 等待嵌套 Fish API 的最长时间 |
| `FISH_S2_SYNTHESIS_TIMEOUT_SECONDS` | `1800` | 等待单次上游合成请求的最长时间 |
| `FISH_S2_LAUNCH_TIMEOUT_MS` | `240000` | `bun run launch --fishs2` 等待封装程序健康检查的时长 |

### 安装器变量

由 `install-fishs2.sh` 与 `install-fishs2.ps1` 读取。请记录你覆盖的任何取值，以便部署可以复现。

| 变量 | 默认值 | 用途 |
|---|---|---|
| `FISH_S2_RUNTIME_REPOSITORY` | `https://github.com/Imagilux/fish-speech.git` | Fish Speech 运行时仓库，例如一个经过审查的镜像 |
| `FISH_S2_RUNTIME_REF` | `2225e924e7d35cc0a1d24dbc67cd1819e6cf429f` | 安装时检出的运行时提交 |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | 要下载的 Hugging Face 仓库 |
| `FISH_S2_MODEL_REVISION` | `main` | 要下载的 Hugging Face 修订版 |
| `FISH_S2_UPDATE` | `0` | 设为 `1` 以有意更新运行时并重新下载模型 |
| `FISH_S2_UPDATE_REF` | 未设置 | 更新时使用的运行时 ref。若不提供，则保留显式设置的 `FISH_S2_RUNTIME_REF`；否则更新使用 `main` |
| `FISH_S2_UPDATE_MODEL_REVISION` | 未设置 | 更新时使用的模型修订版，优先级规则与 `FISH_S2_UPDATE_REF` 相同 |

参考音频必须是非空、未压缩的 PCM RIFF/WAVE 文件。解码后的大小限制会在推理前检查，以防过大的 base64 请求消耗不受限的内存。

## 低显存选项（INT8 量化）

在显存受限的 GPU 上运行、装不下官方 BF16 检查点的用户（例如 8-12 GB 显存），可以选择 INT8 量化模型（`Imagilux/fishaudio-s2-pro`）。

要安装并运行 INT8 检查点：

```bash
# In Linux / WSL2:
export FISH_S2_MODEL_ID="Imagilux/fishaudio-s2-pro"
export FISH_S2_MODEL_DIR="servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
export FISH_S2_MODEL_REVISION="9706ff036580881d87cc09465dd10014527bc481"
bash servers/tts/fishs2/install-fishs2.sh
```

```powershell
# In Windows PowerShell:
$env:FISH_S2_MODEL_ID = "Imagilux/fishaudio-s2-pro"
$env:FISH_S2_MODEL_DIR = "servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
$env:FISH_S2_MODEL_REVISION = "9706ff036580881d87cc09465dd10014527bc481"
.\servers\tts\fishs2\install-fishs2.ps1
```

从同一个 shell 启动 `server.py`，或者在启动它之前设置同样这三个变量，这样封装程序就会加载 INT8 目录，而不是默认的 BF16 目录。

INT8 检查点把 transformer 权重大约从 10.3 GB 降到 5.1 GB，同时把音频嵌入与编解码器层保持在 BF16，因此总共约 10 GB 显存就能容纳。
