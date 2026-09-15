---
title: "Fish Audio S2 Pro"
aiGenerated: true
---

> [!NOTE]
> Esta tradução é fornecida apenas para sua conveniência. O texto original em inglês é o documento oficial e prevalece em caso de divergência.

O Fish Audio S2 Pro é um modelo de TTS 4B multilíngue focado em clonagem de voz de alta fidelidade e entrega expressiva. O TomoriBot o utiliza através do wrapper local em `servers/tts/fishs2/`.

A configuração padrão do TomoriBot usa `Imagilux/fishaudio-s2-pro`, uma quantização apenas de pesos em INT8 do S2 Pro voltada para GPUs de consumo com VRAM limitada. O transformer é reduzido de aproximadamente 10,3 GB para cerca de 5,1 GB, enquanto embeddings, layer norms e o codec VQ-GAN permanecem em BF16. O cartão do modelo relata um total de cerca de 10,9 GB de VRAM em um sistema de teste com uma Radeon de 16 GB e afirma que o checkpoint também funciona em NVIDIA CUDA.

O Fish S2 Pro suporta tags de expressão entre colchetes, como `[whisper]`, `[excited]` e `[angry]`. Configure o endpoint com a marcação **Tags de Colchetes** (Bracket Tags) para que o TomoriBot preserve esses controles nos scripts de voz gerados.

## Licença

O código do Fish Speech e os pesos do modelo S2 Pro são distribuídos sob a Fish Audio Research License. O checkpoint quantizado padrão também está sob essa licença. Pesquisa e uso não comercial são permitidos de acordo com seus termos; o uso comercial exige uma licença separada da Fish Audio.

O TomoriBot não redistribui os pesos do modelo. Cada usuário de hospedagem própria baixa o Fish S2 Pro diretamente do Hugging Face e é responsável por cumprir a Fish Audio Research License. A atribuição exigida é: **Built with Fish Audio**.

## Hardware

A configuração oficial BF16 S2 Pro recomenda pelo menos 24 GB de VRAM. Portanto, o TomoriBot usa o checkpoint INT8 por padrão.

Ponto de partida recomendado:

- GPU NVIDIA ou AMD com **16 GB de VRAM ou mais**
- Python 3.12 recomendado
- `git`, `ffmpeg` e as dependências normais de áudio do sistema exigidas pelo Fish Speech
- Linux ou WSL é o ambiente documentado oficialmente para o Fish Speech. O Windows nativo é fornecido como "melhor esforço" (best-effort).

O checkpoint INT8 é mantido principalmente para o fork `Imagilux` do Fish Speech, que também adiciona gerenciamento de VRAM e correções para GPUs de consumo. É por isso que o instalador do TomoriBot usa esse tempo de execução (runtime) em vez do repositório upstream do Fish Speech por padrão.

## Configuração

### Linux / WSL

Na raiz do repositório do TomoriBot:

```bash
bash servers/tts/fishs2/install-fishs2.sh
servers/tts/fishs2/.venv/bin/python servers/tts/fishs2/server.py
```

O instalador usa um commit revisado do tempo de execução e uma revisão do modelo por padrão. Ele não atualiza um checkout de uma branch em movimento durante uma reinstalação normal. O instalador:

1. clona `Imagilux/fish-speech` em `servers/tts/fishs2/fish-speech/` e faz o checkout do commit do tempo de execução fixado;
2. cria o `.venv` isolado;
3. instala o Fish Speech e as dependências do wrapper do TomoriBot; e
4. baixa a revisão fixada do `Imagilux/fishaudio-s2-pro` em `fish-speech/checkpoints/fish-speech-s2-pro-int8/`.

Os padrões revisados são o commit do tempo de execução `2225e924e7d35cc0a1d24dbc67cd1819e6cf429f` e a revisão do modelo `9706ff036580881d87cc09465dd10014527bc481`.

Para atualizar deliberadamente ou testar outra revisão upstream, defina `FISH_S2_RUNTIME_REF` e `FISH_S2_MODEL_REVISION` antes de executar o instalador. Para uma atualização de conveniência para a `main` do upstream, defina `FISH_S2_UPDATE=1`; isso é uma opção explícita (opt-in) e usa `FISH_S2_UPDATE_REF` e `FISH_S2_UPDATE_MODEL_REVISION` quando fornecidos. Registre qualquer revisão usada para uma implantação para que ela possa ser reproduzida posteriormente. Uma ref de atualização explícita tem prioridade sobre uma ref base. Quando nenhuma ref de atualização é fornecida, uma ref base configurada explicitamente permanece selecionada; caso contrário, a opção de atualização seleciona `main`.

`FISH_S2_RUNTIME_REPOSITORY` pode apontar para um espelho revisado quando necessário. `FISH_S2_MODEL_ID` e `FISH_S2_MODEL_REVISION` selecionam o repositório do Hugging Face e a revisão imutável usada pelo instalador.

O modelo no Hugging Face é restrito (gated). Aceite a licença no Hugging Face primeiro. Se o download pedir autenticação, execute:

```bash
servers/tts/fishs2/.venv/bin/hf auth login
```

Em seguida, execute o instalador novamente.

### Windows PowerShell

A Fish Audio documenta oficialmente Linux/WSL para inferência S2 local, então o WSL é preferível. Um instalador nativo para Windows "melhor esforço" (best-effort) está incluído:

```powershell
.\servers\tts\fishs2\install-fishs2.ps1
.\servers\tts\fishs2\.venv\Scripts\python.exe servers\tts\fishs2\server.py
```

O instalador do PowerShell visa a aceleração de GPU CUDA (`cu124`) por padrão. Para instalar em uma máquina apenas com CPU, sem uma GPU NVIDIA, passe `-Cpu`:

```powershell
.\servers\tts\fishs2\install-fishs2.ps1 -Cpu
```

Se o PyTorch no Windows precisar ser instalado ou atualizado manualmente com suporte a CUDA, execute:

```powershell
.\servers\tts\fishs2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

Se uma dependência upstream do Fish Speech falhar ao ser compilada no Windows nativo, use o WSL.

> [!WARNING]
> **Limitação de desempenho no Windows nativo:** A Fish Audio tem como alvo oficial o Linux e o WSL2. No Windows nativo, o PyTorch não pode usar o Triton para `torch.compile`, forçando o modelo quantizado INT8 a rodar no modo eager não compilado, onde os pesos são convertidos (cast) dinamicamente a cada token. Isso torna a geração significativamente mais lenta (~5s por token) no Windows nativo. Para uma síntese de voz prática e rápida em máquinas Windows, **é altamente recomendado executar o instalador dentro do WSL2**.

O wrapper do TomoriBot escuta em `http://127.0.0.1:8015` por padrão. Internamente, ele inicia o próprio servidor de API do Fish Speech na porta `8025` e traduz a requisição `/synthesize` do TomoriBot para a API MessagePack do Fish. Isso mantém a implementação de inferência do Fish upstream, enquanto preserva o contrato de endpoint comum de TTS do TomoriBot.

O wrapper se vincula (bind) ao loopback por padrão. Se `TOMORI_TTS_HOST` for alterado para um endereço que não seja loopback, defina `FISH_S2_API_KEY` e use o mesmo valor que a chave de API do endpoint personalizado no TomoriBot. O wrapper então exigirá `Authorization: Bearer <key>` para `/health` e `/synthesize`. Um vínculo remoto não autenticado está disponível apenas com a opção explícita `FISH_S2_ALLOW_INSECURE_REMOTE=1` e não é recomendado.

## Registrar no TomoriBot

Em `/providers`, escolha **Add New Custom Endpoint** (Adicionar Novo Endpoint Personalizado) e configure:

- Capability (Capacidade): `Speech`
- API Compatibility (Compatibilidade de API): `tts-clone`
- Endpoint URL (URL do Endpoint): `http://127.0.0.1:8015`
- Voice Source Mode (Modo da Fonte de Voz): `Clone`
- Script Markup (Marcação do Script): `Bracket Tags`
- API key (Chave de API): deixe em branco para a configuração de loopback padrão. Se a autenticação de portador (bearer auth) estiver ativada, insira o valor exato de `FISH_S2_API_KEY`.

Em seguida, adicione a entrada do modelo (model) do endpoint e ative-o através de `/config` em Models > Switch Models.

## Adicionar vozes de persona

1. Prepare um clipe de referência limpo com apenas um orador e pouco ou nenhum ruído de fundo.
2. Em `/config`, abra Models > TTS Parameters & Voices e faça o upload da amostra de voz.
3. Forneça a transcrição do clipe de referência, quando possível.
4. Em `/config`, abra Persona > Voice e atribua a amostra à persona.
5. Gere uma mensagem de voz com `/generate voice-message` ou deixe o TomoriBot gerar uma através da sua ferramenta de mensagem de voz.

A transcrição de referência é importante para a qualidade de clonagem do Fish. O TomoriBot já a armazena com cada amostra de voz, e o sidecar do Fish encaminha o WAV de referência e o `ref_text` para o S2 Pro.

## Controles de expressão

O Fish S2 Pro pode variar a entrega dentro de uma mesma fala usando tags entre colchetes. Por exemplo:

```text
[whisper] Keep your voice down. [excited] Wait, you actually found it?
```

Como o endpoint usa a marcação `Bracket Tags`, o TomoriBot preserva essas tags em vez de removê-las antes da síntese.

## Configuração

| Variável | Padrão | Propósito |
|---|---|---|
| `FISH_SPEECH_DIR` | `servers/tts/fishs2/fish-speech` | Diretório do tempo de execução do Fish Speech |
| `FISH_S2_MODEL_DIR` | `fish-speech/checkpoints/fish-speech-s2-pro-int8` | Diretório do checkpoint do S2 Pro |
| `FISH_S2_MODEL_ID` | `Imagilux/fishaudio-s2-pro` | Repositório do modelo e rótulo de metadados de integridade (health) para o checkpoint configurado |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Endereço de bind do wrapper do TomoriBot |
| `FISH_S2_PORT` | `8015` | Porta do wrapper do Fish; recorre (fallback) a `TOMORI_TTS_PORT` quando não definida |
| `TOMORI_TTS_PORT` | não definido | Substituição de porta compartilhada com retrocompatibilidade |
| `FISH_S2_API_KEY` | não definido | Token bearer opcional, também exigido para binds remotos autenticados |
| `TOMORI_TTS_API_KEY` | não definido | Fallback de token bearer compartilhado quando `FISH_S2_API_KEY` não está definido |
| `FISH_S2_ALLOW_INSECURE_REMOTE` | `0` | Permitir explicitamente um bind não-loopback sem um token bearer |
| `FISH_S2_MAX_REF_AUDIO_BYTES` | `10485760` | Tamanho máximo do WAV de referência decodificado |
| `TOMORI_TTS_MAX_REF_AUDIO_BYTES` | não definido | Fallback do limite compartilhado de áudio de referência decodificado |
| `FISH_S2_UPSTREAM_HOST` | `127.0.0.1` | Endereço de bind interno da API do Fish |
| `FISH_S2_UPSTREAM_PORT` | `8025` | Porta interna da API do Fish |
| `FISH_S2_COMPILE` | `0` | Habilitar `torch.compile` do Fish Speech; o upstream observa que a compilação não é suportada no Windows/macOS nativos sem configuração adicional |
| `FISH_S2_HALF` | `0` | Solicitar modo de tempo de execução FP16; deixe desabilitado para o checkpoint INT8 padrão a menos que você tenha testado |
| `FISH_S2_CHUNK_LENGTH` | `200` | Comprimento do chunk do prompt iterativo do Fish |
| `FISH_S2_TOP_P` | `0.8` | Amostragem top-p |
| `FISH_S2_TEMPERATURE` | `0.8` | Temperatura de amostragem |
| `FISH_S2_REPETITION_PENALTY` | `1.1` | Penalidade de repetição |
| `FISH_S2_MAX_NEW_TOKENS` | `1024` | Máximo de tokens semânticos gerados por requisição |
| `FISH_S2_USE_MEMORY_CACHE` | `on` | Fazer cache de vozes de referência codificadas no tempo de execução do Fish |
| `TOMORI_TTS_MAX_TEXT_CHARS` | `2000` | Comprimento máximo do script aceito pelo wrapper |
| `FISH_S2_STARTUP_TIMEOUT_SECONDS` | `180` | Tempo máximo para esperar pela API aninhada do Fish |
| `FISH_S2_SYNTHESIS_TIMEOUT_SECONDS` | `240` | Tempo máximo para esperar por uma requisição de síntese no upstream |
| `FISH_S2_LAUNCH_TIMEOUT_MS` | `240000` | Tempo limite de prontidão (readiness timeout) de saúde do JSON do iniciador |

O áudio de referência deve ser um arquivo PCM RIFF/WAVE não compactado e não vazio. O limite de tamanho decodificado é verificado antes da inferência para evitar que uma requisição base64 muito grande consuma memória ilimitada.

## Usar outro checkpoint do S2 Pro

Defina `FISH_S2_MODEL_DIR` e `FISH_S2_MODEL_ID` antes de iniciar o wrapper. Por exemplo, uma GPU de 24 GB+ pode usar o checkpoint BF16 oficial baixado de `fishaudio/s2-pro`. A resposta de health (saúde) relata o ID do modelo e o diretório configurados em vez de afirmar que todo checkpoint é o modelo INT8 padrão.

O diretório do checkpoint deve conter os arquivos do modelo Fish e o `codec.pth` esperados pelo tempo de execução (runtime) do Fish Speech selecionado.

## Por que INT8 é o padrão

O objetivo é manter o modelo de voz S2 Pro de alta qualidade utilizável em GPUs comuns de 16 GB sem tornar a quantização de 4 bits, mais agressiva, o padrão. O cartão do modelo Imagilux relata apenas uma diferença muito pequena na taxa de erro de palavra (WER) em relação ao BF16 e mantém vários componentes sensíveis à qualidade em BF16, então o INT8 é o padrão atual do TomoriBot para esse sidecar.
