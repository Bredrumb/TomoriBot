from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from huggingface_hub import snapshot_download
from huggingface_hub.constants import HF_HUB_CACHE

from server import codec_id_from_snapshot, model_id_for_mode


def ensure_disk_space(repo_id: str) -> None:
  planned_files = snapshot_download(repo_id=repo_id, dry_run=True)
  remaining_bytes = sum(file.file_size or 0 for file in planned_files if file.will_download)
  cache_path = Path(HF_HUB_CACHE)
  while not cache_path.exists():
    cache_path = cache_path.parent
  free_bytes = shutil.disk_usage(cache_path).free
  if remaining_bytes > free_bytes:
    needed_gb = remaining_bytes / (1024 ** 3)
    free_gb = free_bytes / (1024 ** 3)
    raise RuntimeError(
      f"Not enough free disk space for {repo_id}: at least {needed_gb:.1f} GiB to download, "
      f"but only {free_gb:.1f} GiB is available in the Hugging Face cache volume ({cache_path})."
    )


def prefetch(mode: str) -> list[str]:
  modes = ("clone", "voice-design") if mode == "auto" else (mode,)
  downloaded: list[str] = []
  for selected_mode in modes:
    model_id = model_id_for_mode(selected_mode)
    ensure_disk_space(model_id)
    print(f"[MOSS-TTS] Downloading {selected_mode} checkpoint: {model_id}", flush=True)
    model_path = snapshot_download(repo_id=model_id)
    downloaded.append(model_id)

    codec_id = codec_id_from_snapshot(model_path, selected_mode)
    if codec_id not in downloaded:
      ensure_disk_space(codec_id)
      print(f"[MOSS-TTS] Downloading audio tokenizer: {codec_id}", flush=True)
      snapshot_download(repo_id=codec_id)
      downloaded.append(codec_id)
  return downloaded


if __name__ == "__main__":
  parser = argparse.ArgumentParser(description="Download MOSS checkpoints before starting the TTS server")
  parser.add_argument("--mode", choices=("auto", "clone", "voice-design"), default="auto")
  args = parser.parse_args()
  prefetch(args.mode)
  print("[MOSS-TTS] Model downloads complete. The server can now load from cache.", flush=True)
