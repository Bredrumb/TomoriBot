---
title: "VoxCPM2"
aiGenerated: true
---

使用 OpenBMB 的 [VoxCPM2](https://github.com/OpenBMB/VoxCPM) 语音合成模型合成跨 30 种语言的富有表现力的 48 kHz 语音。

VoxCPM2 是一款 2B 参数的多语言语音模型，支持语音克隆、转写辅助终极克隆（Ultimate Cloning）以及自然语言语音设计。TomoriBot 通过 `servers/tts/voxcpm2/` 中的服务器连接到官方 `voxcpm` Python 库，在 16 GB 显存内即可轻松运行官方未量化的 `openbmb/VoxCPM2` BF16 检查点。

## 许可证

VoxCPM2 代码与模型权重基于 Apache-2.0 许可证发布，在遵守许可条款的前提下允许商用。TomoriBot 本身不分发模型权重；安装脚本会直接从官方 Hugging Face 仓库下载它们。

官方上游资源：

- [OpenBMB/VoxCPM](https://github.com/OpenBMB/VoxCPM)
- [Hugging Face 上的 openbmb/VoxCPM2](https://huggingface.co/openbmb/VoxCPM2)
- [VoxCPM 文档](https://voxcpm.readthedocs.io/)

## 支持的语言

VoxCPM2 官方支持 30 种语言，无需语言标签：

阿拉伯语、缅甸语、中文、丹麦语、荷兰语、英语、芬兰语、法语、德语、希腊语、希伯来语、印地语、印度尼西亚语、意大利语、日语、高棉语、韩语、老挝语、马来语、挪威语、波兰语、葡萄牙语、俄语、西班牙语、斯瓦希里语、瑞典语、他加禄语、泰语、土耳其语和越南语。

OpenBMB 还记载了若干中文方言。为了兼容通用的 TTS 规范，TomoriBot 仍可能发送 `language` 字段，但 VoxCPM2 会直接从合成文本中检测语言，包装脚本不会强制添加语言标签。

## 语音模式

对于克隆和语音设计，请使用 `Auto` 语音源模式与 `Plain` 脚本标记。提供参考文本可启用终极克隆；表达方式指令具有更高优先级，并在该请求中忽略参考文本。

## 硬件与运行时

推荐的运行环境：

- Python 3.10 到 3.12
- 配备 8 GB 显存或更多的 NVIDIA GPU 用于官方 BF16 运行时；12 到 16 GB 显存更为从容
- 最新的 NVIDIA 驱动，以及支持 CUDA 的 PyTorch 构建版本用于 GPU 加速
- 也支持 CPU 作为后备方案，但运行速度会慢很多

官方包还提供了 CPU 与 Apple MPS 设备选项。在 Windows 上，TomoriBot 可以直接原生运行标准 Python 包，不需要 WSL。Windows PowerShell 安装脚本默认安装支持 CUDA 的 PyTorch 构建（`cu124`）。

若要在纯 CPU 设备上显式安装，请传入 `-Cpu` 开关：

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1 -Cpu
```

如果你的原生 Windows PyTorch 安装需要手动重装或重新对齐驱动，请将支持 CUDA 的 PyTorch 构建直接安装到服务器的虚拟环境中：

```powershell
.\servers\tts\voxcpm2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

## 安装

服务器固定使用当前稳定的 `voxcpm` 2.0.3 包，并将 `openbmb/VoxCPM2` 下载到标准的 Hugging Face 缓存目录中。

### Linux 与 WSL Bash

在 TomoriBot 代码仓库根目录下执行：

```bash
bash servers/tts/voxcpm2/install-voxcpm2.sh
servers/tts/voxcpm2/.venv/bin/python servers/tts/voxcpm2/server.py
```

### Windows PowerShell

在 TomoriBot 代码仓库根目录下执行：

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1
.\servers\tts\voxcpm2\.venv\Scripts\python.exe servers\tts\voxcpm2\server.py
```

初次配置会下载数 GB 的模型权重。若想只配置 Python 环境而不预取模型，可设置 `VOXCPM2_PREFETCH=0`；官方库将在首次启动服务器时下载检查点。

Linux 与 WSL：

```bash
VOXCPM2_PREFETCH=0 bash servers/tts/voxcpm2/install-voxcpm2.sh
```

PowerShell：

```powershell
$env:VOXCPM2_PREFETCH = "0"
.\servers\tts\voxcpm2\install-voxcpm2.ps1
```

配置完成后，运行 `bun run launch --voxcpm2` 可将服务器与 TomoriBot 一同启动。默认端点为 `http://127.0.0.1:8016`。

## 在 TomoriBot 中注册

运行 `/providers`，选择 `+ 添加新自定义端点`，并配置语音端点：

- 功能：`Speech`
- API 兼容性：`tts-clone`
- 端点 URL：`http://127.0.0.1:8016`
- 语音源模式：`Auto`
- 脚本标记：`Plain`
- 支持 Instruct：`Yes`

保存连接之后，选中它并使用其模型下拉菜单添加语音模型。然后打开 `/config` > 模型 > 切换模型，选择 VoxCPM2 语音模型。

推荐使用 `Auto`，因为同一个服务器同时支持参考音频克隆与语音设计。你不需要为这两种模式分别运行独立的 VoxCPM2 进程。

## 人格语音克隆

用于需要模仿现有说话者音色的人格：

1. 准备一段干净的参考音频片段，仅包含单人说话，几乎无背景音乐。上游将 5 到 30 秒视为实用区间。
2. 打开 `/config` 下的模型 > TTS 参数与语音并上传音频片段。
3. 若有参考音频片段的精确文本，请一并输入。VoxCPM2 会将其用于终极克隆，能够还原更多参考音频的节奏、情感与风格。
4. 打开 `/config` 下的人格 > 语音，选择对应人格并分配保存好的语音样本。

如果未提供参考文本，VoxCPM2 仍会执行常规的参考音频语音克隆。

## 人格语音设计

用于需要根据文本描述而非参考音频创建的人格：

1. 打开 `/config` 下的人格 > 语音并选择“语音设计”。
2. 选择对应人格。
3. 输入自然语言描述，例如 `Young adult woman, soft warm voice, relaxed pace, slightly playful delivery`。

对于克隆语音，单次表达方式指令的优先级高于参考文本。

## 环境变量

| 变量 | 默认值 | 用途 |
|---|---|---|
| `VOXCPM2_MODEL_ID` | `openbmb/VoxCPM2` | Hugging Face 模型 ID 或本地模型目录 |
| `VOXCPM2_DEVICE` | `auto` | 运行时设备：`auto`、`cuda`、`cuda:N`、`cpu` 或 `mps` |
| `VOXCPM2_OPTIMIZE` | `1` | 启用官方运行时的优化 / 编译路径 |
| `VOXCPM2_LOAD_DENOISER` | `0` | 加载可选的上游降噪器；默认禁用以节省内存 |
| `VOXCPM2_CFG_VALUE` | `2.0` | 引导强度 |
| `VOXCPM2_INFERENCE_TIMESTEPS` | `10` | 流匹配推理步数；增加步数可提高质量但会牺牲速度 |
| `VOXCPM2_MAX_LEN` | `4096` | 最大生成长度 |
| `VOXCPM2_NORMALIZE` | `0` | 启用上游文本规范化 |
| `VOXCPM2_RETRY_BADCASE` | `1` | 启用上游针对异常生成结果的自动重试行为 |
| `VOXCPM2_RETRY_BADCASE_MAX_TIMES` | `3` | 最大自动重试次数 |
| `VOXCPM2_RETRY_BADCASE_RATIO_THRESHOLD` | `6.0` | 上游异常长度阈值 |
| `VOXCPM2_PREFETCH` | `1` | 仅限安装脚本：在安装过程中下载模型 |
| `VOXCPM2_PORT` | `8016` | VoxCPM2 本地服务器端口 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | 本地服务器绑定地址；参见[网络访问](/self-hosting/local-endpoints/text-to-speech/#network-access) |

参考音频必须是解码后不超过 10 MB 的非空 WAV 容器，包装脚本会在写入临时文件之前对此进行验证。
