---
title: "TTS Integration"
sidebar:
  groupLabel: "TTS"
---

TomoriBot treats speech as a custom endpoint capability. Local engines run outside the bot as HTTP servers and implement `POST /synthesize`; most clone engines receive text plus the configured reference audio sample.

## Quick Flow

1. Start one wrapper from `servers/tts/`.
2. Register it with `/provider custom-endpoint add` using capability `speech` and api style `tts-clone`.
3. Add a reference sample with `/speech voice-add`. Any audio format is accepted (auto-converted to mono WAV). A 10-20 second clip with no BGM is recommended for clone engines.
4. Assign the sample to a persona with `/speech voice-assign`.

Registration makes the endpoint active immediately. Use `/model speech` later only when switching between registered TTS endpoints.

ElevenLabs users should use `/speech elevenlabs`; it registers the speech and transcription endpoints together.

TomoriBot strips Discord custom emoji syntax such as `:pepega:` or `<:pepega:123456789012345678>` from generated voice scripts before synthesis. Unicode emojis are also stripped unless the speech endpoint uses emoji markup, which is intended for IrodoriTTS.

## Endpoint Contract

Local wrappers must expose:

- `GET /health` returning JSON with `status: "ok"`
- `POST /synthesize` accepting JSON `{ text, ref_audio, ref_text, instruct, language }`
- a bare `audio/*` response content type such as `audio/wav`

Clone wrappers should treat `ref_audio` as the speaker reference and `ref_text` as its transcript. Voice-design wrappers may ignore `ref_audio` and use `instruct` as the natural-language voice description; configure those prompts per persona with `/speech voice-design set`.

TomoriBot waits up to `TTS_SYNTHESIZE_TIMEOUT_MS` milliseconds for local clone and VoiceDesign `/synthesize` responses, defaulting to 240000. The legacy `TTS_CLONE_TIMEOUT_MS` name is still accepted when the new setting is unset.

Reference scripts are best-effort examples, not production services. Upstream model packages may break over time; fixes should be made in the wrapper scripts and documented here.
