---
title: "Fish Audio S2 Pro"
aiGenerated: true
---

使用 [Fish Audio S2 Pro](https://github.com/fishaudio/fish-speech) 合成极具表现力的多语言人格语音并实现细粒度的情感标签控制。

Fish Audio S2 Pro 是一款专为高保真语音克隆打造的多语言 4B 参数语音合成模型。TomoriBot 通过 `servers/tts/fishs2/` 中的本地包装脚本连接到该模型。它默认使用官方 BF16 权重（`fishaudio/s2-pro`），并为显存为 8 到 12 GB 的 GPU 提供可选的 INT8 量化检查点（`Imagilux/fishaudio-s2-pro`）。

Fish S2 Pro 支持 `[whisper]`、`[excited]`、`[angry]` 等方括号表达标签。使用“方括号标签”标记配置端点，以便 TomoriBot 在生成的语音文本中保留这些控制标签。

## 许可证

Fish Speech 代码与 S2 Pro 模型权重按 Fish Audio Research License 分发。根据其条款，允许用于研究与非商业用途；商业用途需要单独获得 Fish Audio 许可。

TomoriBot 本身不分发模型权重。每位自部署用户均直接从 Hugging Face 下载 Fish S2 Pro，并自行负责遵守 Fish Audio Research License。要求的署名声明为：Built with Fish Audio。

## 硬件与操作系统

> [!IMPORTANT]
> 为了获得实用的推理速度，请使用 Linux 或 WSL2。包装脚本默认关闭编译；设置 `FISH_S2_COMPILE=1` 可启用 Triton 编译。原生 Windows 生成单个音频可能需要 8 到 10 分钟。

推荐硬件：

- **Linux 或 WSL2（强烈推荐）**
- 配备 16 GB 到 24 GB 显存的 NVIDIA GPU（在启用 KV 缓存和卸载的情况下，BF16 可装入约 16 到 18 GB 显存）
- 推荐使用 Python 3.12
- `git`、`ffmpeg` 以及 Fish Speech 所需的标准音频库

## 安装

### Linux 与 WSL2（推荐）

在 TomoriBot 代码仓库根目录下执行：

```bash
bash servers/tts/fishs2/install-fishs2.sh
servers/tts/fishs2/.venv/bin/python servers/tts/fishs2/server.py
```

安装程序会下载固定的 Fish Speech 运行时与官方 BF16 检查点。若需要可复现的模型下载，请将 `FISH_S2_MODEL_REVISION` 设置为不可变的修订版本号。安装程序变量设置列在[安装器变量](#安装器变量)下。

Hugging Face 上的该模型为受限模型（gated model）。请先在 Hugging Face 上同意其许可。如果下载提示需要身份验证，请运行：

```bash
servers/tts/fishs2/.venv/bin/hf auth login
```

然后重新运行安装脚本。

### Windows PowerShell（仅尽力支持）

原生 Windows 仅供评估体验。由于未编译的 eager 模式下存在驱动程序调度停顿，生成速度会极慢（每个片段约 8 到 10 分钟）：

```powershell
.\servers\tts\fishs2\install-fishs2.ps1
.\servers\tts\fishs2\.venv\Scripts\python.exe servers\tts\fishs2\server.py
```

默认情况下，PowerShell 安装脚本以 CUDA GPU 加速（`cu124`）为目标。若要在无 NVIDIA GPU 的纯 CPU 设备上安装，请传递 `-Cpu`：

```powershell
.\servers\tts\fishs2\install-fishs2.ps1 -Cpu
```

如果 Windows 上的 PyTorch 需要手动安装或更新 CUDA 支持，请运行：

```powershell
.\servers\tts\fishs2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

TomoriBot 在达到 `TTS_SYNTHESIZE_TIMEOUT_MS`（默认为 240000 毫秒）后会停止等待语音消息，该时长短于原生 Windows 生成片段所需的时间。在 Windows 上进行评估时，可在 TomoriBot 的 `.env` 中调大该值（例如 `TTS_SYNTHESIZE_TIMEOUT_MS=900000`）。

## 必须提供参考文本

> [!WARNING]
> Fish S2 Pro 必须提供参考音频片段的精确文本。请在 `/config` > 模型 > TTS 参数与语音下的“参考文本”中填写；缺少参考文本时包装脚本将拒绝请求。

## 在 TomoriBot 中注册

在 `/providers` 中选择 `+ 添加新自定义端点` 并配置：

- 功能：`Speech`
- API 兼容性：`tts-clone`
- 端点 URL：`http://127.0.0.1:8015`
- 语音源模式：`Clone`
- 脚本标记：`方括号标签`
- API 密钥：留空。包装脚本没有身份验证，参见[网络访问](/self-hosting/local-endpoints/text-to-speech/#network-access)。

然后添加该端点的模型条目，并通过 `/config` 的模型 > 切换模型启用它。

## 添加人格语音

1. 准备一段干净的 10 到 20 秒参考片段，仅包含单人说话，背景噪音极小或无噪音。
2. 在 `/config` 中打开模型 > TTS 参数与语音并上传语音样本。
3. 将参考音频中逐字说出的文本填入“参考文本”字段。
4. 在 `/config` 中打开人格 > 语音，并将该样本分配给对应人格。
5. 使用 `/generate voice-message` 生成语音消息，或让 TomoriBot 通过其语音消息工具生成。

上游建议使用 10 到 30 秒的参考样本。

## 表达控制

Fish S2 Pro 允许使用方括号标签在同一句话内部改变发音表达方式。例如：

```text
[whisper] Keep your voice down. [excited] Wait, you actually found it?
```

因为端点配置了“方括号标签”标记，TomoriBot 会保留这些标签，而不会在合成前将它们剥离。

## 配置

| 变量 | 默认值 | 用途 |
|---|---|---|
| `FISH_S2_MODEL_DIR` | `fish-speech/checkpoints/fish-speech-s2-pro` | S2 Pro 检查点目录 |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | 模型仓库标识，以及已配置检查点的健康检查元数据标签 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | 包装脚本绑定地址；参见[网络访问](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `FISH_S2_PORT` | `8015` | Fish 包装脚本端口 |
| `FISH_S2_UPSTREAM_PORT` | `8025` | 内部 Fish API 端口 |
| `FISH_S2_COMPILE` | `0` | 启用 Fish Speech 的 `torch.compile`（需带 Triton 的 Linux/WSL2） |
| `FISH_S2_HALF` | `0` | 请求 FP16 运行时模式 |
| `FISH_S2_CHUNK_LENGTH` | `200` | Fish 迭代提示词分块长度 |
| `FISH_S2_TOP_P` | `0.8` | 采样 top-p |
| `FISH_S2_TEMPERATURE` | `0.8` | 采样温度 |
| `FISH_S2_REPETITION_PENALTY` | `1.1` | 重复惩罚 |
| `FISH_S2_MAX_NEW_TOKENS` | `1024` | 每次请求生成的最大语义词元数 |
| `FISH_S2_USE_MEMORY_CACHE` | `on` | 在 Fish 运行时中缓存已编码的参考语音 |

### 安装器变量

由 `install-fishs2.sh` 与 `install-fishs2.ps1` 读取。请记录你覆盖的任何取值，以便部署可以复现。

| 变量 | 默认值 | 用途 |
|---|---|---|
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | 要下载的 Hugging Face 仓库 |
| `FISH_S2_MODEL_REVISION` | `main` | 要下载的 Hugging Face 修订版本号 |

参考音频必须是非空、未压缩且解码后不超过 10 MB 的 PCM RIFF/WAVE 文件。该上限会在推理前进行检查，以防过大的 base64 请求耗尽内存；对于 TomoriBot 发送的 22.05 kHz 单声道 WAV，该大小上限约可容纳 237 秒。

## 低显存选项（INT8 量化）

在显存受限（例如 8 到 12 GB）且无法满足官方 BF16 检查点要求的 GPU 上运行的用户，可选用 INT8 量化模型（`Imagilux/fishaudio-s2-pro`）。

安装并运行 INT8 检查点：

```bash
# 在 Linux / WSL2 中：
export FISH_S2_MODEL_ID="Imagilux/fishaudio-s2-pro"
export FISH_S2_MODEL_DIR="servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
export FISH_S2_MODEL_REVISION="9706ff036580881d87cc09465dd10014527bc481"
bash servers/tts/fishs2/install-fishs2.sh
```

```powershell
# 在 Windows PowerShell 中：
$env:FISH_S2_MODEL_ID = "Imagilux/fishaudio-s2-pro"
$env:FISH_S2_MODEL_DIR = "servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
$env:FISH_S2_MODEL_REVISION = "9706ff036580881d87cc09465dd10014527bc481"
.\servers\tts\fishs2\install-fishs2.ps1
```

从同一个 shell 启动 `server.py`，或在启动前设置相同的三个环境变量，以便包装脚本加载 INT8 目录而非默认的 BF16 目录。

INT8 检查点将 Transformer 权重从约 10.3 GB 缩减至约 5.1 GB，同时将音频嵌入和编解码层保留在 BF16 中，大致需要 10 GB 总显存。
