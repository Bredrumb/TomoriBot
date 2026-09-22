from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np
import soundfile as sf

from reference_audio import trim_reference_audio


class TrimReferenceAudioTest(unittest.TestCase):
    def _write_clip(self, directory: str, seconds: float, samplerate: int = 24000) -> Path:
        path = Path(directory) / "reference.wav"
        frames = int(seconds * samplerate)
        tone = np.sin(2 * np.pi * 220 * np.arange(frames) / samplerate).astype(np.float32)
        sf.write(path, tone, samplerate, format="WAV", subtype="PCM_16")
        return path

    def test_clamps_a_longer_clip_to_the_window(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self._write_clip(directory, 130.0)

            result = trim_reference_audio(path, 30.0)

            self.assertIsNotNone(result)
            before_seconds, after_seconds = result  # type: ignore[misc]
            self.assertAlmostEqual(before_seconds, 130.0, places=3)
            self.assertAlmostEqual(after_seconds, 30.0, places=3)
            # Upstream asserts `speech.shape[1] / 16000 <= 30` on the prompt loaded at 16 kHz, so
            # the trimmed clip has to land inside the window rather than on a rounded-up boundary.
            self.assertLessEqual(sf.info(path).duration, 30.0)

    def test_clamps_the_rate_tomoribot_normalizes_to(self) -> None:
        # TomoriBot converts every upload to 22.05 kHz mono WAV before storing it, so this is the
        # shape the sidecar actually receives.
        samplerate = 22050
        with tempfile.TemporaryDirectory() as directory:
            path = self._write_clip(directory, 130.0, samplerate=samplerate)

            result = trim_reference_audio(path, 30.0)

            self.assertIsNotNone(result)
            info = sf.info(path)
            self.assertEqual(info.samplerate, samplerate)
            self.assertEqual(info.channels, 1)
            self.assertLessEqual(info.duration, 30.0)

    def test_keeps_the_leading_audio_rather_than_the_tail(self) -> None:
        samplerate = 24000
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "reference.wav"
            # A ramp makes the retained window identifiable: sample value tracks elapsed time.
            ramp = np.linspace(0.0, 1.0, samplerate * 40, dtype=np.float32)
            sf.write(path, ramp, samplerate, format="WAV", subtype="PCM_16")

            trim_reference_audio(path, 10.0)

            kept, _ = sf.read(path, dtype="float32")
            self.assertLess(float(kept[-1]), 0.3)
            self.assertAlmostEqual(float(kept[0]), 0.0, places=3)

    def test_leaves_a_clip_that_already_fits(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self._write_clip(directory, 20.0)
            original = path.read_bytes()

            self.assertIsNone(trim_reference_audio(path, 30.0))
            self.assertEqual(path.read_bytes(), original)

    def test_ignores_a_window_at_or_below_zero(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self._write_clip(directory, 130.0)
            original = path.read_bytes()

            self.assertIsNone(trim_reference_audio(path, 0))
            self.assertIsNone(trim_reference_audio(path, -1))
            self.assertEqual(path.read_bytes(), original)

    def test_preserves_stereo_channels(self) -> None:
        samplerate = 24000
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "reference.wav"
            frames = samplerate * 40
            stereo = np.stack(
                [
                    np.sin(2 * np.pi * 220 * np.arange(frames) / samplerate),
                    np.sin(2 * np.pi * 440 * np.arange(frames) / samplerate),
                ],
                axis=1,
            ).astype(np.float32)
            sf.write(path, stereo, samplerate, format="WAV", subtype="PCM_16")

            trim_reference_audio(path, 5.0)

            kept, kept_rate = sf.read(path, dtype="float32", always_2d=True)
            self.assertEqual(kept_rate, samplerate)
            self.assertEqual(kept.shape[1], 2)
            self.assertAlmostEqual(kept.shape[0] / float(samplerate), 5.0, places=3)


if __name__ == "__main__":
    unittest.main()
