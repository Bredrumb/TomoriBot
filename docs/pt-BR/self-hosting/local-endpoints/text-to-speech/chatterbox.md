---
title: "Chatterbox TTS"
aiGenerated: true
---

> **Aviso:** Esta tradução é fornecida por conveniência e a versão em inglês é a oficial.

Use `servers/tts/chatterbox/server.py` para clonagem de voz em inglês com suporte a tags de eventos. O caminho fast-model é definido por padrão como Chatterbox-Turbo (350M de parâmetros). O Chatterbox-Nano (110M de parâmetros) pode ser selecionado para implantações menores focadas em CPU. Este wrapper não carrega o Chatterbox Multilingual V3.

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

Mantenha esse terminal aberto enquanto o TomoriBot estiver usando o Chatterbox. O URL do endpoint padrão é `http://127.0.0.1:8011`.

### Opcional: usar Chatterbox-Nano

O Nano requer uma compilação do Chatterbox com a opção de loader `nano=True`. Após a configuração normal acima, instale a revisão upstream fixada no mesmo ambiente virtual. O hash do commit fixa a versão fonte compatível; não é uma garantia de segurança. Este comando requer o `git` e mantém as dependências de tempo de execução já instaladas:

```sh
python -m pip install --no-deps --force-reinstall "git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
```

Em seguida, defina `CHATTERBOX_FAST_MODEL=nano` antes de iniciar o wrapper. Deixe a variável indefinida para o Turbo. No Windows PowerShell, defina-a com `$env:CHATTERBOX_FAST_MODEL = "nano"`; no Linux ou macOS, use `CHATTERBOX_FAST_MODEL=nano python servers/tts/chatterbox/server.py`. A resposta de `/health` reporta `fast_model` para que você possa verificar a escolha carregada. Nano e Turbo usam a mesma solicitação de clonagem e tags de eventos suportadas. Ambos funcionam apenas em inglês.

A alternância de fast-model em `/config` deve permanecer habilitada para usar o Nano ou o Turbo. Desativá-la seleciona o modelo Standard de 0.5B do Chatterbox para ajuste de peso CFG e exagero.

### Chatterbox Standard (0.5B com CFG e Exaggeration)

O modelo base original de 0.5B do Chatterbox (`ChatterboxTTS`) já vem integrado ao wrapper do servidor. Ele troca as tags de evento entre colchetes inline do Turbo por um controle vocal refinado usando **Classifier-Free Guidance (`cfg_weight`)** e **`exaggeration`** emocional.

Para usar o modelo Standard:
1. Inicie o wrapper do servidor normalmente.
2. No Discord, execute `/config` > **Models** > **TTS Parameters & Voices**.
3. **Desative** a opção **Fast Model (Turbo)**.
4. Na próxima geração, o wrapper baixa e carrega sob demanda o modelo Standard de 0.5B na memória.

Quando a alternância de fast-model está desativada, o TomoriBot exibe dois controles deslizantes em `/config`:
- **`cfg_weight`** (padrão `0.5`): ajusta o quanto o áudio sintetizado segue o ritmo e o estilo vocal da referência.
- **`exaggeration`** (padrão `0.5`): controla a intensidade emocional e a inflexão dramática da entrega.

> [!NOTE]
> O Chatterbox Standard não suporta tags de evento entre colchetes inline (como `[laughs]` ou `[sigh]`). O TomoriBot remove automaticamente as tags entre colchetes do texto do prompt quando a alternância Fast Model está desativada.

## Registrar no TomoriBot

Execute `/providers`, escolha **Add New Custom Endpoint** e use a compatibilidade da API de fala:

- API Compatibility: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8011`

Após salvar a conexão, selecione-a e use a lista suspensa do modelo para adicionar um modelo de Fala. Escolha `Voice Clone`
como o Voice Source Mode e `Bracket Tags` como o Script Markup para que as tags de entrega sobrevivam ao envio.

Use `/providers` para registro do endpoint e configuração do modelo. Em seguida, abra `/config` > Models > Switch Models para selecionar e ativar o endpoint registrado.

## Configurar uma Voz de Persona

1. Prepare um clipe de voz limpo de 10-20 segundos com um falante e sem música de fundo.
2. Abra `/config` em Models > TTS Parameters & Voices e envie o clipe.
3. Abra `/config` em Persona > Voice, e então escolha a persona e a amostra de voz.

O Turbo e o Nano podem usar tags de eventos entre colchetes como `[laugh]` e `[sigh]` quando a alternância de fast-model está ativada.

## Ajuste Opcional

Use `/config` em Models > TTS Parameters & Voices para ajustar a carga da solicitação do Chatterbox:

- A alternância de fast-model é ativada por padrão. O TomoriBot mantém as tags de eventos do Turbo/Nano suportadas e remove os descritores entre colchetes não suportados antes que o wrapper chame `ChatterboxTurboTTS.generate(...)`.
- `cfg_weight` o padrão é `0.5`. O mínimo é `0`; o TomoriBot não define um máximo absoluto. Isso se aplica apenas quando `turbo` é `false`; valores mais baixos podem ajudar a desacelerar vozes de referência rápidas, enquanto valores mais altos seguem a referência com mais força.
- `exaggeration` o padrão é `0.5`. O mínimo é `0`; o TomoriBot não define um máximo absoluto. Isso se aplica apenas quando `turbo` é `false`; valores mais altos tornam a entrega mais expressiva ou dramática e podem acelerar a fala.

As tags de eventos suportadas do Turbo/Nano são `[clear throat]`, `[sigh]`, `[shush]`, `[cough]`, `[groan]`, `[sniff]`, `[gasp]`, `[chuckle]` e `[laugh]`. Descritores não suportados como `[excited]`, `[whisper]` ou `[smiles]` são removidos em vez de serem enviados ao TTS.

Quando `turbo` está desativado, o TomoriBot remove todos os descritores entre colchetes antes de enviar o texto ao TTS, em seguida o wrapper carrega o modelo `ChatterboxTTS` padrão sob demanda e chama `model.generate(..., cfg_weight, exaggeration)`.
