---
title: "Geração de Vídeos"
sidebar:
  order: 2
---

A TomoriBot pode gerar vídeos curtos a partir de um prompt de texto ou animando uma imagem de referência.
Use `/generate video`, ou simplesmente peça a ela.

## O Que Ela Pode Fazer

- **Texto-para-vídeo**: gera um clipe curto a partir de um prompt.
- **Imagem-para-vídeo**: anima uma imagem de referência (a primeira imagem de uma mensagem
  referenciada se torna o quadro inicial).
- **Imagem-para-vídeo em loop**: quando solicitado pelo chat, modelos compatíveis podem reutilizar a
  imagem inicial como o quadro final.
- **Proporções de aspecto personalizáveis**.

Imagem-para-vídeo e loop dependem das capacidades de primeiro/último quadro do modelo selecionado. A TomoriBot
verifica o catálogo atual de modelos de vídeo do OpenRouter antes de enviar um trabalho pago e pede para você remover
a imagem, desativar o loop ou selecionar um modelo compatível quando necessário.

A geração de vídeo usa um **fluxo de trabalho assíncrono com polling**: a solicitação é enviada e então
a TomoriBot consulta o provedor até que o clipe finalizado esteja pronto, e o publica quando concluído. Clipes
grandes podem demorar um pouco.

## Configuração

1. Configure um modelo de vídeo com `/config` > Models > Switch Models.
2. Certifique-se de que a geração de imagem/mídia está permitida via `/config` > Permissions.
3. Peça a ela para gerar, ou execute `/generate video`.

## Suporte de Provedores

A geração nativa de vídeo está disponível no **Google, OpenRouter** e **Z.ai**. Veja a matriz completa
em [Provedores & Modelos](/pt-BR/features/setup-administration/providers-and-models/#supported-providers).

Para geração de vídeo **local** via ComfyUI (por exemplo, workflows WAN de imagem-para-vídeo), veja
[Configuração: ComfyUI](/pt-BR/self-hosting/local-endpoints/setup-comfyui/).

Para a arquitetura interna de geração e polling, veja a referência sobre
[geração de vídeo](/en/architecture/subsystems/video-generation/).
