from __future__ import annotations

import base64
import hashlib
import os
import tempfile
import threading
from collections import OrderedDict
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import torch
import torchaudio as ta
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel


MODEL_NAME = "chatterbox"
HOST = os.getenv("TOMORI_TTS_HOST", "127.0.0.1")
PORT = int(os.getenv("CHATTERBOX_PORT", "8011"))
DEVICE = os.getenv("TOMORI_TTS_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
MAX_TEXT_CHARS = 2000
FAST_MODEL = os.getenv("CHATTERBOX_FAST_MODEL", "turbo").strip().lower()
if FAST_MODEL not in {"turbo", "nano"}:
  raise ValueError("CHATTERBOX_FAST_MODEL must be 'turbo' or 'nano'.")

# Each entry holds about 170 KB of model-device tensors (speaker embedding plus 10 s of prompt features), so 32 cost about 5 MB of VRAM.
CONDITIONALS_CACHE_LIMIT = 32

turbo_model = None
standard_model = None
model_lock = threading.Lock()
conditionals_cache: OrderedDict[tuple[bool, str], object] = OrderedDict()


class SynthesizeRequest(BaseModel):
  text: str
  ref_audio: str
  ref_text: Optional[str] = None
  instruct: Optional[str] = None
  language: Optional[str] = None
  chatterbox_turbo: bool = True
  cfg_weight: float = 0.5
  exaggeration: float = 0.5


def decode_ref_audio(raw_base64: str, directory: str) -> str:
  try:
    audio_bytes = base64.b64decode(raw_base64, validate=True)
  except Exception as exc:
    raise HTTPException(status_code=400, detail="ref_audio must be valid base64.") from exc

  ref_path = Path(directory) / "reference.wav"
  ref_path.write_bytes(audio_bytes)
  return str(ref_path)


def clamp_nonnegative(value: float) -> float:
  return max(0.0, value)


def apply_reference(active_model, turbo: bool, ref_path: str) -> None:
  key = (turbo, hashlib.sha256(Path(ref_path).read_bytes()).hexdigest())
  cached = conditionals_cache.get(key)
  if cached is not None:
    conditionals_cache.move_to_end(key)
    active_model.conds = cached
    return
  # Without no_grad the S3Gen speaker embedding keeps its autograd graph, about 287 MB of VRAM per cached voice.
  with torch.no_grad():
    # 0.0 is what Turbo's generate() prepares; standard generate() swaps in the request's exaggeration itself.
    active_model.prepare_conditionals(ref_path, exaggeration=0.0)
  conditionals_cache[key] = active_model.conds
  if len(conditionals_cache) > CONDITIONALS_CACHE_LIMIT:
    conditionals_cache.popitem(last=False)


def load_model() -> None:
  global turbo_model

  from chatterbox.tts_turbo import ChatterboxTurboTTS

  if FAST_MODEL == "nano":
    turbo_model = ChatterboxTurboTTS.from_pretrained(device=DEVICE, nano=True)
  else:
    turbo_model = ChatterboxTurboTTS.from_pretrained(device=DEVICE)


def load_standard_model():
  global standard_model

  if standard_model is None:
    from chatterbox.tts import ChatterboxTTS

    standard_model = ChatterboxTTS.from_pretrained(device=DEVICE)
  return standard_model


@asynccontextmanager
async def lifespan(_app: FastAPI):
  load_model()
  yield


app = FastAPI(title="TomoriBot Chatterbox TTS Server", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str]:
  return {
    "status": "ok" if turbo_model is not None else "loading",
    "model": MODEL_NAME,
    "fast_model": FAST_MODEL,
    "device": DEVICE,
    "turbo_loaded": str(turbo_model is not None).lower(),
    "standard_loaded": str(standard_model is not None).lower(),
  }


@app.post("/synthesize")
def synthesize(payload: SynthesizeRequest) -> Response:
  if turbo_model is None:
    raise HTTPException(status_code=503, detail="Model is still loading.")

  text = payload.text.strip()
  if not text:
    raise HTTPException(status_code=400, detail="text is required.")
  if len(text) > MAX_TEXT_CHARS:
    raise HTTPException(status_code=400, detail=f"text exceeds {MAX_TEXT_CHARS} characters.")
  if not payload.ref_audio.strip():
    raise HTTPException(status_code=400, detail="ref_audio is required.")

  with tempfile.TemporaryDirectory(prefix="tomori-chatterbox-") as temp_dir:
    ref_path = decode_ref_audio(payload.ref_audio, temp_dir)
    output_path = Path(temp_dir) / "output.wav"

    with model_lock:
      active_model = turbo_model if payload.chatterbox_turbo else load_standard_model()
      apply_reference(active_model, payload.chatterbox_turbo, ref_path)
      if payload.chatterbox_turbo:
        wav = active_model.generate(text)
      else:
        wav = active_model.generate(
          text,
          cfg_weight=clamp_nonnegative(payload.cfg_weight),
          exaggeration=clamp_nonnegative(payload.exaggeration),
        )

    ta.save(str(output_path), wav.cpu(), int(active_model.sr))
    return Response(content=output_path.read_bytes(), media_type="audio/wav")


if __name__ == "__main__":
  uvicorn.run(app, host=HOST, port=PORT)
