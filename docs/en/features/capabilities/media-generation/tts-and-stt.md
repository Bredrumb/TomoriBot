---
title: "Voice: TTS & STT"
sidebar:
  order: 3
---

TomoriBot can send voice replies with text-to-speech (TTS) and understand audio messages through
speech-to-text (STT). Choose speech providers in `/providers` or configure your own Google or
OpenRouter speech models in `/personal providers`.

## Text-to-speech
<!-- anchor: text-to-speech -->

Ask a persona to send a voice message or use `/generate voice-message`. Enable voice messages under
`/config` > `Permissions` and configure the persona's voice under `/config` > `Persona` > `Voice`.

There are two TTS types:

- **Voice design** creates a voice from a written description, such as "a warm, soft-spoken voice."
- **Voice clone** uses a reference recording to create a voice that resembles the sample.

Each type needs a compatible model. Save a description or assign a reference on the persona's Voice
page, where you can also choose which type to prefer. If the preferred option is unavailable,
TomoriBot can use the other saved option. Descriptions are included in exported persona cards; voice
reference assignments are not.

:::tip
Use `voice_design` or `voice_sample` on `/generate voice-message` to try a voice for one message
without changing the persona's saved voice.
:::

### Providers and models

Google supports voice design, while OpenRouter offers voice design and cloning models. Configure
models under `/config` > `Models` > `Switch Models`, or choose personal models under
`/personal config`. Personal model failures may use the server's model if server fallback is enabled.
An explicitly selected one-off model does not fall back to another model.

ElevenLabs offers cloud voices and transcription. Add its key through `/providers` and assign a
voice to each persona. Its free plan supports premade voices and has usage limits.

For local voice cloning and voice design, see the
[Text-to-Speech guides](/self-hosting/local-endpoints/text-to-speech/). Local cloning requires a
reference sample, which you can upload under `/config` > `Models` > `TTS Parameters & Voices`.

## Speech-to-text
<!-- anchor: speech-to-text -->

A transcription model turns audio attachments into text TomoriBot can use in conversation. Choose it
separately from TTS under `/config` > `Models` > `Switch Models`. Adding ElevenLabs also registers a
transcription endpoint. For local options, see the
[Speech-to-Text guides](/self-hosting/local-endpoints/speech-to-text/).

You can hide visible transcripts under `/config` > `Behavior` > `Notice Behavior` >
`Speech Transcripts`. The text still reaches the conversation context.
