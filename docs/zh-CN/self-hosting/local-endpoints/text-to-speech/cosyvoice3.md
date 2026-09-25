---
title: "CosyVoice 3"
---

CosyVoice 3 是 Alibaba/QwenAudio 多语言 CosyVoice 语音合成项目的当前一代。TomoriBot 把官方运行时封装在 `servers/tts/cosyvoice3/` 里，并对外暴露与其他本地语音端点相同的 `POST /synthesize` 接口。

TomoriBot 默认使用官方的 **`FunAudioLLM/Fun-CosyVoice3-0.5B-2512`** 检查点。它是上游推荐的当前 CosyVoice 3 版本，使用正常的未量化模型，体积足够小，可以在 16 GB 的 NVIDIA GPU 上轻松运行，同时保留 CosyVoice 的低延迟设计。

## 它支持什么

当前的 CosyVoice 3 版本支持：

- 中文、英语、日语、韩语、德语、西班牙语、法语、意大利语与俄语
- 18 种以上的中文方言与口音
- 零样本语音克隆
- 多语言与跨语言语音克隆
- 用于语言、方言、情绪、语速与音量的自然语言指令
- 上游运行时中的细粒度控制，包括 `[breath]` 与 `[laughter]`
- 上游运行时中的文本输入与音频输出流式传输

官方 CosyVoice 3 示例目前包含一个关于日语的重要提醒：日语文本是在转换成片假名之后展示的。日语是受支持的语言，但如果用正常的日语书写方式发音效果不佳，把合成文本转换成片假名就是上游推荐的兼容处理。

## TomoriBot 如何映射请求

封装程序接受 `tts-clone` 常用的这些字段：

- `text`
- `ref_audio`
- `ref_text`
- `instruct`
- `language`

它按下面的规则选择当前 CosyVoice 3 的 API：

| 请求 | CosyVoice 3 路径 |
|---|---|
| 参考音频 + 语音转写 | `inference_zero_shot` |
| 不带语音转写的参考音频 | `inference_cross_lingual` |
| `instruct` 或显式的 `language` | `inference_instruct2` |

为了获得最好的普通克隆质量，请同时提供参考音频与匹配的语音转写。CosyVoice 3 当前的指令 API 以参考音频为条件，但不再同时接受参考语音转写，所以使用 `instruct` 的请求会切换到官方的 `inference_instruct2` 路径。

### 风格与情绪控制

请用 **Plain** 标记注册该端点。表达方式的指导应当放在端点的全局 `voice_instructions` 字段里，而不是放在任意的行内方括号标签中。这样能保住指令对整段话的含义，也避免把 `[happy] Hello. [sad] Goodbye.` 这样的脚本当成两条互相矛盾的全局指令。原生的 `[breath]` 与 `[laughter]` 支持被有意推迟，直到 TomoriBot 能够声明一项精确的、能感知提供方的标签功能为止。

`/synthesize` 的 `instruct` 字段会被传入 CosyVoice 3 的指令条件。例如 `sound relieved but still tired`、`speak as quickly as possible`，或 `speak quietly with restrained excitement`。

## 流式传输

CosyVoice 3 在上游支持双向流式传输。该项目同时记录了文本输入流式与音频输出流式，在其优化配置下，首个音频的延迟可以低到大约 150 ms。

TomoriBot 当前的自定义语音合成接口期望为一条 Discord 语音消息返回一整段音频，所以这个服务器会返回完整的 WAV，并把上游推理默认设为 `stream=False`。只有在测试上游生成器时才设置 `COSYVOICE3_UPSTREAM_STREAM=1`；在流式语音传输出现之前，它并不会降低 TomoriBot 的响应延迟。

## 硬件

推荐的 TomoriBot 起点：

- NVIDIA GPU，**16 GB 显存**
- Python **3.10**
- 与 CUDA 12 兼容的较新 NVIDIA 驱动
- `git`
- `ffmpeg`，用于 TomoriBot 的语音样本归一化
- 如果出现上游音频兼容性问题，Linux 上需要 `sox` 与 `libsox-dev`

模型本身是 0.5B 参数，不需要量化就能放进 16 GB 的显卡。Hugging Face 检查点的下载体积远大于参数量所暗示的大小，因为它还附带 flow 模型、语音分词器、英语文本模型，以及基础版与 RL 两套 LLM 权重。请为当前的模型包预留大约 10 GB 磁盘空间，另外还要算上 Python 环境与运行时。

CPU 推理可以通过上游运行时进行，但不是低延迟 Discord 语音用途的推荐路径。

## 安装

### Linux / WSL2（推荐）

从 TomoriBot 仓库根目录：

```bash
bash servers/tts/cosyvoice3/install-cosyvoice3.sh
servers/tts/cosyvoice3/.venv/bin/python servers/tts/cosyvoice3/server.py
```

或者一起启动已配置的服务器与 TomoriBot：

```bash
bun run launch --cosyvoice3
```

安装程序会：

1. 把经过审查的 `QwenAudio/CosyVoice` 提交 `074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc` 递归检出到 `servers/tts/cosyvoice3/CosyVoice/`；
2. 创建 `servers/tts/cosyvoice3/.venv`；
3. 安装当前上游 CosyVoice 的依赖，再加上这一小套封装程序依赖；
4. 把 `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` 以 Hugging Face 修订版 `29e01c4e8d000f4bcd70751be16fa94bf3d85a18` 下载到 `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B/`。

重新运行会保持这些确切的修订版；要改用更新的修订版，请同时修改安装程序中的两个固定值。如果运行时检出目录有本地修改，安装程序会拒绝在其上重新安装。

上游依赖目前使用 PyTorch 2.3.1 与 CUDA 12.1 包索引、Linux 上的 CUDA 12 ONNX Runtime 包，以及 Linux 上的 TensorRT 10.13 包。如果你使用的硬件需要更新的 PyTorch CUDA 构建，请在装完上游依赖之后，在服务器的 venv 里安装兼容的 PyTorch 构建，并用你的驱动测试它。

### Windows PowerShell

原生 Windows 作为尽力而为的路径提供：

```powershell
.\servers\tts\cosyvoice3\install-cosyvoice3.ps1
.\servers\tts\cosyvoice3\.venv\Scripts\python.exe servers\tts\cosyvoice3\server.py
```

要使用 NVIDIA GPU，**推荐 WSL2**。当前的上游依赖在 Linux 上安装 GPU 版 ONNX Runtime，在 Windows 上却安装 CPU 版，所以 WSL2 更接近 CosyVoice 项目为低延迟而优化和测试的配置。

## 在 TomoriBot 中注册

运行 `/providers`，选择`添加新自定义端点`，并配置语音端点：

- 功能：`Speech`
- API 兼容性：`tts-clone`
- 端点 URL：`http://127.0.0.1:8017`
- 语音来源模式：`Clone`
- 脚本标记风格：`Plain`
- 支持 Instruct：`Yes`

保存连接后，选中它并添加一个 Speech 模型。一个清晰的模型代码是 `Fun-CosyVoice3-0.5B-2512`。

然后打开 `/config` > 模型 > 切换模型，启用 CosyVoice 3 语音端点。

## 指定人格语音

对于普通的零样本克隆：

1. 准备一段干净的 3 到 30 秒样本，只有一位说话者，背景噪音很小或没有。
2. 打开 `/config`，进入模型 > TTS 参数与语音，上传该样本。
3. 尽可能填入匹配的语音转写。CosyVoice 3 会在有转写文本支持的零样本路径中使用它，而它会作为提示前缀被分词，所以它应该描述实际被使用的音频：也就是片段最前面的 30 秒。
4. 打开 `/config`，进入人格 > 语音，把该样本指定给这个人格。

CosyVoice 的语音分词器以 30 秒的提示窗口工作，而上游是用失败来强制这一点：上游自己的网页界面会提示你把提示音频保持在 30 秒以下，而分词器会断言这个上限，而不是缩短音频本身。本地服务器改为截短，所以较长的片段会被截到最前面的 30 秒并继续合成，截短会记录在服务器的控制台。

截短会就地读取片段，这意味着说话者嵌入取自与提示语音 token 相同的最前面 30 秒。CosyVoice 用来做条件设定的就是这个配对，所以较长的参考音频不会失去引擎原本会使用的任何内容。实际影响是，较长的上传只有最前面的 30 秒会影响声音，其余部分会被上传并存储，却不会被使用。

把指定给这个人格的样本保持在 10 到 20 秒，就能轻松落在这个窗口内，也能让存储的语音转写与模型读取的音频保持一致。

跨语言克隆是受支持的。参考说话者可以说与生成文本不同的语言。如果拿不到参考语音转写，封装程序会使用 CosyVoice 3 专用的跨语言路径。

## 用 `/generate voice-message` 测试

用 `/generate voice-message` 测试当前生效的端点，不必等一次普通对话轮次来选中语音工具。你可以使用人格已配置的样本，也可以上传一次性样本。上传样本时，尽可能在弹窗里提供它的语音转写。

想要有表现力的表达方式，可以在弹窗里输入一个全局的表达方式指导，或者让语音工具发送 `voice_instructions`。请让朗读脚本保持纯文本；任意的行内风格标签会在合成前被去掉，而不会被错误地当成整段话的指令。

## 环境变量

| 变量 | 默认值 | 用途 |
|---|---|---|
| `COSYVOICE3_MODEL_DIR` | `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B` | 本地检查点目录 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | 封装程序绑定地址; 参见[网络访问](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `COSYVOICE3_PORT` | `8017` | 封装程序端口 |
| `COSYVOICE3_UPSTREAM_STREAM` | `0` | 启用 CosyVoice 内部的流式生成器 |
| `COSYVOICE3_SPEED` | `1.0` | 传给上游推理的全局数值速度倍数 |
| `COSYVOICE3_DEFAULT_INSTRUCT` | 空 | 请求未提供指令时附加的可选指令 |
| `COSYVOICE3_FP16` | `0` | 要求官方运行时使用其 fp16 模式 |
| `COSYVOICE3_LOAD_TRT` | `0` | 在准备妥当的情况下启用上游 TensorRT 加载 |
| `COSYVOICE3_LOAD_VLLM` | `0` | 在安装了各自独立依赖的情况下启用上游 vLLM 加载 |

默认会关闭 TensorRT、vLLM 与 fp16。普通的 PyTorch 运行时已经能放进目标 16 GB GPU，安装也更简单，并且能避免把默认路径变成专门为优化而设的配置。

## 性能与模型变体

### 默认：基础版 `Fun-CosyVoice3-0.5B-2512`

这是 TomoriBot 推荐的默认选择。它有很强的说话者相似度，支持当前 CosyVoice 3 的所有克隆与指令模式，而且在 16 GB GPU 上不需要量化。

### RL 权重

当前的检查点包还包含 `llm.rl.pt`。上游分别发布基础版与 RL 的结果。RL 权重能改善部分内容错误指标，而在发布的表格里，基础版结果保留了略强的说话者相似度分数。因为 TomoriBot 强调人格语音克隆，封装程序仍然把普通的 `llm.pt` 作为默认。

当前的官方加载器总是读取名为 `llm.pt` 的文件。要想在不覆盖默认安装的情况下试验 RL 权重，请复制模型目录，用 `llm.rl.pt` 替换副本里的 `llm.pt`，然后让 `COSYVOICE3_MODEL_DIR` 指向那个副本。

### vLLM 与 TensorRT

CosyVoice 3 还支持可选的 vLLM 与 TensorRT 路径。上游目前记录了使用 V1 引擎的 vLLM 0.11.x+，以及作为旧路径的 vLLM 0.9.0。这些运行时在版本与硬件上有额外限制，所以 TomoriBot 默认不安装也不启用它们。

只有在普通的 PyTorch 服务器跑通之后才使用它们。对 Discord 语音消息这类工作负载来说，避免额外的运行时复杂性通常比优化一个本来就只有 0.5B 的模型更有用。

## 许可证

当前 CosyVoice 代码仓库采用 **Apache License 2.0** 许可，`FunAudioLLM/Fun-CosyVoice3-0.5B-2512` 这个 Hugging Face 仓库也标注为 **Apache-2.0**。

上游模型卡还包含一段免责声明，说明所展示的内容用于学术演示，其中一些示例可能来自互联网。上游有一个公开讨论，要求明确澄清该免责声明与权重商业使用之间的关系。TomoriBot 不分发该模型。自部署者应当针对自己的部署审查当前的上游许可与模型卡条款，尤其是在商业使用之前。
