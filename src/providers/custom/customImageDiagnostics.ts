export const COMFYUI_INPAINT_MASK_FILENAME_PREFIX = "tomoribot_inpaint_mask";
export const COMFYUI_INPAINT_RESULT_DEBUG_FILENAME_PREFIX = "tomoribot_inpaint_result_debug";

type ComfyUiDiagnosticAsset = {
  filename: string;
  subfolder?: string;
};

export function isComfyUiInpaintMaskAsset(asset: ComfyUiDiagnosticAsset): boolean {
  return asset.filename.toLowerCase().startsWith(COMFYUI_INPAINT_MASK_FILENAME_PREFIX);
}

export function isComfyUiInpaintResultDebugAsset(asset: ComfyUiDiagnosticAsset): boolean {
  return asset.filename.toLowerCase().startsWith(COMFYUI_INPAINT_RESULT_DEBUG_FILENAME_PREFIX);
}

export function isComfyUiDiagnosticAsset(asset: ComfyUiDiagnosticAsset): boolean {
  return isComfyUiInpaintMaskAsset(asset) || isComfyUiInpaintResultDebugAsset(asset);
}

export function getComfyUiDiagnosticLabel(asset: ComfyUiDiagnosticAsset): string {
  const filename = asset.filename.toLowerCase();
  if (isComfyUiInpaintResultDebugAsset(asset)) {
    return "Inpaint result debug";
  }
  if (filename.startsWith(`${COMFYUI_INPAINT_MASK_FILENAME_PREFIX}_detected`)) {
    return "Detected inpaint mask";
  }
  if (filename.startsWith(`${COMFYUI_INPAINT_MASK_FILENAME_PREFIX}_overlay`)) {
    return "Inpaint mask overlay";
  }
  if (isComfyUiInpaintMaskAsset(asset)) {
    return "Final inpaint mask";
  }
  return "ComfyUI diagnostic";
}

export function isComfyUiDiagnosticSaveImageNode(node: unknown): boolean {
  if (!isObject(node) || !isObject(node.inputs)) {
    return false;
  }
  if (typeof node.class_type !== "string" || typeof node.inputs.filename_prefix !== "string") {
    return false;
  }
  if (!node.class_type.toLowerCase().includes("saveimage")) {
    return false;
  }

  const filenamePrefix = node.inputs.filename_prefix.toLowerCase();
  return (
    filenamePrefix.startsWith(COMFYUI_INPAINT_MASK_FILENAME_PREFIX) ||
    filenamePrefix.startsWith(COMFYUI_INPAINT_RESULT_DEBUG_FILENAME_PREFIX)
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function describeComfyUiAssets(files: ComfyUiDiagnosticAsset[]): string {
  return files
    .slice(0, 10)
    .map((file) => [file.subfolder, file.filename].filter(Boolean).join("/"))
    .join(", ");
}

export function formatComfyUiDiagnosticSection(
  title: string,
  rows: Array<string | null | false | undefined>,
): string | null {
  const filteredRows = rows.filter((row): row is string => typeof row === "string" && row.length > 0);
  return filteredRows.length > 0 ? [`${title}`, ...filteredRows.map((row) => `• ${row}`)].join("\n") : null;
}
