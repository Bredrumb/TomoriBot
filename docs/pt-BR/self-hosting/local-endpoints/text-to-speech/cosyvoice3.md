---
title: "CosyVoice 3"
aiGenerated: true
---

Sintetize vozes naturais e multilíngues de personagens com entonação emocional orientada por instruções usando o [CosyVoice 3](https://github.com/QwenAudio/CosyVoice) do Alibaba.

O CosyVoice 3 oferece clonagem de voz zero-shot e cross-lingual em 9 idiomas e mais de 18 dialetos chineses. O TomoriBot integra a execução oficial em `servers/tts/cosyvoice3/` para disponibilizar a interface padrão de fala `POST /synthesize`. O instalador integrado usa por padrão o modelo oficial sem quantização `FunAudioLLM/Fun-CosyVoice3-0.5B-2512`, rodando confortavelmente em 16 GB de VRAM.

O CosyVoice suporta nove idiomas e dialetos chineses. Se a pronúncia em japonês soar inadequada, o repositório upstream recomenda converter o texto para katakana.

Use a marcação de script `Plain` e forneça a direção de entonação via `voice_instructions`. Uma transcrição de referência correspondente habilita a clonagem zero-shot; sem ela, o servidor adota a clonagem cross-lingual. Instruções utilizam o áudio de referência sem a sua transcrição.

## Hardware

Hardware recomendado:

- GPU NVIDIA com 16 GB de VRAM
- Python 3.10
- Driver NVIDIA compatível com CUDA 12
- `git`
- `ffmpeg` para normalização de amostras de voz
- `sox` e `libsox-dev` no Linux caso surjam problemas de compatibilidade de áudio

O modelo de 0,5B parâmetros cabe facilmente em 16 GB de VRAM sem necessidade de quantização. O download do checkpoint inclui modelos de fluxo, tokenizadores de fala, modelos de texto e pesos de aprendizado por reforço, exigindo aproximadamente 10 GB de espaço em disco além das dependências em Python.

Embora a inferência em CPU seja tecnicamente suportada pelo upstream, ela é lenta demais para interações de voz no Discord.

## Instalação

### Linux e WSL2 (recomendado)

A partir da raiz do repositório do TomoriBot:

```bash
bash servers/tts/cosyvoice3/install-cosyvoice3.sh
servers/tts/cosyvoice3/.venv/bin/python servers/tts/cosyvoice3/server.py
```

Ou inicie o servidor configurado junto com o TomoriBot:

```bash
bun run launch --cosyvoice3
```

O instalador baixa revisões fixadas de código e do modelo, recusando-se a sobrescrever um checkout com alterações não confirmadas.

Os requisitos upstream instalam o PyTorch 2.3.1 com pacotes para CUDA 12.1, pacotes do ONNX Runtime para CUDA 12 no Linux e pacotes do TensorRT 10.13 no Linux. Se sua GPU exigir uma versão mais recente do PyTorch, instale uma compilação compatível dentro do ambiente virtual após o término da configuração.

### Windows PowerShell

O uso nativo no Windows é fornecido com base no melhor esforço:

```powershell
.\servers\tts\cosyvoice3\install-cosyvoice3.ps1
.\servers\tts\cosyvoice3\.venv\Scripts\python.exe servers\tts\cosyvoice3\server.py
```

O WSL2 é altamente recomendado para uso de GPUs NVIDIA no Windows. Os requisitos upstream instalam o ONNX Runtime apenas para CPU no Windows, enquanto Linux e WSL2 instalam pacotes com aceleração por GPU.

## Registrar no TomoriBot

Execute `/providers`, selecione `Adicionar Novo Endpoint Personalizado` e configure o endpoint de fala:

- Capacidade: `Speech`
- Compatibilidade de API: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8017`
- Modo de Origem de Voz: `Clone`
- Marcação de Script: `Plain`
- Suporta Instruções: `Yes`

Depois de salvar a conexão, selecione-a e adicione um modelo de Fala. Um identificador claro de modelo é `Fun-CosyVoice3-0.5B-2512`.

Em seguida, abra `/config` > Modelos > Alternar Modelos e ative o endpoint de fala do CosyVoice 3.

## Atribuir a voz de uma persona

Para clonagem de voz zero-shot:

1. Prepare um clipe de áudio limpo de 3 a 30 segundos com apenas um locutor e ruído de fundo mínimo.
2. Abra `/config` em Modelos > Parâmetros de TTS e Vozes e envie a amostra.
3. Insira a transcrição correspondente quando disponível. O CosyVoice 3 tokeniza essa transcrição como prefixo de prompt para clonagem zero-shot; ela deve descrever os primeiros 30 segundos do áudio.
4. Abra `/config` em Persona > Voz e atribua a amostra à persona.

O wrapper trunca o áudio de referência para os primeiros 30 segundos. A clonagem cross-lingual pode usar uma referência falada em um idioma diferente daquele do texto gerado.

## Testar com `/generate voice-message`

Use `/generate voice-message` para testar a síntese sem aguardar uma mensagem automática no chat. Você pode testar com a amostra atribuída à persona ou enviar um clipe avulso com sua respectiva transcrição.

Para orientar a emoção e a entonação, informe a direção no modal ou deixe o prompt da persona fornecer `voice_instructions`. Mantenha o texto falado como diálogo comum; tags de estilo embutidas são removidas antes da síntese.

## Variáveis de ambiente

| Variável | Padrão | Finalidade |
|---|---|---|
| `COSYVOICE3_MODEL_DIR` | `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B` | Diretório local do checkpoint |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Endereço de vinculação do wrapper; consulte [Acesso à rede](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `COSYVOICE3_PORT` | `8017` | Porta do wrapper |
| `COSYVOICE3_UPSTREAM_STREAM` | `0` | Habilita o gerador de streaming interno do CosyVoice |
| `COSYVOICE3_SPEED` | `1.0` | Multiplicador numérico global de velocidade repassado à inferência upstream |
| `COSYVOICE3_DEFAULT_INSTRUCT` | vazio | Instrução opcional aplicada caso a solicitação não forneça uma |
| `COSYVOICE3_FP16` | `0` | Solicita ao ambiente oficial a utilização do modo fp16 |
| `COSYVOICE3_LOAD_TRT` | `0` | Habilita o carregamento do TensorRT upstream quando devidamente configurado |
| `COSYVOICE3_LOAD_VLLM` | `0` | Habilita o carregamento do vLLM upstream quando suas dependências separadas estiverem instaladas |

Por padrão, TensorRT, vLLM e fp16 permanecem desativados. O ambiente padrão do PyTorch opera com tranquilidade em GPUs de 16 GB sem dependências adicionais de execução.

## Variantes de modelo

Para testar os pesos de RL inclusos, duplique o diretório do modelo, renomeie `llm.rl.pt` para `llm.pt` na cópia e aponte `COSYVOICE3_MODEL_DIR` para ele. Ambientes opcionais com vLLM e TensorRT exigem dependências separadas.

## Licença

A base de código do CosyVoice e os pesos `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` são disponibilizados sob a licença Apache-2.0.

O card upstream do modelo salienta que os materiais de demonstração destinam-se à avaliação acadêmica. O TomoriBot não distribui pesos de modelos. Revise o licenciamento e os termos do projeto upstream para o seu caso de uso específico antes de qualquer implantação comercial.
