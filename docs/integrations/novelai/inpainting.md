# NovelAI Inpainting Pipeline

## Overview

TomoriBot can edit existing images using NovelAI's infill API, with Gemini providing automatic region detection. When a user asks the bot to change part of an image (e.g., "make her hair red"), the pipeline:

1. Extracts the source image from a Discord message
2. Sends it to Gemini's segmentation API with a natural language target description
3. Builds an inpainting mask from the detected bounding boxes
4. Calls NovelAI's infill endpoint with the original image + mask + prompt

The implementation spans three files:

| File | Responsibility |
|------|----------------|
| `src/utils/image/segmentationService.ts` | Gemini segmentation API call + mask construction |
| `src/tools/functionCalls/generateImageNaiTool.ts` | NAI infill payload, inpaint mode orchestration |
| `src/utils/image/imageExtractor.ts` | Discord message image extraction utility |

## Pipeline Flow

```
1. Tool receives message_id + edit_target + prompt tags
   └─ generateImageNaiTool.ts → enters inpaint mode

2. Source image extracted from referenced Discord message
   └─ imageExtractor.ts → base64 + mime type + dimensions

3. Gemini segments the target region
   └─ segmentationService.ts → callGeminiSegmentation()
   └─ Returns: bounding boxes (normalized 0–1000) + labels

4. Mask built from bounding boxes
   └─ segmentationService.ts → buildBoundingBoxMask()
   └─ Elliptical shape → latent grid quantization → RGBA encoding

5. Infill request sent to NovelAI
   └─ generateImageNaiTool.ts → generateInpaintImage()
   └─ action: "infill", inpainting model suffix derived at runtime

6. Result image posted to Discord channel
```

## Design Decisions

### Bounding Box Approach (Not Per-Pixel Masks)

Gemini's segmentation API returns both bounding boxes (`box_2d`) and per-pixel masks (`mask`). We only use the bounding boxes because per-pixel masks produce severe artifacts on complex regions:

- **Hair, fur, fabric**: Per-pixel masks have holes, rough edges, and incomplete coverage that translate directly into grey splotches in the inpainted output
- **Blur destroys thin masks**: Applying Gaussian blur to soften per-pixel mask edges turns thin white strands into grey — making the artifacts worse
- **Bounding boxes are reliable**: Gemini's bounding box detection is consistent even when per-pixel segmentation fails

The trade-off is precision — a bounding box covers more area than the exact target region. We mitigate this with elliptical shapes (see below).

### Elliptical Mask Shape

Instead of filling the bounding box as a rectangle, we inscribe an **ellipse** within the padded bounding box:

- **Diffusion models expect organic shapes**: NAI's inpainting model was trained on masks from brush strokes, lasso selections, and other organic tools — not perfect rectangles. A rectangular mask creates an unnatural latent-space discontinuity that the model reproduces as a visible edge.
- **Curved boundaries blend naturally**: An ellipse's varying distance from the content center gives the model a more gradual transition to work with during denoising.
- **Configurable padding** (`NAI_INPAINT_PADDING`, default 0.15): Each side of the bounding box is expanded by this fraction to capture content that extends beyond Gemini's detected region (e.g., wispy hair strands). The padding also compensates for the ellipse's curved boundary cutting into the corners.

### Latent Grid Quantization (Critical)

The mask is **quantized to 1/8th resolution** before being sent to NAI. This is the single most important step for avoiding halo artifacts:

```
Full-res mask → downsample to ceil(w/64)*8 × ceil(h/64)*8 (nearest-neighbor)
             → upsample back to full resolution (nearest-neighbor, V4 only)
```

**Why this matters:** NAI's diffusion model operates in latent space at 1/8th pixel resolution. When you send a full-resolution mask, the model downsamples it internally — and any mask edges that don't align to the 8×8 latent grid produce intermediate grey values. These grey values tell the model to *partially* redraw, creating a visible halo ring at the mask boundary.

Pre-quantizing with nearest-neighbor interpolation ensures every mask pixel snaps to the latent grid. The resulting mask looks "blocky" at full resolution, but this is correct — it matches exactly what the model sees internally.

This approach was derived from the open-source [ComfyUI_NAIDGenerator](https://github.com/bedovyy/ComfyUI_NAIDGenerator) `resize_to_naimask()` function and confirmed by [Aedial/novelai-api](https://github.com/Aedial/novelai-api) issue discussions.

### RGBA Mask Format

The mask is encoded as an **RGBA PNG** rather than a simple RGB black/white PNG:

| Pixel type | R | G | B | A |
|-----------|---|---|---|---|
| Redraw (white) | 255 | 255 | 255 | 255 |
| Preserve (black) | 0 | 0 | 0 | 0 |

The alpha channel acts as the actual mask signal. This matches the `naimask_to_base64()` encoding used by every major open-source NAI client (ComfyUI_NAIDGenerator, novelai-python, novelai-api).

### `add_original_image: true`

This parameter tells NAI to overlay the original image pixels onto the non-masked area of the output. Without it (`false`), the entire image can drift slightly during generation, causing the redrawn region to look inconsistent with its surroundings. All open-source NAI implementations default to `true`.

### `strength: 1.0`

Full denoising strength ensures the masked region is completely redrawn from the prompt tags. Lower values (e.g., 0.7) preserve some of the original structure but cause the original colors to bleed through — white hair at 0.7 strength + "red hair" prompt = grey output.

Configurable via `NAI_INPAINT_STRENGTH` env var.

## Gemini Segmentation Configuration

The Gemini API call uses specific settings derived from Google's [spatial understanding reference](https://ai.google.dev/gemini-api/docs/vision#bbox-segment):

| Setting | Value | Why |
|---------|-------|-----|
| Text before image | Parts order: text first | Gemini processes instructions better when text leads |
| Temperature | 0.5 | Prevents the model from looping on repeated tokens |
| Safety settings | OFF (all categories) | Anime/artistic images trigger false positives, causing silent hangs |
| Thinking | Disabled (`thinkingBudget: 0`) | Adds latency without quality benefit for structured extraction |
| Model | `gemini-2.5-flash` (configurable) | Fast enough for real-time use; configurable via `NAI_SEGMENTATION_MODEL` |

## Configuration Reference

| Env Var | Default | Description |
|---------|---------|-------------|
| `NAI_INPAINT_DEBUG` | `false` | DMs the invoking user the mask + bounding box overlay for debugging |
| `NAI_INPAINT_STRENGTH` | `1.0` | Denoising strength for the masked region (0.0–1.0) |
| `NAI_INPAINT_PADDING` | `0.15` | Padding added to each side of the bounding box as a fraction of box dimension |
| `NAI_SEGMENTATION_MODEL` | `gemini-2.5-flash` | Gemini model used for segmentation |
| `NAI_SEGMENTATION_TIMEOUT_MS` | `90000` | Timeout for the Gemini segmentation API call |

## Debugging

When `NAI_INPAINT_DEBUG=true`, the bot DMs the invoking user two images:

1. **Bounding box overlay**: Original image with dashed rectangles (raw Gemini bbox) and semi-transparent ellipses (actual padded mask shape) drawn on top
2. **Binary mask**: The actual mask being sent to NAI — white regions are redrawn, black regions are preserved

Common issues:

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Halo/ring at mask boundary | Mask not quantized to latent grid, or grey pixels in mask | Ensure `buildBoundingBoxMask` quantization is working; check mask has only pure white/black |
| Grey splotches in output | Using per-pixel masks instead of bounding boxes | Verify `box_2d` coordinates are used, not `mask` data |
| Original colors bleeding through | Strength too low | Increase `NAI_INPAINT_STRENGTH` to 1.0 |
| Target region not fully covered | Bounding box too tight | Increase `NAI_INPAINT_PADDING` (e.g., 0.25) |
| Seam at mask edge with shifted surroundings | `add_original_image: false` | Set to `true` |
| Gemini returns empty/hangs | Safety filter triggered | Verify safety settings are OFF |
| 512x512 squished output | Missing width/height in infill payload | Ensure source image dimensions are passed |

## Lessons Learned

These are mistakes made during development that should not be repeated:

1. **Per-pixel masks from Gemini are unreliable** for complex regions (hair, fur, fabric) — holes, rough edges, incomplete coverage cause artifacts
2. **Blur on masks causes halos**, not fixes them — grey pixels from blur create partial-redraw zones
3. **Mask resolution must match the latent grid** — full-resolution masks with arbitrary edges get quantized internally by the model, creating intermediate values at boundaries
4. **RGBA format matters** — RGB-only masks may not be interpreted correctly by the API
5. **`add_original_image: false` causes global image drift** — the surrounding area shifts, making the redrawn region look inconsistent
6. **Strength < 1.0 causes color bleed-through** — original content leaks into the redrawn area

## Future Work

### Better Segmentation Approaches

The current bounding-box-to-ellipse approach trades precision for stability. An ellipse inscribed in a bounding box includes surrounding pixels that aren't part of the target (e.g., background behind hair), which the model must regenerate. Potential improvements:

- **Alternative segmentation APIs**: Services like SAM 2 (Segment Anything Model) or cloud-based instance segmentation APIs may produce cleaner per-pixel masks than Gemini's built-in segmentation, especially for complex regions like hair
- **Refined Gemini prompting**: Experimenting with more specific segmentation prompts or multi-pass segmentation (coarse bbox pass → refined mask pass) could improve Gemini's per-pixel output quality
- **Hybrid approach**: Use Gemini's bounding box for region detection, then run a specialized segmentation model (e.g., SAM 2) on the cropped region for pixel-precise masking — combining Gemini's natural language understanding with a dedicated segmentation model's precision
- **Mask post-processing**: If per-pixel masks improve, applying morphological operations (dilation, erosion, closing) could fill holes and smooth edges before latent grid quantization
- **User-guided refinement**: Allow users to adjust the mask region via Discord interactions (e.g., "expand the mask", "include more of the left side") for cases where automatic detection falls short

## File References

| File | Purpose |
|------|---------|
| `src/utils/image/segmentationService.ts` | Gemini API call, bounding box mask construction, debug overlay |
| `src/tools/functionCalls/generateImageNaiTool.ts` | NAI infill payload, inpaint mode orchestration, model detection |
| `src/utils/image/imageExtractor.ts` | Discord message image extraction |
| `.env.optional.example` | Optional inpainting and related runtime env vars documented |
