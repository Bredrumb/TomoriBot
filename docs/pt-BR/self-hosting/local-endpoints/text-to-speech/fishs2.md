---
title: "Fish Audio S2 Pro"
aiGenerated: true
---

O Fish Audio S2 Pro é um modelo de TTS 4B multilíngue focado em clonagem de voz de alta fidelidade e entrega expressiva. O TomoriBot o utiliza através do wrapper local em `servers/tts/fishs2/`.

A configuração padrão do TomoriBot usa os pesos BF16 oficiais (`fishaudio/s2-pro`) para oferecer a maior fidelidade de síntese e evitar incompatibilidades de quantização. Para usuários com GPUs de consumo com memória limitada, uma quantização opcional apenas de pesos em INT8 (`Imagilux/fishaudio-s2-pro`) é suportada por meio de variáveis de ambiente.

O Fish S2 Pro suporta tags de expressão entre colchetes, como `[whisper]`, `[excited]` e `[angry]`. Configure o endpoint com a marcação **Tags de Colchetes** (Bracket Tags) para que o TomoriBot preserve esses controles nos scripts de voz gerados.

## Licença

O código do Fish Speech e os pesos do modelo S2 Pro são distribuídos sob a Fish Audio Research License. Pesquisa e uso não comercial são permitidos de acordo com seus termos; o uso comercial exige uma licença separada da Fish Audio.

O TomoriBot não redistribui os pesos do modelo. Cada usuário de hospedagem própria baixa o Fish S2 Pro diretamente do Hugging Face e é responsável por cumprir a Fish Audio Research License. A atribuição exigida é: **Built with Fish Audio**.

## Hardware e Sistema Operacional

> [!IMPORTANT]
> **Use Linux ou WSL2 para o Fish Speech:** a Fish Audio tem como alvo oficial o Linux e o WSL2. O Fish S2 Pro usa uma arquitetura Dual-Autoregressive (Dual-AR): 36 camadas lentas de transformer mais 10 passagens rápidas de codebook, totalizando 76 avaliações de camada por token. No Linux, o OpenAI Triton pode compilar esse loop aninhado em kernels de GPU fundidos (`torch.compile(backend="inductor")`), e os benchmarks upstream demonstram que isso permite síntese em tempo real em GPUs de servidor Linux. O wrapper deixa a compilação desativada por padrão, então defina `FISH_S2_COMPILE=1` para usá-la.
>
> No Windows nativo, o Triton não é suportado, o que força o PyTorch ao modo eager não compilado, com mais de 120.000 despachos sequenciais de kernels CUDA pelo driver WDDM do Windows. Isso causa um travamento severo de despacho e deixa a geração em **~8-10 minutos** (~65s de processamento por segundo de áudio) para o mesmo clipe. Para uma inferência utilizável, **execute o Fish S2 Pro dentro do Linux ou do WSL2**.

Hardware recomendado:

- **Linux ou WSL2 (fortemente recomendado)**
- GPU NVIDIA com **16 GB a 24 GB de VRAM** (o BF16 cabe com folga em ~16-18 GB de VRAM com cache KV e offload)
- Python 3.12 recomendado
- `git`, `ffmpeg` e as bibliotecas de áudio padrão exigidas pelo Fish Speech

## Configuração

### Linux / WSL2 (Recomendado)

Na raiz do repositório do TomoriBot:

```bash
bash servers/tts/fishs2/install-fishs2.sh
servers/tts/fishs2/.venv/bin/python servers/tts/fishs2/server.py
```

O instalador:

1. clona `Imagilux/fish-speech` em `servers/tts/fishs2/fish-speech/` e faz checkout do commit de runtime fixado;
2. cria o `.venv` isolado;
3. instala o Fish Speech e as dependências do wrapper do TomoriBot; e
4. baixa o checkpoint BF16 oficial `fishaudio/s2-pro` em `fish-speech/checkpoints/fish-speech-s2-pro/`.

Uma reinstalação normal permanece no commit de runtime fixado `2225e924e7d35cc0a1d24dbc67cd1819e6cf429f` em vez de
seguir uma branch em movimento; migrar para um runtime mais novo significa alterar esse pin no instalador. A revisão do modelo usa `main` por padrão; fixe `FISH_S2_MODEL_REVISION` em
uma revisão imutável do Hugging Face quando a implantação precisar ser reproduzível. As configurações do instalador
estão listadas em [Variáveis do instalador](#variáveis-do-instalador).

O modelo no Hugging Face é restrito (gated). Aceite a licença no Hugging Face primeiro. Se o download pedir autenticação, execute:

```bash
servers/tts/fishs2/.venv/bin/hf auth login
```

Em seguida, execute o instalador novamente.

### Windows PowerShell (Apenas Melhor Esforço)

O Windows nativo é fornecido apenas para avaliação. Por causa da latência de despacho do driver no modo eager não compilado, a geração será extremamente lenta (~8-10 minutos por clipe):

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

O TomoriBot para de esperar por uma mensagem de voz após `TTS_SYNTHESIZE_TIMEOUT_MS` (padrão 240000 ms), o que
é menos do que um clipe leva no Windows nativo. Aumente esse valor no `.env` do TomoriBot (por exemplo,
`TTS_SYNTHESIZE_TIMEOUT_MS=900000`) enquanto estiver avaliando no Windows.

## Transcrição de Referência Obrigatória

> [!WARNING]
> **O texto de referência (`ref_text`) é obrigatório para clonagem de voz:** o mecanismo de atenção cruzada do Fish S2 Pro precisa da transcrição do áudio de referência para alinhar tokens fonéticos com códigos acústicos.
>
> Se você enviar uma amostra de voz sem a transcrição de referência correspondente, o Fish Speech **descarta silenciosamente os tokens do áudio de referência** e recorre a uma fala aleatória sem referência. O wrapper do Fish no TomoriBot valida e rejeita requisições de síntese sem texto de referência com um `400 Bad Request`, para evitar uma geração acidental sem condicionamento.

Ao adicionar uma voz de persona em `/config` em **Models > TTS Parameters & Voices**, sempre preencha o campo **Reference transcript** com o texto exato falado no seu clipe de áudio de referência.

## Registrar no TomoriBot

Em `/providers`, escolha **Add New Custom Endpoint** (Adicionar Novo Endpoint Personalizado) e configure:

- Capability (Capacidade): `Speech`
- API Compatibility (Compatibilidade de API): `tts-clone`
- Endpoint URL (URL do Endpoint): `http://127.0.0.1:8015`
- Voice Source Mode (Modo da Fonte de Voz): `Clone`
- Script Markup (Marcação do Script): `Bracket Tags`
- API key (Chave de API): deixe em branco. O wrapper não tem autenticação; consulte [Acesso de rede](/self-hosting/local-endpoints/text-to-speech/#network-access).

Em seguida, adicione a entrada do modelo (model) do endpoint e ative-o através de `/config` em Models > Switch Models.

## Adicionar vozes de persona

1. Prepare um clipe de referência limpo de 10-20 segundos com apenas um orador e pouco ou nenhum ruído de fundo.
2. Em `/config`, abra Models > TTS Parameters & Voices e faça o upload da amostra de voz.
3. **Insira a transcrição exata** falada no clipe de referência no campo de texto de referência.
4. Em `/config`, abra Persona > Voice e atribua a amostra à persona.
5. Gere uma mensagem de voz com `/generate voice-message` ou deixe o TomoriBot gerar uma através da sua ferramenta de mensagem de voz.

O upstream descreve uma clonagem precisa a partir de amostras de referência de tipicamente 10-30 segundos. O próprio runtime do Fish S2 Pro não aplica nenhum limite de duração da referência, então um clipe mais longo é aceito em vez de cortado, mas a qualidade de clonagem documentada vem da faixa de 10-30 segundos.

## Controles de expressão

O Fish S2 Pro pode variar a entrega dentro de uma mesma fala usando tags entre colchetes. Por exemplo:

```text
[whisper] Keep your voice down. [excited] Wait, you actually found it?
```

Como o endpoint usa a marcação `Bracket Tags`, o TomoriBot preserva essas tags em vez de removê-las antes da síntese.

## Configuração

| Variável | Padrão | Propósito |
|---|---|---|
| `FISH_S2_MODEL_DIR` | `fish-speech/checkpoints/fish-speech-s2-pro` | Diretório do checkpoint do S2 Pro |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | Repositório do modelo e rótulo de metadados de integridade (health) para o checkpoint configurado |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Endereço de bind do wrapper; consulte [Acesso de rede](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `FISH_S2_PORT` | `8015` | Porta do wrapper do Fish |
| `FISH_S2_UPSTREAM_PORT` | `8025` | Porta interna da API do Fish |
| `FISH_S2_COMPILE` | `0` | Habilitar `torch.compile` do Fish Speech (requer Linux/WSL2 com Triton) |
| `FISH_S2_HALF` | `0` | Solicitar modo de tempo de execução FP16 |
| `FISH_S2_CHUNK_LENGTH` | `200` | Comprimento do chunk do prompt iterativo do Fish |
| `FISH_S2_TOP_P` | `0.8` | Amostragem top-p |
| `FISH_S2_TEMPERATURE` | `0.8` | Temperatura de amostragem |
| `FISH_S2_REPETITION_PENALTY` | `1.1` | Penalidade de repetição |
| `FISH_S2_MAX_NEW_TOKENS` | `1024` | Máximo de tokens semânticos gerados por requisição |
| `FISH_S2_USE_MEMORY_CACHE` | `on` | Fazer cache de vozes de referência codificadas no tempo de execução do Fish |

### Variáveis do instalador

Lidas por `install-fishs2.sh` e `install-fishs2.ps1`. Registre qualquer valor que você sobrescrever para que a implantação possa ser reproduzida.

| Variável | Padrão | Propósito |
|---|---|---|
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | Repositório do Hugging Face a baixar |
| `FISH_S2_MODEL_REVISION` | `main` | Revisão do Hugging Face a baixar |

O áudio de referência deve ser um arquivo PCM RIFF/WAVE não compactado, não vazio e com no máximo 10 MB decodificado. O limite é verificado antes da inferência para que uma requisição base64 muito grande não consuma memória ilimitada, e comporta cerca de 237 segundos do WAV mono de 22,05 kHz que o TomoriBot envia.

## Opção para Pouca VRAM (Quantização INT8)

Usuários com GPUs de VRAM limitada (por exemplo, 8 GB a 12 GB) que não conseguem acomodar o checkpoint BF16 oficial podem optar pelo modelo quantizado INT8 (`Imagilux/fishaudio-s2-pro`).

Para instalar e executar o checkpoint INT8:

```bash
# In Linux / WSL2:
export FISH_S2_MODEL_ID="Imagilux/fishaudio-s2-pro"
export FISH_S2_MODEL_DIR="servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
export FISH_S2_MODEL_REVISION="9706ff036580881d87cc09465dd10014527bc481"
bash servers/tts/fishs2/install-fishs2.sh
```

```powershell
# In Windows PowerShell:
$env:FISH_S2_MODEL_ID = "Imagilux/fishaudio-s2-pro"
$env:FISH_S2_MODEL_DIR = "servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
$env:FISH_S2_MODEL_REVISION = "9706ff036580881d87cc09465dd10014527bc481"
.\servers\tts\fishs2\install-fishs2.ps1
```

Inicie o `server.py` no mesmo shell, ou defina as mesmas três variáveis antes de iniciá-lo, para que o wrapper carregue o diretório INT8 em vez do padrão BF16.

O checkpoint INT8 reduz os pesos do transformer de ~10,3 GB para ~5,1 GB, mantendo os embeddings de áudio e as camadas do codec em BF16, e cabe em ~10 GB de VRAM no total.
