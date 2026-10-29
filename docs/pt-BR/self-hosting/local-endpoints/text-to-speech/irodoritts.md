---
title: "IrodoriTTS"
aiGenerated: true
---

Gere fala em japonês natural com clonagem de voz, VoiceDesign baseado em legendas e marcações expressivas de emojis usando o [Irodori-TTS v4.1](https://github.com/Aratako/Irodori-TTS).

O Irodori-TTS v4.1 é um modelo de conversão de texto em fala focado em japonês que suporta tanto clonagem de voz quanto VoiceDesign descrito em texto em um único checkpoint. O TomoriBot conecta-se ao Irodori por meio do wrapper FastAPI local em `servers/tts/irodoritts/`, usando por padrão `Aratako/Irodori-TTS-v4.1-Small`.

Checkpoints compatíveis do Hugging Face podem ser selecionados com `IRODORI_TTS_MODEL_ID`, incluindo fine-tunes da comunidade como `phasefield-audio/Irodori-TTS-v4.1-Anime`.

## Configuração

O Irodori utiliza `uv` para o gerenciamento de dependências e do backend PyTorch. O servidor mantém seu próprio `pyproject.toml` com dependências fixadas do Irodori e `dacvae` para instalações reproduzíveis. Instale o `uv` primeiro e, em seguida, execute o script de configuração a partir da raiz do repositório do TomoriBot:

### Windows PowerShell (NVIDIA)

```powershell
.\servers\tts\irodoritts\install-irodori.ps1 cu128
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

### Linux Bash (NVIDIA)

```bash
bash servers/tts/irodoritts/install-irodori.sh cu128
servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

Os scripts de configuração criam `servers/tts/irodoritts/.venv`, portanto o comando `bun run launch --irodoritts` continua funcionando após a instalação.

Backends disponíveis:

- `cu128`: NVIDIA CUDA 12.8 no Windows e Linux
- `cpu`: apenas CPU, ou macOS CPU/MPS via PyPI
- `rocm`: AMD ROCm no Linux/WSL
- `xpu`: Intel XPU no Windows e Linux

A URL padrão do endpoint é `http://127.0.0.1:8013`.

## Usando um checkpoint diferente

O modelo padrão é `Aratako/Irodori-TTS-v4.1-Small`. Você pode selecionar outros checkpoints oficiais (incluindo o modelo Large de 3,29B parâmetros e suas variantes quantizadas), fine-tunes da comunidade ou arquivos locais de checkpoint por meio de variáveis de ambiente.

### Checkpoints e variantes

| Modelo / `IRODORI_TTS_MODEL_ID` | Parâmetros | Tamanho do checkpoint | VRAM recomendada | Notas |
|---|---|---|---|---|
| `Aratako/Irodori-TTS-v4.1-Small` | 766M | 1.5 GB | 4-6 GB | Modelo padrão: inferência rápida e baixo uso de memória. |
| `Aratako/Irodori-TTS-v4-Large` | 3.29B | 12.25 GB | 10-14 GB | Modelo Large completo sem quantização com base de texto T5Gemma 2. |
| `Aratako/Irodori-TTS-v4-Large-Quantized/float8-weight-only` | 3.29B | 3.58 GB | 6-8 GB | Pesos em FP8 com ativações em BF16: recomendado para NVIDIA Ada (série RTX 40) e mais recentes. |
| `Aratako/Irodori-TTS-v4-Large-Quantized/int8-weight-only` | 3.29B | 3.58 GB | 6-8 GB | Pesos em INT8 de uso geral com computação em BF16 no NVIDIA CUDA. |
| `Aratako/Irodori-TTS-v4-Large-Quantized/int4-weight-only` | 3.29B | 2.75 GB | 5-6 GB | Variante Large mais compacta: requer NVIDIA Ampere (série RTX 30) ou mais recente. |
| `phasefield-audio/Irodori-TTS-v4.1-Anime` | 766M | 1.5 GB | 4-6 GB | Fine-tune da comunidade para interpretação de fala estilo anime. |

Para clonagem de voz, a versão Small oferece qualidade similar com inferência mais rápida. A Large conta com um codificador de texto mais robusto e segue as descrições de VoiceDesign com maior precisão.

O servidor lê o arquivo `.env` da raiz do repositório ou um `.env` local em `servers/tts/irodoritts/.env`.

### Via `.env` (persistente)

Adicione ao seu `.env` na raiz do TomoriBot:

```dotenv
IRODORI_TTS_MODEL_ID="phasefield-audio/Irodori-TTS-v4.1-Anime"
```

### Via variável de ambiente por sessão

No Windows PowerShell:

```powershell
$env:IRODORI_TTS_MODEL_ID = "phasefield-audio/Irodori-TTS-v4.1-Anime"
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

No Linux Bash:

```bash
IRODORI_TTS_MODEL_ID=phasefield-audio/Irodori-TTS-v4.1-Anime \
  servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

### Usando um arquivo de checkpoint local

Se tiver baixado um arquivo de checkpoint (`.pt` ou `.safetensors`) localmente, aponte `IRODORI_TTS_CHECKPOINT` para o caminho dele:

```dotenv
IRODORI_TTS_CHECKPOINT="/path/to/custom_checkpoint.pt"
```

A versão atual do Irodori baixa o checkpoint juntamente com quaisquer recursos de tokenizador incluídos no repositório do Hugging Face. Variantes em subpastas do Hugging Face também são suportadas por `IRODORI_TTS_MODEL_ID` quando disponibilizadas no repositório do modelo.

## Registrar no TomoriBot

Execute `/providers`, selecione `Adicionar Novo Endpoint Personalizado` e use a compatibilidade de API de fala:

- Compatibilidade de API: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8013`

Depois de salvar a conexão, selecione-a e use o menu suspenso de modelos para adicionar um modelo de Fala. Para a v4.1, as configurações recomendadas são:

- `Modo de Origem de Voz`: `Auto`
- `Estilo de Marcação de Script`: `Emoji`

A opção `Auto` permite que o mesmo endpoint do Irodori atenda a ambos os modos de voz do TomoriBot, garantindo que as indicações de emoção sejam preservadas:

- Personas com uma amostra de voz definida em Persona > Voz enviam um clipe de referência armazenado para clonagem de voz.
- Personas com um prompt de VoiceDesign definido em Persona > Voz enviam o prompt em linguagem natural como condicionamento de legenda do Irodori.

Você ainda pode escolher `Voice Clone` como o Modo de Origem de Voz se desejar apenas clonagem por áudio de referência.

Use `/providers` para registrar o endpoint e configurar o modelo. Em seguida, abra `/config` > Modelos > Alternar Modelos para selecionar e ativar o endpoint registrado.

## Configurar vozes de persona

### Clonagem de voz

1. Prepare um clipe de voz limpo em japonês com apenas um locutor e sem música de fundo. Cerca de 30 segundos já são suficientes: após esse limite, o áudio adicional traz pouco ganho de fidelidade de timbre, aumentando o tamanho do upload e o tempo de inferência.
2. Abra `/config` em Modelos > Parâmetros de TTS e Vozes e envie o clipe.
3. Abra `/config` em Persona > Voz, depois selecione a persona e a amostra de voz.

O Irodori adota por padrão um limite de referência de 120 segundos e trunca clipes maiores. Defina `IRODORI_MAX_REF_SECONDS` para alterar esse limite.

### VoiceDesign

1. Abra `/config` em Persona > Voz.
2. Selecione a persona.
3. Digite uma descrição em linguagem natural da voz e da entonação desejadas.

O TomoriBot envia esse prompt como `instruct`; o wrapper do Irodori o mapeia para o condicionamento `caption` da v4.1. Solicitações de VoiceDesign não requerem um clipe de referência armazenado.

O TomoriBot remove a sintaxe de emojis personalizados do Discord antes de enviar o texto ao TTS. Com `script_markup: emoji`, emojis Unicode são preservados para o condicionamento de texto do Irodori.

### Controles de estilo por emoji

O IrodoriTTS suporta anotações de emojis no texto de entrada para modular efeitos sonoros, estilos de fala e expressões emocionais. Com o `Estilo de Marcação de Script` do TomoriBot configurado como `Emoji`, esses emojis Unicode são mantidos e enviados ao Irodori.

Para consultar a lista de emojis suportados e seus significados, consulte as [anotações de emojis do projeto upstream](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small/blob/main/EMOJI_ANNOTATIONS.md). Emojis funcionam como sugestões de estilo e os resultados podem variar.

## Mensagens de voz longas

Textos longos são divididos em blocos e retornados como uma única mensagem de voz. Solicitações muito extensas podem ultrapassar o limite padrão de 240 segundos de tempo limite; ajuste `TTS_SYNTHESIZE_TIMEOUT_MS` se necessário. Defina `IRODORI_CHUNKING_ENABLED=false` para desativar a divisão ou `IRODORI_CHUNK_MIN_CHARS` para regular o limite de quebra.

## Inferência mais rápida com amostragem sway

O padrão permanece a amostragem linear de 40 passos de alta qualidade do Irodori. Para menor latência, experimente o Sway Sampling com menos passos:

```powershell
$env:IRODORI_NUM_STEPS = "6"
$env:IRODORI_T_SCHEDULE_MODE = "sway"
$env:IRODORI_SWAY_COEFF = "-1.0"
```

Trata-se de um equilíbrio entre qualidade e velocidade de inferência, portanto teste com o checkpoint e as vozes escolhidas antes de adotar definitivamente.

## Variáveis de ambiente

| Variável | Padrão | Finalidade |
|---|---|---|
| `IRODORI_TTS_MODEL_ID` | `Aratako/Irodori-TTS-v4.1-Small` | Repositório de modelos do Hugging Face ou subpasta suportada |
| `IRODORI_TTS_CHECKPOINT` | não definido | Checkpoint local `.pt` ou `.safetensors` opcional; substitui o modelo do Hugging Face |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Endereço de vinculação do servidor; consulte [Acesso à rede](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `IRODORI_TTS_PORT` | `8013` | Porta do servidor |
| `IRODORI_MODEL_DEVICE` | `auto` | Dispositivo do modelo (`auto`, `cuda`, `cpu`, `mps`, `xpu`) |
| `IRODORI_CODEC_DEVICE` | `auto` | Dispositivo do codec |
| `IRODORI_MODEL_PRECISION` | `bf16` em CUDA, caso contrário `fp32` | Precisão do modelo |
| `IRODORI_CODEC_PRECISION` | `fp32` | Precisão do codec |
| `IRODORI_COMPILE_MODEL` | `false` | Habilita `torch.compile` para o modelo do Irodori |
| `IRODORI_COMPILE_DYNAMIC` | `false` | Habilita dimensões dinâmicas na compilação |
| `IRODORI_NUM_STEPS` | `40` | Passos de amostragem de Euler |
| `IRODORI_T_SCHEDULE_MODE` | `linear` | Cronograma de amostragem (`linear` ou `sway`) |
| `IRODORI_SWAY_COEFF` | `-1.0` | Coeficiente sway ao usar o cronograma `sway` |
| `IRODORI_CFG_SCALE_TEXT` | `3.0` | Escala de orientação do texto |
| `IRODORI_CFG_SCALE_CAPTION` | `3.0` | Escala de orientação de legenda / VoiceDesign |
| `IRODORI_CFG_SCALE_SPEAKER` | `5.0` | Escala de orientação do locutor de referência |
| `IRODORI_MAX_REF_SECONDS` | padrão do checkpoint | Limite opcional na duração do áudio de referência |
| `IRODORI_CHUNKING_ENABLED` | `true` | Divide textos longos nos limites de pontuação permitidos e concatena os blocos gerados |
| `IRODORI_CHUNK_MIN_CHARS` | `80` | Mínimo de caracteres sem espaço antes da divisão em limites fortes de frase; vírgulas funcionam como alternativa por volta de 1,5x esse valor |
