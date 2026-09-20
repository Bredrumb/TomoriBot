---
title: "Ajuste de Comportamento"
sidebar:
  order: 3
---

O comportamento da TomoriBot (**o que ela tem permissão para fazer e como ela gera as respostas**) é controlado por
`/config` > Permissions e `/config`, além da personalidade ([Múltiplas Personas](/pt-BR/features/chatting-personality/multiple-personas/))
e do conhecimento ([Memória](/pt-BR/features/knowledge/memory/)). Esta página é um conjunto selecionado das configurações de
alto valor; cada comando está na [Referência de Comandos](/pt-BR/features/command-reference/).

## Capacidades: O Que Ela Tem Permissão para Fazer {#capabilities-what-shes-allowed-to-do}

`/config` > Permissions ativa e desativa os recursos dela: geração de imagem, uso de figurinhas, criação
de tópicos, gerenciamento de mensagens, bloqueio de usuários, autoensino, mensagens de voz e mais. Cada
toggle é a flag de recurso que condiciona a ferramenta correspondente (veja
[Ferramentas & Extensões](/pt-BR/features/capabilities/tools-and-extensions/)). Desative algo e ela simplesmente
não pode fazê-lo, não importa o que um usuário peça.

## Ajuste de Geração {#generation-tuning}

- `/config` > Models > Text Samplers & Parameters: parâmetros de amostragem (temperature, top-p, …): criatividade/aleatoriedade.
  Uma temperature mais alta gera resultados mais variados.
- `/config` > Engine > General: quão humanizadas as respostas dela parecem. A opção `scope` opcional
  aplica o grau em todo o servidor (`Global`, o padrão) ou a uma única persona
  (`Persona`), útil quando uma persona deve enviar mensagens casualmente no grau 3 enquanto outra escreve como um romance. A opção "Inherit" de uma persona limpa sua substituição.
- `/config` > Engine > General: quantas mensagens recentes ela puxa como contexto a cada acionamento.
  Uma alavanca útil: aumente para mais consciência conversacional, diminua para cortar custo de tokens.

## Prompt de Sistema {#system-prompt}

O prompt de sistema fica acima da persona e molda o comportamento geral:

- `/config` > Engine > General: defina uma instrução de sistema personalizada (até 16.000 caracteres).
- `/config` > Engine > General: escolha entre prompts de sistema predefinidos.
- `/config` > Engine > General: restaure o padrão. A confirmação mostra o prompt que acabou de ser
  removido, para que você possa copiá-lo de volta caso o tenha apagado por acidente.

Quando uma [predefinição do SillyTavern](/pt-BR/features/integrations/sillytavern-support/) está ativa, o prompt de sistema
padrão integrado é substituído; mas um personalizado que você definiu aqui ainda é enviado.

## Saída Sem Censura {#uncensored-output}

A TomoriBot **não tem filtro de conteúdo próprio**: ela não é um sistema de moderação e não adiciona
proteções por cima do modelo. O que quer que o provedor subjacente retorne é o que ela diz.
`/nsfw jailbreaks` portanto não "desbloqueia" nada dentro da TomoriBot; ele existe puramente para
contornar filtros **do lado do provedor** que são mais rígidos do que você deseja.

Ele alterna três técnicas independentes (todas desativadas por padrão):

- **Injeção de prompt**: adiciona um bloco de instrução de jailbreak ao contexto para direcionar o modelo
  para longe de recusas desnecessárias.
- **Espaços Unicode**: troca espaços normais por um espaço Unicode visualmente idêntico para que filtros
  de palavras-chave/tokens não correspondam a frases, no texto enviado ao modelo e na resposta dela.
- **Sanitizar**: ofusca um conjunto de palavras sensíveis pelo mesmo motivo, tanto na
  requisição quanto na resposta.

Nenhuma dessas opções muda o que o modelo é *capaz* de fazer; elas apenas reduzem a frequência com que
um filtro de provedor excessivamente zeloso bloqueia uma saída que seria normal. Algumas dessas opções têm
restrição de idade; veja
[Comandos com Restrição de Idade](/pt-BR/features/setup-administration/age-restricted-commands/).

## Aparência & Hora

- `/config` > Persona > Identity & Personality: defina como ela se chama.
- `/config` > Engine > General: o fuso horário do servidor, usado para respostas e lembretes baseados em horário.

---

Procurando controles de administração/custo (cotas, listas de permissões, BYOK) em vez de comportamento? Eles estão em
[Moderação do Servidor](/pt-BR/features/setup-administration/server-moderation/).
