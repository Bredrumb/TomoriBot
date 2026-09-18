---
title: "图像生成"
sidebar:
  order: 1
---

TomoriBot 可以根据文本提示词生成图像，也可以通过编辑参考图来生成。用
`/generate image`，或者直接问她（「给我画一只喝咖啡的小熊猫」）。

## 她能做什么

- **文生图**：根据提示词生成。
- **图生图**：编辑或转换整张参考图的风格。
- **局部重绘（Inpainting）**：在保留其余部分的前提下重画某个特定区域。
- **扩图（Outpainting）**：把画布扩展到原始画面之外。
- **可自定义的画面比例**。
- **参考图**可以来自消息附件、贴纸、表情，或者用户与人格
  的头像。把某条消息指给她，或者点名某个用户或人格，就能把对方的头像拿来当
  参考。

哪些编辑模式可用取决于后端。文生图和图生图
在内置云端提供方（Google、Vertex、OpenRouter）上可用，而**局部重绘与
扩图由本地 [ComfyUI](/en/self-hosting/local-endpoints/setup-comfyui/)
自定义端点提供**，并受该端点声明的能力限制。后端做不到的东西
会直接对她隐藏，所以她不会提供一个你的部署并不支持的模式。

她生成图像时，会使用你这个人格的 Physical Appearance 上下文，加上默认的
正向与负向标签（在后端支持负向提示词的前提下）。结果会以 Discord 媒体画廊的形式
投递，并带上生成时的细节，包括引用了哪些用户或人格。

## 标签自定义

上面每一个标签来源都可以编辑，而且各自的作用范围不同。这些都会打开一个预填了当前标签的弹窗，
所以你是就地编辑：

- **`/config` > 人格 > 外观**：所选人格的 **Physical Appearance** 标签（*她*
  长什么样）。需要管理服务器权限。
- **`/personal config`**：*你自己*的外貌标签，在某次生成
  引用到你时生效。会跟着你走过每一个服务器（见
  [个性化](/zh-CN/features/knowledge/personalization/)）。
- **默认正向与负向标签**在 **`/config` > 模型 > 图像生成默认值**：
  加到每次生成里（或者引导模型避开）的全服务器默认标签。负向
  标签只在后端支持负向提示词时才生效。用空框提交弹窗
  会把这些列表重置为内置默认值。

## 设置

1. 用 `/config` > 模型 > 切换模型 配置一个图像模型。
2. 确认图像生成被允许：它由 `imagegen_enabled` 功能
   （`/config` > 权限）控制。
3. 让她生成，或者运行 `/generate image`。

## 提供方支持

原生图像生成可在 **Google、Vertex AI、Vertex AI Express、OpenRouter、
Z.ai、NVIDIA NIM** 和 **NovelAI** 上使用（动漫风格；原生局部重绘已经写好、即将
推出，目前在完善边缘融合期间处于关闭状态）。完整的支持
对照表以及如何添加提供方，见
[提供方与模型](/zh-CN/features/setup-administration/providers-and-models/#支持的提供方)。

想用你自己的硬件通过 ComfyUI 做**本地**图像生成，见
[设置：ComfyUI](/en/self-hosting/local-endpoints/setup-comfyui/)。
