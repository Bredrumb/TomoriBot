# Chatterbox TTS

Use `servers/tts/chatterbox/server.py` for a local clone endpoint. It defaults to Chatterbox-Turbo, preserving bracket delivery tags and matching TomoriBot's fastest current behavior.

```powershell
python -m venv servers\tts\chatterbox\.venv
servers\tts\chatterbox\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install numpy
pip install -r servers\tts\chatterbox\requirements.txt
python servers\tts\chatterbox\server.py
```

Register with `/config custom-endpoint add`:

- capability: `speech`
- api_style: `tts-clone`
- endpoint_url: your wrapper URL, usually `http://127.0.0.1:8011`
- script_markup: `bracket-tags`
- supports_instruct: `false`

Then run `/config model speech`, `/speech voice-add`, and `/speech voice-assign`.

Use `/speech chatterbox parameters` to tune the Chatterbox request payload:

- `turbo` defaults to `true`. When enabled, TomoriBot keeps supported Chatterbox-Turbo event tags and strips unsupported bracket descriptors before the wrapper uses `ChatterboxTurboTTS.model.generate(...)`.
- `cfg_weight` defaults to `0.5`. Minimum is `0`; TomoriBot does not set a hard maximum. It only applies when `turbo` is `false`; lower values can help slow fast reference voices, while higher values follow the reference more strongly.
- `exaggeration` defaults to `0.5`. Minimum is `0`; TomoriBot does not set a hard maximum. It only applies when `turbo` is `false`; higher values make delivery more expressive or dramatic and may speed speech up.

Supported Turbo event tags are `[clear throat]`, `[sigh]`, `[shush]`, `[cough]`, `[groan]`, `[sniff]`, `[gasp]`, `[chuckle]`, and `[laugh]`. Unsupported descriptors such as `[stammers]`, `[blushes]`, or `[smiles]` are stripped instead of being sent to TTS.

When `turbo` is disabled, TomoriBot strips all bracket descriptors before sending text to TTS, then the wrapper lazily loads the standard `ChatterboxTTS` model and calls `model.generate(..., cfg_weight, exaggeration)`.
