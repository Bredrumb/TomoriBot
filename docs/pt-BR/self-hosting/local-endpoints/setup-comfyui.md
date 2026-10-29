---
title: "Configuração: ComfyUI"
aiGenerated: false
sidebar:
  label: "ComfyUI"
  order: 2
---

O TomoriBot pode gerar imagens e vídeos através da sua própria instância do
[ComfyUI](https://github.com/comfyanonymous/ComfyUI). Ele controla o ComfyUI enviando
um fluxo de trabalho no formato de API com seu prompt e tamanho substituídos, e depois consulta
o endpoint `/history` do ComfyUI até que a saída esteja pronta.

Este guia aborda a instalação/execução do ComfyUI e seu registro. Para criar ou editar
um fluxo de trabalho compatível com o TomoriBot (os marcadores `{TOMORI_*}`), use o
[README de fluxos de trabalho](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows)
no GitHub.

:::note[Nenhuma variável de ambiente necessária]
O ComfyUI é registrado por meio de comandos de barra do Discord e armazenado de forma criptografada no banco de dados.
Consulte a [central de endpoints locais](/self-hosting/local-endpoints/).
:::

## Requisitos de hardware

A geração de imagens e vídeos exige bastante da GPU: o custo mais pesado é a VRAM (a memória da sua placa de vídeo,
separada da RAM do sistema), determinada pelo checkpoint do modelo que seu fluxo de trabalho carrega.
Uma GPU NVIDIA é altamente recomendada. Os dois fluxos de trabalho que acompanham o TomoriBot
são modelos modernos e mais pesados que o SDXL:

| Fluxo de trabalho incluso | Modelo base | VRAM prática | Notas |
|---|---|---|---|
| Anima v1 (imagem) | Qwen-Image (~20B), fp8 | ~16 GB mínimo · 24 GB confortável | Codificador de texto + VAE adicionam ~8-10 GB de sobrecarga. Abaixo de 16 GB, use uma versão GGUF + `--lowvram`. |
| Loop WAN i2v (vídeo) | Wan 2.2 14B, fp8 + LoRAs LightX2V de 4 passos | ~16 GB viável · 24 GB+ confortável | Opção mais pesada, espere minutos por clipe. Descarregue o codificador de texto UMT5 na RAM (`t5_cpu`, requer 24 GB+ de RAM do sistema) em placas menores. |

Ambos os checkpoints inclusos já estão quantizados em fp8 para caber em placas de consumidor. Se você tiver menos
VRAM, troque a UNET por uma quantização menor e ative o `--lowvram` / descarregamento para CPU do ComfyUI. A difusão apenas
por CPU é impraticável (muitos minutos por imagem, ainda pior para vídeo) e pode ultrapassar a janela de consulta do TomoriBot,
de modo que uma GPU é efetivamente necessária para uso regular.

:::tip[Reduzindo ainda mais: escolha uma quantização GGUF]
Para reduzir ainda mais, baixe uma
versão GGUF do modelo no Hugging Face: o código em nomes como `Q4_K_M` / `Q5_K_M` indica a
quantidade de bits por peso, e 4 bits (Q4) ou 5 bits (Q5) costuma ser o ponto ideal com a maior parte da qualidade
por uma fração do tamanho de fp8/fp16. Carregar
UNETs GGUF no ComfyUI requer o nó personalizado [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF).
:::

## 1. Execute o ComfyUI com a API habilitada

Instale o ComfyUI de acordo com o [README dele](https://github.com/comfyanonymous/ComfyUI) e inicie-o para
que escute na rede:

```sh
python main.py --listen 0.0.0.0 --port 8188
```

O parâmetro `--listen 0.0.0.0` é importante se o TomoriBot rodar no Docker ou em uma máquina diferente: o
padrão se vincula apenas ao loopback. Confirme a acessibilidade a partir da máquina em que o bot é executado:

```sh
curl http://127.0.0.1:8188/system_stats
```

Se quiser testar, carregue os checkpoints do modelo esperados pelo fluxo de trabalho escolhido e faça uma geração manual na
interface web do ComfyUI para confirmar que tudo funciona de ponta a ponta antes de integrar ao TomoriBot.

## 2. Obtenha um fluxo de trabalho do TomoriBot

Baixe um fluxo de trabalho pronto para uso no formato de API. Exemplos podem ser encontrados no repositório em
[`assets/comfyui-workflows/`](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows):

| Fluxo de trabalho | Modos |
|----------|-------|
| Anima v1 (imagem) : `tomoribot-anima-v1-comfyui.json` | `txt2img`, `img2img`, `inpaint` |
| Loop WAN i2v (vídeo) : `tomoribot-wan-i2v-loop-video.json` | imagem para vídeo |

Eles estão no formato de API (o JSON exportado pelo ComfyUI via *Save (API Format)*), não no formato de
salvamento normal da interface. Se criar o seu próprio, ele deverá conter os marcadores `{TOMORI_*}` que o
TomoriBot substitui (prompt, largura/altura, seed, imagens de referência, etc.). Consulte o
[README de fluxos de trabalho](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows) e a
página `Endpoints Personalizados` sob `Provedores` em `/help`.

## 3. Registre-o no Discord

Execute `/providers` (ou `/personal providers`), escolha `Adicionar Novo Endpoint Personalizado` e insira:

| Campo | Valor para ComfyUI |
|-------|-------------------|
| `endpoint_label` | Um nome de sua escolha, por exemplo `home-comfy` |
| Compatibilidade de API | `ComfyUI` |
| `endpoint_url` | `http://127.0.0.1:8188` (raiz, sem `/v1`) |
| `auth_token` | *(deixe em branco a menos que seu ComfyUI esteja protegido por autenticação)* |

Depois de salvar a conexão, selecione-a e escolha `+ Adicionar novo Modelo de Imagem` ou `+ Adicionar novo Modelo de Vídeo`
no menu suspenso de modelos. Insira o codinome exato do checkpoint e faça upload do arquivo `.json` do fluxo de trabalho
baixado no Passo 2 em `Fluxo de Trabalho ComfyUI`. A capacidade do modelo deve corresponder ao fluxo de trabalho (fluxo de
imagem → `image`, fluxo de vídeo → `video`).

A adição do modelo o torna o modelo de `image`/`video` ativo automaticamente. Acione a geração conversando diretamente com a Tomori no chat. Se ele não estiver ativo por algum motivo, execute `/config` > Modelos > Alternar Modelos
e selecione o endpoint do ComfyUI registrado.

## Solução de problemas

- **Inacessível ao adicionar:** O ComfyUI foi vinculado ao loopback enquanto o bot está no Docker ou em outro
  host. Inicie-o com `--listen 0.0.0.0` e use `http://host.docker.internal:8188` ou o
  IP da LAN.
- **A geração nunca termina:** O TomoriBot consulta `/history` até que a saída apareça. Inicializações
  a frio e modelos grandes na CPU podem exceder a janela de consulta.
- **Prompt/tamanho ignorado ou tamanho de saída incorreto:** o fluxo de trabalho não possui os marcadores
  obrigatórios `{TOMORI_*}`, ou você fez upload de uma exportação no formato de interface em vez do formato de API.
- **Capacidade incorreta:** um fluxo de trabalho de `image` registrado sob `video` (ou vice-versa) não
  funcionará. Adicione-o novamente sob a capacidade correspondente.
