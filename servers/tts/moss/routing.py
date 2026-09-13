from __future__ import annotations

from typing import Optional


def resolve_mode(raw_mode: str) -> str:
  normalized = raw_mode.strip().lower().replace("_", "-")
  if normalized in {"clone", "voice-clone"}:
    return "clone"
  if normalized in {"voice-design", "design"}:
    return "voice-design"
  if normalized == "auto":
    return "auto"
  raise ValueError("TOMORI_TTS_MODE must be 'clone', 'voice-design', or 'auto'.")


def resolve_request_mode(server_mode: str, ref_audio: Optional[str], instruct: Optional[str]) -> str:
  has_reference = bool(ref_audio and ref_audio.strip())
  has_instruction = bool(instruct and instruct.strip())

  if server_mode == "auto":
    if has_reference:
      return "clone"
    if has_instruction:
      return "voice-design"
    raise ValueError("Send ref_audio for cloning or instruct for voice design.")

  if server_mode == "clone" and not has_reference:
    raise ValueError("Clone mode requires ref_audio.")
  if server_mode == "voice-design" and not has_instruction:
    raise ValueError("Voice-design mode requires instruct.")
  return server_mode
