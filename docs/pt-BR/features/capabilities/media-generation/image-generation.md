---
title: "Geração de Imagens"
sidebar:
  order: 1
---

A TomoriBot pode gerar imagens a partir de um prompt de texto ou editando uma imagem de referência. Use
`/generate image`, ou simplesmente peça a ela ("desenhe um panda-vermelho tomando café").

## O Que Ela Pode Fazer

- **Texto-para-imagem**: gera a partir de um prompt.
- **Imagem-para-imagem**: edita ou reestiliza uma imagem de referência inteira.
- **Inpainting**: redesenha uma região específica preservando o restante.
- **Outpainting**: estende a tela além do quadro original.
- **Proporções de aspecto personalizáveis**.
- **Imagens de referência** podem vir de anexos de mensagem, figurinhas, emojis ou
  avatares de usuários/personas. Aponte-a para uma mensagem, ou nomeie um usuário/persona para
  usar o avatar como referência.

Os modos de edição disponíveis dependem do backend. Texto-para-imagem e imagem-para-imagem
funcionam nos provedores de nuvem integrados (Google, Vertex, OpenRouter), enquanto **inpainting e
outpainting são fornecidos por endpoints personalizados locais do [ComfyUI](/pt-BR/self-hosting/local-endpoints/setup-comfyui/)**
e são restritos pelas capacidades declaradas desse endpoint. O que quer que o backend não consiga fazer
é simplesmente ocultado dela, então ela não oferecerá um modo que sua configuração não suporta.

Quando ela gera uma imagem, usa o contexto de Aparência Física da sua persona, além de tags positivas
e negativas padrão (onde o backend suporta prompts negativos). O resultado é
entregue como uma galeria de mídia do Discord com detalhes do momento da geração, incluindo quaisquer
usuários ou personas referenciados.

## Personalização de Tags
<!-- anchor: tag-customization -->

Cada fonte de tags acima é editável, cada uma em um escopo diferente. Todas abrem um modal
pré-preenchido com as tags atuais, para que você edite no lugar:

- **`/config` > Persona > Appearance**: as tags de **Aparência Física** da persona selecionada (como *ela*
  se parece). Requer a permissão Gerenciar Servidor.
- **`/personal config`**: *suas próprias* tags de aparência, aplicadas quando uma geração
  faz referência a você. Seguem você em todos os servidores (veja
  [Personalização](/pt-BR/features/knowledge/personalization/)).
- **Tags positivas e negativas padrão** em **`/config` > Models > Image Generation Defaults**:
  as tags padrão do servidor inteiro adicionadas (ou evitadas) em cada geração. Tags negativas
  só têm efeito quando o backend suporta prompts negativos. Enviar o modal com uma
  caixa vazia redefine essa lista para os padrões integrados.

## Configuração

1. Configure um modelo de imagem com `/config` > Models > Switch Models.
2. Certifique-se de que a geração de imagens está permitida, pois ela é controlada pela capacidade `imagegen_enabled`
   (`/config` > Permissions).
3. Peça a ela para gerar, ou execute `/generate image`.

## Suporte de Provedores

A geração nativa de imagens está disponível no **Google, Vertex AI, Vertex AI Express, OpenRouter,
Z.ai, NVIDIA NIM** e **NovelAI** (estilo anime; inpainting nativo está implementado e chegando
em breve, atualmente desabilitado enquanto a mesclagem de bordas é refinada). Para a matriz completa de
suporte e como adicionar um provedor, veja
[Provedores & Modelos](/pt-BR/features/setup-administration/providers-and-models/#supported-providers).

Para geração de imagem **local** com seu próprio hardware via ComfyUI, veja
[Configuração: ComfyUI](/pt-BR/self-hosting/local-endpoints/setup-comfyui/).
