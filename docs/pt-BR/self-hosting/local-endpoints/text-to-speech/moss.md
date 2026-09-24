---
title: "MOSS-TTS"
---

Use `servers/tts/moss/server.py` para testar a clonagem de voz MOSS e o design de voz descrito por texto por meio de um endpoint local. O modo automático (*Auto*) seleciona o modelo de clonagem quando o TomoriBot envia `ref_audio` e o MOSS-VoiceGenerator quando ele envia `instruct`. Ele mantém apenas um modelo carregado por vez. Este é um sidecar de teste, não uma integração de bate-papo por voz de Discord via streaming.

O modelo de clonagem padrão é o [MOSS-TTS-Local-Transformer-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Local-Transformer-v1.5) (4B), escolhido como ponto de partida prático para uma GPU de 16 GB. O [MOSS-TTS-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-v1.5) é uma alternativa de 8B, mas geralmente precisará de mais de 16 GB de VRAM no formato BF16. O design de voz usa o [MOSS-VoiceGenerator](https://huggingface.co/OpenMOSS-Team/MOSS-VoiceGenerator) (cerca de 1,7B). O modo automático troca os modelos em vez de manter ambos na VRAM, portanto, uma mudança de modo ainda incorre em um atraso de carregamento na GPU.

## Configuração

Execute a partir da raiz do repositório do TomoriBot. Use Python 3.12 e um driver CUDA compatível com os pacotes (*wheels*) do PyTorch *upstream* para CUDA 12.8. As dependências extras de runtime *upstream* fixam o PyTorch e o Torchaudio 2.9.1+cu128; mantenha este sidecar em seu próprio ambiente virtual. Outras pilhas (*stacks*) CUDA ou de CPU requerem uma instalação validada separadamente.

### Windows PowerShell

```powershell
python -m venv servers\tts\moss\.venv
servers\tts\moss\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers\tts\moss\requirements.txt
python servers\tts\moss\prefetch_models.py
python servers\tts\moss\server.py
```

### Linux ou WSL Bash

```bash
python3.12 -m venv servers/tts/moss/.venv
source servers/tts/moss/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers/tts/moss/requirements.txt
python servers/tts/moss/prefetch_models.py
python servers/tts/moss/server.py
```

O comando de prefetch (pré-busca) baixa o modelo de clonagem, o VoiceGenerator e o tokenizador de áudio de cada modelo no cache do Hugging Face antes do servidor iniciar. Ele verifica o espaço disponível em disco no volume do cache antes de cada download do repositório e reutiliza os arquivos em cache, mas ambos os modelos precisam de espaço substancial. Se a verificação falhar, libere espaço ou defina `HF_HOME` para um volume maior no shell antes de realizar o prefetch e iniciar o servidor. Execute o prefetch novamente após alterar o ID de qualquer um dos modelos. Para baixar apenas um modo para um teste limitado, passe `--mode clone` ou `--mode voice-design`; o outro modo ainda pode ser baixado no primeiro uso.

O endpoint é `http://127.0.0.1:8018`, e `bun run launch --moss` inicia o servidor junto com o TomoriBot. O modo automático aquece o modelo de clonagem a partir do cache local antes de relatar que a inicialização foi concluída. Se o clone não tiver sido pré-buscado (*prefetched*), a inicialização falha em vez de baixá-lo inesperadamente. `MOSS_TTS_WARM_MODE=voice-design` aquece o VoiceGenerator em vez disso; `MOSS_TTS_WARM_MODE=none` mantém a inicialização preguiçosa (*lazy*) anterior. Apenas um modo permanece na memória da GPU. Verifique `GET /health` para `warm_mode`, `active_mode` e `model_id`. O wrapper usa o `trust_remote_code=True` do Hugging Face, portanto instale apenas de uma fonte que você confia e revise as mudanças do *upstream* antes de atualizar.

## Registrar no TomoriBot

Em `/providers`, escolha **Add New Custom Endpoint**, defina API Compatibility como `tts-clone` e use a URL do endpoint `http://127.0.0.1:8018`. Adicione um modelo de Speech com **Voice Source Mode** `Auto` e **Script Markup** `Plain`. Então ative-o em `/config` > Models > Switch Models.

Para clonagem, envie um clipe de referência limpo em `/config` > Models > TTS Parameters & Voices e atribua-o em Persona > Voice. O upstream não documenta nenhum comprimento de referência recomendado para o MOSS-TTS nem qualquer limite de duração em seu runtime, então o comprimento do clipe fica a seu critério; clipes curtos e limpos continuam sendo o padrão mais seguro. Para design de voz, salve uma descrição de voz em linguagem natural em Persona > Voice em vez disso. O MOSS-TTS usa a referência de áudio; ele não usa a transcrição de referência opcional do TomoriBot. O MOSS-VoiceGenerator está documentado para inglês e chinês, não para japonês. O modelo de clonagem 4B tem suporte a japonês, mas uma tag de idioma conhecida melhora a síntese multilíngue.

O adaptador de clonagem atual do TomoriBot não envia a tag de idioma. Para um teste com idioma único, defina `MOSS_TTS_DEFAULT_LANGUAGE=Japanese` (ou `English`, `Chinese`, etc.) antes de iniciar o servidor. Uma requisição `/synthesize` manual pode, em vez disso, fornecer o `language` por requisição. Deixe a variável sem definição para uso com idiomas mistos; avalie a saída em japonês antes de depender dela.

O sidecar lê seu próprio ambiente de processo. Adicionar um valor ao `.env` do bot não o passa automaticamente para um processo Python iniciado separadamente.

Para testar o modelo de 8B (flagship) em uma máquina com memória suficiente, defina `MOSS_TTS_CLONE_MODEL_ID=OpenMOSS-Team/MOSS-TTS-v1.5` antes de realizar o prefetch. `MOSS_TTS_PORT`, `MOSS_TTS_DEVICE`, `MOSS_TTS_DTYPE` e `MOSS_TTS_MAX_NEW_TOKENS` também são configuráveis em `.env.optional.example`. O `TTS_SYNTHESIZE_TIMEOUT_MS` do bot pode precisar ser aumentado para trocas de modo ou inferência na CPU.
