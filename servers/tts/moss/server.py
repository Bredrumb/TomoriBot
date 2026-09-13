from __future__ import annotations

import argparse
import base64
import binascii
import gc
import importlib.util
import io
import json
import os
import sys
import tempfile
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import soundfile as sf
import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from routing import resolve_mode, resolve_request_mode, resolve_warm_mode


DEFAULT_CLONE_MODEL_ID = "OpenMOSS-Team/MOSS-TTS-Local-Transformer-v1.5"
DEFAULT_DESIGN_MODEL_ID = "OpenMOSS-Team/MOSS-VoiceGenerator"
DEFAULT_CODEC_IDS = {
  "clone": "OpenMOSS-Team/MOSS-Audio-Tokenizer-v2",
  "voice-design": "OpenMOSS-Team/MOSS-Audio-Tokenizer",
}


def read_startup_mode() -> str:
  for index, arg in enumerate(sys.argv[1:], start=1):
    if arg == "--mode" and index + 1 < len(sys.argv):
      return sys.argv[index + 1]
    if arg.startswith("--mode="):
      return arg.split("=", 1)[1]
  return os.getenv("TOMORI_TTS_MODE", "auto")


MODE = resolve_mode(read_startup_mode())
WARM_MODE = resolve_warm_mode(os.getenv("MOSS_TTS_WARM_MODE", "clone")) if MODE == "auto" else MODE
HOST = os.getenv("TOMORI_TTS_HOST", "127.0.0.1")
PORT = int(os.getenv("TOMORI_TTS_PORT", "8018"))
DEVICE = os.getenv("MOSS_TTS_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
DTYPE = os.getenv("MOSS_TTS_DTYPE", "bfloat16" if DEVICE.startswith("cuda") else "float32")
CLONE_MODEL_ID = os.getenv("MOSS_TTS_CLONE_MODEL_ID", DEFAULT_CLONE_MODEL_ID)
DESIGN_MODEL_ID = os.getenv("MOSS_TTS_DESIGN_MODEL_ID", DEFAULT_DESIGN_MODEL_ID)
MAX_TEXT_CHARS = int(os.getenv("TOMORI_TTS_MAX_TEXT_CHARS", "2000"))
MAX_REF_AUDIO_BYTES = int(os.getenv("MOSS_TTS_MAX_REF_AUDIO_BYTES", "10485760"))
MAX_NEW_TOKENS = int(os.getenv("MOSS_TTS_MAX_NEW_TOKENS", "4096"))
DEFAULT_LANGUAGE = os.getenv("MOSS_TTS_DEFAULT_LANGUAGE", "").strip()
LANGUAGE_NAMES = {"en": "English", "ja": "Japanese", "zh": "Chinese"}

if HOST not in {"127.0.0.1", "::1", "localhost"} and os.getenv("TOMORI_TTS_ALLOW_REMOTE_BIND") != "true":
  raise ValueError("Remote bind requires TOMORI_TTS_ALLOW_REMOTE_BIND=true.")

model = None
processor = None
active_mode: Optional[str] = None
model_lock = threading.Lock()


class SynthesizeRequest(BaseModel):
  text: str
  ref_audio: Optional[str] = None
  ref_text: Optional[str] = None
  instruct: Optional[str] = None
  language: Optional[str] = None


def model_id_for_mode(mode: str) -> str:
  return CLONE_MODEL_ID if mode == "clone" else DESIGN_MODEL_ID


def codec_id_from_snapshot(snapshot_path: str, mode: str) -> str:
  config_path = Path(snapshot_path) / "processor_config.json"
  config = json.loads(config_path.read_text(encoding="utf-8"))
  nested = config.get("audio_tokenizer")
  if isinstance(nested, dict) and isinstance(nested.get("audio_tokenizer_name_or_path"), str):
    return nested["audio_tokenizer_name_or_path"]
  configured = config.get("audio_tokenizer_name_or_path")
  if isinstance(configured, str) and configured.strip():
    return configured
  return DEFAULT_CODEC_IDS[mode]


def resolve_dtype() -> torch.dtype:
  if DTYPE.lower() in {"bf16", "bfloat16"}:
    return torch.bfloat16
  if DTYPE.lower() in {"fp16", "float16"}:
    return torch.float16
  if DTYPE.lower() in {"fp32", "float32"}:
    return torch.float32
  raise ValueError("MOSS_TTS_DTYPE must be bfloat16, float16, or float32.")


def resolve_attention() -> str:
  if not DEVICE.startswith("cuda"):
    return "eager"
  if importlib.util.find_spec("flash_attn") is not None and resolve_dtype() in {torch.float16, torch.bfloat16}:
    if torch.cuda.get_device_capability(DEVICE)[0] >= 8:
      return "flash_attention_2"
  return "sdpa"


def unload_model() -> None:
  global model, processor, active_mode
  model = None
  processor = None
  active_mode = None
  gc.collect()
  if DEVICE.startswith("cuda") and torch.cuda.is_available():
    torch.cuda.empty_cache()


def load_model_for_mode(mode: str, local_files_only: bool = False) -> None:
  global model, processor, active_mode
  if model is not None and active_mode == mode:
    return
  if model is not None:
    unload_model()

  from transformers import AutoModel, AutoProcessor

  model_id = model_id_for_mode(mode)
  model_path = model_id
  if local_files_only:
    from huggingface_hub import snapshot_download

    model_path = snapshot_download(repo_id=model_id, local_files_only=True)
    codec_id = codec_id_from_snapshot(model_path, mode)
    snapshot_download(
      repo_id=codec_id,
      local_files_only=True,
      allow_patterns=["config.json", "*.safetensors", "*.safetensors.index.json"],
    )
  print(f"[MOSS-TTS] Loading mode={mode} model_id={model_id}", flush=True)
  next_processor = AutoProcessor.from_pretrained(
    model_path,
    trust_remote_code=True,
    **({"normalize_inputs": True} if mode == "voice-design" else {}),
  )
  next_processor.audio_tokenizer = next_processor.audio_tokenizer.to(DEVICE)
  next_model = AutoModel.from_pretrained(
    model_path,
    trust_remote_code=True,
    local_files_only=local_files_only,
    attn_implementation=resolve_attention(),
    torch_dtype=resolve_dtype(),
  ).to(DEVICE)
  next_model.eval()
  processor = next_processor
  model = next_model
  active_mode = mode


def decode_reference(raw_base64: str, directory: str) -> str:
  if len(raw_base64) > (MAX_REF_AUDIO_BYTES + 2) // 3 * 4:
    raise HTTPException(status_code=413, detail="ref_audio exceeds the configured size limit.")
  try:
    audio_bytes = base64.b64decode(raw_base64, validate=True)
  except (ValueError, binascii.Error) as exc:
    raise HTTPException(status_code=400, detail="ref_audio must be valid base64.") from exc
  if len(audio_bytes) > MAX_REF_AUDIO_BYTES:
    raise HTTPException(status_code=413, detail="ref_audio exceeds the configured size limit.")
  path = Path(directory) / "reference.wav"
  path.write_bytes(audio_bytes)
  try:
    sf.info(str(path))
  except (RuntimeError, ValueError) as exc:
    raise HTTPException(status_code=400, detail="ref_audio is not a readable audio file.") from exc
  return str(path)


def encode_reference(path: str) -> torch.Tensor:
  # A path reference makes the MOSS processor call torchaudio.load, which in torchaudio 2.9+ routes through
  # torchcodec and needs FFmpeg shared DLLs that a Windows venv rarely has. Decoding with soundfile and
  # handing the processor pre-encoded codes keeps FFmpeg out of the clone path.
  assert processor is not None
  samples, sampling_rate = sf.read(path, dtype="float32", always_2d=True)
  waveform = torch.from_numpy(samples.T.copy())
  return processor.encode_audios_from_wav([waveform], sampling_rate)[0]


def generate_audio(mode: str, text: str, instruct: Optional[str], language: Optional[str], reference: Optional[str]) -> bytes:
  assert model is not None and processor is not None
  message_kwargs = {"text": text}
  if mode == "clone":
    message_kwargs["reference"] = [encode_reference(reference)]
    selected_language = (language or DEFAULT_LANGUAGE).strip()
    if selected_language:
      message_kwargs["language"] = LANGUAGE_NAMES.get(selected_language.lower(), selected_language)
  else:
    message_kwargs["instruction"] = instruct

  conversation = [[processor.build_user_message(**message_kwargs)]]
  batch = processor(conversation, mode="generation")
  with torch.no_grad():
    output = model.generate(
      input_ids=batch["input_ids"].to(DEVICE),
      attention_mask=batch["attention_mask"].to(DEVICE),
      max_new_tokens=MAX_NEW_TOKENS,
    )
    decoded = processor.decode(output)

  if not decoded or decoded[0] is None or not decoded[0].audio_codes_list:
    raise HTTPException(status_code=502, detail="MOSS produced no audio.")
  audio = torch.cat(decoded[0].audio_codes_list, dim=-1).detach().cpu().to(torch.float32).numpy()
  if audio.ndim == 2:
    audio = audio.T
  buffer = io.BytesIO()
  sf.write(buffer, audio, processor.model_config.sampling_rate, format="WAV")
  return buffer.getvalue()


@asynccontextmanager
async def lifespan(_app: FastAPI):
  initial_mode = WARM_MODE if MODE == "auto" else MODE
  if initial_mode != "none":
    with model_lock:
      try:
        load_model_for_mode(initial_mode, local_files_only=MODE == "auto")
      except OSError as exc:
        if MODE != "auto":
          raise
        raise RuntimeError(
          "MOSS startup model is not fully cached. Run python servers/tts/moss/prefetch_models.py "
          "before starting the server, or set MOSS_TTS_WARM_MODE=none."
        ) from exc
  yield


app = FastAPI(title=f"TomoriBot MOSS-TTS {MODE} Server", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str]:
  return {
    "status": "ok" if model is not None else "idle",
    "mode": MODE,
    "warm_mode": WARM_MODE,
    "active_mode": active_mode or "none",
    "model_id": model_id_for_mode(active_mode) if active_mode else "",
    "device": DEVICE,
  }


@app.post("/synthesize")
def synthesize(payload: SynthesizeRequest) -> Response:
  text = payload.text.strip()
  if not text:
    raise HTTPException(status_code=400, detail="text is required.")
  if len(text) > MAX_TEXT_CHARS:
    raise HTTPException(status_code=400, detail=f"text exceeds {MAX_TEXT_CHARS} characters.")
  try:
    request_mode = resolve_request_mode(MODE, payload.ref_audio, payload.instruct)
  except ValueError as exc:
    raise HTTPException(status_code=400, detail=str(exc)) from exc

  with tempfile.TemporaryDirectory(prefix="tomori-moss-") as temp_dir:
    reference = decode_reference(payload.ref_audio, temp_dir) if request_mode == "clone" and payload.ref_audio else None
    with model_lock:
      load_model_for_mode(request_mode)
      audio_bytes = generate_audio(request_mode, text, payload.instruct, payload.language, reference)
  return Response(content=audio_bytes, media_type="audio/wav")


if __name__ == "__main__":
  parser = argparse.ArgumentParser(description="TomoriBot MOSS-TTS wrapper")
  parser.add_argument("--mode", choices=("auto", "clone", "voice-design"), default=MODE)
  parser.parse_args()
  uvicorn.run(app, host=HOST, port=PORT)
