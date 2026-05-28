# Qwen3-TTS

Use `scripts/tts/qwen3tts/server.py` for both Qwen3-TTS 12Hz 1.7B modes. By default it starts in auto mode, which chooses the Base voice-clone model or VoiceDesign model from each request shape.

```powershell
python -m venv scripts\tts\qwen3tts\.venv
scripts\tts\qwen3tts\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r scripts\tts\qwen3tts\requirements.txt
python scripts\tts\qwen3tts\server.py
```

You can also specify auto mode explicitly:

```powershell
python scripts\tts\qwen3tts\server.py --mode auto
```

Auto mode inspects each `/synthesize` request: requests with `ref_audio` use the clone model, while requests with `instruct` use the VoiceDesign model. It keeps only one model loaded at a time and swaps models when the request type changes, so the first request after a swap may be slower.

In TomoriBot, select `Auto` as the speech endpoint's voice source mode when one endpoint URL should support mixed personas. Personas configured with `/speech voice-assign` use clone synthesis; personas configured with `/speech voice-design set` use VoiceDesign synthesis. Voice samples and VoiceDesign prompts are kept as reusable persona data; the most recently selected voice mode becomes active without deleting the other saved setup.

Register with `/provider custom-endpoint add`:

- capability: `speech`
- api_style: `tts-clone`
- endpoint_url: your wrapper URL
- script_markup: `plain`
- supports_instruct: `false`

## VoiceDesign

Start the same server in VoiceDesign mode when serving `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`.

```powershell
scripts\tts\qwen3tts\.venv\Scripts\Activate.ps1
$env:TOMORI_TTS_MODE = "voice-design"
python scripts\tts\qwen3tts\server.py
```

You can also pass `--mode voice-design` instead of setting `TOMORI_TTS_MODE`.

For mixed clone and VoiceDesign usage on one endpoint URL, prefer `--mode auto` and register a TomoriBot custom endpoint with the `Auto` voice source mode.

Register it the same way as the clone wrapper, but select the VoiceDesign voice source mode. TomoriBot treats VoiceDesign mode as instruct-capable automatically; the Supports Instruct checkbox does not need to be selected separately.

Set each persona's natural-language voice description with `/speech voice-design set`. Remove it with `/speech voice-design remove`. During generation, TomoriBot sends that prompt in the `/synthesize` JSON body as `instruct`; when the tool includes `voice_instructions`, those one-off delivery notes are appended to the instruct text for that message only. The wrapper still accepts `ref_text` or `TOMORI_TTS_DEFAULT_INSTRUCT` as fallbacks for manual testing or single-voice deployments.

When vLLM-Omni or another stable hosted serving path supports this model, prefer documenting that as the production path and keep this wrapper as a reference implementation.
