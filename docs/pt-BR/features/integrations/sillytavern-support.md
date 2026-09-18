---
title: "Suporte ao SillyTavern"
# Keyword-rich <title> targeting "SillyTavern character cards in Discord"
# queries; replaces Starlight's default for this page only. H1 and sidebar
# keep the plain title.
head:
  - tag: title
    content: "TomoriBot | Use SillyTavern Character Cards in Discord"
# Hand-written search snippet; overrides the auto-derived description from
# routeData.ts middleware.
description: "Importe cards de personagem e predefinições de prompt do SillyTavern no Discord com a TomoriBot. Traga seus personagens existentes para o seu servidor."
sidebar:
  order: 2
---

A TomoriBot pode importar duas coisas do [SillyTavern](https://github.com/SillyTavern/SillyTavern)
que você talvez já tenha: **predefinições do Prompt Manager** (como o prompt é organizado) e
**cards de personagem** (o personagem em si). Este é um recurso de nicho para usuários do ST; se você nunca
usou o SillyTavern, pode pular esta página.

## Importação de Cards de Personagem

Traga um personagem existente do SillyTavern direto para o Discord com `/persona import`. Ele
aceita:

- **Cards PNG** com metadados `chara` / `char` embutidos,
- **Cards JSON estilo v2** (com `name`, `description`, `first_mes`, … no nível raiz),
- **Cards JSON v3** (`spec: "chara_card_v3"` com um objeto `data` aninhado),
- **Arquivos `.charx`** (Character Card V3, o formato que sites de cards distribuem por padrão).

Um arquivo `.charx` é um zip cujo `card.json` contém o personagem. A TomoriBot lê esse card e
ignora todo o restante do arquivo: ícones agrupados, sprites de emoção, áudio e vídeo não são
importados, e a resposta de importação informa isso. Defina um avatar com `/server avatar` e adicione sprites em
`/config` > Persona > Sprites.

Se o arquivo não tem metadados da TomoriBot mas é um card ST v2/v3 válido, a importação automaticamente executa
o fluxo de conversão do SillyTavern. Você também pode enviar um card para `/persona generate` para
transformá-lo em uma persona nova.

As importações passam por um esquema de validação antes de qualquer coisa ser salva (limites padrão: 5.000
caracteres por string, 200 atributos, 100 diálogos de exemplo por lado, 100 palavras-gatilho;
quem faz hospedagem própria pode ajustar as variáveis de ambiente `PRESET_MAX_*`). Leituras de arquivos são limitadas separadamente pelas
variáveis `MAX_CHARX_*`, porque o tamanho comprimido de um arquivo não diz nada sobre o que ele expande.
Para a conversão exata e o mapeamento de campos, veja a
[arquitetura de suporte a cards](/en/architecture/integrations/sillytavern/card-support/).

## Predefinições de Prompt

Uma predefinição do Prompt Manager do SillyTavern controla o **layout** do prompt. Use `/config` > Plugins
> SillyTavern Presets para importar predefinições, inspecionar nós habilitados, alternar entre predefinições ou retornar
ao layout normal.

### O Que uma Predefinição Controla

- Ordem do prompt e posicionamento de marcadores
- Nós de prompt personalizados
- Nós de pós-histórico / injeção por profundidade
- Quais nós importados começam habilitados ou desabilitados

### O Que Ela *Não* Substitui

Uma predefinição controla o *layout*, não toda fonte de texto. Estes continuam existindo ao lado dela:

- Seus blocos de sistema/persona: `/config` > Engine > General, `/config` > Persona > Advanced,
  as ações de atributo e diálogo de exemplo em `/config` > Persona > Identity & Personality.
- Histórico de chat ao vivo e contexto de documentos recuperados.
- Contexto automático da TomoriBot: memória do servidor, contexto de emojis/figurinhas, usuários na conversa,
  memória de curto prazo, condicionamento e blocos similares.

### Como os Blocos Nativos São Mapeados

- `main` → o prompt de sistema atual (`/config` > Engine > General, senão o fallback integrado)
- `charDescription` → `/config` > Persona > Advanced
- `charPersonality` → `/config` > Persona > Identity & Personality
- `dialogueExamples` → `/config` > Persona > Identity & Personality
- `chatHistory` → histórico ao vivo do canal
- `worldInfoBefore` / `worldInfoAfter` → contexto de documentos recuperados (não lorebooks do ST)

### Regra do Prompt de Sistema

Enquanto uma predefinição está ativa, o prompt de sistema fallback integrado é removido; mas se *você* definiu
o seu próprio com `/config` > Engine > General, ele ainda é enviado.

### Notas de Compatibilidade

Surpresas comuns quando uma predefinição parece ser ignorada:

- Importado ≠ enviado: nós desabilitados em `prompt_order` permanecem desligados até que você os habilite com
  `/config` > Plugins > SillyTavern Presets. Nós apenas com comentários e nós vazios nunca são enviados; marcadores desconhecidos são
  ignorados.
- A ordem é literal: colocar `chatHistory` antes de `dialogueExamples` envia o chat ao vivo primeiro.
- Injeções de pós-histórico/profundidade são mescladas nas entradas existentes do histórico de chat em vez de se tornarem
  mensagens independentes; múltiplos nós na mesma profundidade são agrupados.
- Pós-processamento de regex, overrides de temperatura/top-p/modelo no lado da predefinição e predefinições em camadas
  não são suportados. Predefinições legadas de text-completion são importadas por um caminho de melhor esforço que
  descarta blocos exclusivos do ST (cenário, âncoras, stop strings, …).

No `/help`, escolha **Integrations** e depois **SillyTavern Presets** para a referência dentro do Discord. Para os detalhes internos do motor de importação, veja a
[arquitetura do sistema de predefinições](/en/architecture/integrations/sillytavern/preset-system/).
