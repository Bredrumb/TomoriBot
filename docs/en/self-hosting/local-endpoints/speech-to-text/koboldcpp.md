---
title: "KoboldCPP Transcription"
sidebar:
  order: 3
---

KoboldCPP has Whisper-based STT support, but endpoint shape can vary by build. TomoriBot's Phase 4 adapter expects OpenAI-compatible `POST /v1/audio/transcriptions`.

## Setup

Start KoboldCPP with Whisper/STT enabled and confirm your build exposes:

- `POST /v1/audio/transcriptions`
- `GET /v1/models` or `GET /models`

Keep KoboldCPP running while TomoriBot is using it. If your build only exposes `/api/extra/transcribe` or another custom shape, use a wrapper until TomoriBot has a dedicated adapter.

## Register in TomoriBot

Run `/provider custom-endpoint add`:

- `capability`: `transcription`
- `api_style`: `openai-compatible-transcription`
- `endpoint_url`: your KoboldCPP server root

In the modal:

- `Transcription Model`: the model name your server reports
- `Transcription Language`: optional language hint, such as `en` or `ja`

Registration makes the endpoint active immediately. Use `/model transcription` later only when switching endpoints.

## Use Transcripts

After registration, TomoriBot transcribes audio attachments in the background and adds the text to chat context. Use `/speech transcripts` only if you also want transcripts posted visibly in chat.
