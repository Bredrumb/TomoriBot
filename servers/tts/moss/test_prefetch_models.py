from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import prefetch_models
import server


class MossPrefetchTests(unittest.TestCase):
  def test_codec_selection_reads_model_configuration(self) -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
      config_path = Path(temp_dir) / "processor_config.json"
      config_path.write_text(json.dumps({"audio_tokenizer_name_or_path": "example/codec"}), encoding="utf-8")
      self.assertEqual(prefetch_models.codec_id_from_snapshot(temp_dir, "clone"), "example/codec")

      config_path.write_text(json.dumps({"audio_tokenizer": {"audio_tokenizer_name_or_path": "example/nested"}}), encoding="utf-8")
      self.assertEqual(prefetch_models.codec_id_from_snapshot(temp_dir, "clone"), "example/nested")

      config_path.write_text("{}", encoding="utf-8")
      self.assertEqual(prefetch_models.codec_id_from_snapshot(temp_dir, "voice-design"), "OpenMOSS-Team/MOSS-Audio-Tokenizer")

  def test_auto_prefetches_both_models_and_their_codecs(self) -> None:
    with tempfile.TemporaryDirectory() as clone_dir, tempfile.TemporaryDirectory() as design_dir:
      (Path(clone_dir) / "processor_config.json").write_text(
        json.dumps({"audio_tokenizer_name_or_path": "OpenMOSS-Team/MOSS-Audio-Tokenizer-v2"}), encoding="utf-8"
      )
      (Path(design_dir) / "processor_config.json").write_text("{}", encoding="utf-8")

      def fake_download(repo_id: str, dry_run: bool = False) -> str | list[SimpleNamespace]:
        if dry_run:
          return [SimpleNamespace(file_size=1024, will_download=True)]
        return design_dir if repo_id == server.DESIGN_MODEL_ID else clone_dir

      with patch("prefetch_models.snapshot_download", side_effect=fake_download) as download, patch(
        "prefetch_models.shutil.disk_usage", return_value=SimpleNamespace(free=1024 * 1024)
      ):
        result = prefetch_models.prefetch("auto")

    expected = [
      server.CLONE_MODEL_ID,
      "OpenMOSS-Team/MOSS-Audio-Tokenizer-v2",
      server.DESIGN_MODEL_ID,
      "OpenMOSS-Team/MOSS-Audio-Tokenizer",
    ]
    self.assertEqual(result, expected)
    self.assertEqual([call.kwargs["repo_id"] for call in download.call_args_list if not call.kwargs.get("dry_run")], expected)

  def test_prefetch_refuses_a_checkpoint_that_cannot_fit(self) -> None:
    planned = [SimpleNamespace(file_size=2048, will_download=True)]
    with patch("prefetch_models.snapshot_download", return_value=planned) as download, patch(
      "prefetch_models.shutil.disk_usage", return_value=SimpleNamespace(free=1024)
    ):
      with self.assertRaisesRegex(RuntimeError, "Not enough free disk space"):
        prefetch_models.prefetch("clone")
    download.assert_called_once_with(repo_id=server.CLONE_MODEL_ID, dry_run=True)


if __name__ == "__main__":
  unittest.main()
