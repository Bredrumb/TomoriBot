from __future__ import annotations

import base64
import asyncio
import io
import unittest
import wave
from types import SimpleNamespace
from unittest.mock import patch

import torch

import server


class FakeProcessor:
  def __init__(self) -> None:
    self.audio_tokenizer = self
    self.model_config = SimpleNamespace(sampling_rate=16000)
    self.messages: list[dict[str, object]] = []

  def to(self, _device: str) -> FakeProcessor:
    return self

  def build_user_message(self, **kwargs: object) -> dict[str, object]:
    self.messages.append(kwargs)
    return kwargs

  def __call__(self, _conversations: object, mode: str) -> dict[str, torch.Tensor]:
    assert mode == "generation"
    return {"input_ids": torch.zeros((1, 1), dtype=torch.long), "attention_mask": torch.ones((1, 1), dtype=torch.long)}

  def encode_audios_from_wav(self, wavs: list[torch.Tensor], _sampling_rate: int) -> list[torch.Tensor]:
    return [torch.zeros((wav.shape[-1] // 80, 32), dtype=torch.long) for wav in wavs]

  def decode(self, _output: object) -> list[SimpleNamespace]:
    return [SimpleNamespace(audio_codes_list=[torch.zeros((1, 800), dtype=torch.float32)])]


class FakeModel:
  def to(self, _device: str) -> FakeModel:
    return self

  def eval(self) -> FakeModel:
    return self

  def generate(self, **_kwargs: object) -> object:
    return object()


def reference_wav() -> str:
  buffer = io.BytesIO()
  with wave.open(buffer, "wb") as output:
    output.setnchannels(1)
    output.setsampwidth(2)
    output.setframerate(16000)
    output.writeframes(b"\x00\x00" * 800)
  return base64.b64encode(buffer.getvalue()).decode("ascii")


class MossServerTests(unittest.TestCase):
  def setUp(self) -> None:
    server.unload_model()
    server.MODE = "auto"
    server.DEVICE = "cpu"
    server.DTYPE = "float32"
    server.DEFAULT_LANGUAGE = ""
    self.processors: list[FakeProcessor] = []
    self.processor_options: list[dict[str, object]] = []
    self.model_ids: list[str] = []

    def make_processor(_model_id: str, **kwargs: object) -> FakeProcessor:
      next_processor = FakeProcessor()
      self.processors.append(next_processor)
      self.processor_options.append(kwargs)
      return next_processor

    def make_model(model_id: str, **_kwargs: object) -> FakeModel:
      self.model_ids.append(model_id)
      return FakeModel()

    self.processor_patch = patch("transformers.AutoProcessor.from_pretrained", side_effect=make_processor)
    self.model_patch = patch("transformers.AutoModel.from_pretrained", side_effect=make_model)
    self.processor_patch.start()
    self.model_patch.start()
    self.addCleanup(self.processor_patch.stop)
    self.addCleanup(self.model_patch.stop)
    self.addCleanup(server.unload_model)

  def test_clone_uses_reference_and_language(self) -> None:
    response = server.synthesize(server.SynthesizeRequest(text="Hello", ref_audio=reference_wav(), language="ja"))

    self.assertEqual(response.media_type, "audio/wav")
    self.assertTrue(response.body.startswith(b"RIFF"))
    self.assertEqual(self.model_ids, [server.CLONE_MODEL_ID])
    message = self.processors[0].messages[0]
    self.assertEqual(message["language"], "Japanese")
    self.assertEqual(len(message["reference"]), 1)
    self.assertIsInstance(message["reference"][0], torch.Tensor)
    self.assertNotIn("instruction", message)

  def test_auto_swaps_to_voice_generator(self) -> None:
    server.synthesize(server.SynthesizeRequest(text="Hello", ref_audio=reference_wav()))
    response = server.synthesize(server.SynthesizeRequest(text="Hello", instruct="Warm and gentle"))

    self.assertEqual(response.media_type, "audio/wav")
    self.assertEqual(self.model_ids, [server.CLONE_MODEL_ID, server.DESIGN_MODEL_ID])
    self.assertEqual(self.processors[1].messages[0]["instruction"], "Warm and gentle")
    self.assertNotIn("reference", self.processors[1].messages[0])

  def test_invalid_reference_is_rejected_before_model_load(self) -> None:
    with self.assertRaises(server.HTTPException) as raised:
      server.synthesize(server.SynthesizeRequest(text="Hello", ref_audio=base64.b64encode(b"not audio").decode()))

    self.assertEqual(raised.exception.status_code, 400)
    self.assertEqual(self.model_ids, [])

  def test_auto_warms_selected_model_before_serving(self) -> None:
    server.WARM_MODE = "voice-design"
    self.addCleanup(setattr, server, "WARM_MODE", "clone")

    async def run_lifespan() -> None:
      async with server.lifespan(server.app):
        self.assertEqual(server.active_mode, "voice-design")

    with patch("huggingface_hub.snapshot_download", side_effect=["cached-model", "cached-codec"]) as download:
      with patch.object(server, "codec_id_from_snapshot", return_value="cached-codec-id"):
        asyncio.run(run_lifespan())
    self.assertEqual(self.model_ids, ["cached-model"])
    self.assertNotIn("local_files_only", self.processor_options[0])
    self.assertEqual(download.call_count, 2)
    self.assertEqual(download.call_args_list[0].kwargs, {"repo_id": server.DESIGN_MODEL_ID, "local_files_only": True})
    self.assertEqual(
      download.call_args_list[1].kwargs,
      {
        "repo_id": "cached-codec-id",
        "local_files_only": True,
        "allow_patterns": ["config.json", "*.safetensors", "*.safetensors.index.json"],
      },
    )

  def test_auto_warm_reports_missing_prefetch_without_downloading(self) -> None:
    with patch("huggingface_hub.snapshot_download", side_effect=OSError("not cached")):
      async def run_lifespan() -> None:
        async with server.lifespan(server.app):
          pass

      with self.assertRaisesRegex(RuntimeError, "prefetch_models.py"):
        asyncio.run(run_lifespan())


if __name__ == "__main__":
  unittest.main()
