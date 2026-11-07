---
title: "Documentos"
sidebar:
  order: 3
aiGenerated: false
---

Os documentos oferecem à TomoriBot uma base de conhecimento que ela pesquisa enquanto responde: o livro de regras de um jogo, o FAQ de um servidor, a exportação de uma wiki ou notas de uma história. Eles armazenam materiais longos demais para serem uma [memória de longo prazo](/features/knowledge/memory/long-term-memory/).

## Por que usar documentos

Uma memória de longo prazo ativa é enviada por completo com cada resposta, portanto cada uma ocupa espaço no prompt quer a conversa precise dela ou não. Em vez disso, um documento é pesquisado. Cada resposta recebe no máximo 10 trechos correspondentes à conversa, então até mesmo um livro de regras de 40 páginas adiciona no máximo cerca de três páginas de texto a uma resposta, e as seções sobre as quais ninguém pergunta não custam nada.

Use uma memória de longo prazo para um fato curto que ela deva sempre saber. Use um documento para materiais de referência que ela deva consultar quando o assunto surgir.

## Como funciona a busca
<!-- anchor: how-search-works -->

Quando você adiciona um documento, a TomoriBot o divide em trechos de alguns parágrafos cada, chamados de fragmentos (chunks). Um modelo de embedding transforma então cada fragmento em uma lista de números que descreve o que ele significa. Fragmentos sobre tópicos semelhantes recebem números semelhantes, mesmo usando palavras diferentes.

A cada mensagem, ela transforma a mensagem mais recente em números da mesma forma e escolhe os fragmentos com significado mais próximo. Ela também verifica fragmentos que compartilham palavras exatas, o que identifica nomes e termos inventados que um modelo de embedding talvez não conheça. As melhores correspondências entram no prompt dela para aquela resposta. Essa técnica é chamada de geração aumentada por recuperação (RAG).

Por exemplo, um documento diz "Os membros da guilda se reúnem toda sexta-feira nas docas." Perguntar "quando a guilda se junta?" encontra esse fragmento mesmo que a pergunta nunca use "reúnem" ou "sexta-feira".

Como ela vê apenas os fragmentos correspondentes, ela não consegue resumir um documento inteiro nem fazer contagens ao longo dele. Perguntas sobre detalhes específicos funcionam melhor. Títulos em Markdown ajudam: cada fragmento mantém os títulos de sua seção, de modo que um documento bem organizado oferece correspondências mais claras.

## Configurando documentos

Documentos precisam de um modelo de embedding. Escolha um no espaço Embeddings; veja [Provedores & Modelos](/features/setup-administration/providers-and-models/).

Gerencie documentos em `/memories` > `Documentos`. Escolha `Adicionar novo documento` para enviar um arquivo `.txt`, `.md` ou `.pdf`. Um documento pode pertencer a uma persona ou ser compartilhado entre personas, e pode ser limitado a canais selecionados e seus tópicos. Você pode ler os fragmentos armazenados e editar ou remover qualquer um deles. Para transformar uma memória longa do servidor em documento, abra-a em `/memories` e escolha `Vetorizar`.

Em servidores novos, o gerenciamento de documentos é restrito por padrão a membros com `Gerenciar Servidor`; quem gerencia o servidor pode conceder acesso por meio de `/moderation` > `Acesso de Membros`.

## Limites de documentos

Por padrão, um arquivo pode ter até 4 MB e seu texto até 120.000 caracteres (cerca de 20.000 palavras em inglês), divididos em no máximo 150 fragmentos. Os documentos de cada persona e o conjunto compartilhado podem conter 20 documentos e 1.000 fragmentos. Quem faz hospedagem própria pode alterar esses limites com `MAX_DOCUMENT_SIZE_MB`, `MAX_DOCUMENT_TEXT_LENGTH`, `MAX_DOCUMENT_CHUNKS`, `MAX_DOCUMENTS_PER_SERVER` e `MAX_DOCUMENT_CHUNKS_PER_SERVER`.

## Aprendendo com o histórico de chat

O comando `/learn history` lê até 100 mensagens no canal atual, extrai os fatos presentes nelas e salva esses fatos como um documento. Ele requer a permissão `Gerenciar Servidor` e um modelo com suporte a saídas estruturadas.

A importação de histórico oferece prompts para conversa, roleplay e o ponto de vista de uma persona. Você pode revisar e ajustar o prompt antes de importar. Escolha quem aprende o resultado com `learner`: uma persona (a persona principal se deixada em branco), cada persona que falou ou todas as personas juntas.
