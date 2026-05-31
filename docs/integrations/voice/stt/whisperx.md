---
title: "WhisperX Transcription"
---

WhisperX is the recommended beginner-friendly local transcription path.

```powershell
cd servers/stt
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python whisperx_server.py
```

Register with `/config custom-endpoint add`:

- capability: `transcription`
- api_style: `openai-compatible-transcription`
- endpoint_url: your server URL
- transcription_model: `large-v3` or the model loaded by your server
- transcription_language: optional default language hint

Select it with `/config model transcription`.
