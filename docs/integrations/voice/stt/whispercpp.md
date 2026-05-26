# whisper.cpp Transcription

whisper.cpp can be used when its HTTP server exposes an OpenAI-compatible `POST /v1/audio/transcriptions` endpoint.

Register with `/config custom-endpoint add` using capability `transcription` and api style `openai-compatible-transcription`. If your server exposes a different endpoint shape, place a thin wrapper in front of it that maps requests to TomoriBot's expected OpenAI-compatible shape.
