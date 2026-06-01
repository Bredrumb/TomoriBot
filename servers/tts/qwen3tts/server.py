from __future__ import annotations

import argparse
import base64
import gc
import os
import sys
import tempfile
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import soundfile as sf
import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel


CLONE_MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
VOICE_DESIGN_MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
MODEL_NAMES = {
  "clone": "qwen3-tts-12hz-1.7b-base",
  "voice-design": "qwen3-tts-12hz-1.7b-voice-design",
}


def resolve_mode(raw_mode: str) -> str:
  normalized = raw_mode.strip().lower().replace("_", "-")
  if normalized in {"clone", "voice-clone", "base"}:
    return "clone"
  if normalized in {"voice-design", "design"}:
    return "voice-design"
  if normalized in {"auto", "dynamic"}:
    return "auto"
  raise ValueError("TOMORI_TTS_MODE must be 'clone', 'voice-design', or 'auto'.")


def read_startup_mode() -> str:
  for index, arg in enumerate(sys.argv[1:], start=1):
    if arg == "--mode" and index + 1 < len(sys.argv):
      return sys.argv[index + 1]
    if arg.startswith("--mode="):
      return arg.split("=", 1)[1]

  return os.getenv("TOMORI_TTS_MODE", "auto")


MODE = resolve_mode(read_startup_mode())
HOST = os.getenv("TOMORI_TTS_HOST", "127.0.0.1")
PORT = int(os.getenv("TOMORI_TTS_PORT", "8014" if MODE == "voice-design" else "8012"))
DEVICE_MAP = os.getenv("QWEN3TTS_DEVICE_MAP", "cuda:0" if torch.cuda.is_available() else "cpu")
DTYPE = os.getenv("QWEN3TTS_DTYPE", "bfloat16" if torch.cuda.is_available() else "float32")
USE_FLASH_ATTENTION = os.getenv("QWEN3TTS_FLASH_ATTENTION", "0") == "1"
MAX_TEXT_CHARS = int(os.getenv("TOMORI_TTS_MAX_TEXT_CHARS", "2000"))
DEFAULT_INSTRUCT = os.getenv("TOMORI_TTS_DEFAULT_INSTRUCT", "").strip()
LOG_PAYLOADS = os.getenv("TOMORI_TTS_LOG_PAYLOADS", "0") == "1"
LOG_PREVIEW_CHARS = int(os.getenv("TOMORI_TTS_LOG_PREVIEW_CHARS", "240"))

LANGUAGE_NAMES = {
  "zh": "Chinese",
  "zh-cn": "Chinese",
  "en": "English",
  "ja": "Japanese",
  "jp": "Japanese",
  "ko": "Korean",
  "de": "German",
  "fr": "French",
  "ru": "Russian",
  "pt": "Portuguese",
  "es": "Spanish",
  "it": "Italian",
}

model = None
model_mode: Optional[str] = None
model_lock = threading.Lock()


class SynthesizeRequest(BaseModel):
  text: str
  # Required in clone mode, ignored in voice-design mode.
  ref_audio: Optional[str] = None
  # Clone mode treats this as the reference transcript. VoiceDesign keeps it as
  # a compatibility fallback for manual tests; TomoriBot sends persona prompts
  # in `instruct`.
  ref_text: Optional[str] = None
  # VoiceDesign mode uses this as the voice prompt. Clone mode intentionally
  # ignores it so clone wrappers do not start interpreting delivery directions.
  instruct: Optional[str] = None
  language: Optional[str] = None


def decode_ref_audio(raw_base64: str, directory: str) -> str:
  try:
    audio_bytes = base64.b64decode(raw_base64, validate=True)
  except Exception as exc:
    raise HTTPException(status_code=400, detail="ref_audio must be valid base64.") from exc

  ref_path = Path(directory) / "reference.wav"
  ref_path.write_bytes(audio_bytes)
  return str(ref_path)


def log_info(message: str) -> None:
  print(f"[Qwen3TTS] {message}", flush=True)


def preview_for_log(text: str) -> str:
  escaped = text.replace("\r", "\\r").replace("\n", "\\n")
  if LOG_PAYLOADS or len(escaped) <= LOG_PREVIEW_CHARS:
    return escaped
  return f"{escaped[:LOG_PREVIEW_CHARS]}..."


def resolve_dtype() -> torch.dtype:
  normalized = DTYPE.strip().lower()
  if normalized in {"bf16", "bfloat16"}:
    return torch.bfloat16
  if normalized in {"fp16", "float16"}:
    return torch.float16
  return torch.float32


def resolve_language(language: Optional[str]) -> str:
  if not language or not language.strip():
    return "Auto"

  normalized = language.strip().lower().replace("_", "-")
  return LANGUAGE_NAMES.get(normalized, language.strip())


def resolve_design_instruct(payload: SynthesizeRequest) -> str:
  # Preferred path: TomoriBot's VoiceDesign adapter sends the persona prompt,
  # plus any one-off voice_instructions, in `instruct`. `ref_text` and the env
  # fallback are kept for manual curl testing and simple single-voice servers.
  for candidate in (payload.instruct, payload.ref_text, DEFAULT_INSTRUCT):
    if candidate and candidate.strip():
      return candidate.strip()

  raise HTTPException(
    status_code=400,
    detail=(
      "VoiceDesign requires a voice description. Send `instruct`, pass `ref_text` "
      "for manual testing, or set TOMORI_TTS_DEFAULT_INSTRUCT."
    ),
  )


def model_id_for_mode(mode: str) -> str:
  generic_override = os.getenv("QWEN3TTS_MODEL_ID")
  if MODE != "auto" and generic_override:
    return generic_override

  if mode == "voice-design":
    return os.getenv("QWEN3TTS_VOICE_DESIGN_MODEL_ID", VOICE_DESIGN_MODEL_ID)

  return os.getenv("QWEN3TTS_CLONE_MODEL_ID", CLONE_MODEL_ID)


def unload_model() -> None:
  global model, model_mode

  model = None
  model_mode = None
  gc.collect()
  if torch.cuda.is_available():
    torch.cuda.empty_cache()


def load_model_for_mode(mode: str) -> None:
  global model, model_mode

  if model is not None and model_mode == mode:
    return

  if model is not None:
    log_info(f"Unloading active model mode={model_mode} before loading mode={mode}")
    unload_model()

  from qwen_tts import Qwen3TTSModel

  model_id = model_id_for_mode(mode)
  kwargs: dict = {
    "device_map": DEVICE_MAP,
    "dtype": resolve_dtype(),
  }
  if USE_FLASH_ATTENTION:
    kwargs["attn_implementation"] = "flash_attention_2"

  load_started_at = time.perf_counter()
  log_info(
    f"Loading model mode={mode} model_id={model_id} device_map={DEVICE_MAP} dtype={DTYPE} flash_attention={USE_FLASH_ATTENTION}"
  )
  model = Qwen3TTSModel.from_pretrained(model_id, **kwargs)
  model_mode = mode
  log_info(f"Model loaded mode={mode} elapsed_ms={int((time.perf_counter() - load_started_at) * 1000)}")


def infer_request_mode(payload: SynthesizeRequest) -> str:
  has_ref_audio = bool(payload.ref_audio and payload.ref_audio.strip())
  has_voice_design_prompt = bool(
    (payload.instruct and payload.instruct.strip())
    or (payload.ref_text and payload.ref_text.strip())
    or DEFAULT_INSTRUCT
  )

  if has_ref_audio:
    return "clone"
  if has_voice_design_prompt:
    return "voice-design"

  raise HTTPException(
    status_code=400,
    detail=(
      "Could not infer Qwen3-TTS mode from the request. Send `ref_audio` for clone "
      "mode, or send `instruct` for VoiceDesign mode."
    ),
  )


def resolve_request_mode(payload: SynthesizeRequest) -> str:
  if MODE == "auto":
    return infer_request_mode(payload)

  if MODE == "clone" and payload.instruct and payload.instruct.strip() and not payload.ref_audio:
    raise HTTPException(
      status_code=400,
      detail=(
        "This Qwen3-TTS server is running in clone mode, but the request looks "
        "like a VoiceDesign request. Restart with `python server.py --mode "
        "voice-design`, use `--mode auto`, or set TOMORI_TTS_MODE=voice-design."
      ),
    )

  return MODE


@asynccontextmanager
async def lifespan(_app: FastAPI):
  if MODE != "auto":
    load_model_for_mode(MODE)
  yield


app = FastAPI(title=f"TomoriBot Qwen3-TTS 12Hz 1.7B {MODE} Server", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str]:
  active_mode = model_mode or ("lazy" if MODE == "auto" else MODE)
  active_model_id = model_id_for_mode(model_mode) if model_mode else ""
  active_model_name = MODEL_NAMES.get(model_mode or "", "")
  return {
    "status": "ok" if model is not None else ("idle" if MODE == "auto" else "loading"),
    "model": active_model_name,
    "model_id": active_model_id,
    "device_map": DEVICE_MAP,
    "mode": MODE,
    "active_mode": active_mode,
  }


@app.post("/synthesize")
def synthesize(payload: SynthesizeRequest) -> Response:
  request_started_at = time.perf_counter()
  text = payload.text.strip()
  if not text:
    raise HTTPException(status_code=400, detail="text is required.")
  if len(text) > MAX_TEXT_CHARS:
    raise HTTPException(status_code=400, detail=f"text exceeds {MAX_TEXT_CHARS} characters.")

  with tempfile.TemporaryDirectory(prefix=f"tomori-qwen3tts-{MODE}-") as temp_dir:
    output_path = Path(temp_dir) / "output.wav"

    with model_lock:
      request_mode = resolve_request_mode(payload)
      language = resolve_language(payload.language)
      design_instruct = resolve_design_instruct(payload) if request_mode == "voice-design" else ""
      log_info(
        f"/synthesize received mode={request_mode} server_mode={MODE} text_chars={len(text)} "
        f"instruct_chars={len(design_instruct)} ref_audio_chars={len(payload.ref_audio or '')} language={language} "
        f"active_model={model_mode or 'none'} payload_log={'full' if LOG_PAYLOADS else 'preview'}"
      )
      log_info(f"Text {'full' if LOG_PAYLOADS else 'preview'}: {preview_for_log(text)}")
      if request_mode == "voice-design":
        log_info(f"Instruct {'full' if LOG_PAYLOADS else 'preview'}: {preview_for_log(design_instruct)}")

      load_model_for_mode(request_mode)

      if request_mode == "voice-design":
        generation_started_at = time.perf_counter()
        wavs, sample_rate = model.generate_voice_design(
          text=text,
          language=language,
          instruct=design_instruct,
        )
        log_info(
          f"VoiceDesign generation finished sample_rate={sample_rate} elapsed_ms={int((time.perf_counter() - generation_started_at) * 1000)}"
        )
      else:
        if not payload.ref_audio or not payload.ref_audio.strip():
          raise HTTPException(status_code=400, detail="ref_audio is required.")

        ref_text = payload.ref_text.strip() if payload.ref_text else ""
        ref_path = decode_ref_audio(payload.ref_audio, temp_dir)
        generation_started_at = time.perf_counter()
        wavs, sample_rate = model.generate_voice_clone(
          text=text,
          language=language,
          ref_audio=ref_path,
          ref_text=ref_text,
          x_vector_only_mode=ref_text == "",
        )
        log_info(
          f"Clone generation finished sample_rate={sample_rate} elapsed_ms={int((time.perf_counter() - generation_started_at) * 1000)}"
        )

    sf.write(str(output_path), wavs[0], int(sample_rate))
    log_info(f"/synthesize completed elapsed_ms={int((time.perf_counter() - request_started_at) * 1000)}")
    return Response(content=output_path.read_bytes(), media_type="audio/wav")


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="TomoriBot Qwen3-TTS wrapper")
  parser.add_argument(
    "--mode",
    choices=("clone", "voice-design", "auto"),
    default=MODE,
    help="TTS serving mode. Equivalent to TOMORI_TTS_MODE.",
  )
  return parser.parse_args()


if __name__ == "__main__":
  parse_args()
  uvicorn.run(app, host=HOST, port=PORT)
