import type JSZip from "jszip";

export function resolveZipEntryFile(zip: JSZip, declaredPath: string): JSZip.JSZipObject | null {
  if (declaredPath.includes("..") || declaredPath.startsWith("/") || declaredPath.includes("\\")) {
    return null;
  }

  const direct = zip.file(declaredPath);
  if (direct && !direct.dir) {
    return direct;
  }

  return findZipEntryByBasename(zip, declaredPath.split("/").pop());
}

export function findZipEntryByBasename(zip: JSZip, basename: string | undefined): JSZip.JSZipObject | null {
  if (!basename) {
    return null;
  }

  const lowerTarget = basename.toLowerCase();
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) {
      continue;
    }
    if (name.split("/").pop()?.toLowerCase() === lowerTarget) {
      return file;
    }
  }
  return null;
}

// JSZip exposes uncompressedSize only on its internal _data object, so null is returned when missing for callers to
// fall back to a post-read size check.
export function getDeclaredUncompressedSize(file: JSZip.JSZipObject): number | null {
  const internal = file as unknown as {
    _data?: { uncompressedSize?: number };
  };
  const size = internal._data?.uncompressedSize;
  return typeof size === "number" && Number.isFinite(size) ? size : null;
}
