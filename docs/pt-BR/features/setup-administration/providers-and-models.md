---
title: "Provedores & Modelos"
sidebar:
  order: 1
---

A TomoriBot não tem um modelo de IA embutido: você conecta um a partir de um provedor. Um **provedor** é um
serviço de IA (Google Gemini, OpenRouter, NovelAI, um endpoint local, …), e um **modelo** é um
modelo específico nesse provedor. Você precisa de pelo menos um provedor para usá-la.

## Chaves de API {#api-keys}

Adicione uma chave de provedor durante a configuração inicial com `/setup`, ou depois em `/providers` escolhendo
**Add New Provider**. As chaves são **criptografadas em repouso**: ninguém, incluindo administradores do servidor, pode
lê-las de volta.

`/setup` pergunta como as respostas devem chegar a um modelo antes de tudo, e a resposta decide o que ele
coleta:

| Modo | O que é coletado |
|---|---|
| **AI Provider (Recommended)** | Um provedor do catálogo mais sua chave de API, validada e criptografada como rascunho. |
| **Custom Endpoint (Advanced)** | A conexão do endpoint e um modelo de texto, registrados dentro do assistente. Veja [Endpoints Personalizados](#endpoints-personalizados). |
| **User BYOK** (apenas servidores) | Nada: o workspace não mantém nenhum provedor próprio, então os membros devem fornecer provedores pessoais. |

Nada é gravado até o **Finish Setup**, então um assistente abandonado ou expirado não altera as
linhas de provedor existentes do workspace. Para substituir uma chave já armazenada, use `/providers`, porque
o `/setup` se recusa a executar em um workspace que já está configurado.

Cada provedor tem suas próprias etapas de geração de chave. Execute **`/help`**, escolha **Setup**, depois **Step 1: Get an API Key**, e escolha seu
provedor para o passo a passo exato, ou use estes pontos de partida:

| Provedor | Notas | Obter uma chave |
|---|---|---|
| **Google Gemini** | Nível gratuito, executa todos os recursos. Configuração inicial recomendada. | [AI Studio](https://aistudio.google.com/apikey) |
| **OpenRouter** | Uma chave, muitos modelos (alguns gratuitos). | [Chaves do OpenRouter](https://openrouter.ai/settings/keys) |
| **NovelAI** | Assinatura; narrativa/roleplay sem censura (somente texto). | [NovelAI](https://novelai.net/) |
| **DeepSeek** | Modelos de raciocínio com pagamento por uso. | [DeepSeek](https://platform.deepseek.com/api_keys) |
| **NVIDIA NIM** | Texto hospedado, embeddings e imagem. | [NVIDIA Build](https://build.nvidia.com/) |
| **Anthropic** | Modelos Claude via API (não Claude Code). | — |
| **Z.ai** | Família GLM. ⚠️ ToS restringe uso a cenários de código/agente. | [Z.ai](https://z.ai/) |
| **Vertex AI** | Google Cloud via ADC do `gcloud`: melhor para configurações locais/dev. | veja abaixo |
| **Vertex AI Express** | BYOK de chave de API do Google Cloud (Preview, subconjunto do Gemini). | [Express Mode](https://console.cloud.google.com/expressmode) |
| **Custom** | Qualquer endpoint compatível com OpenAI (Ollama, vLLM, LiteLLM, …). | veja [Endpoints Personalizados](#endpoints-personalizados) |

:::caution
Nunca compartilhe sua chave de API com ninguém. Adicione ou substitua o token de autenticação Bearer de um endpoint personalizado
a partir da ação **Edit Endpoint** em `/providers`.
:::

O **Vertex AI** se autentica com Application Default Credentials em vez de um segredo armazenado.
Para hospedagem local, o ADC pode vir do `gcloud`; implantações hospedadas devem usar uma identidade de
carga de trabalho ou conta de serviço. Uma chave de API do AI Studio sozinha não autentica o Vertex AI completo. O projeto
selecionado deve ter faturamento e a API do Vertex AI habilitados, e a identidade do host precisa de acesso ao Vertex.
O guia de configuração está disponível em **Google Vertex AI** na página **API Keys** em `/help`.

A configuração de provedores com suporte Google valida as credenciais através do endpoint autenticado de
listagem de modelos. Ela não gera texto nem depende de qualquer modelo de chat que esteja marcado como
padrão do catálogo, então um padrão aposentado não pode impedir que uma credencial válida seja salva.

### Opcional: Chave do Brave Search

O Brave Search é separado do seu provedor de IA e apenas aprimora a pesquisa na web (adiciona pesquisa de imagem,
vídeo e notícias). Configure-o com `/providers`. ⚠️ O Brave inclui $5/mês de
crédito gratuito; defina um limite de uso de $5 no painel do Brave para evitar cobranças.

## Escolhendo Modelos

`/providers` gerencia credenciais do servidor, catálogos de modelos e registros de endpoints, enquanto
`/config` > Models > Switch Models seleciona as atribuições de capacidade compartilhadas que todos os membros deste
servidor usam. Ambos precisam da permissão de servidor necessária. Membros individuais gerenciam suas próprias credenciais
e catálogos de modelos com `/personal providers`, e selecionam modelos pessoais em `/personal config`.
Configurações pessoais os acompanham em todos os servidores onde usam a TomoriBot. Veja
[Personalização](/pt-BR/features/knowledge/personalization/#your-own-providers) para esse lado.

Os painéis são intitulados **Server Providers** e **Personal Providers** para que sua propriedade permaneça visível após
a interação do comando ser aberta.

Após um provedor ser definido, use `/config` > Models > Switch Models para escolher as atribuições de capacidade compartilhadas.
Os seis slots comuns selecionam entradas de modelo dos catálogos de provedores:

- `/config` > Models > Switch Models: o modelo principal de chat
- `/config` > Models > Switch Models: um modelo de visão (para ler imagens quando o modelo de chat não consegue)
- `/config` > Models > Switch Models: embeddings para a [base de conhecimento de documentos](/pt-BR/features/knowledge/memory/#document-knowledge-base-rag)
- `/config` > Models > Switch Models: geração de imagem padrão (veja [Geração de Imagem](/pt-BR/features/capabilities/media-generation/image-generation/))
- `/config` > Models > Switch Models: geração de imagem NovelAI
- `/config` > Models > Switch Models: geração de vídeo
- `/config` > Models > Switch Models: endpoint de texto-para-fala (TTS)
- `/config` > Models > Switch Models: endpoint de fala-para-texto (STT)

As seis primeiras entradas escolhem registros do catálogo de modelos. Os slots de TTS e STT escolhem endpoints com escopo
de workspace, então eles ativam o endpoint selecionado em vez de gravar uma coluna de modelo. Registre
e edite esses endpoints em `/providers`; o controle de ativação de endpoint dele ainda funciona. `/personal config`
mantém seis slots pessoais de roteamento de modelo e não adiciona seletores pessoais de endpoints TTS/STT.

Você também pode gerenciar as chaves de backup deste servidor para failover automático e balanceamento de carga com
`/providers`.

## Endpoints Personalizados {#custom-endpoints}

Endpoints personalizados permitem que você registre serviços auto-hospedados ou com proxy: Ollama, LM Studio,
LiteLLM, vLLM, ComfyUI, TTS/STT local; como **pacotes de provedores rotulados**.

- **Escopo do servidor:** abra `/providers` para registro e edição de endpoints do workspace.
- **Escopo pessoal:** abra `/personal providers` para catálogos de modelos pessoais (apenas você; veja
  [Personalização](/pt-BR/features/knowledge/personalization/#your-own-providers)). Endpoints pessoais de fala
  não são selecionados em `/personal config`.

Um **rótulo** é o nome exibido no menu e agrupa capacidades sob um pacote quando compartilham
uma URL de endpoint. Ele nunca é enviado ao endpoint remoto. Capacidades servidas de URLs diferentes
precisam de rótulos distintos. Escolha **Add New Custom Endpoint**, selecione a
compatibilidade de API e salve a conexão. Salvar prepara as capacidades suportadas por aquele
protocolo sem registrar nenhum modelo. Em seguida, selecione o novo endpoint e use seu menu suspenso de
modelo para registrar um código de modelo exato e capacidade. Adicionar um modelo o ativa para aquela
capacidade. Use o mesmo menu para anexar mais modelos ou editar um registro adicionado pelo workspace.
Modelos de texto declaram suas próprias capacidades nesse formulário, e modelos de imagem declaram quais modos de
solicitação suportam.

Para TTS e STT, registre o endpoint e seus modelos em `/providers`, depois escolha e ative o
endpoint em `/config` > Models > Switch Models. Esses slots de fala selecionam um endpoint em vez de uma
entrada do catálogo de modelos. `/providers` continua sendo a superfície de registro, configuração e edição de endpoints.

A compatibilidade de API determina os caminhos de requisição e payloads que o serviço implementa, então ela também determina quais
slots de capacidade a conexão prepara. Registrar modelos exatos para esses slots é uma etapa separada, e o
protocolo não pode ser inferido de forma confiável a partir da URL do endpoint.

O modo **Custom Endpoint (Advanced)** do `/setup` executa os mesmos dois passos dentro do assistente:
**Configure Connection** salva a compatibilidade de API, rótulo, URL e token de autenticação opcional após
uma verificação de acessibilidade, e **Configure Text Model** registra o modelo de texto exato e suas declarações de
capacidade. O botão de modelo fica desabilitado até que uma conexão seja validada, e re-salvar a
conexão limpa a declaração do modelo porque as declarações dependem da compatibilidade de API.
O assistente cria a conexão, provedor salvo, modelo e linhas de modelo ativo juntos quando você
pressiona **Finish Setup**, então ele nunca deixa uma conexão que não tem um modelo de texto utilizável. Ele registra
apenas modelos de texto; capacidades de imagem, vídeo, TTS e STT ainda são registradas em `/providers`.

Para guias completos de execução dos servidores, veja:

- [Configuração: LLM Local](/pt-BR/self-hosting/local-endpoints/setup-local-llm/): Ollama, KoboldCPP, LM Studio, vLLM, LiteLLM.
- [Configuração: ComfyUI](/pt-BR/self-hosting/local-endpoints/setup-comfyui/): geração local de imagem/vídeo.
- [Configuração: ChatMock](/pt-BR/self-hosting/local-endpoints/setup-chatmock/): conta ChatGPT / Codex CLI.

## Provedores Suportados {#supported-providers}

Se você não tem o hardware para hospedar seus próprios modelos, a TomoriBot suporta uma ampla gama de
serviços. Nem todo recurso está disponível em todos os provedores.

### Provedores de LLM

| Provedor | Streaming | Chamada de Ferramentas | Entrada de Imagem | Embeddings | Notas |
|---|---|---|---|---|---|
| **Google Gemini** | ✅ | ✅ | ✅ | ✅ | Modelos gratuitos disponíveis |
| **OpenRouter** | ✅ | ✅ | ✅ | ✅ | Modelos gratuitos disponíveis |
| **Anthropic (API)** | ✅ | ✅ | ✅ | – | Não é Claude Code |
| **NovelAI** | ✅ | ✅ | – | – | Apenas GLM 4.6 pode usar ferramentas |
| **NVIDIA NIM** | ✅ | ✅ | ✅ | ✅ | Modelos gratuitos disponíveis |
| **DeepSeek** | ✅ | ✅ | – | – | – |
| **Z.ai** | ✅ | ✅ | ✅ | – | Modelos gratuitos; ⚠️ ToS = uso somente para código/agente |
| **Z.ai Coding** | ✅ | ✅ | – | – | Plano de assinatura |
| **Google Vertex AI** | ✅ | ✅ | ✅ | ✅ | Inclui versão Express 'gratuita' |
| **Codex CLI (via ChatMock)** | ✅ | ✅ | ✅ | – | [Configuração](/pt-BR/self-hosting/local-endpoints/setup-chatmock/) |

### Geração de Imagem

| Provedor | Texto-para-Imagem | Imagem-para-Imagem | Inpainting | Notas |
|---|---|---|---|---|
| **Google** | ✅ | ✅ | – | – |
| **OpenRouter** | ✅ | ✅ | – | – |
| **NovelAI** | ✅ | ✅ | ✅ | Pode combinar com outros provedores |
| **NVIDIA** | ✅ | – | – | Somente texto-para-imagem; imagens de referência são ignoradas |
| **Z.ai** | ✅ | – | – | – |

Esses são os **padrões** com os quais os modelos de imagem de um provedor começam, e o NovelAI roda por seu próprio
pipeline em vez desta tabela. Registrar um modelo de imagem através de `/providers` permite que você declare os modos
próprios daquele modelo, que é como você habilita inpainting em um workflow ComfyUI ou em um modelo de provedor cuja API suporta
edição com máscara. Um modelo que você nunca declara continua seguindo os padrões acima, então uma correção posterior neles
o atinge automaticamente. Declare apenas o que o modelo realmente faz: a Tomori oferece à ferramenta exatamente os modos
que você marca, e um modo que a API rejeita se torna uma geração falhada.

### Geração de Vídeo

| Provedor | Texto-para-Vídeo | Imagem-para-Vídeo | Notas |
|---|---|---|---|
| **Google** | ✅ | ✅ | Workflow de polling assíncrono |
| **OpenRouter** | ✅ | ✅ | Workflow de polling assíncrono |
| **Z.ai** | ✅ | ✅ | Workflow de polling assíncrono |

### Voz & Áudio

| Provedor | Texto-para-Fala | Fala-para-Texto |
|---|---|---|
| **ElevenLabs** | ✅ | ✅ |

Motores de voz locais são cobertos em [Hospedagem Própria](/pt-BR/self-hosting/). Para os mecanismos integrados de pesquisa na
web e leitura de URLs, veja [Ferramentas & Extensões](/pt-BR/features/capabilities/tools-and-extensions/#pesquisa-na-web--leitura-de-urls).
