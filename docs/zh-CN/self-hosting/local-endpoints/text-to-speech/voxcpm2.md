---
title: "VoxCPM2"
---

> **关于这份翻译：** 本页是英文版[VoxCPM2](https://docs.tomoribot.app/en/self-hosting/local-endpoints/text-to-speech/voxcpm2/)的翻译，仅为方便阅读而提供，内容以英文版为准。若本页与英文版有任何不一致，一律以英文版为准。

VoxCPM2 是 OpenBMB 的 2B 参数多语言语音合成模型。它支持 30 种语言、48 kHz 输出、自然语言形式的 Voice Design、参考音频语音克隆、可控克隆，以及借助参考文本的「终极克隆」。TomoriBot 通过 `servers/tts/voxcpm2/` 里的轻量封装程序来使用官方的 `voxcpm` Python 包。

默认模型是官方的 `openbmb/VoxCPM2` BF16 检查点。OpenBMB 报告标准运行时大约需要 **8 GB 显存**，所以常规模型可以轻松放进 16 GB 的 NVIDIA GPU，默认不需要量化检查点。

## 许可证

VoxCPM2 的代码与模型权重以 **Apache-2.0** 发布，在遵守许可证条款的前提下也包括商业使用。TomoriBot 不分发这些权重；安装程序会从官方 Hugging Face 仓库下载它们。

官方上游资源：

- [OpenBMB/VoxCPM](https://github.com/OpenBMB/VoxCPM)
- [Hugging Face 上的 openbmb/VoxCPM2](https://huggingface.co/openbmb/VoxCPM2)
- [VoxCPM 文档](https://voxcpm.readthedocs.io/)

## 支持的语言

VoxCPM2 官方支持 30 种语言，而且不需要语言标记：

阿拉伯语、缅甸语、中文、丹麦语、荷兰语、英语、芬兰语、法语、德语、希腊语、希伯来语、印地语、印度尼西亚语、意大利语、日语、高棉语、韩语、老挝语、马来语、挪威语、波兰语、葡萄牙语、俄语、西班牙语、斯瓦希里语、瑞典语、他加禄语、泰语、土耳其语和越南语。

OpenBMB 还记录了若干中文方言。为了兼容通用的 TTS 契约，TomoriBot 仍然可能发送 `language` 字段，但 VoxCPM2 会从合成文本中检测语言，封装程序不会强制加上语言标记。

## 语音模式

一个 VoxCPM2 端点就能处理 TomoriBot 所有有用的语音来源模式：

| TomoriBot 请求 | VoxCPM2 行为 |
|---|---|
| 只有 `text` | 会被拒绝；请选择参考样本或 VoiceDesign 提示词 |
| `text` + `instruct` | 根据自然语言描述进行语音设计 |
| `text` + `ref_audio` | 参考音频语音克隆 |
| `text` + `ref_audio` + `instruct` | 可控克隆：保留说话者，同时调整表达方式 |
| `text` + `ref_audio` + `ref_text` | 使用参考音频及其转写文本进行终极克隆 |
| `text` + `ref_audio` + `ref_text` + `instruct` | 可控克隆；一次性指令优先，转写文本不会发送 |

VoxCPM2 把自然语言描述放在待合成文本前的括号里，以此表示 Voice Design 与风格控制。TomoriBot 已经有用于此目的的 `instruct` 字段，所以封装程序会自动完成这个转换。

请使用 **Plain** 脚本标记风格。VoxCPM2 不需要 TomoriBot 保留方括号标签或表情符号控制语法，也不必新增脚本标记模式。

## 硬件与运行时

推荐的起点：

- Python **3.10-3.12**
- 用于官方 BF16 运行时的 NVIDIA GPU，**8 GB 显存或更多**；12-16 GB 会比较宽裕
- 最新的 NVIDIA 驱动，以及支持 CUDA 的 PyTorch 构建，用于 GPU 加速
- 也支持 CPU 作为兜底方案，但速度会慢得多

官方包还提供 CPU 与 Apple MPS 设备选择。在 Windows 上，TomoriBot 可以直接原生运行标准 Python 包；不需要 WSL。Windows PowerShell 安装程序默认安装支持 CUDA 的 PyTorch 构建（`cu124`）。

要在只有 CPU 的机器上显式安装，请传入 `-Cpu` 开关：

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1 -Cpu
```

如果你的原生 Windows PyTorch 安装需要手动重装或重新对齐驱动，请把支持 CUDA 的 PyTorch 构建直接安装到边车服务的虚拟环境里：

```powershell
.\servers\tts\voxcpm2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

OpenBMB 报告，在 RTX 4090 上使用标准运行时的 RTF 约为 0.30。上游还支持流式生成，并记录了更快的 Nano-vLLM 与 vLLM-Omni 服务方案。TomoriBot 当前的 `POST /synthesize` 契约只返回一个 WAV 响应，所以这个边车服务会有意缓冲生成的语音，而不对外暴露单独的流式协议。

## 安装

边车服务固定使用当前稳定的 `voxcpm` 2.0.3 包，并把 `openbmb/VoxCPM2` 下载到常规的 Hugging Face 缓存里。

### Linux / WSL Bash

在 TomoriBot 仓库根目录运行：

```bash
bash servers/tts/voxcpm2/install-voxcpm2.sh
servers/tts/voxcpm2/.venv/bin/python servers/tts/voxcpm2/server.py
```

### Windows PowerShell

在 TomoriBot 仓库根目录运行：

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1
.\servers\tts\voxcpm2\.venv\Scripts\python.exe servers\tts\voxcpm2\server.py
```

第一次安装会下载数 GB 的模型权重。如果只想安装 Python 环境而不预先拉取模型，请设置 `VOXCPM2_PREFETCH=0`；这样官方库会在服务器第一次启动时下载检查点。

Linux / WSL：

```bash
VOXCPM2_PREFETCH=0 bash servers/tts/voxcpm2/install-voxcpm2.sh
```

PowerShell：

```powershell
$env:VOXCPM2_PREFETCH = "0"
.\servers\tts\voxcpm2\install-voxcpm2.ps1
```

安装完成后，`bun run launch --voxcpm2` 会同时启动边车服务与 TomoriBot。默认端点是 `http://127.0.0.1:8016`。

如果设置了 `VOXCPM2_API_KEY` 或 `TOMORI_TTS_API_KEY`，请以启用认证的方式注册端点，并在 TomoriBot 中保存同一个密钥。启动器仍会探测无需认证的 `/health` 路由，而合成请求会使用 `Authorization: Bearer <key>`。

## 在 TomoriBot 中注册

运行 `/providers`，选择**添加新自定义端点**，然后配置语音合成端点：

- 功能：`Speech`
- API 兼容性：`tts-clone`
- 端点 URL：`http://127.0.0.1:8016`
- 语音来源模式：`Auto`
- 脚本标记风格：`Plain`
- 支持指令：`Yes`

保存连接后，选中它，用它的模型下拉菜单添加一个语音合成模型。然后打开 `/config` > 模型 > 切换模型，选择 VoxCPM2 语音模型。

推荐使用 `Auto`，因为同一个服务器同时支持参考音频克隆与语音设计。你不需要为这两种模式分别运行 VoxCPM2 进程。

## 人格语音克隆

对于应当克隆现有说话者的人格：

1. 准备一段干净的参考音频片段，只有一位说话者，背景音乐很少或没有。
2. 打开 `/config`，进入模型 > TTS 参数与语音，上传这段片段。
3. 如果拿得到参考片段的准确转写文本，就把它加上。VoxCPM2 会用它进行终极克隆，从而复现更多参考音频的节奏、情感与风格。
4. 打开 `/config`，进入人格 > 语音，选择该人格，并指定保存好的语音样本。

如果没有存储转写文本，VoxCPM2 仍然会执行常规的参考音频克隆。

## 人格语音设计

对于应当根据书面语音描述而不是样本来创建的人格：

1. 打开 `/config`，进入人格 > 语音，选择 VoiceDesign。
2. 选择该人格。
3. 输入一段自然语言描述，例如「年轻成年女性，柔和温暖的嗓音，节奏放松，表达略带俏皮」。

TomoriBot 会把保存好的描述作为 `instruct` 发送。VoxCPM2 会把它转换成本地 Voice Design 控制前缀。

当克隆人格同时收到一次性语音指令时，VoxCPM2 会使用可控克隆：参考样本提供说话者身份，而指令则调整情感、节奏或表达方式等特质。如果同时存储了转写文本，指令会优先，因为上游的终极克隆路径不提供可靠的控制指令模式；因此该请求会有意省略转写文本。

## `/generate voice-message`

一旦 VoxCPM2 成为当前生效的语音合成模型，`/generate voice-message` 就会像普通的语音消息工具调用一样，使用该人格配置好的语音来源：

- 克隆人格发送存储的 `ref_audio` 与可选的 `ref_text`；
- VoiceDesign 人格把保存的提示词作为 `instruct` 发送；
- 启用了支持指令的、具备克隆能力的端点会显示**表达方向**字段，并通过 `instruct` 传递一次性指令；
- 当存在指令且配有克隆样本时，TomoriBot 只使用 `reference_wav_path`，不发送转写文本相关字段。

## 环境变量

| 变量 | 默认值 | 用途 |
|---|---|---|
| `VOXCPM2_MODEL_ID` | `openbmb/VoxCPM2` | Hugging Face 模型 ID 或本地模型目录 |
| `VOXCPM2_DEVICE` | `auto` | 运行时设备：`auto`、`cuda`、`cuda:N`、`cpu` 或 `mps` |
| `VOXCPM2_OPTIMIZE` | `1` | 启用官方运行时的优化 / 编译路径 |
| `VOXCPM2_LOAD_DENOISER` | `0` | 加载可选的上游降噪器；默认关闭以节省内存 |
| `VOXCPM2_CFG_VALUE` | `2.0` | 引导强度 |
| `VOXCPM2_INFERENCE_TIMESTEPS` | `10` | 流匹配推理步数；增加步数可以提升质量，但会牺牲速度 |
| `VOXCPM2_MAX_LEN` | `4096` | 最大生成长度 |
| `VOXCPM2_NORMALIZE` | `0` | 启用上游的文本规范化 |
| `VOXCPM2_RETRY_BADCASE` | `1` | 启用上游针对异常生成的重试行为 |
| `VOXCPM2_RETRY_BADCASE_MAX_TIMES` | `3` | 最大自动重试次数 |
| `VOXCPM2_RETRY_BADCASE_RATIO_THRESHOLD` | `6.0` | 上游的异常长度阈值 |
| `VOXCPM2_PREFETCH` | `1` | 仅安装程序：在安装过程中下载模型 |
| `VOXCPM2_PORT` | `8016` | VoxCPM2 边车服务端口；未设置时回退到 `TOMORI_TTS_PORT` |
| `TOMORI_TTS_HOST` | `127.0.0.1` | 边车服务的绑定地址 |
| `TOMORI_TTS_PORT` | `8016` | 向后兼容的共享边车服务端口回退值 |
| `VOXCPM2_MAX_REF_AUDIO_BYTES` | `10485760` | 解码后的参考音频大小上限 |
| `VOXCPM2_API_KEY` | 未设置 | `/synthesize` 的可选 bearer token；也可以回退接受 `TOMORI_TTS_API_KEY` |
| `TOMORI_TTS_API_KEY` | 未设置 | `/synthesize` 共享的可选 bearer token 回退值 |
| `TOMORI_TTS_ALLOW_REMOTE_BIND` | `0` | 仅当要在没有 bearer token 的情况下允许非回环绑定时才设为 `1` |
| `TOMORI_TTS_MAX_TEXT_CHARS` | `2000` | 可接受的合成文本长度上限 |

参考音频必须是非空的 WAV 容器。封装程序会在写入临时文件之前强制执行解码后的字节上限。`/health` 始终保持无需认证，供本地就绪检查使用；只要配置了密钥，`/synthesize` 就要求 `Authorization: Bearer <key>`。除非已经部署了反向代理或有明确的远程策略，否则请保持默认的回环绑定。

## 备用检查点与运行时

官方 BF16 模型已经能放进预期的 16 GB 消费级 GPU 目标，所以 TomoriBot 默认不使用量化检查点。社区里存在一些量化版本，但它们会额外增加一层兼容性与维护负担，而常规安装并不需要。

对于高吞吐量的部署，OpenBMB 目前推荐把 Nano-vLLM-VoxCPM 和 vLLM-Omni 作为加速服务方案。那些运行时可以提供超出这个参考边车服务的流式与并发服务能力。它们并不是 TomoriBot 常规本地语音消息工作流所必需的，而这个封装程序有意停留在官方 `voxcpm` API 上，以便在上游模型升级时仍然容易跟进。
