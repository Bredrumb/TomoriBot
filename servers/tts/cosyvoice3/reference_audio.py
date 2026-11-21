from __future__ import annotations

from pathlib import Path

import soundfile as sf


def trim_reference_audio(path: Path, max_seconds: float) -> tuple[float, float] | None:
    """Clamp a reference clip to the tokenizer's window, in place.

    Returns the (before, after) durations when audio was cut, or None when the clip already fits.

    CosyVoice's tokenizer asserts that prompt audio stays inside its 30-second window and fails the
    request rather than shortening the audio, while the prompt speech features are aligned to that
    same prompt. Reading the clip down to its leading window therefore keeps the speaker embedding,
    the prompt speech token, and the prompt speech feature all describing one span.
    """
    info = sf.info(path)
    if max_seconds <= 0 or info.duration <= max_seconds:
        return None

    kept_frames = int(max_seconds * info.samplerate)
    audio, samplerate = sf.read(path, frames=kept_frames, dtype="float32", always_2d=True)
    sf.write(path, audio, samplerate, format="WAV", subtype="PCM_16")
    return info.duration, kept_frames / float(info.samplerate)
