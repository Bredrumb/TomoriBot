---
title: "Lorebooks"
sidebar:
  order: 2
aiGenerated: false
---

Os lorebooks são uma memória avançada para mundos de RPG, personagens e detalhes recorrentes da história. Use
Memórias para conversas cotidianas. As entradas de lorebook relembram os detalhes que você escreve quando as palavras-chave
delas aparecem em mensagens recentes.

Gerencie lorebooks em `/memories` > `Lorebooks`. Todos os membros podem ler as entradas no escopo; somente
membros com a permissão `Gerenciar Servidor` podem adicionar, editar, importar, exportar ou remover entradas.

## Lorebooks de Todo o Servidor e de Persona

Os lorebooks têm dois escopos:

- Livros de **Todo o Servidor** se aplicam a todas as personas no servidor. Escolha um livro primeiro e depois escolha uma entrada dentro dele.
- Entradas de **Persona** pertencem a uma linhagem de persona. Elas continuam a se aplicar mesmo após a persona ser
  removida e importada novamente.

Use os botões `Todo o Servidor` e `Persona` no topo da página para alternar o escopo. A lista de personas
agrupa personas que compartilham uma linhagem, pois elas compartilham o mesmo livro. Os limites de canal e o
escopo Todo o Servidor/Persona são controles separados: o escopo decide quem possui a entrada, enquanto os canais
decidem onde ela pode aparecer.

## Escrevendo uma entrada

Defina para cada entrada um título, palavras-chave e até 4.000 caracteres de conteúdo. As palavras-chave são palavras
ou frases separadas por vírgulas. A correspondência ignora maiúsculas/minúsculas e diferenças de largura total/meia largura.

Deixe as palavras-chave em branco para fatos de contexto que não precisam de correspondência por palavra-chave. Adicione palavras-chave novamente para restaurar
a correspondência. Novas entradas usam o posicionamento depois da persona; entradas importadas mantêm o posicionamento original.
Os slots de world info de uma predefinição do SillyTavern controlam onde os grupos antes e depois aparecem.

## Quando as entradas são ativadas

Uma entrada ativada precisa de uma correspondência de palavras-chave, a menos que suas palavras-chave estejam em branco. Os limites de escopo e canal ainda
se aplicam a entradas sem palavras-chave.

`Regras de Ativação` controlam palavras-chave secundárias, o número de mensagens recentes pesquisadas (1-100), chance de
ativação e ordem de inserção. Palavras-chave secundárias podem exigir qualquer correspondência (OR), todas as correspondências (AND), nenhuma
correspondência (NOR) ou menos do que todas as correspondências (NAND). Números de inserção menores aparecem mais cedo.

A chance de ativação varia de 0% a 100%. Zero impede a ativação, inclusive para entradas sem palavras-chave.
Probabilidades ausentes ou nulas em um arquivo importado têm como padrão 100%; um 0% explícito permanece em 0%.
Entradas `Desativada` continuam salvas e fora do prompt.

A correspondência de palavras-chave é literal. Chaves em formato regex, como `/a+/`, são mantidas exatamente como escritas e não atuam como
expressões regulares.

## O que chega ao prompt

As entradas ativadas são enviadas em um bloco `World Info` por posicionamento, na ordem de inserção. Ambos os blocos
compartilham um limite de 8.000 caracteres; uma entrada que excederia esse limite é ignorada para que entradas posteriores ainda
possam caber.

O conteúdo pode usar `{{user}}`, `{{char}}` e `{{bot}}`. O TomoriBot os substitui pelos nomes atuais.
Outras macros `{{...}}` e blocos condicionais permanecem exatamente como escritos.

## Limites de canal

As restrições de canal para Todo o Servidor pertencem à coleção e se aplicam a todas as suas entradas. Configure-as com
`Canais` ao lado do botão de estado da coleção. Os lorebooks de persona mantêm as restrições de canal em cada
entrada. Deixar os canais vazios permite todos os canais; as threads seguem o canal pai.

O botão `Ativa` / `Desativada` da coleção controla o livro inteiro. Desativá-lo mantém todas as entradas
fora da conversa sem alterar o estado individual de cada entrada. Reativar a coleção preserva
quais entradas estavam ativadas ou desativadas.

Memórias do servidor antigas marcadas com palavras-chave que foram convertidas em lore de persona ainda podem conter um nome de
`#channel` não resolvido. Até que um administrador salve uma seleção de canais, o TomoriBot trata essa entrada como ativa em
todos os canais e a sinaliza na página de Lorebooks.

## Importando um lorebook

No escopo de Todo o Servidor, escolha `+ Importar Lorebook` no seletor de coleções para criar um livro a partir do
arquivo enviado. O nome padrão é o nome contido no arquivo ou o nome do arquivo; você pode inserir um
nome na janela de diálogo de importação. Nomes já existentes são rejeitados, de modo que importar um novo livro não pode sobrescrever um existente.
Use `+ Importar Entradas` no seletor de entradas do livro selecionado para anexar ou substituir suas entradas.

No escopo de Persona, `+ Importar Lorebook` permanece no seletor de entradas porque a persona possui um único livro.
Ambas as importações aceitam JSON de world info do SillyTavern, JSON de Character Book e cards de personagem nos formatos PNG,
CHARX ou JSON. O envio de um card aqui importa apenas o seu Character Book incorporado. Um card sem
livro mantém o lorebook selecionado inalterado.

Anexar é o padrão: entradas já presentes são ignoradas e novas entradas são adicionadas. Marque
`Substituir este lorebook` para substituir apenas o livro selecionado. Os demais livros de Todo o Servidor permanecem intactos.
Cada persona pode conter 250 entradas, e os livros de Todo o Servidor compartilham um limite separado de 250 entradas;
uma importação que exceder esse limite é rejeitada por completo, evitando importações parciais. Os arquivos têm limite
de 2 MB para JSON; cards PNG e CHARX utilizam os limites de importação de persona da hospedagem exibidos na janela de upload.

O relatório informa quantas entradas foram adicionadas e quantas foram ignoradas. A contagem de entradas ignoradas inclui
duplicatas e entradas que o conversor não pôde utilizar, como entradas sem conteúdo. Configurações sem
destino correspondente, como grupos, recursão, temporizadores fixos (sticky), tempos de recarga e gatilhos, são contabilizadas e
descartadas. As posições de world info de 2 a 7 entram antes da persona. Chaves regex permanecem inertes. O relatório de importação identifica palavras-chave e configurações não suportadas.

O Character Book de um card é importado como o lorebook dessa persona por `/persona import`; consulte
[Suporte ao SillyTavern](/features/integrations/sillytavern-support/).

## Exportando um lorebook

`Exportar Lorebook` no seletor de entradas baixa o livro de Todo o Servidor ou o livro de Persona selecionado como
JSON de world info do SillyTavern. Reimporte-o por meio do mesmo upload de lorebook. As configurações de ativação das entradas
e os estados individuais de ativação acompanham o arquivo; restrições de canal, nomes de canais não resolvidos
e o estado da coleção não são incluídos.

Para um backup do servidor que preserve essas restrições e configurações de coleção, use `/export memories`
com `Todas as Personas`. `Persona Principal` e `Persona Selecionada` exportam apenas memórias e mantêm o lore
de destino intacto quando importados.

## Páginas relacionadas

- [Memória](/features/knowledge/memory/)
- [Por Dentro do Prompt](/features/knowledge/inside-the-prompt/)
- [Manuseio de Dados](/features/knowledge/data-handling/)
