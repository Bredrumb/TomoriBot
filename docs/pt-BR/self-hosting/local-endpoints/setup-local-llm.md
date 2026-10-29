---
title: "Configuração: LLM Local"
aiGenerated: false
sidebar:
  label: "LLM Local"
  order: 1
---

O TomoriBot pode usar qualquer servidor de LLM local compatível com a API da OpenAI para geração de texto e embeddings.

:::note[Nenhuma variável de ambiente necessária]
Modelos locais são registrados por meio de comandos de barra do Discord e armazenados de forma criptografada no
banco de dados. Não há configuração no `.env` para eles.
:::

## 1. Execute o servidor do seu modelo

Este guia demonstra o processo usando o Ollama como exemplo porque ele é o mais fácil para começar, mas você pode usar qualquer opção de sua preferência, especialmente se já tiver experiência técnica!

Instale o [Ollama](https://ollama.com). Os exemplos abaixo usam o Gemma 4 do Google, mas qualquer modelo na [biblioteca do Ollama](https://ollama.com/library) funciona.

### Qual tamanho devo baixar?
<!-- anchor: which-size-should-i-pull -->

Modelos locais rodam na VRAM da sua GPU (a memória integrada da sua placa de vídeo, separada
da memória RAM do sistema). Regra geral: um modelo precisa de pelo menos o seu tamanho de download livre na
VRAM, mais ~1-2 GB de margem para o contexto da conversa. Escolha o maior Gemma 4 que
couber na sua placa:

| VRAM da sua GPU | Mais indicado | Download (aprox.) |
|---|---|---|
| ~8 GB | `gemma4:e2b` | 7.2 GB |
| ~12 GB | `gemma4:12b` | 7.6 GB |
| ~16 GB | `gemma4:12b` (cabe totalmente) ou `gemma4:26b` | 7.6 / 18 GB |
| 24 GB+ | `gemma4:26b` ou `gemma4:31b` | 18 / 20 GB |

Os tamanhos de download referem-se à quantização padrão do Ollama; consulte a
[página do modelo](https://ollama.com/library/gemma4) para ver os números exatos. Não tem certeza de quanta VRAM você
tem? No Windows: `Gerenciador de Tarefas` > `Desempenho` > `GPU`, veja "Memória de GPU dedicada".

Baixe o tamanho escolhido e inicie o servidor:

```sh
ollama pull gemma4:12b     # substitua pela tag que couber na sua VRAM
ollama serve               # escuta em http://127.0.0.1:11434
```

Confirme a acessibilidade a partir da máquina em que o TomoriBot está rodando:

```sh
curl http://127.0.0.1:11434/v1/models
```

Anote a tag exata instalada, pois ela é o Nome do Modelo que você registrará:

```sh
ollama list
# NAME              ID            SIZE
# gemma4:12b        a1b2c3d4...   7.6 GB
```

## 2. Registre-o no Discord

Execute `/providers` (para todo o servidor) ou `/personal providers` (apenas para você), escolha `Adicionar Novo Endpoint Personalizado` e insira:

| Campo | Valor para Ollama |
|-------|-------------------|
| `endpoint_label` | Um nome de sua escolha, por exemplo `home-ollama` |
| Compatibilidade de API | `OpenAI-Compatible` (recomendado) ou `Ollama` |
| `endpoint_url` | `http://127.0.0.1:11434/v1` para OpenAI-Compatible · `http://127.0.0.1:11434` para Ollama |
| `auth_token` | *(deixe em branco)* |

:::tip[Escolha a URL que corresponde à compatibilidade de API]
Tanto `OpenAI-Compatible` quanto `Ollama` aceitam a raiz simples e a normalizam para a base `/v1`.
`/chat/completions` é anexado automaticamente, portanto não o adicione. URLs que já trazem um
caminho, como `https://openrouter.ai/api/v1` ou um prefixo de gateway, são armazenadas exatamente como fornecidas.
:::

Depois de salvar a conexão, selecione-a e escolha `+ Adicionar novo Modelo de Texto` no menu suspenso de modelos.
Preencha os campos:

- **Nome do Modelo (ID exato da API):** `gemma4:12b`, a tag exata obtida em `ollama list`.
- **Substituição da Janela de Contexto (Context Window Override):** opcional, apenas para Ollama / KoboldCPP. Defina isso (por exemplo, `8192`,
  `16384`) para aumentar o `num_ctx` padrão do Ollama, que de outra forma seria muito pequeno e truncaria
  contextos longos do TomoriBot. Deixe em branco para usar o padrão do servidor.
- **Opções:** ative `Chamada de ferramentas` se o modelo suportar chamadas de função; ative
  `Entrada de imagem` apenas para modelos de visão; e `Saída estruturada` se o modelo lidar bem com esquemas JSON.
  Em nosso exemplo, o Gemma 4 suporta todos eles, então marque todas as opções.

O TomoriBot valida a conexão ao salvar. Se relatar que o endpoint está inacessível, a
causa mais comum é uma divergência de `localhost`/Docker ou uma barra `/v1` faltando/extra (veja
[pegadinhas](#notes--gotchas)).

A adição do modelo o torna o modelo de `text` ativo automaticamente. Comece a conversar para testá-lo. Se
ele não estiver ativo por algum motivo, execute `/config` > Modelos > Alternar Modelos e selecione o modelo recém-registrado.

## 3. (Opcional) Embeddings locais para RAG

Selecione o endpoint salvo e use seu menu suspenso de modelos para adicionar um modelo de Embedding (por exemplo,
`ollama pull nomic-embed-text`, Nome do Modelo `nomic-embed-text:latest`). Recursos de RAG também precisam do
pgvector instalado no Postgres. Você pode consultar o guia de [configuração manual](/self-hosting/manual-setup/) aqui.

## 4. (Opcional) Compartilhar uma GPU com o ComfyUI
<!-- anchor: 4-optional-share-one-gpu-with-comfyui -->

Se o modelo de texto e o ComfyUI forem executados na mesma GPU, o TomoriBot pode descarregar o modelo de texto da memória enquanto uma
tarefa de imagem ou vídeo do ComfyUI estiver em execução. Respostas de texto que chegarem durante a tarefa aguardam até que a GPU esteja
livre novamente.

Abra o endpoint salvo, pressione `Editar Endpoint` e marque `Descarregar modelo durante tarefas do ComfyUI`
em `Comportamento do Endpoint`. O TomoriBot verifica qual servidor está na URL quando você salva:

- **Ollama:** funciona exatamente como instalado. O TomoriBot solicita ao Ollama para descarregar o modelo antes da tarefa, e
  o Ollama o recarrega na solicitação de texto seguinte.
- **KoboldCpp:** inicie o KoboldCpp com `--admin` e `--admindir`, e configure o token de autenticação do endpoint
  com a senha de administrador. O TomoriBot usa a API de recarregamento administrativo do KoboldCpp para descarregar o modelo
  e carregá-lo novamente em seguida.

Qualquer outro servidor é recusado ao salvar, pois servidores genéricos compatíveis com OpenAI não possuem uma
forma padronizada de descarregar modelos.

## Outros servidores
<!-- anchor: other-servers -->

O TomoriBot suporta qualquer endpoint compatível com OpenAI, mas os servidores abaixo são os recomendados. Todos eles usam o mesmo fluxo: apenas a URL e algumas observações mudam.

### KoboldCPP

- Inicie com a compatibilidade com OpenAI ativada (já embutida). Padrão: `http://127.0.0.1:5001/v1`.
- Compatibilidade de API: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:5001/v1`.
- Respeita a `Substituição da Janela de Contexto` da mesma forma que o Ollama.
- Para descarregar o modelo durante tarefas do ComfyUI, inicie também com `--admin` e `--admindir` (consulte
  [Compartilhar uma GPU com o ComfyUI](#4-optional-share-one-gpu-with-comfyui)).
- Carrega modelos GGUF; o Nome do Modelo é o que o modelo carregado reportar (geralmente o nome
  base do arquivo), confira na resposta de `/v1/models` do KoboldCPP.

### llama.cpp (`llama-server`)

- Compile ou instale o [llama.cpp](https://github.com/ggml-org/llama.cpp), depois forneça um GGUF usando
  seu servidor compatível com OpenAI integrado:
  ```sh
  llama-server -m model.gguf -c 16384 --host 0.0.0.0 --port 8080
  ```
- Compatibilidade de API: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:8080/v1`.
- Defina a janela de contexto na inicialização com `-c`, pois a `Substituição da Janela de Contexto` do modal
  é exclusiva do Ollama/KoboldCPP e não surte efeito aqui.
- O Nome do Modelo é o que `/v1/models` reportar; defina um nome limpo com `--alias meu-modelo`.
- Se você o iniciou com `--api-key`, insira essa chave em `auth_token`.

### LM Studio

- No LM Studio, inicie o `Local Server` (na aba `Developer`). Padrão: `http://127.0.0.1:1234/v1`.
- Compatibilidade de API: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:1234/v1`.
- O Nome do Modelo é o identificador exibido pelo LM Studio para o modelo carregado.

### vLLM

- Forneça o serviço com o servidor compatível com OpenAI: `vllm serve <model>` → `http://127.0.0.1:8000/v1`.
- Compatibilidade de API: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:8000/v1`.
- Se você iniciou o vLLM com `--api-key`, insira essa chave em `auth_token`.
- O Nome do Modelo é o caminho/nome do modelo servido (corresponde a `/v1/models`).

### LiteLLM (proxy para múltiplos backends)

- Execute o proxy LiteLLM; padrão: `http://127.0.0.1:4000/v1`.
- Compatibilidade de API: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:4000/v1`.
- O Nome do Modelo é o alias do modelo definido na configuração do LiteLLM.
- Se o proxy exigir uma chave mestra, insira-a em `auth_token`.

### ChatMock (Conta ChatGPT / CLI Codex)

Possui seu próprio guia dedicado devido a uma solução alternativa para o prompt de sistema:
[Configuração: ChatMock](/self-hosting/local-endpoints/setup-chatmock/).

## Escolhendo modelos no Hugging Face

Além da biblioteca organizada do Ollama, o [Hugging Face](https://huggingface.co) hospeda milhares de
modelos da comunidade. KoboldCPP, llama.cpp e LM Studio conseguem carregar o formato GGUF, que é um
pacote de arquivo único baixado e apontado diretamente no servidor.

1. **Encontre um GGUF.** Pesquise no Hugging Face pelo nome do seu modelo seguido de "GGUF"; quantizadores da comunidade como
   [bartowski](https://huggingface.co/bartowski) publicam versões GGUF da maioria dos modelos populares
   logo após o lançamento. Dê preferência a variantes instruct/chat (nomes terminados em `-Instruct` ou
   `-Chat`); modelos base não mantêm uma conversa fluida.
2. **Escolha uma quantização compatível com sua VRAM.** O repositório lista o mesmo modelo em vários níveis de quantização, e o
   tamanho do arquivo ≈ a VRAM necessária (mais ~1-2 GB para o contexto, mesma regra da
   [tabela de dimensionamento](#which-size-should-i-pull) acima). Baixe o arquivo `.gguf` único escolhido.
3. **Carregue o modelo.** Inicie o KoboldCPP ou `llama-server` com esse arquivo (consulte
   [Outros servidores](#other-servers)), depois registre o endpoint no Discord como de costume.

:::tip[Qual quantização escolher? Q4 ou Q5 é o ponto ideal]
A quantização armazena cada peso com menos bits para reduzir o tamanho do modelo, ao custo de uma pequena perda de qualidade.
O código em nomes como `Q4_K_M` / `Q5_K_M` representa a quantidade de bits por peso: **4 bits (Q4) ou 5 bits (Q5)
é o ponto ideal comum**, entregando quase toda a qualidade por aproximadamente metade do tamanho de 8 bits. Abaixo de 4 bits,
a degradação é rápida. E para um mesmo limite de VRAM, um **modelo maior em Q4 geralmente supera um modelo menor
em Q8**.
:::

## Notas e pegadinhas
<!-- anchor: notes--gotchas -->
<!-- anchor: notes-gotchas -->

- **Uma entrada de endpoint por rótulo.** Para registrar vários modelos que compartilham o mesmo servidor, selecione o
  endpoint salvo e use o menu suspenso de modelos novamente. Use rótulos diferentes para servidores ou protocolos de API
  realmente distintos.
- **O Nome do Modelo é o identificador da API.** Trata-se da string exata enviada ao servidor. Informá-la incorretamente é a
  causa mais comum de "conectou, mas as respostas falham".
- **Executando o TomoriBot no Docker?** O endereço `localhost` de dentro do contêiner não é o seu host. Use
  `http://host.docker.internal:<porta>` (Windows/macOS) ou o IP da LAN do host, e vincule o
  servidor do modelo a `0.0.0.0`.
- **Usando o Compose?** A configuração `RUN_ENV=development` permite endpoints HTTP locais. Um
  ambiente de produção exige HTTPS e bloqueia destinos de rede privada, a menos que o chamador
  os autorize explicitamente. `FETCH_URL_ALLOW_PRIVATE_NETWORK=true` autoriza alvos privados para
  `fetch_url` em produção; isso não altera as regras de endpoints de provedores. Endereços de metadados de nuvem
  permanecem bloqueados em qualquer modo.
