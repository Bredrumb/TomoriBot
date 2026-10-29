# ComfyUI Workflows

This folder contains API-format ComfyUI workflows that can be uploaded when adding
a TomoriBot custom endpoint with API style `comfyui`.

## Anima Image Workflows

Two [Anima](https://huggingface.co/circlestone-labs/Anima) workflows ship here. Both cover every
image mode and upscale generated images 2x with an anime upscaler plus a short hires pass. They
differ in model and finish:

| Workflow | Model | Finish | Speed |
|---|---|---|---|
| `tomoribot-anima-image-turbo.json` | Anima Turbo v1.1 (10 steps, CFG 1) | Upscale | Fast |
| `tomoribot-anima-image-detailed.json` | Anima Aesthetic v1.1 (30 steps, CFG 4.5) | Upscale, then face and hand detailers | Several times slower |

TomoriBot picks the path per request:

| Request | Path |
|---|---|
| Prompt only | Text-to-image, then the finish |
| A message image, user, or persona as reference, or any mix of them | Character reference through Anima Ref Adapter, then the finish |
| Inpaint or outpaint on a reference image | LanPaint inpaint/outpaint, without upscale or detailers so only the masked area changes |

TomoriBot folds the workflow's branches before submitting it, so a request only runs the nodes
on its own path. A text-to-image request never loads the reference adapter.

### Character references

When Tomori targets a picture, a user, or a persona without asking for an edit, the workflow
sends those images to the [Anima Ref Adapter](https://github.com/ElectronGirl/ComfyUI-Anima-Ref-Adapter).
The adapter keeps who is drawn (hair, eyes, outfit) and takes the pose, place, and framing from
the prompt, so the output is a new scene instead of a repaint of the reference.

- A user or persona resolves to their saved character reference image, or to their avatar when
  none is saved. A clean full-body character reference gives far better results than an avatar.
- Two or three references are stitched side by side, left to right, in the order Tomori lists them
  in the tool's `references` argument (user and persona names mixed with message images). Prompts
  work best when they say who is on the left and who is on the right. The adapter is trained on up
  to two characters, so a third is best effort.
- `denoise` does not apply on this path; the adapter always draws a fresh image at the requested
  aspect ratio.

### 1. Install the custom nodes

Install each pack into `ComfyUI/custom_nodes/` (ComfyUI Manager's "Install via Git URL" works too),
then restart ComfyUI. ComfyUI itself must be recent enough to include the core `ImageStitch` node.

| Node pack | Nodes the workflow uses |
|---|---|
| [ComfyUI-Anima-Ref-Adapter](https://github.com/ElectronGirl/ComfyUI-Anima-Ref-Adapter) | `AnimaRefAdapter` |
| [ComfyUI-Impact-Pack](https://github.com/ltdrdata/ComfyUI-Impact-Pack) | `ImageReceiver`, `ImpactConditionalBranch`, `ImpactCompare`, `ImpactConvertDataType`, `ImpactInt`, `FaceDetailer` (detailed only) |
| [ComfyUI-Impact-Subpack](https://github.com/ltdrdata/ComfyUI-Impact-Subpack) (detailed only) | `UltralyticsDetectorProvider` |
| [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes) | `GrowMaskWithBlur` |
| [ComfyUI-RMBG](https://github.com/1038lab/ComfyUI-RMBG) | `RMBG`, `ClothesSegment`, `AILab_Florence2` |
| [LanPaint](https://github.com/scraed/LanPaint) | `LanPaint_KSampler`, `LanPaint_MaskBlend` |

```sh
cd ComfyUI/custom_nodes
git clone https://github.com/ElectronGirl/ComfyUI-Anima-Ref-Adapter.git
git clone https://github.com/ltdrdata/ComfyUI-Impact-Pack.git
git clone https://github.com/ltdrdata/ComfyUI-Impact-Subpack.git
git clone https://github.com/kijai/ComfyUI-KJNodes.git
git clone https://github.com/1038lab/ComfyUI-RMBG.git
git clone https://github.com/scraed/LanPaint.git
```

Install each pack's Python requirements into the Python environment that runs ComfyUI
(`pip install -r <pack>/requirements.txt`), or let ComfyUI Manager do it.

### 2. Download the models

The workflows load these exact filenames, so keep the names unchanged:

| File | Folder | Download |
|---|---|---|
| `anima-turbo-v1.1.safetensors` (4.2 GB, turbo) | `ComfyUI/models/diffusion_models/` | [circlestone-labs/Anima](https://huggingface.co/circlestone-labs/Anima/blob/main/split_files/diffusion_models/anima-turbo-v1.1.safetensors) |
| `anima-aesthetic-v1.1.safetensors` (4.2 GB, detailed) | `ComfyUI/models/diffusion_models/` | [circlestone-labs/Anima](https://huggingface.co/circlestone-labs/Anima/blob/main/split_files/diffusion_models/anima-aesthetic-v1.1.safetensors) |
| `qwen_3_06b_base.safetensors` (1.2 GB) | `ComfyUI/models/text_encoders/` | [circlestone-labs/Anima](https://huggingface.co/circlestone-labs/Anima/blob/main/split_files/text_encoders/qwen_3_06b_base.safetensors) |
| `qwen_image_vae.safetensors` (254 MB) | `ComfyUI/models/vae/` | [circlestone-labs/Anima](https://huggingface.co/circlestone-labs/Anima/blob/main/split_files/vae/qwen_image_vae.safetensors) |
| `anima_ref_adapter_v2_r64.safetensors` (183 MB) | `ComfyUI/models/loras/` | [ElectronGirl/anima-ref-adapter](https://huggingface.co/ElectronGirl/anima-ref-adapter/blob/main/anima_ref_adapter_v2_r64.safetensors) |
| `RealESRGAN_x4plus_anime_6B.pth` (18 MB) | `ComfyUI/models/upscale_models/` | [xinntao/Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth) |
| `face_yolov8s.pt` (23 MB, detailed) | `ComfyUI/models/ultralytics/bbox/` | [Bingsu/adetailer](https://huggingface.co/Bingsu/adetailer/blob/main/face_yolov8s.pt) |
| `hand_yolov8s.pt` (23 MB, detailed) | `ComfyUI/models/ultralytics/bbox/` | [Bingsu/adetailer](https://huggingface.co/Bingsu/adetailer/blob/main/hand_yolov8s.pt) |

To use a different Anima model, download it from the
[Anima model folder](https://huggingface.co/circlestone-labs/Anima/tree/main/split_files/diffusion_models)
and change `unet_name` in the `Model: ... UNet` node. Turbo models want about 10 steps and CFG 1;
base and aesthetic models want about 30 steps and CFG 4-5. Match `steps` and `cfg` on the
`Txt2Img sampler`, `Character reference sampler`, and `Upscale: hires sampler` nodes (and the
detailer nodes in the detailed workflow). `ref_guidance` on the `Character reference: Anima Ref
Adapter` node is 1 for Turbo and 4.5 otherwise.

Upscaled images are 2x the requested size (about 2048 px on the long side). Discord rejects
attachments over the server's upload limit, so lower `scale_by` on the `Upscale: scale to 2x`
node (for example to 0.375 for 1.5x) if large PNGs fail to send.

The adapter, Florence-2 (`ComfyUI/models/LLM/`), RMBG-2.0, and the clothing parser
(`ComfyUI/models/RMBG/`) download on first use. Pre-download them by hand when the ComfyUI
machine has no internet access, or when the first request would otherwise exceed TomoriBot's
poll window.

The Anima Ref Adapter weights use the CircleStone Non-Commercial License, like Anima itself.

### 3. Test in ComfyUI, then register

Before uploading a workflow to TomoriBot, generate one image in the ComfyUI web UI with
the Anima models to confirm they load. When TomoriBot's request fails, ComfyUI's error names the
missing node class or, for a missing model, reports the filename as `Value not in list`.

When registering the endpoint, choose the `image` capability and tick the capabilities you want:

- `Text to image`
- `Reference image`: enables character references (pictures, users, personas).
- `Inpainting`: enables inpaint and outpaint edits.
- `Negative prompt`: appends TomoriBot's negative prompt to the workflow's built-in one.

### Placeholders

The workflow's `{TOMORI_*}` strings are filled in per request. The core ones for authoring your own
Anima variant are:

- `{TOMORI_PROMPT}`: the scene prompt without TomoriBot's defaults. The character reference path
  (and text-to-image in the detailed workflow) adds its own short quality prefix, because Anima
  Aesthetic works best without `score_*` tags.
- `{TOMORI_PROMPT_WITH_DEFAULTS}` and `{TOMORI_NEGATIVE_PROMPT}`: prompts with TomoriBot's quality
  and safety defaults applied.
- `{TOMORI_WIDTH}`, `{TOMORI_HEIGHT}`, `{TOMORI_SOURCE_WIDTH}`, `{TOMORI_SOURCE_HEIGHT}`: output and
  source sizes.
- `{TOMORI_SEED}`
- `{TOMORI_REFERENCE_IMAGE_COUNT}` and `{TOMORI_REFERENCE_IMAGE_<n>_DATA_URL}` (n = 1-3).
- `{TOMORI_INPAINT}`, `{TOMORI_OUTPAINT}`, `{TOMORI_MASK_PROMPT}`: edit-path switches and target.

`buildComfyUiPlaceholderMap` in `src/providers/custom/customComfyUiEndpoint.ts` defines every
placeholder and its value.

## Wan I2V Loop Video Workflow

Use `tomoribot-wan-i2v-loop-video.json` for Wan I2V loop video generation.

Supported modes:

- Image-to-video with one reference image

When registering the endpoint, choose the `video` capability and select the
workflow support modes that match how you want the workflow to be used:

- `img2vid`

Required ComfyUI custom nodes and models are encoded in the workflow itself through
its node class names and model filenames. If ComfyUI rejects the prompt, install
the missing nodes or models named in the ComfyUI error output, then re-upload the
same workflow JSON in TomoriBot.
