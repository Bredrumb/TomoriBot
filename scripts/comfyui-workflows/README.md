# ComfyUI Workflows

This folder contains API-format ComfyUI workflows that can be uploaded when adding
a TomoriBot custom endpoint with API style `comfyui`.

## Anima3 Image Workflow

Use `tomoribot-anima3-comfyui.json` for Anima3 image generation.

Supported modes:

- Text-to-image
- Image-to-image with one reference image
- Inpainting with one reference image

When registering the endpoint, choose the `image` capability and select the
workflow support modes that match how you want the workflow to be used:

- `txt2img`
- `img2img`
- `inpaint`

The workflow uses these TomoriBot placeholders:

- `{TOMORI_PROMPT}`
- `{TOMORI_PROMPT_WITH_DEFAULTS}`
- `{TOMORI_WIDTH}`
- `{TOMORI_HEIGHT}`
- `{TOMORI_SEED}`
- `{TOMORI_REFERENCE_IMAGE_COUNT}`
- `{TOMORI_REFERENCE_IMAGE_1_DATA_URL}`
- `{TOMORI_IMG2IMG_DENOISE}`
- `{TOMORI_INPAINT}`
- `{TOMORI_INPAINT_MASK_MODE}`
- `{TOMORI_INPAINT_INVERT_MASK}`
- `{TOMORI_INPAINT_MODE}`
- `{TOMORI_MASK_PROMPT}`
- `{TOMORI_GROUNDINGDINO_MODEL}`
- `{TOMORI_SAM_MODEL}`
- `{TOMORI_INPAINT_CFG}`
- `{TOMORI_INPAINT_DENOISE}`
- `{TOMORI_INPAINT_MASK_THRESHOLD}`
- `{TOMORI_INPAINT_MASK_GROW}`
- `{TOMORI_INPAINT_MASK_FEATHER}`
- `{TOMORI_INPAINT_SUBTRACT_FACE_MASK}`
- `{TOMORI_INPAINT_FACE_MASK_PROMPT}`
- `{TOMORI_INPAINT_FACE_MASK_THRESHOLD}`
- `{TOMORI_INPAINT_FACE_MASK_GROW}`
- `{TOMORI_INPAINT_FACE_MASK_FEATHER}`
- `{TOMORI_INPAINT_SUBTRACT_CLOTHING_MASK}`
- `{TOMORI_INPAINT_CLOTHING_MASK_PROMPT}`
- `{TOMORI_INPAINT_CLOTHING_MASK_THRESHOLD}`
- `{TOMORI_INPAINT_CLOTHING_MASK_GROW}`
- `{TOMORI_INPAINT_CLOTHING_MASK_FEATHER}`
- `{TOMORI_INPAINT_SUBTRACT_ARMS_MASK}`
- `{TOMORI_INPAINT_ARMS_MASK_PROMPT}`
- `{TOMORI_INPAINT_ARMS_MASK_THRESHOLD}`
- `{TOMORI_INPAINT_ARMS_MASK_GROW}`
- `{TOMORI_INPAINT_ARMS_MASK_FEATHER}`
- `{TOMORI_INPAINT_SUBTRACT_NECK_MASK}`
- `{TOMORI_INPAINT_NECK_MASK_PROMPT}`
- `{TOMORI_INPAINT_NECK_MASK_THRESHOLD}`
- `{TOMORI_INPAINT_NECK_MASK_GROW}`
- `{TOMORI_INPAINT_NECK_MASK_FEATHER}`
- `{TOMORI_INPAINT_SUBTRACT_SKIN_MASK}`
- `{TOMORI_INPAINT_SKIN_MASK_PROMPT}`
- `{TOMORI_INPAINT_SKIN_MASK_THRESHOLD}`
- `{TOMORI_INPAINT_SKIN_MASK_GROW}`
- `{TOMORI_INPAINT_SKIN_MASK_FEATHER}`
- `{TOMORI_INPAINT_EXTEND_DIRECTION}`
- `{TOMORI_INPAINT_EXTEND_PIXELS}`
- `{TOMORI_INPAINT_EXTEND_X}`
- `{TOMORI_INPAINT_EXTEND_Y}`
- `{TOMORI_INPAINT_EXTEND_GROW}`
- `{TOMORI_INPAINT_EXTEND_FEATHER}`
- `{TOMORI_INPAINT_EXTEND_PADDING}`

Required ComfyUI custom nodes/models are encoded in the workflow itself through
its node class names and model filenames. The default workflow also uses
`ComfyUI-Inpaint-CropAndStitch` for normal target inpainting, via
`InpaintCropImproved` and `InpaintStitchImproved`, so masked edits are cropped,
inpainted at focused local resolution, then stitched back into the original
image. If ComfyUI rejects the prompt, install
the missing nodes/models named in the ComfyUI error output, then re-upload the
same workflow JSON in TomoriBot.
