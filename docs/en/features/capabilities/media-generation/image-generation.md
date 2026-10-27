---
title: "Image Generation"
sidebar:
  order: 1
---

TomoriBot can generate images from a description or edit a reference image. Ask her in chat or use
`/generate image`. For manual NovelAI generation, use `/novelai generate image`.

:::tip
If a chat request does not produce an image, try `/generate image`. It calls the image model directly,
even when the chat model cannot use tools.
:::

## Editing and references

TomoriBot can use attachments, stickers, emojis, and user or persona avatars as references. Mention a
user or persona to use their avatar. Depending on your image provider, she can also restyle an image,
redraw part of it (inpainting), or extend it beyond its edges (outpainting).

:::tip
To edit an existing picture, reply to the message containing it and describe the change. This makes
the picture available even if the original message is far up the channel.
:::

Available editing modes depend on the provider. Inpainting and outpainting require a local
[ComfyUI](/self-hosting/local-endpoints/setup-comfyui/) endpoint that supports them.
The `nsfw` option hides the result behind a Discord spoiler; it does not change provider content
filters.

## Tag customization
<!-- anchor: tag-customization -->

Appearance and default tags can guide image generation. For example, if you ask "Generate an image
of me hugging you," TomoriBot can use your saved appearance and the persona's appearance to describe
both of you in the image.

- `/config` > `Persona` > `Image Generation Details`: the persona's appearance.
- `/personal config`: your appearance when an image references you. See
  [Personalization](/features/knowledge/personalization/).
- `/config` > `Models` > `Image Generation Defaults`: server-wide positive and negative tags.
  Negative tags depend on provider support.

## Tag lookup
<!-- anchor: tag-lookup -->

[Danbooru Search](/features/capabilities/tools-and-extensions/danbooru/) helps TomoriBot
find a character's appearance or outfit tags before generating an image, including cosplay requests.
The `Default + Image Generation Expert` system prompt preset encourages her to look up tags and choose
the appropriate prompt style.

## Setup and providers

Configure an image model under `/config` > `Models` > `Switch Models` and enable image generation
under `/config` > `Permissions`. Available models depend on your provider. See
[Providers & Models](/features/setup-administration/providers-and-models/#supported-providers) for the
provider list, or [Setup: ComfyUI](/self-hosting/local-endpoints/setup-comfyui/) for local generation.
