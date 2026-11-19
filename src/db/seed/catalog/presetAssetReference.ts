// Upload-once bookkeeping shared by the preset avatar and preset sprite seeders.
//
// Every locale variant of a preset resolves the same image bytes to the same storage key, so
// without this an art change re-uploads identical bytes once per authored locale. Both seeders keep
// one map per run and reuse the first upload's reference. Only the identifier each asset type is
// addressed by differs: sprites carry a sprite key, avatars do not. That key stays with the caller,
// so this module never merges the two identity rules.

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
