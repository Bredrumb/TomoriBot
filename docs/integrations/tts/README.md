# TTS Integration

TomoriBot treats speech as a custom endpoint capability. Local engines run outside the bot as HTTP servers and implement `POST /synthesize`; most clone engines receive text plus the configured reference audio sample.

## Quick Flow

1. Start one wrapper from `scripts/tts/`.
2. Register it with `/provider custom-endpoint add` using capability `speech` and api style `tts-clone`.
3. Select it with `/model speech`.
4. Add a reference sample with `/speech voice-add`. Any audio format is accepted (auto-converted to mono WAV). A 10-20 second clip with no BGM is recommended for clone engines.
5. Assign the sample to a persona with `/speech voice-assign`.

ElevenLabs users should use `/speech elevenlabs`; it registers the speech and transcription endpoints together.

TomoriBot strips Discord custom emoji syntax such as `:pepega:` or `<:pepega:123456789012345678>` from generated voice scripts before synthesis. Unicode emojis are also stripped unless the speech endpoint uses emoji markup, which is intended for IrodoriTTS.

## Endpoint Contract

Local wrappers must expose:

- `GET /health` returning JSON with `status: "ok"`
- `POST /synthesize` accepting JSON `{ text, ref_audio, ref_text, instruct, language }`
- a bare `audio/*` response content type such as `audio/wav`

Clone wrappers should treat `ref_audio` as the speaker reference and `ref_text` as its transcript. Voice-design wrappers may ignore `ref_audio` and use `instruct` as the natural-language voice description; configure those prompts per persona with `/speech voice-design set`.

Reference scripts are best-effort examples, not production services. Upstream model packages may break over time; fixes should be made in the wrapper scripts and documented here.
