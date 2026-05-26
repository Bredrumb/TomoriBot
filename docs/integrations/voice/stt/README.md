# Transcription Integration

TomoriBot treats speech-to-text as the `transcription` custom endpoint capability. Audio attachments are transcribed in the background and added to conversation context when an active transcription endpoint exists.

Visible transcript posting is separate. `/speech transcripts` only controls whether voice-message transcripts are posted in chat; it does not enable or disable background STT.

## Quick Flow

1. Start the WhisperX reference server from `servers/stt/`.
2. Register it with `/config custom-endpoint add` using capability `transcription` and api style `openai-compatible-transcription`.
3. Select it with `/config model transcription`.

ElevenLabs users should use `/speech elevenlabs`; it registers transcription alongside speech.
