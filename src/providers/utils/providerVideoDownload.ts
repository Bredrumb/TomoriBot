export const PROVIDER_VIDEO_DOWNLOAD_MAX_MB = Math.max(
  1,
  Number.parseInt(process.env.PROVIDER_VIDEO_DOWNLOAD_MAX_MB ?? "25", 10) || 25,
);
