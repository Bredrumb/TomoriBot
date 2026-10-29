---
title: "IrodoriTTS"
aiGenerated: true
---

使用 [Irodori-TTS v4.1](https://github.com/Aratako/Irodori-TTS)，通过语音克隆、基于描述文本的 VoiceDesign 以及富有表现力的表情标记生成自然的日语语音。

Irodori-TTS v4.1 是一款专注于日语的语音合成模型，支持在单个检查点内进行语音克隆和文本描述的 VoiceDesign。TomoriBot 通过 `servers/tts/irodoritts/` 中的本地 FastAPI 包装脚本连接到 Irodori，默认使用 `Aratako/Irodori-TTS-v4.1-Small`。

可以通过 `IRODORI_TTS_MODEL_ID` 选择兼容的 Hugging Face 检查点，包括 `phasefield-audio/Irodori-TTS-v4.1-Anime` 等社区微调版本。

## 安装

Irodori 使用 `uv` 进行依赖与 PyTorch 后端管理。服务器维护自己的 `pyproject.toml`，并固定了 Irodori 和 `dacvae` 依赖，以实现可复现的安装。首先安装 `uv`，然后在 TomoriBot 代码仓库根目录下运行配置脚本：

### Windows PowerShell (NVIDIA)

```powershell
.\servers\tts\irodoritts\install-irodori.ps1 cu128
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

### Linux Bash (NVIDIA)

```bash
bash servers/tts/irodoritts/install-irodori.sh cu128
servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

安装脚本会创建 `servers/tts/irodoritts/.venv`，因此在安装后 `bun run launch --irodoritts` 即可正常工作。

可用后端：

- `cu128`：Windows 和 Linux 上的 NVIDIA CUDA 12.8
- `cpu`：纯 CPU，或通过 PyPI 的 macOS CPU/MPS
- `rocm`：Linux/WSL 上的 AMD ROCm
- `xpu`：Windows 和 Linux 上的 Intel XPU

默认端点 URL 为 `http://127.0.0.1:8013`。

## 使用不同的检查点

默认模型为 `Aratako/Irodori-TTS-v4.1-Small`。可以通过环境变量配置其他官方检查点（包括 3.29B 参数量的 Large 模型及其量化变体）、社区微调版本或本地检查点文件。

### 检查点与变体

| 模型 / `IRODORI_TTS_MODEL_ID` | 参数量 | 检查点大小 | 建议显存 | 备注 |
|---|---|---|---|---|
| `Aratako/Irodori-TTS-v4.1-Small` | 766M | 1.5 GB | 4-6 GB | 默认模型：推理速度快，内存占用低。 |
| `Aratako/Irodori-TTS-v4-Large` | 3.29B | 12.25 GB | 10-14 GB | 采用 T5Gemma 2 文本骨干网络的完整未量化 Large 模型。 |
| `Aratako/Irodori-TTS-v4-Large-Quantized/float8-weight-only` | 3.29B | 3.58 GB | 6-8 GB | FP8 权重配合 BF16 激活：推荐用于 NVIDIA Ada（RTX 40 系列）及更新架构。 |
| `Aratako/Irodori-TTS-v4-Large-Quantized/int8-weight-only` | 3.29B | 3.58 GB | 6-8 GB | 在 NVIDIA CUDA 上使用 BF16 计算的通用 INT8 权重。 |
| `Aratako/Irodori-TTS-v4-Large-Quantized/int4-weight-only` | 3.29B | 2.75 GB | 5-6 GB | 最小的 Large 变体：需要 NVIDIA Ampere（RTX 30 系列）或更新架构。 |
| `phasefield-audio/Irodori-TTS-v4.1-Anime` | 766M | 1.5 GB | 4-6 GB | 针对动漫风格语音表达的社区微调版本。 |

对于语音克隆，Small 模型在推理更快的同时提供了相近的质量。Large 模型的文本编码器更强大，能更紧密地遵循 VoiceDesign 描述。

服务器会自动读取代码仓库根目录下的 `.env` 或 `servers/tts/irodoritts/.env` 本地文件。

### 通过 `.env`（持久化）

添加到 TomoriBot 根目录的 `.env` 中：

```dotenv
IRODORI_TTS_MODEL_ID="phasefield-audio/Irodori-TTS-v4.1-Anime"
```

### 通过单次会话环境变量

在 Windows PowerShell 中：

```powershell
$env:IRODORI_TTS_MODEL_ID = "phasefield-audio/Irodori-TTS-v4.1-Anime"
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

在 Linux Bash 中：

```bash
IRODORI_TTS_MODEL_ID=phasefield-audio/Irodori-TTS-v4.1-Anime \
  servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

### 使用本地检查点文件

如果你已将检查点文件（`.pt` 或 `.safetensors`）下载到本地，可将 `IRODORI_TTS_CHECKPOINT` 指向其路径：

```dotenv
IRODORI_TTS_CHECKPOINT="/path/to/custom_checkpoint.pt"
```

当前版本的 Irodori 会连同 Hugging Face 仓库中附带的分词器资源一起下载检查点。当模型仓库提供 Hugging Face 子文件夹变体时，`IRODORI_TTS_MODEL_ID` 也支持它们。

## 在 TomoriBot 中注册

运行 `/providers`，选择 `+ 添加新自定义端点`，并选择语音 API 兼容性：

- API 兼容性：`tts-clone`
- `endpoint_url`：`http://127.0.0.1:8013`

保存连接之后，选中它并使用其模型下拉菜单添加语音模型。对于 v4.1，推荐设置为：

- `语音源模式`：`自动`
- `脚本标记风格`：`表情`

`自动`让同一个 Irodori 端点能够同时支持两种 TomoriBot 语音模式，以便在发送过程中保留情感提示：

- 在人格 > 语音下分配了语音样本的人格会发送存储的参考音频片段进行语音克隆。
- 在人格 > 语音下配置了 VoiceDesign 提示词的人格会将保存的自然语言提示作为 Irodori 描述文本条件发送。

如果你仅需要基于参考音频的语音克隆，也可以将语音源模式选择为“声音克隆”。

在 `/providers` 中完成端点注册和模型配置。然后打开 `/config` > 模型 > 切换模型，选中并激活已注册的端点。

## 设置人格语音

### 语音克隆

1. 准备一段干净的日语语音片段，仅包含单人说话且无背景音乐。大约 30 秒即已足够：超过此时长后，额外的音频几乎不会带来音色保真度提升，反而会增加上传大小与推理时间。
2. 打开 `/config` 下的模型 > TTS 参数与语音并上传音频片段。
3. 打开 `/config` 下的人格 > 语音，选择对应人格与该语音样本。

Irodori 默认使用 120 秒的参考音频上限，并会自动截断超出部分。设置 `IRODORI_MAX_REF_SECONDS` 可修改此限制。

### 语音设计

1. 打开 `/config` 下的人格 > 语音。
2. 选择对应人格。
3. 输入所需音色和表达方式的自然语言描述。

TomoriBot 会将此提示词作为 `instruct` 发送；Irodori 包装脚本会将其映射为 v4.1 的 `caption` 条件。VoiceDesign 请求不需要已保存的参考音频片段。

在将文本发送至 TTS 之前，TomoriBot 会剥离 Discord 自定义表情语法。在配置了 `script_markup: emoji` 时，Unicode 表情会被保留，用于 Irodori 的文本调节。

### 表情风格控制

IrodoriTTS 支持输入文本中的表情符号注释，用于影响声音效果、说话风格以及情感表达。将 TomoriBot 的“脚本标记风格”设为“表情”后，这些 Unicode 表情会被保留并发送给 Irodori。

受支持的表情及其对应含义，请参见[上游表情注释文档](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small/blob/main/EMOJI_ANNOTATIONS.md)。表情符号属于风格线索，生成结果可能有所波动。

## 长语音消息

较长的文本会被拆分成多个分块，并在生成后拼接为一个语音消息返回。长文本请求可能会超出默认的 240 秒超时时间；如有需要请调大 `TTS_SYNTHESIZE_TIMEOUT_MS`。设置 `IRODORI_CHUNKING_ENABLED=false` 可禁用分块，设置 `IRODORI_CHUNK_MIN_CHARS` 可调整拆分阈值。

## 使用 Sway 采样加速推理

默认配置仍然是 Irodori 更高质量的 40 步线性采样。若想降低延迟，可以尝试使用步数更少的 Sway 采样：

```powershell
$env:IRODORI_NUM_STEPS = "6"
$env:IRODORI_T_SCHEDULE_MODE = "sway"
$env:IRODORI_SWAY_COEFF = "-1.0"
```

这是推理质量与速度之间的权衡，请在正式应用前结合你选定的检查点和声音进行测试。

## 环境变量

| 变量 | 默认值 | 用途 |
|---|---|---|
| `IRODORI_TTS_MODEL_ID` | `Aratako/Irodori-TTS-v4.1-Small` | Hugging Face 模型仓库或受支持的仓库/子文件夹路径 |
| `IRODORI_TTS_CHECKPOINT` | 未设置 | 可选的本地 `.pt` 或 `.safetensors` 检查点；会覆盖 Hugging Face 模型设置 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | 服务器绑定地址；参见[网络访问](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `IRODORI_TTS_PORT` | `8013` | 服务器端口 |
| `IRODORI_MODEL_DEVICE` | `auto` | 模型设备（`auto`、`cuda`、`cpu`、`mps`、`xpu`） |
| `IRODORI_CODEC_DEVICE` | `auto` | 编解码器设备 |
| `IRODORI_MODEL_PRECISION` | 在 CUDA 上为 `bf16`，否则为 `fp32` | 模型精度 |
| `IRODORI_CODEC_PRECISION` | `fp32` | 编解码器精度 |
| `IRODORI_COMPILE_MODEL` | `false` | 为 Irodori 模型启用 `torch.compile` |
| `IRODORI_COMPILE_DYNAMIC` | `false` | 编译时启用动态形状（dynamic shapes） |
| `IRODORI_NUM_STEPS` | `40` | Euler 采样步数 |
| `IRODORI_T_SCHEDULE_MODE` | `linear` | 采样调度策略（`linear` 或 `sway`） |
| `IRODORI_SWAY_COEFF` | `-1.0` | 使用 `sway` 调度时的 Sway 系数 |
| `IRODORI_CFG_SCALE_TEXT` | `3.0` | 文本引导强度 |
| `IRODORI_CFG_SCALE_CAPTION` | `3.0` | 描述文本 / VoiceDesign 引导强度 |
| `IRODORI_CFG_SCALE_SPEAKER` | `5.0` | 参考说话人引导强度 |
| `IRODORI_MAX_REF_SECONDS` | 检查点默认值 | 参考音频时长的可选上限 |
| `IRODORI_CHUNKING_ENABLED` | `true` | 在符合条件的标点处拆分长文本并拼接生成的音频分块 |
| `IRODORI_CHUNK_MIN_CHARS` | `80` | 强句末标点拆分前的最小非空白字符数；逗号作为后备拆分点，阈值约为该值的 1.5 倍 |
