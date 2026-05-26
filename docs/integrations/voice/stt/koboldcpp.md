# KoboldCPP Transcription

KoboldCPP has Whisper-based STT support, but endpoint shape can vary by build. TomoriBot's Phase 4 adapter expects OpenAI-compatible `POST /v1/audio/transcriptions`.

If your KoboldCPP build exposes that endpoint, register it with `/config custom-endpoint add` using capability `transcription` and api style `openai-compatible-transcription`.

If it only exposes `/api/extra/transcribe` or another custom shape, use a wrapper until TomoriBot has a dedicated adapter.
