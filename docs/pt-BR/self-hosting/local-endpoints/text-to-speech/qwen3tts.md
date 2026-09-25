---
title: "Qwen3-TTS"
aiGenerated: true
---

Use `servers/tts/qwen3tts/server.py` para ambos os modos do Qwen3-TTS 12Hz 1.7B, a opção de TTS maior porém a mais precisa entre as atuais do TomoriBot. Por padrão, ele inicia no modo automático, que escolhe o modelo Base de clone de voz ou o modelo VoiceDesign a partir do formato de cada requisição.

## Configuração

Execute estes comandos a partir da raiz do repositório do TomoriBot, a pasta onde você clonou o TomoriBot:

### Usando o Windows PowerShell

```powershell
python -m venv servers\tts\qwen3tts\.venv
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r servers\tts\qwen3tts\requirements.txt
python servers\tts\qwen3tts\server.py
```

### Usando Bash no Linux/macOS

```bash
python3 -m venv servers/tts/qwen3tts/.venv
source servers/tts/qwen3tts/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r servers/tts/qwen3tts/requirements.txt
python servers/tts/qwen3tts/server.py
```

A URL padrão do endpoint no modo automático é `http://127.0.0.1:8012`; defina `QWEN3TTS_PORT` para usar outra porta. Você também pode especificar o modo automático explicitamente:

```powershell
python servers\tts\qwen3tts\server.py --mode auto
```

O modo automático inspeciona cada requisição `/synthesize`: requisições com `ref_audio` usam o modelo de clone, enquanto requisições com `instruct` usam o modelo VoiceDesign. Ele mantém apenas um modelo carregado por vez e troca os modelos quando o tipo de requisição muda, de modo que a primeira requisição após uma troca pode ser mais lenta.

## Registrar no TomoriBot

Para a maioria dos usuários, registre o servidor no modo automático para que um único endpoint possa suportar as personas tanto para clone de voz quanto para VoiceDesign.

Execute `/providers`, escolha `Adicionar Novo Endpoint Personalizado` e use a compatibilidade da API de fala:

- API Compatibility: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8012`

Após salvar a conexão, selecione-a e use o menu suspenso de modelo para adicionar um modelo de fala (Speech). O formulário do modelo pede por **Voice Source Mode** e **Script Markup**; escolha `Auto` e `Plain` para o servidor em modo automático.

Use `/providers` para registro do endpoint e configuração do modelo. Em seguida, abra `/config` > Models > Switch Models para selecionar e ativar o endpoint registrado.

## Configurar Vozes das Personas

### Clonagem de voz

Use isso para personas que devem imitar um clipe de referência:

1. Prepare um clipe de voz limpo de 10 a 20 segundos com um locutor e sem música de fundo.
2. Abra `/config` em Models > TTS Parameters & Voices e envie o clipe.
3. Abra `/config` em Persona > Voice e, em seguida, escolha a persona e a amostra de voz.

O Qwen3-TTS anuncia clonagem rápida a partir de apenas 3 segundos de áudio de referência, e seu tempo de execução não documenta nem aplica um limite de duração da referência. O comprimento do clipe é, portanto, uma decisão de qualidade que você controla, e não um limite que o servidor verifica.

### VoiceDesign

Use isso para personas que devem usar uma descrição de voz escrita em vez de uma amostra:

1. Abra `/config` em Persona > Voice e escolha VoiceDesign.
2. Escolha a persona.
3. Insira um prompt de voz em linguagem natural, como a idade do locutor, tom, sotaque e estilo de entrega.

Remova o prompt do VoiceDesign de uma persona em Persona > Voice em `/config`. Durante a geração, o TomoriBot envia o prompt salvo no corpo JSON de `/synthesize` como `instruct`; comandos pontuais de `voice_instructions` a partir da ferramenta são anexados.

O modo automático mantém ambas as configurações. Personas configuradas em Persona > Voice em `/config` usam a síntese de clone ou a síntese do VoiceDesign de acordo com sua seleção.

## (Opcional) Servidor Apenas para VoiceDesign

Inicie o mesmo servidor no modo VoiceDesign ao servir `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`.

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

Você também pode passar `--mode voice-design` em vez de definir `TOMORI_TTS_MODE`. A URL padrão do endpoint apenas para VoiceDesign é `http://127.0.0.1:8014`.

Registre-o da mesma forma que o modo automático, mas use a URL do endpoint `http://127.0.0.1:8014` e escolha `VoiceDesign` como o Voice Source Mode no modelo de fala (Speech).
