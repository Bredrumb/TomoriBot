---
title: "配置：ComfyUI"
aiGenerated: false
sidebar:
  label: "ComfyUI"
  order: 3
---

TomoriBot可以通过你自己的[ComfyUI](https://github.com/comfyanonymous/ComfyUI)实例生成图像和视频。它驱动ComfyUI的方式是提交一份API格式工作流，将你的提示词与尺寸替换进去，然后轮询ComfyUI的`/history`端点直到输出就绪。

本指南涵盖ComfyUI的安装、运行与注册。如需编写或编辑与TomoriBot兼容的工作流（`{TOMORI_*}`占位符），请参阅GitHub上的[workflow README](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows)。

:::note[不需要环境变量]
ComfyUI通过Discord斜杠指令注册，并加密存储在数据库中。参见[本地端点总览](/self-hosting/local-endpoints/)。
:::

## 硬件要求

图像与视频生成受限于GPU：主要开销在于显存（VRAM，显卡内存，独立于系统RAM），由工作流加载的模型检查点决定。强烈建议使用NVIDIA GPU。TomoriBot附带的工作流需求如下：

| 自带工作流 | 基础模型 | 实际所需VRAM | 备注 |
|---|---|---|---|
| Anima turbo（图像） | Anima Turbo v1.1（2B），bf16 | 约8 GB可用 · 12 GB以上更从容 | 4.2 GB模型加上1.2 GB文本编码器，采用10步推理外加一次简短的2倍放大通道。使用角色参考图会额外增加约一半的生成时间。 |
| Anima detailed（图像） | Anima Aesthetic v1.1（2B），bf16 | 约8 GB可用 · 12 GB以上更从容 | 显存需求与turbo相同，但采用30步推理外加面部与手部细节修复器，因此单张图像耗时是前者的数倍。其他Anima模型位于[模型目录](https://huggingface.co/circlestone-labs/Anima/tree/main/split_files/diffusion_models)；工作流README介绍了如何切换。 |
| WAN i2v loop（视频） | Wan 2.2 14B，fp8加4步LightX2V LoRA | 约16 GB可用 · 24 GB以上更从容 | 最重的一个选项，预计每个片段需要几分钟。在显存较小的显卡上把UMT5文本编码器卸载到内存（`t5_cpu`，需要24 GB以上系统内存）。 |

Wan检查点已经做过fp8量化以便装进消费级显卡。如果你的显存更少，可以把UNET换成更小的量化版本，并启用ComfyUI的`--lowvram`或CPU卸载。纯CPU扩散不实用（每张图要好几分钟，视频更久），而且可能超出TomoriBot的轮询窗口，所以日常使用实际上必须有GPU。

:::tip[进一步降低要求：选择GGUF量化]
若想进一步缩减体积，可从Hugging Face下载该模型的GGUF构建版本：名称中像`Q4_K_M` / `Q5_K_M`这样的代号代表每个权重的比特数，4比特（Q4）或5比特（Q5）通常是平衡点，能在占用fp8/fp16一小部分显存的同时保留大部分质量。在ComfyUI中加载GGUF UNET需要[ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF)自定义节点。
:::

## 1. 启用API运行ComfyUI

按照[它的README](https://github.com/comfyanonymous/ComfyUI)安装ComfyUI。如果bot运行在同一台机器上，或者本机运行着Cloudflare Tunnel连接器，请将其保持在回环地址上：

```sh
python main.py --listen 127.0.0.1 --port 8188
```

对于独立托管的生产环境bot，请遵循[Cloudflare Tunnel指南中的ComfyUI配置](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/)。它可以在ComfyUI保持监听回环地址的同时提供公网HTTPS端点。在下方注册时使用其隧道URL；如果打算在无身份验证的情况下共享该URL，请先查看该指南中的[已知风险](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/#known-risks)。

对于运行在Docker中或受信任局域网内的bot，监听`0.0.0.0`可以让bot访问宿主机的端口。请使用宿主机防火墙限制访问权限；任何能够访问未开启身份验证的ComfyUI的人都可以提交工作流。非生产环境下的TomoriBot还需要在`ALLOW_PRIVATE_NETWORK`中允许该端点的主机和端口。确认本地API正常响应：

```sh
curl http://127.0.0.1:8188/system_stats
```

如果你想先测一下，可以加载所选工作流需要的模型检查点，在ComfyUI网页界面中手动生成一次以确认端到端跑通，然后再接入TomoriBot。

## 2. 获取一份TomoriBot工作流

下载一份开箱可用的API格式工作流。示例可在仓库的[`assets/comfyui-workflows/`](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows)下找到：

| 工作流 | 模式 |
|----------|-------|
| Anima turbo（图像，快速）：`tomoribot-anima-image-turbo.json` | 文生图、角色参考图、局部重绘/扩图 |
| Anima detailed（图像，较慢，带面部与手部细节修复）：`tomoribot-anima-image-detailed.json` | 文生图、角色参考图、局部重绘/扩图 |
| MOSS standard（图像，由多模态编码器重写提示词）：`tomoribot-moss-image.json` | 文生图、角色参考图 |
| MOSS detailed（图像，较慢，2倍放大并带面部与手部细节修复）：`tomoribot-moss-image-detailed.json` | 文生图、角色参考图 |
| WAN i2v loop（视频）：`tomoribot-wan-i2v-loop-video.json` | 图生视频 |

每个工作流都需要在ComfyUI特定文件夹中放置特定的自定义节点和模型文件。[workflow README](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows)列出了Anima和MOSS工作流所需的组件，并附有下载链接及每个文件应放入的文件夹路径。请在注册前先安装好这些组件，否则生成时会因缺少节点或`Value not in list`错误而失败。

这些均为API格式（ComfyUI通过*Save (API Format)*导出的JSON），而非普通的界面保存格式。如果你自行编写工作流，其中必须包含TomoriBot替换所需的`{TOMORI_*}`占位符（提示词、宽高、种子、参考图等）。参见[workflow README](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows)以及`/help`中「提供方」下的「自定义端点」页面。

## 3. 在Discord里注册它

运行`/providers`（或`/personal providers`），选择`+ 添加新自定义端点`，然后填入：

| 字段 | ComfyUI的取值 |
|-------|-------------------|
| `endpoint_label` | 你自选的名称，例如`home-comfy` |
| API 兼容性 | `ComfyUI` |
| `endpoint_url` | 同机bot：`http://127.0.0.1:8188`；生产环境隧道：`https://engine.example.com`（根地址，不要加`/v1`） |
| `auth_token` | 除非你的端点网关需要客户端密钥，否则留空 |

保存连接之后，选中它，并从模型下拉菜单中选择`+ 添加新的图像模型`或`+ 添加新的视频模型`。填入检查点的确切代号，并将第2步下载的工作流`.json`上传到`ComfyUI 工作流`。模型能力必须与工作流匹配（图像工作流 → `image`，视频工作流 → `video`）。

对于Anima工作流，请在`图像能力`下勾选`文生图`、`参考图像`和`局部重绘`。启用`参考图像`后，Tomori就能根据用户或人格的角色参考图来绘制角色。

添加模型会自动将其设为当前生效的`image`/`video`模型。在聊天中直接向Tomori提问即可触发生成。如果由于某种原因未生效，请运行`/config` > 模型 > 切换模型，并选择你注册的ComfyUI端点。

## 故障排查

- **添加时无法访问：**对于生产环境，请检查隧道、`/system_stats`路由，以及网关所需的客户端密钥（如有配置）。对于Docker或受信任的局域网，请检查监听地址、防火墙、宿主机地址以及TomoriBot的私有网络允许配置。
- **生成永远无法完成：**TomoriBot会轮询`/history`直到输出出现。冷启动以及在CPU上运行大模型都可能超出轮询窗口。
- **提示词或尺寸被忽略，或者输出尺寸错误：**工作流缺少必需的`{TOMORI_*}`占位符，或者你上传的是界面格式导出而非API格式。
- **缺少节点或`Value not in list`：**workflow README中要求的自定义节点包或模型文件尚未安装，或者模型文件被重命名。安装后重启ComfyUI再试即可，无需重新上传工作流。
- **能力选错：**将`image`工作流注册在`video`下（反之亦然）将无法运行。请按匹配的能力重新添加。
