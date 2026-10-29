---
title: "配置：ComfyUI"
sidebar:
  label: "ComfyUI"
  order: 2
aiGenerated: false
---

TomoriBot 可以通过你自己的
[ComfyUI](https://github.com/comfyanonymous/ComfyUI) 实例生成图像和视频。它驱动 ComfyUI 的方式是提交一份 API 格式工作流，其中替换进你的提示词与尺寸，然后轮询
ComfyUI 的 `/history` 端点，直到输出就绪。

本指南涵盖 ComfyUI 的安装、运行与注册。编写或编辑与 TomoriBot 兼容的工作流（`{TOMORI_*}` 占位符），请使用 GitHub 上的
[workflow README](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows)。

:::note[不需要环境变量]
ComfyUI 通过 Discord 斜杠指令注册，并加密存储在数据库中。
参见[本地端点总览](/self-hosting/local-endpoints/)。
:::

## 硬件要求

图像与视频生成受限于 GPU：主要开销在于显存（VRAM，显卡内存，独立于系统 RAM），由工作流加载的模型检查点决定。强烈建议使用 NVIDIA GPU。TomoriBot 自带的两份工作流均基于现代的、比 SDXL 更大的模型：

| 自带工作流 | 基础模型 | 实际所需 VRAM | 备注 |
|---|---|---|---|
| Anima v1（图像） | Qwen-Image（约 20B），fp8 | 约 16 GB 起步 · 24 GB 更从容 | 文本编码器加 VAE 会额外带来约 8 到 10 GB 开销。低于 16 GB 时，请用 GGUF 版本加 `--lowvram`。 |
| WAN i2v loop（视频） | Wan 2.2 14B，fp8 加 4 步 LightX2V LoRA | 约 16 GB 可用 · 24 GB 以上更从容 | 最重的一个，预计每个片段要几分钟。在较小的显卡上把 UMT5 文本编码器卸载到内存（`t5_cpu`，需要 24 GB 以上系统内存）。 |

自带的两份检查点都已经做过 fp8 量化，以便装进消费级显卡。如果你的 VRAM 更少，就把 UNET 换成更小的量化版本，并启用 ComfyUI 的 `--lowvram` 或 CPU 卸载。纯 CPU 扩散不实用（每张图要好几分钟，视频更糟），而且可能超出 TomoriBot 的轮询窗口，所以日常使用实际上必须有 GPU。

:::tip[进一步降低要求：选择 GGUF 量化]
若想进一步缩减体积，可从 Hugging Face 下载该模型的 GGUF 构建版本：名称中像 `Q4_K_M` / `Q5_K_M` 这样的代号代表每个权重的比特数，4 比特（Q4）或 5 比特（Q5）通常是平衡点，能在占用 fp8/fp16 一小部分显存的同时保留大部分质量。在 ComfyUI 中加载 GGUF UNET 需要
[ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF) 自定义节点。
:::

## 1. 启用 API 运行 ComfyUI

按[它的 README](https://github.com/comfyanonymous/ComfyUI) 安装 ComfyUI，并以监听网络的方式启动它：

```sh
python main.py --listen 0.0.0.0 --port 8188
```

如果 TomoriBot 跑在 Docker 里或另一台机器上，`--listen 0.0.0.0` 就很重要：默认只绑定回环地址。请确认从 bot 所在的那台机器能访问到它：

```sh
curl http://127.0.0.1:8188/system_stats
```

如果你想先测一下，就加载你选定的工作流所需要的模型检查点，并在 ComfyUI 网页界面里手动生成一次，确认端到端能跑通，再接上 TomoriBot。

## 2. 获取一份 TomoriBot 工作流

下载一份开箱可用的 API 格式工作流。示例可以在仓库的
[`assets/comfyui-workflows/`](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows) 下找到：

| 工作流 | 模式 |
|----------|-------|
| Anima v1（图像）：`tomoribot-anima-v1-comfyui.json` | `txt2img`、`img2img`、`inpaint` |
| WAN i2v loop（视频）：`tomoribot-wan-i2v-loop-video.json` | 图生视频 |

这些均为 API 格式（ComfyUI 通过 *Save (API Format)* 导出的 JSON），而非普通的界面保存格式。如果你自行编写工作流，必须包含 TomoriBot 替换所需的 `{TOMORI_*}` 占位符（提示词、宽高、种子、参考图等）。参见
[workflow README](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows) 以及
`/help` 中“提供方”下的“自定义端点”页面。

## 3. 在 Discord 里注册它

运行 `/providers`（或 `/personal providers`），选择 `+ 添加新自定义端点`，然后填入：

| 字段 | ComfyUI 的取值 |
|---|---|
| `endpoint_label` | 你自选的名称，例如 `home-comfy` |
| API 兼容性 | `ComfyUI` |
| `endpoint_url` | `http://127.0.0.1:8188`（根地址，不要加 `/v1`） |
| `auth_token` | *（留空，除非你的 ComfyUI 位于身份验证之后）* |

保存连接之后，选中它，并从模型下拉菜单中选择 `+ 添加新的图像模型` 或 `+ 添加新的视频模型`。填入检查点的确切代号，并将从第 2 步下载的工作流 `.json` 上传到 `ComfyUI 工作流`。模型能力必须与工作流匹配（图像工作流 → `image`，视频工作流 → `video`）。

添加模型会自动将其设为当前生效的 `image`/`video`模型。在聊天中直接向 Tomori 提问即可触发生成。如果由于某种原因未生效，请运行 `/config` > 模型 > 切换模型并选择你注册的 ComfyUI 端点。

## 故障排查

- **添加时无法访问：** ComfyUI 绑定了回环地址，而 bot 在 Docker 中或在另一台主机上。使用 `--listen 0.0.0.0` 启动它，并使用 `http://host.docker.internal:8188` 或局域网 IP。
- **生成永远无法完成：** TomoriBot 会轮询 `/history`，直到输出出现。冷启动以及在 CPU 上运行大模型都可能超出轮询窗口。
- **提示词或尺寸被忽略，或者输出尺寸错误：** 工作流缺少必需的 `{TOMORI_*}` 占位符，或者你上传的是界面格式导出而非 API 格式。
- **能力选错：** 将 `image` 工作流注册在 `video` 下（反之亦然）将无法运行。请按匹配的能力重新添加。
