---
title: "MOSS-TTS"
aiGenerated: true
---

Avalie a clonagem de voz e o design de voz em linguagem natural localmente por meio de um endpoint de fala unificado usando o [MOSS-TTS](https://github.com/OpenMOSS/MOSS-TTS).

O modelo padrão de clonagem de 4B e o VoiceGenerator de 1,7B alternam na memória da GPU quando o modo de voz muda, de modo que a primeira solicitação após uma troca leva mais tempo. O modelo de clonagem de 8B requer mais VRAM.

## Configuração

Execute os comandos a partir da raiz do repositório do TomoriBot usando Python 3.12 e um driver compatível com CUDA 12.8:

### Windows PowerShell

```powershell
python -m venv servers\tts\moss\.venv
servers\tts\moss\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers\tts\moss\requirements.txt
python servers\tts\moss\prefetch_models.py
python servers\tts\moss\server.py
```

### Linux ou WSL Bash

```bash
python3.12 -m venv servers/tts/moss/.venv
source servers/tts/moss/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers/tts/moss/requirements.txt
python servers/tts/moss/prefetch_models.py
python servers/tts/moss/server.py
```

O comando de pré-download baixa o modelo de clonagem, o VoiceGenerator e os tokenizadores de áudio para o cache do Hugging Face antes de iniciar o servidor. Se o espaço em disco for limitado, configure `HF_HOME` para uma partição com mais capacidade. Para baixar apenas um modelo, passe `--mode clone` ou `--mode voice-design`.

O endpoint padrão é `http://127.0.0.1:8018`. Execute `bun run launch --moss` para iniciar o servidor juntamente com o TomoriBot. O modo Auto pré-aquece o modelo de clonagem a partir do cache local. Defina `MOSS_TTS_WARM_MODE=voice-design` para pré-aquecer o VoiceGenerator em vez disso, ou `MOSS_TTS_WARM_MODE=none` para inicialização sob demanda (lazy). Verifique em `GET /health` os valores de `warm_mode`, `active_mode` e `model_id` ativos. O wrapper utiliza `trust_remote_code=True` do Hugging Face, portanto revise o código upstream antes de realizar atualizações.

## Registrar no TomoriBot

Em `/providers`, selecione `Adicionar Novo Endpoint Personalizado`, defina a Compatibilidade de API como `tts-clone` e utilize a URL de endpoint `http://127.0.0.1:8018`. Adicione um modelo de Fala com `Modo de Origem de Voz` configurado como `Auto` e `Marcação de Script` configurada como `Plain`. Ative-o em `/config` > Modelos > Alternar Modelos.

Para clonagem de voz, envie um clipe de referência limpo em `/config` > Modelos > Parâmetros de TTS e Vozes e atribua-o em Persona > Voz. Clipes de áudio mais curtos e limpos proporcionam resultados mais consistentes. Para design de voz, salve uma descrição em linguagem natural em Persona > Voz. Observe que o MOSS-VoiceGenerator foi projetado para inglês e chinês. Embora o modelo de clonagem de 4B suporte japonês, tags explícitas de idioma aumentam a clareza da síntese.

O adaptador de clonagem do TomoriBot não envia tags de idioma automaticamente. Para uso com um único idioma, defina `MOSS_TTS_DEFAULT_LANGUAGE=Japanese` (ou `English`, `Chinese`, etc.) antes de iniciar o servidor. Chamadas manuais para `/synthesize` podem passar `language` diretamente.

O servidor lê seu próprio ambiente de shell; configurações no `.env` do bot não se aplicam a um terminal Python iniciado de forma independente.

Para executar o modelo de 8B em hardware com grande quantidade de memória, defina `MOSS_TTS_CLONE_MODEL_ID=OpenMOSS-Team/MOSS-TTS-v1.5` antes de realizar o pré-download. `MOSS_TTS_PORT`, `MOSS_TTS_DEVICE`, `MOSS_TTS_DTYPE` e `MOSS_TTS_MAX_NEW_TOKENS` são configuráveis no arquivo `.env.optional.example`. Aumente o valor de `TTS_SYNTHESIZE_TIMEOUT_MS` no TomoriBot se a alternância de modelos ou a execução em CPU causar estouro do tempo limite.
