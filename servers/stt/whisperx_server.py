from __future__ import annotations

import os
import tempfile
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import torch
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse, Response


MODEL_ID = os.getenv("WHISPERX_MODEL", "large-v3")
HOST = os.getenv("TOMORI_STT_HOST", os.getenv("TOMORI_TRANSCRIPTION_HOST", "127.0.0.1"))
PORT = int(os.getenv("TOMORI_STT_PORT", os.getenv("TOMORI_TRANSCRIPTION_PORT", "8021")))
DEVICE = os.getenv("WHISPERX_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
COMPUTE_TYPE = os.getenv("WHISPERX_COMPUTE_TYPE", "float16" if torch.cuda.is_available() else "int8")
BATCH_SIZE = int(os.getenv("WHISPERX_BATCH_SIZE", "16"))
ENABLE_ALIGNMENT = os.getenv("WHISPERX_ENABLE_ALIGNMENT", "0") == "1"

model = None
model_lock = threading.Lock()
alignment_models = {}


def load_model() -> None:
  global model

  import whisperx

  model = whisperx.load_model(MODEL_ID, DEVICE, compute_type=COMPUTE_TYPE)


@asynccontextmanager
async def lifespan(_app: FastAPI):
  load_model()
  yield


app = FastAPI(title="TomoriBot WhisperX STT Server", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str]:
  return {
    "status": "ok" if model is not None else "loading",
    "model": MODEL_ID,
    "device": DEVICE,
  }


@app.get("/v1/models")
def list_models() -> dict[str, object]:
  return {
    "object": "list",
    "data": [
      {
        "id": MODEL_ID,
        "object": "model",
        "owned_by": "local-whisperx",
      }
    ],
  }


def segment_text(result: dict[str, object]) -> str:
  segments = result.get("segments")
  if not isinstance(segments, list):
    return ""

  parts = []
  for segment in segments:
    if isinstance(segment, dict):
      text = segment.get("text")
      if isinstance(text, str) and text.strip():
        parts.append(text.strip())
  return " ".join(parts).strip()


def maybe_align(result: dict[str, object], audio: object) -> dict[str, object]:
  if not ENABLE_ALIGNMENT:
    return result

  import whisperx

  language_code = result.get("language")
  if not isinstance(language_code, str) or not language_code:
    return result

  if language_code not in alignment_models:
    alignment_models[language_code] = whisperx.load_align_model(language_code=language_code, device=DEVICE)

  align_model, metadata = alignment_models[language_code]
  segments = result.get("segments", [])
  return whisperx.align(segments, align_model, metadata, audio, DEVICE, return_char_alignments=False)


def transcribe_file(path: str, language: Optional[str]) -> dict[str, object]:
  if model is None:
    raise HTTPException(status_code=503, detail="Model is still loading.")

  import whisperx

  audio = whisperx.load_audio(path)

  with model_lock:
    if language and language.strip():
      try:
        result = model.transcribe(audio, batch_size=BATCH_SIZE, language=language.strip())
      except TypeError:
        result = model.transcribe(audio, batch_size=BATCH_SIZE)
    else:
      result = model.transcribe(audio, batch_size=BATCH_SIZE)

    return maybe_align(result, audio)


@app.post("/v1/audio/transcriptions")
async def create_transcription(
  file: UploadFile = File(...),
  model_name: str = Form(alias="model", default=MODEL_ID),
  response_format: str = Form(default="json"),
  language: Optional[str] = Form(default=None),
) -> Response:
  if model_name and model_name != MODEL_ID:
    raise HTTPException(status_code=400, detail=f"Only model '{MODEL_ID}' is loaded.")

  suffix = Path(file.filename or "audio.wav").suffix or ".wav"
  with tempfile.TemporaryDirectory(prefix="tomori-whisperx-") as temp_dir:
    audio_path = Path(temp_dir) / f"input{suffix}"
    audio_path.write_bytes(await file.read())

    result = transcribe_file(str(audio_path), language)
    text = segment_text(result)

    if response_format == "text":
      return PlainTextResponse(text)

    return JSONResponse(
      {
        "text": text,
        "language": result.get("language"),
        "segments": result.get("segments", []),
      }
    )


if __name__ == "__main__":
  uvicorn.run(app, host=HOST, port=PORT)
