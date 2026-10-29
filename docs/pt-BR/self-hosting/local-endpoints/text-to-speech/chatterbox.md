---
title: "Chatterbox TTS"
aiGenerated: true
---

Clone vozes em inglês com tags de emoção usando o servidor local de conversão de texto em fala [Chatterbox](https://github.com/resemble-ai/chatterbox).

O Chatterbox roda localmente via `servers/tts/chatterbox/server.py`. Ele usa por padrão o modelo rápido Chatterbox-Turbo (350M parâmetros) com tags de eventos de emoção no texto, como `[laugh]` e `[sigh]`. Você também pode configurar o modelo leve Chatterbox-Nano (110M parâmetros) para configurações baseadas em CPU ou o modelo padrão de 0,5B para orientação sem classificador (`cfg_weight`) e ajuste de `exaggeration` emocional. Este wrapper não carrega o Chatterbox Multilingual V3.

## Configuração

Execute estes comandos na raiz do repositório do TomoriBot, a pasta onde você clonou o TomoriBot:

### Windows PowerShell

```powershell
python -m venv servers\tts\chatterbox\.venv
servers\tts\chatterbox\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install numpy
pip install -r servers\tts\chatterbox\requirements.txt
python servers\tts\chatterbox\server.py
```

### Linux/macOS Bash

```bash
python3 -m venv servers/tts/chatterbox/.venv
source servers/tts/chatterbox/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install numpy
python -m pip install -r servers/tts/chatterbox/requirements.txt
python servers/tts/chatterbox/server.py
```

Mantenha esse terminal aberto enquanto o TomoriBot estiver usando o Chatterbox. A URL do endpoint padrão é `http://127.0.0.1:8011`; defina `CHATTERBOX_PORT` para usar outra porta.

### Opcional: usar Chatterbox-Nano

O Nano requer uma versão do Chatterbox com a opção de carregamento `nano=True`. Após a configuração normal acima, instale a revisão upstream fixada no mesmo ambiente virtual. O hash de commit define a versão de código compatível; ele não é uma garantia de segurança. Este comando requer `git` e mantém as dependências de execução já instaladas:

```sh
python -m pip install --no-deps --force-reinstall "git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
```

Em seguida, defina `CHATTERBOX_FAST_MODEL=nano` antes de iniciar o wrapper. Deixe a variável sem valor para o Turbo. No Windows PowerShell, defina-a com `$env:CHATTERBOX_FAST_MODEL = "nano"`; no Linux ou macOS, use `CHATTERBOX_FAST_MODEL=nano python servers/tts/chatterbox/server.py`. A resposta de `/health` informa o `fast_model` para que você possa verificar a opção carregada. Tanto o Nano quanto o Turbo usam a mesma solicitação de clonagem e tags de eventos suportadas. Ambos são exclusivos para o idioma inglês.

A opção de modelo rápido em `/config` deve permanecer ativada para usar o Nano ou o Turbo. Desativá-la seleciona o modelo padrão Chatterbox de 0,5B para ajuste de peso CFG e exagero.

### Chatterbox Padrão

Para usar o modelo Padrão, desative `Fast Model (Turbo)` em `/config` > Modelos > Parâmetros de TTS e Vozes. O modelo Padrão suporta o ajuste de `cfg_weight` e `exaggeration`, mas não tags de evento entre colchetes.

## Registrar no TomoriBot

Inclua `Chatterbox` no rótulo do endpoint ou no nome do modelo. O TomoriBot reconhece um endpoint do Chatterbox apenas por esse nome (ou por uma URL de endpoint que o contenha), de modo que a lista de tags permitidas do Turbo, a remoção de tags do modelo padrão e as opções do Chatterbox em `/generate voice-message` só se aplicam quando ele estiver presente.

Execute `/providers`, escolha `Adicionar Novo Endpoint Personalizado` e use a compatibilidade de API de fala:

- Compatibilidade de API: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8011`

Depois de salvar a conexão, selecione-a e escolha `+ Adicionar novo Modelo de Fala` no menu suspenso de modelos. Escolha `Voice Clone` como o `Modo de Origem de Voz` e `Bracket Tags` como o `Estilo de Marcação de Script` para que as tags de entonação sejam preservadas no envio.

Use `/providers` para registro do endpoint e configuração do modelo. Em seguida, abra `/config` > Modelos > Alternar Modelos para selecionar e ativar o endpoint registrado.

## Configurar a voz de uma persona

1. Prepare um clipe de voz limpo de 10 segundos com apenas um locutor e sem música de fundo.
2. Abra `/config` em Modelos > Parâmetros de TTS e Vozes e envie o clipe.
3. Abra `/config` em Persona > Voz, depois escolha a persona e a amostra de voz.

O Chatterbox requer mais de 5 segundos de áudio. Procure usar 10 segundos; o modelo usa apenas uma porção limitada de clipes mais longos para condicionamento.

## Ajustes opcionais

Em `/config` > Modelos > Parâmetros de TTS e Vozes, ajuste `cfg_weight` e `exaggeration` para o modelo Padrão. Ambos têm o padrão `0.5`; valores mais altos seguem a referência com mais fidelidade e aumentam a expressividade, respectivamente.

As tags de evento suportadas no Turbo/Nano são `[clear throat]`, `[sigh]`, `[shush]`, `[cough]`, `[groan]`, `[sniff]`, `[gasp]`, `[chuckle]` e `[laugh]`. Descritores não suportados, como `[excited]`, `[whisper]` ou `[smiles]`, são removidos antes do envio ao TTS.
