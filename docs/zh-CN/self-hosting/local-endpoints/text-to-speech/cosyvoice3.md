---
title: "CosyVoice 3"
aiGenerated: true
---

使用阿里巴巴的 [CosyVoice 3](https://github.com/QwenAudio/CosyVoice)，通过基于指令的情感表达合成自然的多语言人格语音。

CosyVoice 3 支持跨 9 种语言以及 18 种以上中文方言的零样本与跨语言语音克隆。TomoriBot 在 `servers/tts/cosyvoice3/` 中对官方运行时进行了包装，提供标准的 `POST /synthesize` 语音接口。自带的安装程序默认使用官方未量化的 `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` 模型，可在 16 GB 显存内流畅运行。

CosyVoice 支持 9 种语言与中文方言。如果日语发音不佳，上游建议将文本转换为片假名。

使用 `Plain` 脚本标记，并通过 `voice_instructions` 提供表达方式指导。提供匹配的参考文本可启用零样本克隆；若没有参考文本，服务器则使用跨语言克隆。指令控制会使用参考音频，但不使用其参考文本。

## 硬件要求

推荐硬件：

- 配备 16 GB 显存的 NVIDIA GPU
- Python 3.10
- 兼容 CUDA 12 的 NVIDIA 驱动
- `git`
- 用于语音样本标准化的 `ffmpeg`
- 若遇到音频兼容性问题，Linux 上需安装 `sox` 和 `libsox-dev`

0.5B 参数量的模型无需量化即可轻松装入 16 GB 显存。下载的检查点包含流模型、语音分词器、文本模型以及强化学习权重，加上 Python 依赖大致需要 10 GB 磁盘空间。

虽然上游在技术上支持 CPU 推理，但其运行速度过慢，无法满足 Discord 语音交互的需求。

## 安装

### Linux 与 WSL2（推荐）

在 TomoriBot 代码仓库根目录下执行：

```bash
bash servers/tts/cosyvoice3/install-cosyvoice3.sh
servers/tts/cosyvoice3/.venv/bin/python servers/tts/cosyvoice3/server.py
```

或者将已配置的服务器与 TomoriBot 一同启动：

```bash
bun run launch --cosyvoice3
```

安装程序会下载固定的运行时与模型版本，并拒绝覆盖包含未提交本地更改的代码检出目录。

上游依赖项会在 Linux 上安装 PyTorch 2.3.1 与 CUDA 12.1 包、CUDA 12 ONNX Runtime 包以及 TensorRT 10.13 包。如果你的 GPU 需要更新版本的 PyTorch，请在配置完成后在虚拟环境中安装兼容的 PyTorch 版本。

### Windows PowerShell

原生 Windows 作为尽力支持的备选路径提供：

```powershell
.\servers\tts\cosyvoice3\install-cosyvoice3.ps1
.\servers\tts\cosyvoice3\.venv\Scripts\python.exe servers\tts\cosyvoice3\server.py
```

在 Windows 上使用 NVIDIA GPU 时，强烈建议使用 WSL2。上游依赖在 Windows 上默认安装纯 CPU 版本的 ONNX Runtime，而在 Linux 与 WSL2 上安装的是 GPU 加速包。

## 在 TomoriBot 中注册

运行 `/providers`，选择 `+ 添加新自定义端点`，并配置语音端点：

- 功能：`Speech`
- API 兼容性：`tts-clone`
- 端点 URL：`http://127.0.0.1:8017`
- 语音源模式：`Clone`
- 脚本标记：`Plain`
- 支持 Instruct：`Yes`

保存连接之后，选中它并添加一个语音模型。清晰的模型代号推荐使用 `Fun-CosyVoice3-0.5B-2512`。

然后打开 `/config` > 模型 > 切换模型，激活 CosyVoice 3 语音端点。

## 指定人格语音

进行零样本语音克隆：

1. 准备一段 3 到 30 秒的干净音频片段，仅包含单人说话且背景噪音极小。
2. 打开 `/config` 下的模型 > TTS 参数与语音并上传该样本。
3. 若有匹配的参考文本，请一并输入。CosyVoice 3 会将此文本作为零样本克隆的提示前缀进行分词；它应当对应音频的前 30 秒内容。
4. 打开 `/config` 下的人格 > 语音，并将该样本分配给对应人格。

包装脚本会自动将参考音频截取至前 30 秒。跨语言克隆可使用与生成文本语言不同的参考说话人音频。

## 使用 `/generate voice-message` 测试

使用 `/generate voice-message` 可以直接测试语音合成，无需等待聊天自动触发。你可以使用人格已分配的样本进行测试，也可以上传带有参考文本的一次性音频。

若要指导情感与表达方式，可在弹窗中输入要求，或让人格提示词提供 `voice_instructions`。请保持发音文本为纯文本对话；内联样式标签会在合成前被自动剔除。

## 环境变量

| 变量 | 默认值 | 用途 |
|---|---|---|
| `COSYVOICE3_MODEL_DIR` | `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B` | 本地检查点目录 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | 包装脚本绑定地址；参见[网络访问](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `COSYVOICE3_PORT` | `8017` | 包装脚本端口 |
| `COSYVOICE3_UPSTREAM_STREAM` | `0` | 启用 CosyVoice 内部流式生成器 |
| `COSYVOICE3_SPEED` | `1.0` | 传递给上游推理的全局数字语速乘数 |
| `COSYVOICE3_DEFAULT_INSTRUCT` | 空 | 当请求未提供指令时附加的可选默认指令 |
| `COSYVOICE3_FP16` | `0` | 要求官方运行时使用 fp16 模式 |
| `COSYVOICE3_LOAD_TRT` | `0` | 在准备就绪时启用上游 TensorRT 加载 |
| `COSYVOICE3_LOAD_VLLM` | `0` | 在安装了单独依赖时启用上游 vLLM 加载 |

默认情况下，TensorRT、vLLM 和 fp16 均保持禁用。标准 PyTorch 运行时无需额外的运行时依赖即可在 16 GB 显存的 GPU 上轻松运行。

## 模型变体

若想尝试自带的强化学习（RL）权重，请复制模型目录，在副本中将 `llm.rl.pt` 重命名为 `llm.pt`，并将 `COSYVOICE3_MODEL_DIR` 指向该目录。可选的 vLLM 和 TensorRT 运行时需要单独安装额外依赖。

## 许可证

CosyVoice 代码仓库与 `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` 权重基于 Apache-2.0 许可证发布。

上游模型卡注明演示素材仅供学术评估使用。TomoriBot 本身不分发模型权重。在进行商业部署前，请针对你的具体应用场景审查上游许可与条款。
