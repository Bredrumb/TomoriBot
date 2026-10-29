---
title: "VoxCPM2"
aiGenerated: true
---

Sintetize fala expressiva a 48 kHz em 30 idiomas usando o modelo de conversão de texto em fala [VoxCPM2](https://github.com/OpenBMB/VoxCPM) da OpenBMB.

O VoxCPM2 é um modelo de fala multilíngue de 2B de parâmetros que suporta clonagem de voz, Ultimate Cloning assistida por transcrição e Voice Design em linguagem natural. O TomoriBot conecta-se à biblioteca oficial `voxcpm` em Python por meio do servidor em `servers/tts/voxcpm2/`, executando o checkpoint oficial em BF16 sem quantização `openbmb/VoxCPM2` confortavelmente dentro de 16 GB de VRAM.

## Licença

O código e os pesos do modelo VoxCPM2 são lançados sob a licença Apache-2.0, incluindo uso comercial sujeito aos termos da licença. O TomoriBot não redistribui os pesos; o instalador os baixa do repositório oficial do Hugging Face.

Recursos oficiais do projeto upstream:

- [OpenBMB/VoxCPM](https://github.com/OpenBMB/VoxCPM)
- [openbmb/VoxCPM2 no Hugging Face](https://huggingface.co/openbmb/VoxCPM2)
- [Documentação do VoxCPM](https://voxcpm.readthedocs.io/)

## Idiomas suportados

O VoxCPM2 suporta oficialmente 30 idiomas sem exigir uma tag de idioma:

Árabe, birmanês, chinês, dinamarquês, holandês, inglês, finlandês, francês, alemão, grego, hebraico, híndi, indonésio, italiano, japonês, khmer, coreano, laosiano, malaio, norueguês, polonês, português, russo, espanhol, suaíli, sueco, tagalo, tailandês, turco e vietnamita.

A OpenBMB também documenta vários dialetos chineses. O TomoriBot ainda pode enviar um campo `language` para compatibilidade com o contrato comum de TTS, mas o VoxCPM2 detecta o idioma a partir do texto de síntese e o wrapper não impõe uma tag de idioma.

## Modos de voz

Use as opções `Auto` e a marcação `Plain` para clonagem e design de voz. Uma transcrição de referência habilita o Ultimate Cloning; uma instrução de entonação tem precedência e omite a transcrição para essa solicitação.

## Hardware e tempo de execução

Ponto de partida recomendado:

- Python 3.10 a 3.12
- GPU NVIDIA com 8 GB de VRAM ou mais para o ambiente oficial em BF16; 12 a 16 GB oferecem folga confortável
- Driver NVIDIA atualizado e compilação do PyTorch habilitada para CUDA para aceleração por GPU
- O uso de CPU é suportado como alternativa de contingência, mas é substancialmente mais lento

O pacote oficial também disponibiliza a seleção de dispositivos CPU e Apple MPS. Para o TomoriBot no Windows, o pacote Python padrão pode rodar nativamente; o WSL não é obrigatório. O instalador em PowerShell para Windows instala por padrão uma versão do PyTorch com suporte a CUDA (`cu124`).

Para instalar explicitamente em uma máquina exclusiva para CPU, utilize o parâmetro `-Cpu`:

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1 -Cpu
```

Se a instalação nativa do PyTorch no Windows precisar de reinstalação manual ou ajuste de drivers, instale a versão com suporte a CUDA diretamente no ambiente virtual do servidor:

```powershell
.\servers\tts\voxcpm2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

## Instalação

O servidor fixa o pacote estável `voxcpm` 2.0.3 atual e baixa `openbmb/VoxCPM2` para o cache padrão do Hugging Face.

### Linux e WSL Bash

A partir da raiz do repositório do TomoriBot:

```bash
bash servers/tts/voxcpm2/install-voxcpm2.sh
servers/tts/voxcpm2/.venv/bin/python servers/tts/voxcpm2/server.py
```

### Windows PowerShell

A partir da raiz do repositório do TomoriBot:

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1
.\servers\tts\voxcpm2\.venv\Scripts\python.exe servers\tts\voxcpm2\server.py
```

A primeira configuração baixa vários gigabytes de pesos do modelo. Para instalar o ambiente Python sem pré-baixar o modelo, defina `VOXCPM2_PREFETCH=0`; a biblioteca oficial baixará o checkpoint na primeira inicialização do servidor.

Linux e WSL:

```bash
VOXCPM2_PREFETCH=0 bash servers/tts/voxcpm2/install-voxcpm2.sh
```

PowerShell:

```powershell
$env:VOXCPM2_PREFETCH = "0"
.\servers\tts\voxcpm2\install-voxcpm2.ps1
```

Após a configuração, `bun run launch --voxcpm2` inicia o servidor junto com o TomoriBot. O endpoint padrão é `http://127.0.0.1:8016`.

## Registrar no TomoriBot

Execute `/providers`, selecione `Adicionar Novo Endpoint Personalizado` e configure o endpoint de Fala:

- Capacidade: `Speech`
- Compatibilidade de API: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8016`
- Modo de Origem de Voz: `Auto`
- Marcação de Script: `Plain`
- Suporta Instruções: `Yes`

Depois de salvar a conexão, selecione-a e use o menu suspenso de modelos para adicionar um modelo de Fala. Em seguida, abra `/config` > Modelos > Alternar Modelos e selecione o modelo de fala VoxCPM2.

A opção `Auto` é recomendada porque o mesmo servidor suporta tanto a clonagem por áudio de referência quanto o Voice Design. Não é necessário executar processos separados do VoxCPM2 para os dois modos.

## Clonagem de voz de persona

Para uma persona que deve clonar uma voz existente:

1. Prepare um clipe de referência limpo com apenas um locutor e pouca ou nenhuma música de fundo. O projeto upstream considera 5 a 30 segundos como a faixa prática.
2. Abra `/config` em Modelos > Parâmetros de TTS e Vozes e envie o clipe.
3. Adicione a transcrição exata do clipe de referência quando disponível. O VoxCPM2 a utiliza para o Ultimate Cloning e pode reproduzir com maior fidelidade o ritmo, a emoção e o estilo da referência.
4. Abra `/config` em Persona > Voz, selecione a persona e atribua a amostra salva.

Se nenhuma transcrição for fornecida, o VoxCPM2 ainda realizará a clonagem comum por áudio de referência.

## Voice Design de persona

Para uma persona que deve ser criada a partir de uma descrição escrita de voz em vez de uma amostra:

1. Abra `/config` em Persona > Voz e selecione VoiceDesign.
2. Selecione a persona.
3. Insira uma descrição em linguagem natural, como `Young adult woman, soft warm voice, relaxed pace, slightly playful delivery`.

Para uma voz clonada, instruções pontuais de entonação têm precedência sobre a transcrição de referência.

## Variáveis de ambiente

| Variável | Padrão | Finalidade |
|---|---|---|
| `VOXCPM2_MODEL_ID` | `openbmb/VoxCPM2` | ID do modelo no Hugging Face ou diretório local do modelo |
| `VOXCPM2_DEVICE` | `auto` | Dispositivo de execução: `auto`, `cuda`, `cuda:N`, `cpu` ou `mps` |
| `VOXCPM2_OPTIMIZE` | `1` | Habilita o caminho de otimização/compilação da execução oficial |
| `VOXCPM2_LOAD_DENOISER` | `0` | Carrega o redutor de ruído opcional upstream; desativado por padrão para economizar memória |
| `VOXCPM2_CFG_VALUE` | `2.0` | Intensidade da orientação |
| `VOXCPM2_INFERENCE_TIMESTEPS` | `10` | Passos de inferência de flow-matching; valores maiores podem melhorar a qualidade com perda de velocidade |
| `VOXCPM2_MAX_LEN` | `4096` | Comprimento máximo da geração |
| `VOXCPM2_NORMALIZE` | `0` | Habilita a normalização de texto do upstream |
| `VOXCPM2_RETRY_BADCASE` | `1` | Habilita o comportamento de repetição do upstream para gerações anômalas |
| `VOXCPM2_RETRY_BADCASE_MAX_TIMES` | `3` | Número máximo de repetições automáticas |
| `VOXCPM2_RETRY_BADCASE_RATIO_THRESHOLD` | `6.0` | Limite de proporção para detecção de anomalias no upstream |
| `VOXCPM2_PREFETCH` | `1` | Apenas instalador: baixa o modelo durante a configuração |
| `VOXCPM2_PORT` | `8016` | Porta do servidor local do VoxCPM2 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Endereço de vinculação do servidor local; consulte [Acesso à rede](/self-hosting/local-endpoints/text-to-speech/#network-access) |

O áudio de referência deve ser um contêiner WAV não vazio de no máximo 10 MB decodificado, o que o wrapper verifica antes de gravar um arquivo temporário.
