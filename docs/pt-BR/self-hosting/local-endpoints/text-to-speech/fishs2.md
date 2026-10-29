---
title: "Fish Audio S2 Pro"
aiGenerated: true
---

Sintetize falas de personagens multilíngues altamente expressivas com tags de emoção refinadas usando o [Fish Audio S2 Pro](https://github.com/fishaudio/fish-speech).

O Fish Audio S2 Pro é um modelo de conversão de texto em fala multilíngue com 4B de parâmetros desenvolvido para clonagem de voz de alta fidelidade. O TomoriBot conecta-se ao modelo por meio do wrapper local em `servers/tts/fishs2/`. Ele usa por padrão os pesos oficiais em BF16 (`fishaudio/s2-pro`), com um checkpoint quantizado em INT8 opcional (`Imagilux/fishaudio-s2-pro`) para GPUs com 8 a 12 GB de VRAM.

O Fish S2 Pro suporta tags de expressão entre colchetes, como `[whisper]`, `[excited]` e `[angry]`. Configure o endpoint com a marcação `Bracket Tags` para que o TomoriBot preserve esses controles nos scripts de voz gerados.

## Licença

O código do Fish Speech e os pesos do modelo S2 Pro são distribuídos sob a Fish Audio Research License. A pesquisa e o uso não comercial são permitidos sob seus termos; o uso comercial exige uma licença separada da Fish Audio.

O TomoriBot não redistribui os pesos do modelo. Cada usuário de hospedagem própria baixa o Fish S2 Pro diretamente do Hugging Face e é responsável por cumprir a Fish Audio Research License. A atribuição obrigatória é: Built with Fish Audio.

## Hardware e sistemas operacionais

> [!IMPORTANT]
> Use Linux ou WSL2 para uma velocidade de inferência viável. O wrapper mantém a compilação desativada por padrão; defina `FISH_S2_COMPILE=1` para habilitar a compilação com Triton. A execução nativa no Windows pode levar de 8 a 10 minutos por clipe.

Hardware recomendado:

- **Linux ou WSL2 (Altamente Recomendado)**
- GPU NVIDIA com 16 GB a 24 GB de VRAM (BF16 cabe confortavelmente em ~16-18 GB de VRAM com cache KV e descarregamento)
- Python 3.12 recomendado
- `git`, `ffmpeg` e bibliotecas padrão de áudio exigidas pelo Fish Speech

## Configuração

### Linux e WSL2 (recomendado)

A partir da raiz do repositório do TomoriBot:

```bash
bash servers/tts/fishs2/install-fishs2.sh
servers/tts/fishs2/.venv/bin/python servers/tts/fishs2/server.py
```

O instalador baixa o ambiente fixado do Fish Speech e o checkpoint oficial em BF16. Defina `FISH_S2_MODEL_REVISION` com uma revisão imutável para garantir downloads reproduzíveis do modelo.

O modelo no Hugging Face possui acesso controlado. Aceite a licença no Hugging Face primeiro. Caso o download solicite autenticação, execute:

```bash
servers/tts/fishs2/.venv/bin/hf auth login
```

Em seguida, execute o instalador novamente.

### Windows PowerShell (somente melhor esforço)

O Windows nativo é disponibilizado apenas para avaliação. Devido à latência de envio do driver no modo eager não compilado, a geração será extremamente lenta (~8 a 10 minutos por clipe):

```powershell
.\servers\tts\fishs2\install-fishs2.ps1
.\servers\tts\fishs2\.venv\Scripts\python.exe servers\tts\fishs2\server.py
```

O instalador em PowerShell tem como alvo padrão a aceleração por GPU via CUDA (`cu124`). Para instalar em uma máquina sem GPU NVIDIA (somente CPU), passe `-Cpu`:

```powershell
.\servers\tts\fishs2\install-fishs2.ps1 -Cpu
```

Se o PyTorch no Windows precisar ser instalado ou atualizado manualmente com suporte a CUDA, execute:

```powershell
.\servers\tts\fishs2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

O TomoriBot para de aguardar uma mensagem de voz após `TTS_SYNTHESIZE_TIMEOUT_MS` (padrão de 240000 ms), o que é menor do que o tempo necessário para um clipe no Windows nativo. Aumente esse valor no `.env` do TomoriBot (por exemplo, `TTS_SYNTHESIZE_TIMEOUT_MS=900000`) durante a avaliação no Windows.

## Transcrição de referência obrigatória

> [!WARNING]
> O Fish S2 Pro exige a transcrição exata do clipe de referência. Insira-a em `Transcrição de referência` em `/config` > Modelos > Parâmetros de TTS e Vozes; o wrapper rejeita solicitações sem ela.

## Registrar no TomoriBot

Em `/providers`, escolha `Adicionar Novo Endpoint Personalizado` e configure:

- Capacidade: `Speech`
- Compatibilidade de API: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8015`
- Modo de Origem de Voz: `Clone`
- Marcação de Script: `Bracket Tags`
- Chave de API: deixe vazia. O wrapper não possui autenticação; consulte [Acesso à rede](/self-hosting/local-endpoints/text-to-speech/#network-access).

Em seguida, adicione a entrada de modelo do endpoint e ative-o em `/config` sob Modelos > Alternar Modelos.

## Adicionar vozes de persona

1. Prepare um clipe de referência limpo de 10 a 20 segundos com apenas um locutor e pouco ou nenhum ruído de fundo.
2. Em `/config`, abra Modelos > Parâmetros de TTS e Vozes e envie a amostra de voz.
3. **Insira a transcrição exata** falada no clipe de referência no campo de texto de referência.
4. Em `/config`, abra Persona > Voz e atribua a amostra à persona.
5. Gere uma mensagem de voz com `/generate voice-message` ou deixe o TomoriBot gerar uma por meio da sua ferramenta de mensagem de voz.

O projeto upstream recomenda amostras de referência de 10 a 30 segundos.

## Controles de expressão

O Fish S2 Pro consegue variar a entonação dentro de uma mesma fala usando tags entre colchetes. Por exemplo:

```text
[whisper] Keep your voice down. [excited] Wait, you actually found it?
```

Como o endpoint usa a marcação `Bracket Tags`, o TomoriBot preserva essas tags em vez de removê-las antes da síntese.

## Configuração

| Variável | Padrão | Finalidade |
|---|---|---|
| `FISH_S2_MODEL_DIR` | `fish-speech/checkpoints/fish-speech-s2-pro` | Diretório do checkpoint do S2 Pro |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | Repositório do modelo e rótulo de metadados de integridade para o checkpoint configurado |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Endereço de vinculação do wrapper; consulte [Acesso à rede](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `FISH_S2_PORT` | `8015` | Porta do wrapper do Fish |
| `FISH_S2_UPSTREAM_PORT` | `8025` | Porta interna da API do Fish |
| `FISH_S2_COMPILE` | `0` | Habilita `torch.compile` do Fish Speech (requer Linux/WSL2 com Triton) |
| `FISH_S2_HALF` | `0` | Solicita modo de execução em FP16 |
| `FISH_S2_CHUNK_LENGTH` | `200` | Comprimento do bloco de prompt iterativo do Fish |
| `FISH_S2_TOP_P` | `0.8` | Amostragem top-p |
| `FISH_S2_TEMPERATURE` | `0.8` | Temperatura de amostragem |
| `FISH_S2_REPETITION_PENALTY` | `1.1` | Penalidade de repetição |
| `FISH_S2_MAX_NEW_TOKENS` | `1024` | Máximo de tokens semânticos gerados por solicitação |
| `FISH_S2_USE_MEMORY_CACHE` | `on` | Faz cache de vozes de referência codificadas na execução do Fish |

### Variáveis do instalador

Lidas por `install-fishs2.sh` e `install-fishs2.ps1`. Registre qualquer valor que você sobrescrever para que a implantação possa ser reproduzida.

| Variável | Padrão | Finalidade |
|---|---|---|
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | Repositório do Hugging Face para download |
| `FISH_S2_MODEL_REVISION` | `main` | Revisão do Hugging Face para download |

O áudio de referência deve ser um arquivo PCM RIFF/WAVE descompactado, não vazio e com no máximo 10 MB decodificado. O limite é validado antes da inferência para impedir que solicitações em base64 com tamanho excessivo consumam memória indefinidamente, comportando cerca de 237 segundos do WAV mono a 22,05 kHz enviado pelo TomoriBot.

## Opção de baixo consumo de VRAM (quantização INT8)

Usuários com GPUs com restrição de VRAM (por exemplo, 8 a 12 GB) que não comportam o checkpoint oficial em BF16 podem optar pelo modelo quantizado em INT8 (`Imagilux/fishaudio-s2-pro`).

Para instalar e executar o checkpoint em INT8:

```bash
# No Linux / WSL2:
export FISH_S2_MODEL_ID="Imagilux/fishaudio-s2-pro"
export FISH_S2_MODEL_DIR="servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
export FISH_S2_MODEL_REVISION="9706ff036580881d87cc09465dd10014527bc481"
bash servers/tts/fishs2/install-fishs2.sh
```

```powershell
# No Windows PowerShell:
$env:FISH_S2_MODEL_ID = "Imagilux/fishaudio-s2-pro"
$env:FISH_S2_MODEL_DIR = "servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
$env:FISH_S2_MODEL_REVISION = "9706ff036580881d87cc09465dd10014527bc481"
.\servers\tts\fishs2\install-fishs2.ps1
```

Inicie `server.py` a partir do mesmo shell, ou defina as mesmas três variáveis antes de iniciá-lo, para que o wrapper carregue o diretório INT8 em vez do padrão BF16.

O checkpoint em INT8 reduz os pesos do transformer de ~10,3 GB para ~5,1 GB, mantendo os embeddings de áudio e as camadas de codec em BF16, cabendo dentro de aproximadamente 10 GB de VRAM total.
