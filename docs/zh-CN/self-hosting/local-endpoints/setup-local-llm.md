---
title: "配置：本地 LLM"
sidebar:
  label: "Local LLM"
  order: 1
aiGenerated: false
---

TomoriBot 可以使用任何与 OpenAI 兼容的本地 LLM 服务器进行文本生成与嵌入。

:::note[不需要环境变量]
本地模型通过 Discord 斜杠指令注册，并加密存储在数据库中。它们没有对应的 `.env` 设置。
:::

## 1. 运行你的模型服务器

本指南以 Ollama 为例走一遍流程，因为它最容易上手。你也可以使用任何你喜欢的服务器，特别是如果你已经是技术型用户的话！

安装 [Ollama](https://ollama.com)。下面的示例使用的是 Google 的 Gemma 4，但 [Ollama 的模型库](https://ollama.com/library)中的任何模型均可使用。

### 该拉取哪个尺寸？

本地模型运行在 GPU 的显存（VRAM，显卡内存，独立于系统 RAM）中。经验法则：模型至少需要在显存中留出相当于其下载体积的空间，再加上约 1 到 2 GB 用于对话上下文。根据你的显卡容量挑选能装下的最大 Gemma 4：

| 你的 GPU 显存 | 最合适的选择 | 下载大小（约） |
|---|---|---|
| 约 8 GB | `gemma4:e2b` | 7.2 GB |
| 约 12 GB | `gemma4:12b` | 7.6 GB |
| 约 16 GB | `gemma4:12b`（能完全装下），或 `gemma4:26b` | 7.6 / 18 GB |
| 24 GB 以上 | `gemma4:26b` 或 `gemma4:31b` | 18 / 20 GB |

下载大小基于 Ollama 的默认量化配置；精确数值请参见
[模型页面](https://ollama.com/library/gemma4)。不确定自己有多少显存？Windows 用户：任务管理器 > 性能 > GPU，查看“专用 GPU 内存”。

拉取选定的尺寸并启动服务器：

```sh
ollama pull gemma4:12b     # 换成适合你显存大小的标签
ollama serve               # 监听 http://127.0.0.1:11434
```

确认从 TomoriBot 所在的计算机能够访问到它：

```sh
curl http://127.0.0.1:11434/v1/models
```

记下实际安装的确切标签，这就是你要注册的模型名称：

```sh
ollama list
# NAME              ID            SIZE
# gemma4:12b        a1b2c3d4...   7.6 GB
```

## 2. 在 Discord 里注册它

运行 `/providers`（对全服务器生效）或 `/personal providers`（仅对自己生效），选择 `+ 添加新自定义端点`，然后填入：

| 字段 | Ollama 的取值 |
|---|---|
| `endpoint_label` | 你自选的名称，例如 `home-ollama` |
| API 兼容性 | `OpenAI-Compatible`（推荐）或 `Ollama` |
| `endpoint_url` | OpenAI 兼容模式使用 `http://127.0.0.1:11434/v1` · Ollama 模式使用 `http://127.0.0.1:11434` |
| `auth_token` | *（留空）* |

:::tip[选择与 API 兼容类型匹配的 URL]
`OpenAI-Compatible` 和 `Ollama` 均接受裸根地址，并会将其规范化为 `/v1` 基础路径。
`/chat/completions` 会自动追加，请勿手动填写。已经包含路径的 URL（例如
`https://openrouter.ai/api/v1` 或某个网关前缀）会按原样保存。
:::

保存连接之后，选中它，并从模型下拉菜单中选择 `+ 添加新的文本模型`。填入：

- **模型名称**（确切的 API ID）：`gemma4:12b`，即 `ollama list` 中显示的确切标签。
- **上下文窗口覆盖**：可选，仅适用于 Ollama 与 KoboldCPP。设置该数值（例如 `8192`、
  `16384`）可调高 Ollama 默认较小的 `num_ctx`，否则可能会截断
  TomoriBot 的长上下文。留空则使用服务器默认值。
- **各项开关**：若模型支持函数调用，请启用“工具调用”；仅视觉模型才启用“图像输入”；若模型能够良好处理 JSON schema，则启用“结构化输出”。在我们的示例中，Gemma 4 全部支持，因此全部勾选即可。

TomoriBot 会在保存时验证连接。如果提示端点无法访问，常见原因是 `localhost` 与 Docker 网络不匹配，或者缺少/多写了 `/v1`（参见
[注意事项与踩坑点](#注意事项与踩坑点)）。

添加模型会自动将其设为当前生效的 `text` 模型。直接在聊天中开始对话即可体验。如果由于某种原因未生效，请运行 `/config` > 模型 > 切换模型并选择你新注册的模型。

## 3.（可选）用于 RAG 的本地嵌入

选中已保存的端点，并在模型下拉菜单中添加一个嵌入模型（例如
`ollama pull nomic-embed-text`，模型名称填写 `nomic-embed-text:latest`）。RAG 功能还需要在 Postgres 中安装 pgvector。你可以参考此处的[手动安装](/self-hosting/manual-setup/)指南。

## 4.（可选）与 ComfyUI 共享单张 GPU
<!-- anchor: 4-optional-share-one-gpu-with-comfyui -->

如果文本模型与 ComfyUI 运行在同一张 GPU 上，TomoriBot 可以在 ComfyUI 图像或视频任务运行时卸载文本模型。任务执行期间收到的文本回复会等待 GPU 重新释放后再处理。

打开已保存的端点，点击“编辑端点”，并在“端点行为”下勾选“ComfyUI 任务期间卸载模型”。保存时 TomoriBot 会检查该 URL 处的服务器类型：

- **Ollama**：安装后即可直接使用。TomoriBot 会在任务开始前请求 Ollama 卸载模型，Ollama 会在收到下一次文本请求时重新加载它。
- **KoboldCpp**：使用 `--admin` 和 `--admindir` 启动 KoboldCpp，并将端点的身份验证令牌设置为管理员密码。TomoriBot 会使用 KoboldCpp 的管理员重载 API 卸载模型，并在任务完成后重新加载。

保存时其他服务器均会被拒绝，因为通用的 OpenAI 兼容服务器没有统一的模型卸载方式。

## 其他服务器

TomoriBot 支持任何兼容 OpenAI 的端点，但推荐使用以下服务器。它们均采用相同的流程：仅 URL 和少数注意事项有所不同。

### KoboldCPP

- 启动时启用内置的 OpenAI 兼容模式。默认：`http://127.0.0.1:5001/v1`。
- API 兼容性：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:5001/v1`。
- 与 Ollama 一样支持“上下文窗口覆盖”。
- 若要在 ComfyUI 任务期间卸载模型，启动时还需添加 `--admin` 与 `--admindir`（参见
  [与 ComfyUI 共享单张 GPU](#4-optional-share-one-gpu-with-comfyui)）。
- 支持加载 GGUF 模型；模型名称填写已加载模型报告的名称（通常为文件名主干），可查看 KoboldCPP 的 `/v1/models` 响应。

### llama.cpp（`llama-server`）

- 构建或安装 [llama.cpp](https://github.com/ggml-org/llama.cpp)，然后使用其自带的 OpenAI 兼容服务器提供 GGUF 服务：
  ```sh
  llama-server -m model.gguf -c 16384 --host 0.0.0.0 --port 8080
  ```
- API 兼容性：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:8080/v1`。
- 启动时使用 `-c` 设置上下文窗口，弹窗中的“上下文窗口覆盖”仅适用于 Ollama/KoboldCPP，在此处不起作用。
- 模型名称填写 `/v1/models` 报告的内容；可以使用 `--alias my-model` 指定一个整洁的别名。
- 如果使用 `--api-key` 启动，请将该密钥填入 `auth_token`。

### LM Studio

- 在 LM Studio 中，启动“本地服务器”（“开发者”标签页）。默认：`http://127.0.0.1:1234/v1`。
- API 兼容性：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:1234/v1`。
- 模型名称填写 LM Studio 为已加载模型显示的标识符。

### vLLM

- 使用 OpenAI 兼容服务器启动服务：`vllm serve <model>` → `http://127.0.0.1:8000/v1`。
- API 兼容性：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:8000/v1`。
- 如果使用 `--api-key` 启动 vLLM，请将该密钥填入 `auth_token`。
- 模型名称填写所提供服务的模型路径或名称（与 `/v1/models` 匹配）。

### LiteLLM（多后端代理）

- 运行 LiteLLM 代理；默认：`http://127.0.0.1:4000/v1`。
- API 兼容性：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:4000/v1`。
- 模型名称填写在 LiteLLM 配置中定义的模型别名。
- 如果代理启用了主密钥验证，请将其填入 `auth_token`。

### ChatMock（ChatGPT 账户 / Codex CLI）

由于需要系统提示词兼容处理，它配有专用的配置指南：
[配置：ChatMock](/self-hosting/local-endpoints/setup-chatmock/)。

## 从 Hugging Face 挑选模型

除了 Ollama 精选的模型库，[Hugging Face](https://huggingface.co) 还托管着成千上万的社区模型。KoboldCPP、llama.cpp 和 LM Studio 均支持加载 GGUF 格式：这是一种单文件打包格式，只需下载文件并将服务器指向它即可。

1. **寻找 GGUF**：在 Hugging Face 上搜索你的模型名称加上“GGUF”，社区量化维护者（如
   [bartowski](https://huggingface.co/bartowski)）通常会在热门模型发布后不久提供 GGUF 构建版本。优先选择指令/对话变体（名称以 `-Instruct` 或
   `-Chat` 结尾）；基础模型无法进行连贯对话。
2. **选择适合你显存的量化档位**：一个仓库通常会列出同一模型的多个量化等级，文件大小大致等于其所需的显存（加上约 1 到 2 GB 用于上下文，规则与上方的
   [尺寸表](#该拉取哪个尺寸)相同）。下载你选定档位的单 `.gguf` 文件。
3. **加载模型**：使用该文件启动 KoboldCPP 或 `llama-server`（参见
   [其他服务器](#其他服务器)），然后照常在 Discord 中注册端点。

:::tip[选择哪种量化档位？Q4 或 Q5 是最佳平衡点]
量化通过以更少的比特存储每个权重来缩小模型体积，代价是微小的质量损失。名称中像 `Q4_K_M` / `Q5_K_M` 这样的代号代表每个权重的比特数：**4 比特（Q4）或 5 比特（Q5）是通常的最佳平衡点**，能在仅占用 8 比特约一半体积的同时保留绝大部分质量。低于 4 比特质量会迅速劣化。在固定的显存预算下，**采用 Q4 量化的较大模型通常优于采用 Q8 量化的较小模型**。
:::

## 注意事项与踩坑点
<!-- anchor: notes-gotchas -->

- **每个标签对应一个端点条目**：若要注册共享同一服务器的多个模型，请选中已保存的端点并再次使用其模型下拉菜单。对于真正不同的服务器或 API 协议，请使用不同的标签。
- **模型名称是 API 标识符**：它是发送给服务器的确切字符串。填写错误是“连接成功但回复失败”最常见的原因。
- **在 Docker 中运行 TomoriBot？** 容器内的 `localhost` 不是你的宿主机。请使用
  `http://host.docker.internal:<port>`（Windows/macOS）或宿主机的局域网 IP，并将模型服务器绑定到 `0.0.0.0`。
- **使用 Compose？** 其 `RUN_ENV=development` 设置允许使用本地 HTTP 端点。生产环境运行时会强制使用 HTTPS 并屏蔽私有网络目标，除非调用方显式允许。在生产环境中 `FETCH_URL_ALLOW_PRIVATE_NETWORK=true` 允许 `fetch_url` 访问私有目标；它不会改变提供方端点规则。云元数据地址在任何模式下均保持屏蔽。
