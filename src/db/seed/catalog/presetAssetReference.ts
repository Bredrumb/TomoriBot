// Reuses the first uploaded reference per content-addressed key because every locale variant of a preset shares the
// same image bytes, while callers supply their own asset-specific key shape.

type SharedPresetUploadLogger = (error?: unknown) => void;

interface SharedPresetAssetReferenceOptions {
  expectedKey: string;
  // Matched against the whole expectedKey with endsWith rather than filename alone because retired per-language rows
  // share the filename.
  existingReference: string | null;
  uploadedThisRun: Map<string, string>;
  upload: () => Promise<string | null>;
  logFailure: SharedPresetUploadLogger;
}

export async function resolveSharedPresetAssetReference(
  options: SharedPresetAssetReferenceOptions,
): Promise<string | null> {
  if (options.existingReference?.endsWith(options.expectedKey)) {
    return options.existingReference;
  }

  const uploaded = options.uploadedThisRun.get(options.expectedKey);
  if (uploaded) {
    return uploaded;
  }

  const uploadedReference = await options.upload();
  if (!uploadedReference) {
    options.logFailure();
    return null;
  }

  options.uploadedThisRun.set(options.expectedKey, uploadedReference);
  return uploadedReference;
}
