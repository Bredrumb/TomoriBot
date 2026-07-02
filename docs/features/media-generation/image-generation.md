---
title: "Image Generation"
sidebar:
  order: 1
---

TomoriBot can generate images from a text prompt or by editing a reference image. Use
`/generate image`, or just ask her ("draw me a red panda drinking coffee").

## What She Can Do

- **Text-to-image** — generate from a prompt.
- **Image-to-image** — edit or restyle a reference image.
- **Customizable aspect ratios**.
- **Reference images** can come from message attachments, stickers, emojis, or user/persona
  avatars. Point her at a message, or name a user/persona to pull in their avatar as a
  reference.

When she generates an image, she uses your persona's Physical Appearance context plus default
positive and negative tags (where the backend supports negative prompts). The result is
delivered as a Discord media gallery with generation-time details, including any referenced
users or personas.

## Setup

1. Configure an image model with `/model image`.
2. Make sure image generation is allowed — it's gated by the `imagegen_enabled` capability
   (`/capabilities`).
3. Ask her to generate, or run `/generate image`.

## Provider Support

Native image generation is available on **Google, Vertex AI, Vertex AI Express, OpenRouter,
Z.ai, NVIDIA NIM**, and **NovelAI** (anime-styled, with inpainting). For the full support
matrix and how to add a provider, see
[Providers & Models](/features/providers-and-models/#supported-providers).

For **local** image generation with your own hardware via ComfyUI, see
[Setup: ComfyUI](/self-hosting/setup-comfyui/).
