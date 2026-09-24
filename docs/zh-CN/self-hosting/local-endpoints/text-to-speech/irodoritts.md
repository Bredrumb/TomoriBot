---
title: "IrodoriTTS"
---

Irodori-TTS v4.1 是一个以日语为主的语音合成模型，在同一个检查点里同时具备语音克隆与基于描述文本的 VoiceDesign。TomoriBot 通过 `servers/tts/irodoritts/` 里的本地 FastAPI 封装程序来运行它。

默认模型是 `Aratako/Irodori-TTS-v4.1-Small`。兼容的 Hugging Face 检查点可以用 `IRODORI_TTS_MODEL_ID` 来选择，包括社区微调版本，例如 `phasefield-audio/Irodori-TTS-v4.1-Anime`。

## 设置

Irodori 现在使用 `uv` 管理依赖与 PyTorch 后端。请先安装 `uv`，然后在 TomoriBot 仓库根目录运行安装脚本。

### Windows PowerShell（NVIDIA）

```powershell
.\servers\tts\irodoritts\install-irodori.ps1 cu128
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

### Linux Bash（NVIDIA）

```bash
bash servers/tts/irodoritts/install-irodori.sh cu128
servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

安装脚本会创建 `servers/tts/irodoritts/.venv`，所以安装完成后 `bun run launch --irodoritts` 依然可用。

可用的后端有：

- `cu128`：Windows/Linux 上的 NVIDIA CUDA 12.8
- `cpu`：仅 CPU，或者通过 PyPI 使用 macOS 的 CPU/MPS
- `rocm`：Linux/WSL 上的 AMD ROCm
- `xpu`：Windows/Linux 上的 Intel XPU

默认端点 URL 是 `http://127.0.0.1:8013`。

## 使用其他检查点

默认模型是 `Aratako/Irodori-TTS-v4.1-Small`。兼容的 Hugging Face 仓库、社区微调版本（例如 `phasefield-audio/Irodori-TTS-v4.1-Anime`），以及本地检查点文件，都可以通过环境变量来配置。

启动边车服务时（直接用 Python，或通过 `bun run launch --irodoritts`），服务器会自动读取仓库根目录的 `.env`（或 `servers/tts/irodoritts/` 里的本地 `.env`），并在启动时把当前生效的模型 ID 记录到日志里。

### 通过 `.env`（持久生效）

在 TomoriBot 根目录的 `.env` 里加入：

```dotenv
IRODORI_TTS_MODEL_ID="phasefield-audio/Irodori-TTS-v4.1-Anime"
```

### 通过环境变量（每次会话）

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

如果你已经把检查点文件（`.pt` 或 `.safetensors`）下载到本地，请把 `IRODORI_TTS_CHECKPOINT` 设为它的路径：

```dotenv
IRODORI_TTS_CHECKPOINT="/path/to/custom_checkpoint.pt"
```

当前的 Irodori 会把检查点与 Hugging Face 仓库里附带的任何分词器资源一起下载。当模型仓库提供 Hugging Face 子文件夹变体时，`IRODORI_TTS_MODEL_ID` 也支持它们。

## 在 TomoriBot 中注册

运行 `/providers`，选择**添加新自定义端点**，并使用语音合成的 API 兼容性：

- API 兼容性：`tts-clone`
- `endpoint_url`：`http://127.0.0.1:8013`

保存连接后，选中它并用它的模型下拉菜单添加一个 Speech 模型。对 v4.1 来说，推荐的设置是：

- `Voice Source Mode`：`Auto`
- `Script Markup Style`：`Emoji`

`Auto` 让同一个 Irodori 端点同时支持 TomoriBot 的两种语音模式，因此情绪线索在发送时能完整保留：

- 在人格 > 语音 下指定了语音样本的人格，会发送一段存储的参考片段用于语音克隆。
- 在人格 > 语音 下设置了 VoiceDesign 提示词的人格，会发送保存的自然语言提示词，作为 Irodori 的描述文本条件。

如果你只想要参考音频的语音克隆，仍然可以把 `Voice Clone` 选为语音来源模式。

端点注册与模型设置请用 `/providers`。然后打开 `/config` > 模型 > 切换模型，选中并启用已注册的端点。

## 设置人格语音

### 语音克隆

1. 准备一段干净的日语语音片段，只有一位说话者，没有背景音乐。大约 30 秒就已经足够：超过这个长度后，多出的音频对音色还原度帮助很小，却会增加上传体积和推理时间。
2. 打开 `/config`，进入模型 > TTS 参数与语音，上传该片段。
3. 打开 `/config`，进入人格 > 语音，然后选择人格与语音样本。

Irodori v4.1 支持比旧的 v2 模型更长的参考条件，但干净的源音频仍然比单纯的时长更重要。

v4.1 运行时会按检查点默认值限制参考片段，v4.1 检查点把这个值设为 120 秒。更长的音频会被裁剪到该上限，而不是被拒绝，`IRODORI_MAX_REF_SECONDS` 可以覆盖它。因此，位于 TomoriBot 130 秒上传上限的片段仍然可用：Irodori 会以其中的前 120 秒作为条件。

这里并不是越长越好。上游指出，大约 30 秒的干净参考语音就已经能带来大部分可测量的说话人相似度提升，而且同一说话者的多段较短片段胜过一段长录音。片段更长时附带的参考 latent 步骤也会让每次合成请求更慢。只有当说话者的音色在整段录音中发生变化时，才需要超过 30 秒。

### VoiceDesign

1. 打开 `/config`，进入人格 > 语音。
2. 选择人格。
3. 输入一段自然语言描述，说明你想要的声音与表达方式。

TomoriBot 会把这段提示词作为 `instruct` 发送；Irodori 封装程序会把它映射到 v4.1 的 `caption` 条件。VoiceDesign 请求不需要存储参考片段。

TomoriBot 在把文本发送给语音合成之前，会去掉 Discord 自定义 emoji 写法。当 `script_markup: emoji` 时，Unicode emoji 会被保留，用于 Irodori 的文本条件。

## 用 Sway Sampling 加快推理

默认仍然是 Irodori 质量更高的 40 步线性采样。想要更低延迟，可以试试步数更少的 Sway Sampling：

```powershell
$env:IRODORI_NUM_STEPS = "6"
$env:IRODORI_T_SCHEDULE_MODE = "sway"
$env:IRODORI_SWAY_COEFF = "-1.0"
```

这是推理质量与速度之间的取舍，所以在把它固定下来之前，请先用你选择的检查点与语音测试。

## 为什么现在安装脚本更简单了

之前的 TomoriBot 安装程序会克隆并给 Irodori 的 `pyproject.toml` 打补丁、手动安装 `dacvae`，还固定了一个 v2 时代的旧 Irodori 提交。对那些较老的上游包布局来说，这些兼容处理是必要的，但对当前的 Irodori 已经不再合适。

边车服务现在有自己的 `pyproject.toml`，并遵循上游的 `uv` 后端设置。Irodori 与 `dacvae` 在那里仍然固定到已知提交，以保证安装可复现，但 TomoriBot 在安装过程中不再修改上游源代码。

## 环境变量

| 变量 | 默认值 | 用途 |
|---|---|---|
| `IRODORI_TTS_MODEL_ID` | `Aratako/Irodori-TTS-v4.1-Small` | Hugging Face 模型仓库，或受支持的仓库/子文件夹来源 |
| `IRODORI_TTS_CHECKPOINT` | 未设置 | 可选的本地 `.pt` 或 `.safetensors` 检查点；会覆盖 Hugging Face 模型 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | 服务器绑定地址; 参见[网络访问](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `IRODORI_TTS_PORT` | `8013` | 服务器端口 |
| `IRODORI_MODEL_DEVICE` | `auto` | 模型设备（`auto`、`cuda`、`cpu`、`mps`、`xpu`） |
| `IRODORI_CODEC_DEVICE` | `auto` | 编解码器设备 |
| `IRODORI_MODEL_PRECISION` | CUDA 上为 `bf16`，其他情况为 `fp32` | 模型精度 |
| `IRODORI_CODEC_PRECISION` | `fp32` | 编解码器精度 |
| `IRODORI_COMPILE_MODEL` | `false` | 为 Irodori 模型启用 `torch.compile` |
| `IRODORI_COMPILE_DYNAMIC` | `false` | 编译时启用动态形状 |
| `IRODORI_NUM_STEPS` | `40` | Euler 采样步数 |
| `IRODORI_T_SCHEDULE_MODE` | `linear` | 采样调度（`linear` 或 `sway`） |
| `IRODORI_SWAY_COEFF` | `-1.0` | 使用 `sway` 调度时的 Sway 系数 |
| `IRODORI_CFG_SCALE_TEXT` | `3.0` | 文本引导强度 |
| `IRODORI_CFG_SCALE_CAPTION` | `3.0` | 描述文本 / VoiceDesign 引导强度 |
| `IRODORI_CFG_SCALE_SPEAKER` | `5.0` | 参考说话者引导强度 |
| `IRODORI_MAX_REF_SECONDS` | 检查点默认值 | 参考音频时长的可选上限 |
