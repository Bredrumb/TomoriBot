---
title: "Setup: ComfyUI"
aiGenerated: false
sidebar:
  label: "ComfyUI"
  order: 2
---

TomoriBot can generate images and videos through your own
[ComfyUI](https://github.com/comfyanonymous/ComfyUI) instance. It drives ComfyUI by
submitting an API-format workflow with your prompt/size substituted in, then polls
ComfyUI's `/history` endpoint until the output is ready.

This guide covers installing/running ComfyUI and registering it. For authoring or editing
a TomoriBot-compatible workflow (the `{TOMORI_*}` placeholders), use the
[workflow README](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows)
on GitHub.

:::note[No env vars needed]
ComfyUI is registered through Discord slash commands and stored encrypted in the database.
See the [local endpoints hub](/self-hosting/local-endpoints/).
:::

## Hardware requirements

Image and video generation is GPU-bound: the heavy cost is VRAM (your graphics card's
memory, separate from system RAM), determined by the model checkpoint your workflow loads.
An NVIDIA GPU is strongly recommended. The two workflows TomoriBot ships need:

| Bundled workflow | Base model | Practical VRAM | Notes |
|---|---|---|---|
| Anima turbo (image) | Anima Turbo v1.1 (2B), bf16 | ~8 GB workable · 12 GB+ comfortable | The 4.2 GB model plus a 1.2 GB text encoder, at 10 steps plus a short 2x upscale pass. A character reference adds about half again to generation time. |
| Anima detailed (image) | Anima Aesthetic v1.1 (2B), bf16 | ~8 GB workable · 12 GB+ comfortable | Same memory as turbo, but 30 steps plus face and hand detailers, so several times slower per image. Other Anima models are in the [model folder](https://huggingface.co/circlestone-labs/Anima/tree/main/split_files/diffusion_models); the workflow README covers switching. |
| WAN i2v loop (video) | Wan 2.2 14B, fp8 + 4-step LightX2V LoRAs | ~16 GB workable · 24 GB+ comfortable | Heaviest option expect minutes per clip. Offload the UMT5 text encoder to RAM (`t5_cpu`, needs 24 GB+ system RAM) on smaller cards. |

The Wan checkpoint is already fp8-quantized to fit consumer cards. If you have less
VRAM, swap the UNET for a smaller quant and enable ComfyUI's `--lowvram` / CPU offload. CPU-only diffusion is
impractical (many minutes per image, worse for video) and can exceed TomoriBot's poll window,
so a GPU is effectively required for regular use.

:::tip[Going lower: pick a GGUF quant]
To shrink further, download a
GGUF build of the model from Hugging Face: the code in names like `Q4_K_M` / `Q5_K_M` is the
bits-per-weight, and 4-bit (Q4) or 5-bit (Q5) is the usual sweet spot with most of the quality
for a fraction of the fp8/fp16 footprint. Loading
GGUF UNETs in ComfyUI needs the [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF) custom
node.
:::


## 1. Run ComfyUI with the API enabled

Install ComfyUI per [its README](https://github.com/comfyanonymous/ComfyUI) and start it so it
listens on the network:

```sh
python main.py --listen 0.0.0.0 --port 8188
```

`--listen 0.0.0.0` matters if TomoriBot runs in Docker or on a different machine: the
default binds to loopback only. Confirm reachability from the machine the bot runs on:

```sh
curl http://127.0.0.1:8188/system_stats
```

If you want to test, load the model checkpoints your chosen workflow expects and do one manual generation in the
ComfyUI web UI to confirm it works end to end before wiring up TomoriBot.

## 2. Grab a TomoriBot workflow

Download a ready-to-use API-format workflow. Examples can be found in the repo under
[`assets/comfyui-workflows/`](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows):

| Workflow | Modes |
|----------|-------|
| Anima turbo (image, fast) : `tomoribot-anima-image-turbo.json` | text to image, character reference, inpaint/outpaint |
| Anima detailed (image, slower, face and hand detailers) : `tomoribot-anima-image-detailed.json` | text to image, character reference, inpaint/outpaint |
| WAN i2v loop (video) : `tomoribot-wan-i2v-loop-video.json` | image-to-video |

Each workflow needs specific custom nodes and model files in specific ComfyUI folders. The
[workflow README](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows) lists
them for the Anima workflow, with download links and the folder each file goes in. Install those
before registering, or generation fails with a missing node or `Value not in list` error.

These are API format (the JSON ComfyUI exports via *Save (API Format)*), not the regular
UI-save format. If you author your own, it must contain the `{TOMORI_*}` placeholders
TomoriBot substitutes (prompt, width/height, seed, reference images, etc.). See the
[workflow README](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows) and the
`Custom Endpoints` page under `Providers` in `/help`.

## 3. Register it in Discord

Run `/providers` (or `/personal providers`), choose `Add New Custom Endpoint`, and enter:

| Field | Value for ComfyUI |
|-------|-------------------|
| `endpoint_label` | A name you choose, e.g. `home-comfy` |
| API Compatibility | `ComfyUI` |
| `endpoint_url` | `http://127.0.0.1:8188` (root, without `/v1`) |
| `auth_token` | *(leave blank unless your ComfyUI is behind auth)* |

After saving the connection, select it and choose `+ Add new Image Model` or `+ Add new Video Model`
from the model dropdown. Enter the checkpoint's exact code name and upload the workflow `.json`
downloaded from Step 2 into `ComfyUI Workflow`. The model capability must match the workflow (image
workflow → `image`, video workflow → `video`).

For the Anima workflows, tick `Text to image`, `Reference image`, and `Inpainting` under
`Image Capabilities`. `Reference image` is what lets Tomori draw a user or persona from their
character reference.

Adding the model makes it the active `image`/`video` model automatically. Trigger generation by asking Tomori directly in chat. If it isn't active for some reason, run `/config` > Models > Switch Models
and select your registered ComfyUI endpoint.

## Troubleshooting

- **Unreachable on add:** ComfyUI bound to loopback while the bot is in Docker / on another
  host. Start it with `--listen 0.0.0.0` and use `http://host.docker.internal:8188` or the
  LAN IP.
- **Generation never completes:** TomoriBot polls `/history` until the output appears. Cold
  starts and large models on CPU can exceed the poll window.
- **Prompt/size ignored or wrong output size:** the workflow is missing the required
  `{TOMORI_*}` placeholders, or you uploaded a UI-format export instead of API format.
- **Missing node or `Value not in list`:** a custom node pack or model file from the
  workflow README is not installed, or a model file was renamed. Install it, restart ComfyUI, and
  try again. You don't need to re-upload the workflow.
- **Wrong capability:** an `image` workflow registered under `video` (or vice-versa) won't
  run. Re-add it under the matching capability.
