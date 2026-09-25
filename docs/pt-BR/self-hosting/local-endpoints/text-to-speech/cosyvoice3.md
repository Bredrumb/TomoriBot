---
title: "CosyVoice 3"
aiGenerated: true
---

O CosyVoice 3 é a atual geração do projeto de TTS (Text-to-Speech) multilíngue CosyVoice da Alibaba/QwenAudio. O TomoriBot encapsula o runtime oficial em `servers/tts/cosyvoice3/` e expõe a mesma interface `POST /synthesize` usada pelos outros endpoints de fala locais.

O TomoriBot usa como padrão o checkpoint oficial **`FunAudioLLM/Fun-CosyVoice3-0.5B-2512`**. Este é o lançamento atual do CosyVoice 3 recomendado pelos criadores (upstream), usa o modelo não quantizado normal e é pequeno o suficiente para rodar confortavelmente em uma GPU NVIDIA de 16 GB, mantendo intacto o design de baixa latência do CosyVoice.

## O que ele suporta

O lançamento atual do CosyVoice 3 suporta:

- Chinês, Inglês, Japonês, Coreano, Alemão, Espanhol, Francês, Italiano e Russo
- Mais de 18 dialetos e sotaques chineses
- Clonagem de voz zero-shot
- Clonagem de voz multilíngue e cross-lingual
- Instruções em linguagem natural para idioma, dialeto, emoção, velocidade da fala e volume
- Controles refinados no runtime upstream, incluindo `[breath]` e `[laughter]`
- Streaming de entrada de texto e saída de áudio no runtime upstream

Os exemplos oficiais do CosyVoice 3 incluem atualmente uma ressalva importante para o japonês: o texto em japonês é exibido após a conversão para katakana. O japonês é um idioma suportado, mas se a ortografia normal do japonês resultar em uma pronúncia ruim, converter o texto da síntese para katakana é a solução alternativa recomendada pelo upstream.

## Como o TomoriBot mapeia as solicitações

O wrapper aceita os campos normais de `tts-clone`:

- `text`
- `ref_audio`
- `ref_text`
- `instruct`
- `language`

Ele escolhe a API atual do CosyVoice 3 da seguinte maneira:

| Solicitação | Caminho do CosyVoice 3 |
|---|---|
| Áudio de referência + transcrição | `inference_zero_shot` |
| Áudio de referência sem transcrição | `inference_cross_lingual` |
| `instruct` ou `language` explícito | `inference_instruct2` |

Para obter a melhor qualidade de clonagem comum, forneça tanto o áudio de referência quanto a sua transcrição correspondente. A API de instrução atual do CosyVoice 3 é condicionada ao áudio de referência, mas não aceita também a transcrição de referência, portanto, as solicitações que usam `instruct` mudam para o caminho oficial `inference_instruct2`.

### Controles de estilo e emoção

Registre o endpoint com a marcação de script (Script Markup) **Plain**. A direção de entrega (delivery direction) pertence ao campo `voice_instructions` global do endpoint, e não a tags arbitrárias de colchetes no meio da frase. Isso preserva o significado da instrução para toda a declaração e evita tratar um script como `[happy] Hello. [sad] Goodbye.` como duas instruções globais contraditórias. O suporte nativo a `[breath]` e `[laughter]` é intencionalmente adiado até que o TomoriBot possa anunciar uma capacidade exata de tag ciente do provedor.

O campo `instruct` do `/synthesize` é passado para o condicionamento de instrução do CosyVoice 3. Os exemplos incluem `sound relieved but still tired`, `speak as quickly as possible` ou `speak quietly with restrained excitement`.

## Streaming

O CosyVoice 3 suporta streaming bidirecional no upstream. O projeto documenta tanto o streaming de entrada de texto quanto o streaming de saída de áudio, com latência para o primeiro áudio de cerca de 150 ms em sua configuração otimizada.

A interface TTS personalizada atual do TomoriBot espera uma resposta de áudio completa para uma mensagem de voz no Discord, então este servidor retorna um WAV completo e define a inferência upstream como padrão para `stream=False`. Defina `COSYVOICE3_UPSTREAM_STREAM=1` apenas ao testar o gerador upstream; isso não reduz a latência de resposta do TomoriBot até que exista um transporte de voz por streaming.

## Hardware

Ponto de partida recomendado para o TomoriBot:

- GPU NVIDIA com **16 GB de VRAM**
- Python **3.10**
- Driver NVIDIA recente compatível com CUDA 12
- `git`
- `ffmpeg` para normalização de amostra de voz do TomoriBot
- `sox` e `libsox-dev` no Linux, caso ocorram problemas de compatibilidade de áudio upstream

O modelo em si tem 0.5B de parâmetros e não precisa de quantização para caber em uma placa de 16 GB. O download do checkpoint do Hugging Face é muito maior do que a contagem de parâmetros sugere, porque ele também inclui o modelo de fluxo (flow model), os tokenizadores de fala, o modelo de texto em inglês e ambos os pesos LLM base e RL. Reserve cerca de 10 GB de espaço em disco para o pacote de modelo atual, além do ambiente Python e runtime (tempo de execução).

A inferência na CPU é possível através do runtime upstream, mas não é o caminho recomendado para o uso de voz de baixa latência no Discord.

## Instalação

### Linux / WSL2 (recomendado)

A partir da raiz do repositório do TomoriBot:

```bash
bash servers/tts/cosyvoice3/install-cosyvoice3.sh
servers/tts/cosyvoice3/.venv/bin/python servers/tts/cosyvoice3/server.py
```

Ou inicie o servidor configurado e o TomoriBot juntos:

```bash
bun run launch --cosyvoice3
```

O instalador:

1. faz o checkout do commit revisado `074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc` do `QwenAudio/CosyVoice` recursivamente em `servers/tts/cosyvoice3/CosyVoice/`;
2. cria `servers/tts/cosyvoice3/.venv`;
3. instala os requisitos atuais do CosyVoice upstream, mais o pequeno conjunto de dependências do wrapper; e
4. baixa o `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` na revisão `29e01c4e8d000f4bcd70751be16fa94bf3d85a18` do Hugging Face em `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B/`.

Novas execuções mantêm exatamente essas revisões; migrar para revisões mais novas significa alterar os dois pins no instalador. O instalador se recusa a reinstalar sobre um checkout do runtime que tenha alterações locais.

Os requisitos upstream atualmente usam o PyTorch 2.3.1 com o índice de pacotes do CUDA 12.1, pacotes CUDA 12 do ONNX Runtime no Linux e pacotes do TensorRT 10.13 no Linux. Se você estiver usando um hardware que exija uma compilação (build) mais recente do PyTorch para CUDA, instale uma compilação compatível do PyTorch no venv do servidor após os requisitos upstream e teste-a com seu driver.

### Windows PowerShell

O Windows nativo é fornecido como um caminho de "melhor esforço" (best-effort):

```powershell
.\servers\tts\cosyvoice3\install-cosyvoice3.ps1
.\servers\tts\cosyvoice3\.venv\Scripts\python.exe servers\tts\cosyvoice3\server.py
```

Para o uso de GPU NVIDIA, **o WSL2 é recomendado**. Os requisitos atuais do upstream instalam a GPU ONNX Runtime no Linux, mas a CPU ONNX Runtime no Windows, então o WSL2 corresponde mais fielmente à configuração que o projeto CosyVoice otimiza e testa para obter baixa latência.

## Registrar no TomoriBot

Execute `/providers`, escolha `Adicionar Novo Endpoint Personalizado` (Adicionar Novo Endpoint Personalizado) e configure o endpoint de fala:

- Capability: `Speech`
- API Compatibility: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8017`
- Voice Source Mode: `Clone`
- Script Markup: `Plain`
- Supports Instruct: `Yes`

Após salvar a conexão, selecione-a e adicione um modelo (model) de Speech. Um código de modelo claro é `Fun-CosyVoice3-0.5B-2512`.

Em seguida, abra `/config` > Models > Switch Models e ative o endpoint de fala do CosyVoice 3.

## Atribuir uma voz de persona

Para a clonagem zero-shot normal:

1. Prepare uma amostra limpa de 3 a 30 segundos com um locutor e pouco ou nenhum ruído de fundo.
2. Abra `/config` em Models > TTS Parameters & Voices e envie a amostra.
3. Insira a transcrição correspondente quando possível. O CosyVoice 3 usa isso para o caminho zero-shot com suporte de transcrição, e ela é tokenizada como prefixo de prompt, então deve descrever o áudio que é realmente usado: os primeiros 30 segundos do clipe.
4. Abra `/config` em Persona > Voice e atribua essa amostra à persona.

O tokenizador de fala do CosyVoice trabalha com uma janela de prompt de 30 segundos, e o upstream a impõe ao falhar: a própria interface web do upstream orienta manter o áudio de prompt abaixo de 30 segundos, e o tokenizador afirma esse limite em vez de encurtar o áudio em si. O servidor local corta, então um clipe mais longo é cortado nos primeiros 30 segundos, a síntese continua e o corte é registrado no console do servidor.

O corte lê o clipe no próprio lugar, o que significa que o embedding de locutor é obtido dos mesmos 30 segundos iniciais usados como tokens de fala do prompt. É esse par que o CosyVoice usa como condicionamento, então uma referência longa não perde nada que o motor teria usado. O efeito prático é que apenas os 30 segundos iniciais de um upload longo condicionam a voz, enquanto o restante é enviado e armazenado sem ser usado.

Manter a amostra atribuída entre 10 e 20 segundos permanece dentro da janela com folga, o que também mantém a transcrição armazenada alinhada com o áudio que o modelo lê.

A clonagem cross-lingual é suportada. O locutor de referência pode falar um idioma diferente do texto gerado. Se uma transcrição de referência não estiver disponível, o wrapper usa o caminho cross-lingual dedicado do CosyVoice 3.

## Testar com `/generate voice-message`

Use `/generate voice-message` para testar o endpoint ativo sem esperar por um turno de bate-papo normal para que a ferramenta de voz seja escolhida. Você pode usar a amostra configurada da persona ou enviar uma amostra única. Ao enviar uma amostra, forneça a sua transcrição no modal, quando possível.

Para uma entrega expressiva, insira uma direção de entrega global no modal ou deixe a ferramenta de voz enviar `voice_instructions`. Mantenha o script falado como texto simples; as tags de estilo arbitrárias inline são removidas antes da síntese em vez de serem interpretadas incorretamente como instruções para toda a declaração.

## Variáveis de ambiente

| Variável | Padrão | Propósito |
|---|---|---|
| `COSYVOICE3_MODEL_DIR` | `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B` | Diretório de checkpoint local |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Endereço de bind do wrapper; consulte [Acesso de rede](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `COSYVOICE3_PORT` | `8017` | Porta do wrapper |
| `COSYVOICE3_UPSTREAM_STREAM` | `0` | Habilitar o gerador de streaming interno do CosyVoice |
| `COSYVOICE3_SPEED` | `1.0` | Multiplicador numérico global de velocidade passado para inferência upstream |
| `COSYVOICE3_DEFAULT_INSTRUCT` | vazio | Instrução opcional adicionada quando uma solicitação não a fornece |
| `COSYVOICE3_FP16` | `0` | Pedir para o runtime oficial usar seu modo fp16 |
| `COSYVOICE3_LOAD_TRT` | `0` | Habilitar carregamento upstream de TensorRT quando devidamente preparado |
| `COSYVOICE3_LOAD_VLLM` | `0` | Habilitar carregamento upstream de vLLM quando suas dependências separadas estiverem instaladas |

O padrão mantém TensorRT, vLLM e fp16 desligados. O runtime do PyTorch normal já se encaixa na GPU alvo de 16 GB, é mais simples de instalar e evita que o caminho padrão se torne uma configuração de otimização específica para hospedagem própria.

## Desempenho e variantes do modelo

### Padrão: base `Fun-CosyVoice3-0.5B-2512`

Este é o padrão recomendado para o TomoriBot. Tem forte similaridade com o locutor, suporta todos os modos atuais de clonagem e instrução do CosyVoice 3 e não precisa de quantização em uma GPU de 16 GB.

### Peso RL

O pacote de checkpoint atual também inclui `llm.rl.pt`. O upstream publica os resultados base e RL separadamente. O peso RL melhora algumas métricas de erro de conteúdo, enquanto o resultado base retém pontuações ligeiramente mais fortes de similaridade de locutor na tabela publicada. Como o TomoriBot enfatiza a clonagem de voz de persona, o wrapper deixa o `llm.pt` normal como padrão.

O carregador oficial atual sempre lê um arquivo chamado `llm.pt`. Para experimentar o peso RL sem substituir a instalação padrão, copie o diretório do modelo, substitua o `llm.pt` da cópia pelo `llm.rl.pt` e aponte `COSYVOICE3_MODEL_DIR` para essa cópia.

### vLLM e TensorRT

O CosyVoice 3 também suporta caminhos opcionais vLLM e TensorRT. Atualmente, o upstream documenta o vLLM 0.11.x+ usando o motor V1 e o vLLM 0.9.0 como o caminho legado. Esses runtimes têm restrições adicionais de versão e hardware, de modo que o TomoriBot não os instala ou habilita por padrão.

Use-os apenas depois que o servidor comum do PyTorch estiver funcionando. Para uma carga de trabalho de mensagens de voz no Discord, evitar complexidade adicional de runtime geralmente é mais útil do que otimizar um modelo já pequeno de 0.5B.

## Licença

O repositório de código atual do CosyVoice é licenciado sob a **Apache License 2.0**, e o repositório Hugging Face `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` também está marcado como **Apache-2.0**.

O model card upstream também contém um aviso (disclaimer) afirmando que o conteúdo exibido é para demonstração acadêmica e que alguns exemplos podem vir da internet. Uma discussão aberta upstream pede uma clarificação explícita sobre como esse aviso se relaciona com o uso comercial dos pesos. O TomoriBot não redistribui o modelo. Os usuários de hospedagem própria devem revisar as licenças e os termos do model card atuais do upstream para sua própria implementação, especialmente antes de qualquer uso comercial.
