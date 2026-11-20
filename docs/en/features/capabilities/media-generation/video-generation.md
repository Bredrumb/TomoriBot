---
title: "Video Generation"
sidebar:
  order: 2
---

TomoriBot can generate short videos from a description or animate an image. Ask her in chat or use
`/generate video`. For image-to-video, she uses the first image in the referenced message as the
starting frame. Supported models can also use it as the final frame to create a loop.

Image and loop support depend on the selected model. Video generation can take time; TomoriBot posts
the result when the provider finishes. The `nsfw` option hides it behind a Discord spoiler without
changing provider content filters.

:::tip
Videos larger than 25 MB cannot be posted. If a clip exceeds the limit, try generating a shorter one.
:::

## Setup and providers

Select a video model under `/config` > `Models` > `Switch Models` and enable video generation under
`/config` > `Permissions`. Google, OpenRouter, and Z.ai support video generation; see
[Providers & Models](/features/setup-administration/providers-and-models/#supported-providers).
For local generation, see [Setup: ComfyUI](/self-hosting/local-endpoints/setup-comfyui/).
