---
title: "视频生成"
sidebar:
  order: 2
---

TomoriBot 可以根据文本提示词生成短视频，也可以让参考图动起来。
用 `/generate video`，或者直接问她。

## 她能做什么

- **文生视频**：根据提示词生成一段短片。
- **图生视频**：让参考图动起来（被引用消息里的第一张图
  会成为起始帧）。
- **循环图生视频**：在聊天里提出要求时，支持的模型可以把
  起始图复用为最后一帧。
- **可自定义的画面比例**。

图生视频和循环取决于所选模型的首帧与末帧能力。TomoriBot
会在提交付费任务前检查 OpenRouter 当前的视频模型目录，并在必要时请你去掉
图片、关闭循环，或者换一个兼容的模型。

视频生成使用**异步轮询流程**：请求先提交，然后
TomoriBot 轮询提供方直到成片就绪，完成后发布出来。大片子
可能要等一会儿。

## 设置

1. 用 `/config` > 模型 > 切换模型 配置一个视频模型。
2. 通过 `/config` > 权限 确认图像与媒体生成已获允许。
3. 让她生成，或者运行 `/generate video`。

## 提供方支持

原生视频生成可在 **Google、OpenRouter** 和 **Z.ai** 上使用。完整对照表见
[提供方与模型](/zh-CN/features/setup-administration/providers-and-models/#支持的提供方)。

想通过 ComfyUI 做**本地**视频生成（例如 WAN 图生视频工作流），见
[设置：ComfyUI](/zh-CN/self-hosting/local-endpoints/setup-comfyui/)。

关于内部的生成与轮询架构，见
[视频生成](/en/architecture/subsystems/video-generation/)参考。
