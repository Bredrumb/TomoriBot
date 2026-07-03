---
title: "whisper.cpp Transcription"
sidebar:
  order: 2
---

whisper.cpp can be used when its HTTP server exposes an OpenAI-compatible `POST /v1/audio/transcriptions` endpoint.

## Setup

Start your whisper.cpp HTTP server and confirm it exposes an OpenAI-compatible transcription endpoint:

- `POST /v1/audio/transcriptions`
- `GET /v1/models` or `GET /models`

Keep the server running while TomoriBot is using it. The endpoint URL is the server root, such as `http://127.0.0.1:8022`.

If your whisper.cpp build exposes a different endpoint shape, place a thin wrapper in front of it that maps requests to TomoriBot's expected OpenAI-compatible shape.

## Register in TomoriBot

Run `/provider custom-endpoint add`:

- `capability`: `transcription`
- `api_style`: `openai-compatible-transcription`
- `endpoint_url`: your whisper.cpp server root

In the modal:

- `Transcription Model`: the model name your server reports
- `Transcription Language`: optional language hint, such as `en` or `ja`

Registration makes the endpoint active immediately. Use `/model transcription` later only when switching endpoints.

## Use Transcripts

After registration, TomoriBot transcribes audio attachments in the background and adds the text to chat context. Use `/speech transcripts` only if you also want transcripts posted visibly in chat.
