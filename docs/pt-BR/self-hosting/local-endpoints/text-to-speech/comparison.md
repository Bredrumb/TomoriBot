---
title: "Comparação de Motores TTS"
aiGenerated: false
sidebar:
  order: 1
---

Compare os tempos de síntese e as amostras de áudio do mesmo ambiente de teste abaixo.

## Clonagem de Voz Multilíngue e em Inglês

### Prompts de Benchmark

- **Prompt Padrão** *(usado para Chatterbox Standard/Turbo/Nano, MOSS-TTS, CosyVoice 3, VoxCPM2 e Qwen3-TTS)*:
  > *"Pain and pleasure are two sides of the same coin. Go on now... flip it. Either way, I'll let you feel all of me."*
- **Prompt do Fish Audio S2 Pro** *(testado com tags de expressão entre colchetes)*:
  > *"Pain and pleasure are two sides of the same coin. [laughs] Go on now... flip it. [whispers] Either way, I'll let you feel all of me."*

### Desempenho e Comparação de Áudio

Os tempos informam a duração total de geração (segundos cronometrados desde a requisição até o áudio finalizado) e o Real-Time Factor (RTF), definido como o tempo de geração dividido pela duração do áudio:

- **RTF < 1.0 (negrito):** O motor gera a fala mais rápido do que em tempo real (por exemplo, `0.50× RTF` renderiza um clipe de 10 segundos em 5 segundos). Apenas esses motores conseguiriam acompanhar uma chamada de voz ao vivo, funcionalidade que o TomoriBot não implementa atualmente.
- **RTF > 1.0:** A geração demora mais tempo do que o áudio falado. O TomoriBot envia cada mensagem de voz como um arquivo completo, portanto um RTF maior significa apenas uma espera mais longa.

| Motor | Windows Nativo<sup>(1)</sup><br/>(RTX 4070 Ti SUPER) | Linux / WSL2 | macOS<br/>(Apple Silicon) | Amostra de Áudio |
|---|---|---|---|---|
| [Fish Audio S2 Pro](/self-hosting/local-endpoints/text-to-speech/fishs2/) | ~8-10 min<sup>(2)</sup><br/>*(~65× RTF)* | Não testado | Não testado | <audio controls preload="none" src="/audio/tts/fish-s2-pro.wav"></audio> |
| [Chatterbox (Turbo, Padrão)](/self-hosting/local-endpoints/text-to-speech/chatterbox/) | ~5.0s *(clipe de 8.7s)*<br/>0.57× RTF | Não testado | Não testado | <audio controls preload="none" src="/audio/tts/chatterbox-turbo.wav"></audio> |
| [Chatterbox (Nano)](/self-hosting/local-endpoints/text-to-speech/chatterbox/) | ~3.0s *(clipe de 8.0s)*<br/>0.38× RTF | Não testado | Não testado | <audio controls preload="none" src="/audio/tts/chatterbox-nano.wav"></audio> |
| [Chatterbox (Standard)](/self-hosting/local-endpoints/text-to-speech/chatterbox/) | ~6.0s *(clipe de 7.8s)*<br/>0.77× RTF | Não testado | Não testado | <audio controls preload="none" src="/audio/tts/chatterbox.wav"></audio> |
| [MOSS-TTS](/self-hosting/local-endpoints/text-to-speech/moss/) | ~12.0s *(clipe de 8.8s)*<br/>1.36× RTF | Não testado | Não testado | <audio controls preload="none" src="/audio/tts/moss-tts.wav"></audio> |
| [CosyVoice 3](/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) | ~6.0s *(clipe de 13.9s)*<br/>0.43× RTF | Não testado | Não testado | <audio controls preload="none" src="/audio/tts/cosy-voice-3.wav"></audio> |
| [VoxCPM2](/self-hosting/local-endpoints/text-to-speech/voxcpm2/) | ~8.0s *(clipe de 7.4s)*<br/>1.09× RTF | Não testado | Não testado | <audio controls preload="none" src="/audio/tts/voxcpm2.wav"></audio> |
| [Qwen3-TTS](/self-hosting/local-endpoints/text-to-speech/qwen3tts/) | ~10.0s *(clipe de 9.2s)*<br/>1.09× RTF | Não testado | Não testado | <audio controls preload="none" src="/audio/tts/qwen3-tts.wav"></audio> |

- <sup>(1)</sup> **Ambiente de Teste**: NVIDIA GeForce RTX 4070 Ti SUPER (16 GB GDDR6X, Ada Lovelace) no Windows 11 (execução nativa) usando uma amostra de áudio de referência mono de 24 kHz com 26,6 segundos e transcrição literal correspondente.
- <sup>(2)</sup> **Fish Audio S2 Pro**: A execução no Windows roda em modo eager não compilado (~65× RTF) devido à latência de inicialização de kernels CUDA ao longo de suas 76 avaliações de camada por token. Recomenda-se a execução no Linux ou WSL2 com fusão de compilador OpenAI Triton (`torch.compile`) para evitar esse travamento de despacho.

---

## Clonagem de Voz em Japonês

### Prompt de Benchmark em Japonês

> *「そんな顔して……ほんとは私にやられたいんでしょ？ざぁこざぁこ～♡」*

### Desempenho e Comparação de Áudio em Japonês

| Motor | Windows Nativo<sup>(1)</sup><br/>(RTX 4070 Ti SUPER) | Linux / WSL2 | macOS<br/>(Apple Silicon) | Amostra de Áudio |
|---|---|---|---|---|
| [IrodoriTTS](/self-hosting/local-endpoints/text-to-speech/irodoritts/) | ~4.0s *(clipe de 8.5s)*<br/>0.47× RTF | Não testado | Não testado | <audio controls preload="none" src="/audio/tts/irodori.wav"></audio> |

- <sup>(1)</sup> Medido no mesmo ambiente de teste com RTX 4070 Ti SUPER no Windows 11.

---

## Compare os Motores

O TomoriBot retorna arquivos WAV completos. Os tamanhos de modelos indicam a contagem de parâmetros; os números de memória de GPU são orientações de configuração. Os tempos acima foram obtidos em uma única máquina com Windows.

As durações de referência incluem recomendações upstream e limites de tempo de execução. Consulte o guia de cada motor para mais detalhes.

| Motor | Tamanho do modelo; GPU de 16 GB | Idiomas | Clipe de referência | Fontes de voz e controles | Velocidade / caminho de streaming | Escolha para |
|---|---|---|---|---|---|---|
| [Chatterbox](/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 350M Turbo (padrão), 110M Nano ou 500M Standard; sim, Nano pode usar CPU | Inglês | 10 segundos; durações maiores são ignoradas silenciosamente após a janela de prompt de 10 s | Clonagem por referência, tags de evento suportadas; o modelo Standard oferece CFG/exagero | Foco em velocidade/tamanho reduzido; wrapper retorna WAV completo | Configuração enxuta de clonagem em inglês ou experimentos em CPU |
| [Qwen3-TTS](/self-hosting/local-endpoints/text-to-speech/qwen3tts/) | 1.7B por modo; sim, modelos alternam | 10, incluindo inglês/japonês | A partir de 3 segundos; sem limite documentado | Clonagem ou VoiceDesign descrito em texto | Foco em qualidade; streaming upstream, buffer no wrapper | Clonagem multilíngue de uso geral e VoiceDesign em japonês |
| [MOSS-TTS](/self-hosting/local-endpoints/text-to-speech/moss/) | 4B clone + ~1.7B design, alternados; 16 GB é um alvo de teste não verificado; 8B topo de linha provavelmente não | Clonagem: 31, incluindo japonês; design: inglês/chinês | Não documentado upstream; sem limite em tempo de execução | Clonagem ou VoiceGenerator descrito em texto; tags de idioma na clonagem | Experimental; clone local tem backend de streaming upstream, buffer no wrapper | Comparar qualidade de clonagem do MOSS ou design de voz em inglês/chinês |
| [IrodoriTTS](/self-hosting/local-endpoints/text-to-speech/irodoritts/) | ~0.8B na v4.1 Small atual; ~3-4 GB de VRAM observados em execução local | Apenas japonês | ~30 segundos; truncado no limite de 120 s do checkpoint | Clonagem ou VoiceDesign; indicações de estilo por emoji | Passos de amostragem equilibram qualidade e velocidade; buffer no wrapper | Vozes em japonês com baixo consumo e interpretação guiada por emojis |
| [Fish S2 Pro](/self-hosting/local-endpoints/text-to-speech/fishs2/) | 4B; padrão oficial BF16 (~16-18 GB), INT8 opcional para 16 GB | 83 declarados upstream | 10-30 segundos; sem limite em tempo de execução | Clonagem por referência (requer transcrição de referência), tags de expressão livres entre colchetes | Modelo Dual-AR pesado; requer Linux/WSL2 com Triton para síntese rápida (~65× RTF no modo eager do Windows) | Clonagem expressiva com controle fino; verifique os termos da licença de pesquisa |
| [VoxCPM2](/self-hosting/local-endpoints/text-to-speech/voxcpm2/) | 2B; ~8 GB BF16 relatados upstream | 30 | 5-30 segundos; intervalo documentado, sem limite em tempo de execução | Clonagem, Voice Design, Ultimate Cloning assistida por transcrição, instruções de entonação | ~0.30 RTF em RTX 4090 upstream; streaming upstream, buffer no wrapper | Modelo multilíngue único com os controles mais amplos de fonte de voz |
| [CosyVoice 3](/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) | 0.5B no núcleo; 16 GB confortável, download/tempo de execução maiores | 9, incluindo japonês, além de dialetos chineses | 3-30 segundos; durações maiores são truncadas para os primeiros 30 s | Clonagem, clonagem cross-lingual, entonação por linguagem natural | Foco em baixa latência; streaming nativo de texto/áudio upstream, buffer no wrapper | Candidato promissor para streaming com clonagem cross-lingual |

O tamanho dos modelos e a contagem de idiomas seguem as páginas upstream de [Chatterbox](https://github.com/resemble-ai/chatterbox), [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS), [MOSS](https://github.com/OpenMOSS/MOSS-TTS), [Irodori](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small), [Fish S2 Pro](https://huggingface.co/fishaudio/s2-pro), [VoxCPM2](https://huggingface.co/openbmb/VoxCPM2) e [CosyVoice 3](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512). Consulte cada guia para obter detalhes sobre SO, drivers, licença, revisão de modelo e memória. Uma GPU de 16 GB não comporta necessariamente um modelo de TTS e um LLM local grande de forma simultânea.

A primeira solicitação do modo automático do Qwen3-TTS inclui o carregamento do modelo. O MOSS pré-baixa ambos os modelos durante a configuração e pré-aquece o modelo de clonagem na inicialização por padrão, mas qualquer um dos servidores automáticos ainda precisará carregar o outro modelo após uma troca de modo. O TomoriBot aguarda até `TTS_SYNTHESIZE_TIMEOUT_MS` (padrão 240000 ms) por cada resposta completa.
