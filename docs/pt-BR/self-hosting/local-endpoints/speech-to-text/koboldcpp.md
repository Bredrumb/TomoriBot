---
title: "Transcrição com KoboldCPP"
sidebar:
  order: 3
---

O KoboldCPP possui suporte a STT baseado no Whisper, mas o formato do endpoint pode variar de acordo com a build. O adaptador da Fase 4 do TomoriBot espera um `POST /v1/audio/transcriptions` compatível com a OpenAI.

## Configuração

Inicie o KoboldCPP com o Whisper/STT ativado e confirme se a sua build expõe:

- `POST /v1/audio/transcriptions`
- `GET /v1/models` ou `GET /models`

Mantenha o KoboldCPP rodando enquanto o TomoriBot estiver utilizando-o. Se a sua build expuser apenas `/api/extra/transcribe` ou outro formato personalizado, utilize um wrapper até que o TomoriBot tenha um adaptador dedicado.

## Registrar no TomoriBot

Execute `/providers`, escolha **Add New Custom Endpoint** e use a compatibilidade da API de transcrição:

- API Compatibility: `openai-compatible-transcription`
- `endpoint_url`: a raiz do servidor do seu KoboldCPP

Após salvar a conexão, selecione-a e use o menu suspenso de modelo para adicionar o nome do modelo que o seu servidor reporta como um modelo de transcrição.

Use `/providers` para registro de endpoint e configuração do modelo. Depois, abra `/config` > Models > Switch Models para selecionar e ativar o endpoint registrado.

## Usar Transcrições

Após o registro, o TomoriBot transcreve anexos de áudio em segundo plano e adiciona o texto ao contexto do chat. Use `/config` > Engine > Notices apenas se você também quiser que as transcrições sejam postadas visivelmente no chat.
