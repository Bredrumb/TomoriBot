from __future__ import annotations

import base64
import os
import tempfile
import threading
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
PORT = int(os.getenv("TOMORI_TTS_PORT", "8011"))
DEVICE = os.getenv("TOMORI_TTS_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
MAX_TEXT_CHARS = int(os.getenv("TOMORI_TTS_MAX_TEXT_CHARS", "2000"))

turbo_model = None
standard_model = None
model_lock = threading.Lock()


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


def load_model() -> None:
  global turbo_model

  from chatterbox.tts_turbo import ChatterboxTurboTTS

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
      if payload.chatterbox_turbo:
        active_model = turbo_model
        wav = active_model.generate(text, audio_prompt_path=ref_path)
      else:
        active_model = load_standard_model()
        wav = active_model.generate(
          text,
          audio_prompt_path=ref_path,
          cfg_weight=clamp_nonnegative(payload.cfg_weight),
          exaggeration=clamp_nonnegative(payload.exaggeration),
        )

    ta.save(str(output_path), wav.cpu(), int(active_model.sr))
    return Response(content=output_path.read_bytes(), media_type="audio/wav")


if __name__ == "__main__":
  uvicorn.run(app, host=HOST, port=PORT)
