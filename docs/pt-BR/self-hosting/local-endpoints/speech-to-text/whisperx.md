---
title: "Transcrição WhisperX"
sidebar:
  order: 1
---

O WhisperX é o caminho de transcrição local recomendado para iniciantes.

## Configuração

Execute estes comandos a partir da raiz do repositório do TomoriBot, a pasta onde você clonou o TomoriBot. O primeiro comando entra na pasta do servidor STT:

### Windows PowerShell

```powershell
cd servers/stt
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python whisperx_server.py
```

### Linux/macOS Bash

```bash
cd servers/stt
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python whisperx_server.py
```

Mantenha esse terminal aberto enquanto a TomoriBot estiver usando o WhisperX. O URL padrão do endpoint é `http://127.0.0.1:8021`.

## Registrar na TomoriBot

Execute `/providers`, escolha `Adicionar Novo Endpoint Personalizado`, e use a compatibilidade da API de transcrição:

- API Compatibility: `openai-compatible-transcription`
- `endpoint_url`: `http://127.0.0.1:8021`

Depois de salvar a conexão, selecione-a e use o menu suspenso do modelo para adicionar `large-v3`, ou qualquer que seja o valor definido em `WHISPERX_MODEL`, como um modelo de Transcrição.

Use `/providers` para o registro do endpoint e configuração do modelo. Em seguida, abra `/config` > Models > Switch Models para selecionar e ativar o endpoint registrado.

## Usar Transcrições

Após o registro, a TomoriBot transcreve anexos de áudio em segundo plano e adiciona o texto ao contexto do chat. Use `/config` > Engine > Notices apenas se você também quiser que as transcrições sejam postadas de forma visível no chat.
