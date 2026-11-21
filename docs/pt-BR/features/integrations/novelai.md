---
title: "NovelAI"
sidebar:
  order: 4
aiGenerated: true
---

O NovelAI conecta modelos de texto (`GLM 4.6`, `Xialong`, `Kayra`, `Erato`) e geração de imagens de anime.
Você pode usar o NovelAI para ambos ou combinar sua geração de imagens com outro provedor de chat.

## Modelos de texto e assinatura
<!-- anchor: text-models-and-subscription -->

O `GLM 4.6` é o modelo de texto padrão. `Xialong` e `Erato` exigem uma assinatura ativa do Opus.
A seleção do `Xialong` verifica sua chave salva do servidor ou pessoal; se você selecioná-lo antes de adicionar uma chave,
a verificação será executada quando você adicionar a chave. A assinatura da chave em uso determina o limite de contexto
permitido. Administradores do servidor podem verificar o limite de geração do Opus com `/novelai usage`.

O [guia de formato de chat](https://docs.novelai.net/en/text/chatformat/) do NovelAI descreve a
abordagem em estilo de história usada para `Kayra` e `Erato`; `GLM 4.6` e `Xialong` usam modelos de chat
separados. A filtragem e o polimento abaixo são as adaptações do TomoriBot.

## Predefinições de amostragem
<!-- anchor: sampling-presets -->

A troca de modelos de texto carrega `Carefree-Kayra`, `Erato-Shosetsu` ou `Default-Xialong` para o
modelo selecionado; o `GLM 4.6` usa seus próprios padrões. A troca redefine temperatura, top-k, top-p e
min-p e ativa esses amostradores tanto para trocas de modelo do servidor quanto pessoais. Altere as predefinições ou
amostradores em `/config` > `Modelos` > `Samplers de Texto e Parâmetros`; edições posteriores continuam ativas, e
a substituição de uma chave no mesmo modelo as preserva.

## Contexto e configurações
<!-- anchor: context-and-settings -->

Configurações omitidas permanecem salvas em `/config` > `Comportamento` > `Comportamento Geral` para outros provedores.

| Conteúdo ou configuração | Tratamento no NovelAI |
|---|---|
| Atributos de persona, diálogos de exemplo, conversa e memórias | Mantidos, incluindo memórias pessoais visíveis e de curto prazo. Filtros de privacidade e tags de memória continuam sendo aplicados. |
| Prompts do sistema, de persona e de canal; notas de contexto; regras do humanizador; condicionamento; instruções do SillyTavern | Omitidos. O Xialong usa o prompt do sistema do NovelAI; GLM, Kayra e Erato não têm bloco de sistema. |
| Status, informações de hora/canal/servidor, documentos e inventários de emojis/figurinhas/sprites | Omitidos. |
| Avisos de ferramentas de memória | Omitidos, incluindo avisos gerados antes de uma substituição pessoal ou fallback. |
| Metadados ATTG e estrelas de qualidade | ATTG significa Autor, Título, Tags e Gênero. O Xialong coloca metadatos primeiro em suas informações persistentes e tem como padrão 4 estrelas. O Erato usa as estrelas configuradas; o Kayra omite estrelas. |
| Preenchimentos de resposta | Mantidos quando permitidos pelos controles de preenchimento. |
| Ferramentas e mídias | Sem chamadas de ferramentas de modelos de texto ou entrada de imagem/vídeo. Comandos de barra e comandos separados de geração de imagens continuam disponíveis. |
| Limites de tokens | Contados localmente reservando espaço para respostas. O tamanho de resposta configurado tem prioridade sobre o tamanho da predefinição e pode ser reduzido para caber. |

Rótulos de interlocutores externos conhecidos e linhas isoladas de `---` ou `***` interrompem a saída, mesmo com a
configuração compartilhada de parada por interlocutor desativada. Nomes, apelidos e rótulos de sprites da persona que responde
continuam permitidos. A proteção local preserva o código; paradas literais da API ainda podem corresponder dentro de código gerado.

## Corte de contexto
<!-- anchor: context-trimming -->

As memórias usam até 20% da janela de contexto, com as entradas mais antigas removidas primeiro. Se o prompt ainda
não couber, o TomoriBot o corta nesta ordem:

| Ordem | Conteúdo removido | Conteúdo protegido |
|---|---|---|
| 1 | Diálogos de exemplo extras | Uma troca de exemplo disponível |
| 2 | Memórias, entradas mais antigas primeiro | Sem mínimo |
| 3 | Histórico de conversa antigo | Até duas trocas recentes do histórico |

Atributos de persona, metadados ATTG e o turno atual também permanecem protegidos. A geração falha se o
contexto protegido não puder ser acomodado. O corte deixa as memórias e mensagens salvas inalteradas.

`/tool prompt snapshot` exibe o prompt final, contagens de tokens, limite de resposta e relatório de corte.

## Polimento de texto e entrega no Discord
<!-- anchor: text-polishing-and-discord-delivery -->

O polimento altera apenas a cópia do histórico, memórias e diálogos de exemplo enviados aos quatro modelos do
NovelAI, antes da contagem de tokens. O texto salvo e outros provedores não são alterados; a gramática não é reescrita.

- **O texto é colocado em maiúsculas corretamente**: inícios de frases e linhas em caracteres latinos são colocados
  em maiúsculas; nomes conhecidos de personas usam as maiúsculas e minúsculas configuradas.
- **Linhas em prosa recebem pontuação**: pontos finais ausentes são adicionados enquanto a pontuação existente,
  quebras de linha e linhas em branco permanecem no lugar.
- **Prosa formatada é polida**: `*kisses juno*` se torna `*Kisses Juno.*`. Negrito, sublinhado,
  tachado e spoilers seguem as mesmas regras; ênfase inline mantém suas maiúsculas e minúsculas, exceto para nomes.
- **Código e marcação são preservados**: código, URLs, menções, marcação do Discord, listas, cabeçalhos,
  citações em bloco, tabelas e separadores mantêm seu conteúdo ou estrutura.
- **Inícios e finais que não sejam em prosa são respeitados**: linhas que começam com blocos de código, URLs, menções,
  emojis ou caracteres não latinos pulam a formatação de frases. Finais com emojis, kaomojis, código e links não recebem
  ponto extra.
- **Memórias de longo prazo usam conteúdo simples**: rótulos de proprietário adicionados, IDs de banco de dados e prefixos de tags
  são omitidos; nomes resolvidos permanecem.
- **Anotações de histórico geradas são removidas**: referências de respostas, metadados de reações e
  avisos administrativos são omitidos. Gestos tornam-se ações; cenas e resumos perdem seu
  invólucro de sistema. Textos literais de usuários contendo `System:` são mantidos.
- **Preenchimentos continuam exatos**: preenchimentos de resposta explícitos e fragmentos de continuação permanecem inalterados.
- **A entrega no Discord segue suas configurações**: o humanizador continua controlando maiúsculas/minúsculas, pontuação
  e divisão de mensagens. Histórico posterior é polido novamente; a pontuação perdida não pode ser recuperada com exatidão.

## Geração de imagem
<!-- anchor: image-generation -->

Atribua um modelo ao slot `Imagem NovelAI` em `/config` > `Modelos` > `Trocar Modelos`. Membros
podem gerar imagens diretamente com `/novelai generate image` ou pedir no chat quando o provedor de texto
ativo oferecer suporte a chamadas de ferramentas.

A predefinição `Default + Image Generation Expert` usa tags no estilo imageboard para o NovelAI, com descrições
curtas quando necessário para interações ou posicionamento de texto. Para cenas com vários personagens,
o TomoriBot mantém o cenário compartilhado e as direções de câmera separados da aparência e das
ações de cada personagem.

Para fala legível, peça à TomoriBot para incluir o diálogo exato. A ferramenta de imagem do NovelAI coloca o
diálogo dos personagens em uma seção final `Text:` automaticamente. V4 e V4.5 oferecem suporte a texto em inglês;
V5 também suporta japonês e chinês. Texto em placas ou telas pode ser descrito no prompt de
cena compartilhada. Mantenha o texto solicitado curto e evite `no text` entre as tags positivas. Posicionamento e
tipografia (incluindo escrita japonesa vertical) são sugestões em vez de garantias.
