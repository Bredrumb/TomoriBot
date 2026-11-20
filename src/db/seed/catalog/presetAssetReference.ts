// Upload-once bookkeeping shared by the preset avatar and preset sprite seeders.
//
// Every locale variant of a preset resolves the same image bytes to the same storage key, so
// without this an art change re-uploads identical bytes once per authored locale. Both seeders keep
// one map per run and reuse the first upload's reference. Only the identifier each asset type is
// addressed by differs: sprites carry a sprite key, avatars do not. That key stays with the caller,
// so this module never merges the two identity rules.

/** A line the caller wants emitted when an upload produced no stored reference. */
type SharedPresetUploadLogger = (error?: unknown) => void;

interface SharedPresetAssetReferenceOptions {
  /** Storage key this asset's current bytes resolve to. Taken from the persona catalog. */
  expectedKey: string;
  /**
   * Reference already stored on the row, or null when the row has none.
   *
   * Compared against the whole key with `endsWith`, never against the filename alone: a row written
   * under the retired per-language key ends with the same filename, so a filename comparison would
   * pin it to its old path and re-upload on every seed.
   */
  existingReference: string | null;
  /** Per-run map from storage key to the reference already uploaded. */
  uploadedThisRun: Map<string, string>;
  /** Performs the upload when the key is not in the map yet. */
  upload: () => Promise<string | null>;
  /** Emits the caller's own skip message when the upload returns no reference. */
  logFailure: SharedPresetUploadLogger;
}

/**
 * Resolves the stored reference for one shared preset asset, uploading it once per run.
 *
 * A row already pointing at the expected key is reused as-is, because the same content is already
 * uploaded and only the row's metadata needs refreshing. Otherwise the first caller to need the key
 * uploads it and every later caller reads that reference from the map.
 *
 * @returns The stored reference, or null when the upload failed
 */
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
