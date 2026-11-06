---
title: "Transcripción de WhisperX"
sidebar:
  order: 1
aiGenerated: true
---

Configura conversión de voz a texto local y precisa para TomoriBot utilizando el servidor [WhisperX](https://github.com/m-bain/whisperX) incluido. WhisperX proporciona una transcripción de audio rápida con alineación a nivel de palabra.

## Configuración

Ejecuta estos comandos desde la raíz del repositorio TomoriBot:

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

Mantén esa terminal abierta mientras TomoriBot esté usando WhisperX. La URL del punto de conexión predeterminado es `http://127.0.0.1:8021`. En Windows, usa `127.0.0.1` en lugar de `localhost`.

## Elegir un modelo

Establece `WHISPERX_MODEL` antes de iniciar el servidor.

| `WHISPERX_MODEL` | Tamaño | Uso |
|---|---|---|
| `large-v3` | 1.55B | Mejor precisión multilingüe; alrededor de 0.6 GiB más de VRAM que turbo |
| `large-v3-turbo` | 809M | Multilingüe, decodificador más rápido; japonés ligeramente inferior |
| `kotoba-tech/kotoba-whisper-v2.0-faster` | 756M | Solo japonés; más preciso que turbo en clips de prueba en japonés, a la misma velocidad |

En clips cortos el codificador domina, por lo que los tres funcionan a una velocidad similar. Elige según el idioma y la VRAM. `small` y `base` pierden demasiada precisión en japonés como para recomendarlos. Los modelos de Whisper aún pueden inventar texto en clips muy cortos o casi silenciosos.

## GPU

El servidor usa una GPU NVIDIA automáticamente cuando hay una disponible. Consulta `http://127.0.0.1:8021/health`: `device` debería mostrar `cuda`. En Windows, el reconocimiento de voz necesita las DLL de CUDA 12 cuBLAS y cuDNN en tu `PATH`. Sin ellas, el servidor muestra `GPU found but unusable` al iniciar y se ejecuta en la CPU, lo cual es mucho más lento: instálalas y reinicia el servidor. Si estableces `WHISPERX_DEVICE=cuda`, el servidor se detiene al iniciar en su lugar.

## Registro en TomoriBot

Ejecuta `/providers`, elige `Agregar nuevo punto de conexión personalizado` y usa la compatibilidad de API de transcripción:

- Compatibilidad de API: `openai-compatible-transcription`
- `endpoint_url`: `http://127.0.0.1:8021`

Después de guardar la conexión, selecciónala y usa su menú desplegable de modelos para agregar el valor exacto de `WHISPERX_MODEL` (`large-v3` por defecto, o el ID de repositorio completo como `kotoba-tech/kotoba-whisper-v2.0-faster`) como un modelo de Transcripción.

Usa `/providers` para el registro del endpoint y la configuración del modelo. Luego abre `/config` > Modelos > Cambiar modelos para seleccionar y activar el endpoint registrado.

## Usar transcripciones

Después del registro, TomoriBot transcribe los archivos adjuntos de audio en segundo plano y agrega el texto al contexto del chat. Usa `/config` > Comportamiento > Comportamiento de avisos solo si también quieres que las transcripciones se publiquen de manera visible en el chat.
