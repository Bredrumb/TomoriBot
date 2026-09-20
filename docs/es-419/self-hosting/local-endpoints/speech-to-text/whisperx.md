---
title: "Transcripción de WhisperX"
sidebar:
  order: 1
---

WhisperX es la ruta de transcripción local recomendada y apta para principiantes.

## Configuración

Ejecuta estos comandos desde la raíz del repositorio de TomoriBot, la carpeta donde clonaste TomoriBot. El primer comando entra a la carpeta del servidor de voz a texto:

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

Mantén esa terminal abierta mientras TomoriBot esté usando WhisperX. La URL del punto de conexión predeterminado es `http://127.0.0.1:8021`.

## Registro en TomoriBot

Ejecuta `/providers`, elige **Agregar nuevo punto de conexión personalizado** y usa la compatibilidad de API de transcripción:

- Compatibilidad de API: `openai-compatible-transcription`
- `endpoint_url`: `http://127.0.0.1:8021`

Después de guardar la conexión, selecciónala y usa su menú desplegable de modelos para agregar `large-v3`, o a lo que sea que esté configurado `WHISPERX_MODEL`, como un modelo de Transcripción.

Usa `/providers` para el registro del endpoint y la configuración del modelo. Luego abre `/config` > Modelos > Cambiar modelos para seleccionar y activar el endpoint registrado.

## Uso de transcripciones

Después del registro, TomoriBot transcribe los archivos adjuntos de audio en segundo plano y agrega el texto al contexto del chat. Usa `/config` > Motor > Avisos solo si también quieres que las transcripciones se publiquen visiblemente en el chat.
