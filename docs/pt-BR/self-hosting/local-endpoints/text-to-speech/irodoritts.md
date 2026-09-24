---
title: "IrodoriTTS"
aiGenerated: true
---

Irodori-TTS v4.1 é um modelo de TTS focado em japonês com clonagem de voz e VoiceDesign baseado em legendas em um único checkpoint. O TomoriBot o executa através de um wrapper local do FastAPI em `servers/tts/irodoritts/`.

O modelo padrão é `Aratako/Irodori-TTS-v4.1-Small`. Checkpoints compatíveis do Hugging Face podem ser selecionados com `IRODORI_TTS_MODEL_ID`, incluindo ajustes finos (fine-tunes) da comunidade, como `phasefield-audio/Irodori-TTS-v4.1-Anime`.

## Configuração

O Irodori agora usa `uv` para gerenciamento de dependências e do backend PyTorch. Instale o `uv` primeiro, depois execute o script de configuração a partir da raiz do repositório do TomoriBot.

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

Os scripts de configuração criam `servers/tts/irodoritts/.venv`, de modo que `bun run launch --irodoritts` continua a funcionar após a instalação.

Os backends disponíveis são:

- `cu128`: NVIDIA CUDA 12.8 no Windows/Linux
- `cpu`: Apenas CPU, ou macOS CPU/MPS via PyPI
- `rocm`: AMD ROCm no Linux/WSL
- `xpu`: Intel XPU no Windows/Linux

O URL do endpoint padrão é `http://127.0.0.1:8013`.

## Usando um Checkpoint Diferente

O modelo padrão é `Aratako/Irodori-TTS-v4.1-Small`. Repositórios compatíveis do Hugging Face, ajustes finos da comunidade (como `phasefield-audio/Irodori-TTS-v4.1-Anime`), ou arquivos de checkpoint locais podem ser configurados via variáveis de ambiente.

Ao iniciar o sidecar (diretamente com Python ou via `bun run launch --irodoritts`), o servidor lê automaticamente o `.env` da raiz do repositório (ou um `.env` local em `servers/tts/irodoritts/`) e registra o ID do modelo ativo na inicialização.

### Via `.env` (Persistente)

Adicione ao seu `.env` na raiz do TomoriBot:

```dotenv
IRODORI_TTS_MODEL_ID="phasefield-audio/Irodori-TTS-v4.1-Anime"
```

### Via Variável de Ambiente por Sessão

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

### Usando um Arquivo de Checkpoint Local

Se você baixou um arquivo de checkpoint (`.pt` ou `.safetensors`) localmente, defina `IRODORI_TTS_CHECKPOINT` com seu caminho:

```dotenv
IRODORI_TTS_CHECKPOINT="/caminho/para/checkpoint_personalizado.pt"
```

O Irodori atual faz o download do checkpoint junto com quaisquer recursos do tokenizador agrupados no repositório do Hugging Face. Variantes de subpastas do Hugging Face também são suportadas por `IRODORI_TTS_MODEL_ID` quando o repositório do modelo as fornece.

## Registrar no TomoriBot

Execute `/providers`, escolha **Add New Custom Endpoint**, e use a compatibilidade da API de fala:

- Compatibilidade de API: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8013`

Após salvar a conexão, selecione-a e use a lista suspensa do modelo para adicionar um modelo de Speech. Para a v4.1, as
configurações recomendadas são:

- `Voice Source Mode`: `Auto`
- `Script Markup Style`: `Emoji`

O `Auto` permite que o mesmo endpoint do Irodori suporte ambos os modos de voz do TomoriBot, para que os sinais de emoção sobrevivam ao envio:

- As personas com uma amostra de voz atribuída em Persona > Voice enviam um clipe de referência armazenado para clonagem de voz.
- As personas com um prompt de VoiceDesign configurado em Persona > Voice enviam o prompt em linguagem natural salvo como o condicionamento de legenda do Irodori.

Você ainda pode escolher `Voice Clone` como o `Voice Source Mode` se quiser apenas a clonagem de voz por áudio de referência.

Use `/providers` para registrar o endpoint e configurar o modelo. Em seguida, abra `/config` > Models > Switch Models para selecionar e ativar o endpoint registrado.

## Configurar vozes de personas

### Clonagem de voz

1. Prepare um clipe de voz limpo em japonês com um falante e sem música de fundo. Cerca de 30 segundos já bastam: além disso, o áudio extra acrescenta pouco à fidelidade do timbre e aumenta o tamanho do upload e o tempo de inferência.
2. Abra `/config` em Models > TTS Parameters & Voices e envie o clipe.
3. Abra `/config` em Persona > Voice, e então escolha a persona e a amostra de voz.

O Irodori v4.1 suporta condicionamento de referência mais longo do que o antigo modelo v2, mas um áudio de origem limpo continua sendo mais importante do que a duração bruta.

O runtime do v4.1 limita o clipe de referência ao padrão do checkpoint, que o checkpoint v4.1 define como 120 segundos. Qualquer duração maior é cortada até esse limite em vez de ser recusada, e `IRODORI_MAX_REF_SECONDS` substitui esse valor. Um clipe no teto de upload de 130 segundos do TomoriBot, portanto, ainda funciona: o Irodori usa os primeiros 120 segundos dele como condicionamento.

Mais longo não é melhor aqui. O upstream relata que aproximadamente 30 segundos de fala de referência limpa já capturam a maior parte do ganho mensurável de similaridade com o falante, e que vários clipes mais curtos do mesmo falante superam uma única gravação longa. Os passos de latent de referência adicionais que acompanham um clipe mais longo também tornam cada solicitação de síntese mais demorada. Só ultrapasse os 30 segundos quando o timbre do falante variar ao longo da gravação.

### VoiceDesign

1. Abra `/config` em Persona > Voice.
2. Escolha a persona.
3. Insira uma descrição em linguagem natural da voz e da entrega desejadas.

O TomoriBot envia esse prompt como `instruct`; o wrapper do Irodori o mapeia para a condição `caption` do v4.1. As solicitações do VoiceDesign não exigem um clipe de referência armazenado.

O TomoriBot remove a sintaxe de emoji personalizado do Discord antes de enviar o texto para o TTS. Com `script_markup: emoji`, os emojis Unicode são preservados para o condicionamento de texto do Irodori.

## Inferência mais rápida com Sway Sampling

O padrão continua sendo a amostragem linear de 40 passos do Irodori, de maior qualidade. Para menor latência, tente o Sway Sampling com menos passos:

```powershell
$env:IRODORI_NUM_STEPS = "6"
$env:IRODORI_T_SCHEDULE_MODE = "sway"
$env:IRODORI_SWAY_COEFF = "-1.0"
```

Esta é uma compensação entre qualidade e velocidade de inferência, portanto, teste-a com seu checkpoint e vozes escolhidos antes de torná-la permanente.

## Por que os scripts de instalação estão mais simples agora

O instalador anterior do TomoriBot clonava e corrigia o `pyproject.toml` do Irodori, instalava o `dacvae` manualmente e fixava um commit antigo do Irodori da era v2. Essas soluções alternativas eram necessárias para o layout de pacote upstream mais antigo, mas não são mais apropriadas para o Irodori atual.

O sidecar agora tem seu próprio `pyproject.toml` e segue a configuração de backend `uv` do upstream. O Irodori e o `dacvae` permanecem fixados em commits conhecidos para instalações reproduzíveis, mas o TomoriBot não modifica mais o código-fonte upstream durante a instalação.

## Variáveis de ambiente

| Variável | Padrão | Propósito |
|---|---|---|
| `IRODORI_TTS_MODEL_ID` | `Aratako/Irodori-TTS-v4.1-Small` | Repositório de modelo do Hugging Face ou fonte suportada repositório/subpasta |
| `IRODORI_TTS_CHECKPOINT` | não definido | Checkpoint opcional local `.pt` ou `.safetensors`; substitui o modelo do Hugging Face |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Endereço de vinculação do servidor; consulte [Acesso de rede](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `IRODORI_TTS_PORT` | `8013` | Porta do servidor |
| `IRODORI_MODEL_DEVICE` | `auto` | Dispositivo do modelo (`auto`, `cuda`, `cpu`, `mps`, `xpu`) |
| `IRODORI_CODEC_DEVICE` | `auto` | Dispositivo do codec |
| `IRODORI_MODEL_PRECISION` | `bf16` em CUDA, caso contrário `fp32` | Precisão do modelo |
| `IRODORI_CODEC_PRECISION` | `fp32` | Precisão do codec |
| `IRODORI_COMPILE_MODEL` | `false` | Habilitar `torch.compile` para o modelo do Irodori |
| `IRODORI_COMPILE_DYNAMIC` | `false` | Habilitar formas dinâmicas ao compilar |
| `IRODORI_NUM_STEPS` | `40` | Passos de amostragem de Euler |
| `IRODORI_T_SCHEDULE_MODE` | `linear` | Cronograma de amostragem (`linear` ou `sway`) |
| `IRODORI_SWAY_COEFF` | `-1.0` | Coeficiente de sway ao usar o cronograma `sway` |
| `IRODORI_CFG_SCALE_TEXT` | `3.0` | Escala de orientação de texto |
| `IRODORI_CFG_SCALE_CAPTION` | `3.0` | Escala de orientação de legenda / VoiceDesign |
| `IRODORI_CFG_SCALE_SPEAKER` | `5.0` | Escala de orientação de falante de referência |
| `IRODORI_MAX_REF_SECONDS` | padrão do checkpoint | Limite opcional da duração do áudio de referência |
