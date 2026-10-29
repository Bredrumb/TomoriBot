---
title: "Qwen3-TTS"
aiGenerated: true
---

Sintetize falas de personagens multilíngues com alta precisão usando o [Qwen3-TTS](https://github.com/QwenAudio/Qwen3-TTS) nos modos de clonagem de voz e VoiceDesign descrito em texto.

O Qwen3-TTS 12Hz 1.7B oferece síntese de fala local de alta fidelidade. Executar `servers/tts/qwen3tts/server.py` no seu modo automático padrão seleciona dinamicamente o modelo Base de clonagem de voz ou o modelo VoiceDesign com base em cada solicitação recebida.

## Configuração

Execute estes comandos na raiz do repositório do TomoriBot, a pasta onde você clonou o TomoriBot:

### Windows PowerShell

```powershell
python -m venv servers\tts\qwen3tts\.venv
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r servers\tts\qwen3tts\requirements.txt
python servers\tts\qwen3tts\server.py
```

### Linux e macOS Bash

```bash
python3 -m venv servers/tts/qwen3tts/.venv
source servers/tts/qwen3tts/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r servers/tts/qwen3tts/requirements.txt
python servers/tts/qwen3tts/server.py
```

A URL padrão do endpoint em modo automático é `http://127.0.0.1:8012`; defina `QWEN3TTS_PORT` para usar outra porta. Você também pode especificar o modo automático explicitamente:

```powershell
python servers\tts\qwen3tts\server.py --mode auto
```

O modo automático analisa cada solicitação para `/synthesize`: solicitações com `ref_audio` utilizam o modelo de clonagem, enquanto solicitações com `instruct` usam o modelo VoiceDesign. Ele mantém apenas um modelo carregado por vez e troca os modelos quando o tipo de solicitação muda, de modo que a primeira solicitação após uma troca pode ser mais lenta.

## Registrar no TomoriBot

Para a maioria dos usuários, registre o servidor em modo automático para que um único endpoint suporte personas tanto com clonagem de voz quanto com VoiceDesign.

Execute `/providers`, selecione `Adicionar Novo Endpoint Personalizado` e use a compatibilidade de API de fala:

- Compatibilidade de API: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8012`

Depois de salvar a conexão, selecione-a e use o menu suspenso de modelos para adicionar um modelo de Fala. O formulário solicita o `Modo de Origem de Voz` e a `Marcação de Script`; escolha `Auto` e `Plain` para o servidor em modo automático.

Use `/providers` para registrar o endpoint e configurar o modelo. Em seguida, abra `/config` > Modelos > Alternar Modelos para selecionar e ativar o endpoint registrado.

## Configurar vozes de persona

### Clonagem de voz

Use esta opção para personas que devem imitar um clipe de referência:

1. Prepare um clipe de voz limpo de 10 a 20 segundos com apenas um locutor e sem música de fundo.
2. Abra `/config` em Modelos > Parâmetros de TTS e Vozes e envie o clipe.
3. Abra `/config` em Persona > Voz, depois selecione a persona e a amostra de voz.

O Qwen3-TTS suporta clipes de referência a partir de 3 segundos de duração.

### VoiceDesign

Use esta opção para personas que devem usar uma descrição textual da voz em vez de uma amostra:

1. Abra `/config` em Persona > Voz e selecione VoiceDesign.
2. Selecione a persona.
3. Insira um prompt de voz em linguagem natural, descrevendo a idade, tom, sotaque e entonação da pessoa que fala.

## Opcional: servidor exclusivo de VoiceDesign

Inicie o mesmo servidor no modo VoiceDesign ao disponibilizar `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`.

Windows PowerShell:

```powershell
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
$env:TOMORI_TTS_MODE = "voice-design"
python servers\tts\qwen3tts\server.py
```

Bash:

```bash
source servers/tts/qwen3tts/.venv/bin/activate
TOMORI_TTS_MODE=voice-design python servers/tts/qwen3tts/server.py
```

Você também pode passar `--mode voice-design` em vez de definir `TOMORI_TTS_MODE`. A URL padrão do endpoint exclusivo de VoiceDesign é `http://127.0.0.1:8014`.

Registre-o da mesma forma que no modo automático, mas use a URL de endpoint `http://127.0.0.1:8014` e selecione `VoiceDesign` como o Modo de Origem de Voz no modelo de Fala.
