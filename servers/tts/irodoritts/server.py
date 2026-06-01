from __future__ import annotations

import base64
import os
import tempfile
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import torch
import torchaudio
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from huggingface_hub import hf_hub_download
from pydantic import BaseModel


MODEL_ID = os.getenv("IRODORI_TTS_MODEL_ID", "Aratako/Irodori-TTS-500M-v2")
MODEL_NAME = "irodori-tts-500m-v2"
HOST = os.getenv("TOMORI_TTS_HOST", "127.0.0.1")
PORT = int(os.getenv("TOMORI_TTS_PORT", "8013"))
MODEL_DEVICE = os.getenv("IRODORI_MODEL_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
CODEC_DEVICE = os.getenv("IRODORI_CODEC_DEVICE", MODEL_DEVICE)
MODEL_PRECISION = os.getenv("IRODORI_MODEL_PRECISION", "bf16" if torch.cuda.is_available() else "fp32")
CODEC_PRECISION = os.getenv("IRODORI_CODEC_PRECISION", MODEL_PRECISION)
MAX_TEXT_CHARS = int(os.getenv("TOMORI_TTS_MAX_TEXT_CHARS", "1000"))

runtime = None
runtime_lock = threading.Lock()


class SynthesizeRequest(BaseModel):
  text: str
  ref_audio: str
  ref_text: Optional[str] = None
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


def load_model() -> None:
  global runtime

  from irodori_tts.inference_runtime import InferenceRuntime, RuntimeKey

  checkpoint_path = hf_hub_download(repo_id=MODEL_ID, filename="model.safetensors")
  runtime = InferenceRuntime.from_key(
    RuntimeKey(
      checkpoint=checkpoint_path,
      model_device=MODEL_DEVICE,
      codec_device=CODEC_DEVICE,
      model_precision=MODEL_PRECISION,
      codec_precision=CODEC_PRECISION,
    )
  )


@asynccontextmanager
async def lifespan(_app: FastAPI):
  load_model()
  yield


app = FastAPI(title="TomoriBot Irodori-TTS Server", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str]:
  return {
    "status": "ok" if runtime is not None else "loading",
    "model": MODEL_NAME,
    "model_id": MODEL_ID,
    "model_device": MODEL_DEVICE,
  }


@app.post("/synthesize")
def synthesize(payload: SynthesizeRequest) -> Response:
  if runtime is None:
    raise HTTPException(status_code=503, detail="Model is still loading.")

  text = payload.text.strip()
  if not text:
    raise HTTPException(status_code=400, detail="text is required.")
  if len(text) > MAX_TEXT_CHARS:
    raise HTTPException(status_code=400, detail=f"text exceeds {MAX_TEXT_CHARS} characters.")
  if not payload.ref_audio.strip():
    raise HTTPException(status_code=400, detail="ref_audio is required.")

  with tempfile.TemporaryDirectory(prefix="tomori-irodori-") as temp_dir:
    ref_path = decode_ref_audio(payload.ref_audio, temp_dir)
    output_path = Path(temp_dir) / "output.wav"

    from irodori_tts.inference_runtime import SamplingRequest

    with runtime_lock:
      result = runtime.synthesize(
        SamplingRequest(
          text=text,
          ref_wav=ref_path,
          no_ref=False,
          num_candidates=1,
        ),
        log_fn=None,
      )

    # Cast to float32 before saving — WAV doesn't support bfloat16
    torchaudio.save(str(output_path), result.audio.float().cpu(), int(result.sample_rate))
    return Response(content=output_path.read_bytes(), media_type="audio/wav")


if __name__ == "__main__":
  uvicorn.run(app, host=HOST, port=PORT)
