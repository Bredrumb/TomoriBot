---
title: "Gravações de conversa"
description: "Salve trechos em torno de suas mensagens no servidor e exporte ou exclua suas gravações privadamente."
sidebar:
  order: 5
---

Gravações de conversa é um recurso opcional que salva trechos em torno de suas próprias mensagens no servidor apenas para seu uso pessoal, com identidades estruturadas do Discord substituídas por marcadores antes do armazenamento (texto livre e links externos ainda podem identificar pessoas).

**Por padrão, o TomoriBot não salva suas mensagens, a gravação é opcional por usuário apenas para seu próprio uso pessoal, e começa somente após você confirmar o comando `/record`. O TomoriBot não constrói personas automaticamente, não faz chamadas a provedores de IA e não alimenta nenhum pipeline de treinamento com esses trechos.**

## Para que é usado

- Manter arquivos pessoais de suas próprias mensagens no servidor e do contexto ao redor.
- Revisar discussões passadas com carimbos de data/hora, ordem das mensagens e links de resposta.
- Analisar seu próprio estilo de escrita para rascunhar notas ou prompts de personas offline.
- Exportar transcrições estruturadas em Markdown ou JSON para seu próprio uso offline.

## Iniciar e parar a gravação

- **`/record start`**: Escolha uma duração e se deseja salvar apenas suas mensagens ou incluir mensagens ao redor, e depois confirme. Evite `Até ser interrompido (não recomendado)` a menos que planeje interromper manualmente.
- **Sessões ativas**: Você pode ter uma gravação ativa por servidor. Executar `/record start` enquanto estiver ativo abre suas configurações: as alterações de contexto se aplicam apenas a novos trechos; alterar a duração define um novo término a partir de agora, enquanto manter a mesma duração preserva o término atual.
- **`/record stop`**: Interrompe a coleta e mantém os trechos salvos.
- **`/record data`**: Abre suas gravações e configurações para o servidor atual.
- **Escopo**: Indisponível em DMs. Os gerentes do servidor não podem visualizar, exportar ou excluir suas gravações.

## O que é salvo

- **Gatilhos**: Após a ativação, cada mensagem real que você enviar pode salvar um trecho que termina com essa mensagem (mesmo quando a Tomori não responde). Mensagens de personificação não acionam a gravação.
- **Contexto**: Até 10 mensagens elegíveis anteriores no mesmo canal ou tópico a partir de uma janela recente limitada (elas podem ser anteriores à ativação).
- **Modos**: `Apenas minhas mensagens` salva somente suas mensagens. `Incluir mensagens ao redor` também pode salvar outros membros, bots e webhooks, mesmo que nunca tenham iniciado uma gravação.
- **Canais elegíveis**: Canais e tópicos do servidor onde você e o bot possam ver e ler o histórico, incluindo canais restritos e tópicos privados. Membros com privacidade `Completo` são ignorados. As configurações de privacidade de canal e de contexto multicanal não excluem suas gravações.
- **Lacunas e duplicatas**: Os trechos são instantâneos sobrepostos com carimbos de data/hora, ordem e links de resposta. A mesma mensagem pode aparecer em vários trechos. Tempo de inatividade, eventos perdidos ou permissões ausentes deixam lacunas (sem preenchimento retroativo).
- **Embeds**: Salva títulos, descrições, campos, nomes de autores e rodapés de embeds como texto de mensagem, com a mesma substituição de identidade do texto comum.
- **Anexos**: Salva contagens de imagens, vídeos, áudios e arquivos (tipos desconhecidos contam como arquivos). Bytes de mídia, nomes de arquivos, URLs de anexos, OCR e descrições de mídia geradas não são salvos.

### Marcadores de identidade legíveis

- Menções estruturadas, canais e cargos usam marcadores estáveis de sessão (`[SELF]`, `[PARTICIPANT_1]`, `[CHANNEL_1]`, `[ROLE_1]`).
- Nomes conhecidos e apelidos exclusivos são substituídos sem diferenciar maiúsculas de minúsculas antes de salvar (o que pode substituir palavras comuns que coincidam com um nome). Nomes compartilhados são ignorados, e nenhuma busca em todo o servidor é realizada.
- Emojis personalizados do Discord se tornam `:nome:`; emojis Unicode permanecem inalterados. Links de mensagens do Discord se tornam um marcador genérico; URLs externas permanecem inalteradas.
- A substituição é feita da melhor forma possível: texto livre e links externos ainda podem identificar pessoas. Texto digitado que se pareça com um marcador permanece como texto literal.

## Exportar e excluir

- **Exportar**: Em `/record data`, escolha um intervalo de tempo e Markdown ou JSON. Intervalos relativos terminam no momento em que você envia; `Todo o período` inclui todos os trechos salvos. Os trechos são selecionados pelo horário da mensagem final deles.
- **Entrega**: Os arquivos chegam em uma resposta privada (salve-os antes que expire). Os nomes de arquivo incluem o horário de exportação em UTC e um ID de exportação curto; arquivos divididos também incluem números de partes. Exportações grandes são divididas entre trechos completos; reduza o intervalo se um intervalo ou trecho exceder os limites de tamanho. Os trechos salvos continuam exportáveis mesmo se você perder o acesso ao canal de origem mais tarde.
- **IDs JSON**: Cada exportação atribui novos IDs opacos (mensagens compartilhadas mantêm o mesmo ID entre arquivos divididos; mensagens com texto idêntico recebem IDs diferentes). Nenhum ID do Discord ou ID armazenado é exportado.
- **Excluir**: Use `Excluir registros do servidor` para escolher um intervalo de tempo, incluindo `Todo o período`, e confirme. Os intervalos de tempo terminam quando você envia a seleção; mensagens gravadas depois disso continuam salvas. Excluir não interrompe uma gravação ativa, e interromper não exclui os registros salvos.

## Privacidade e retenção

- **Acesso do operador e IA**: O operador do bot armazena as gravações em seu banco de dados e pode ter acesso à infraestrutura. A gravação não faz chamadas a provedores de IA e não inicia nenhum fluxo de trabalho de treinamento ou personificação.
- **Cota**: 100 MiB de conteúdo lógico de transcrição em todos os servidores (mensagens compartilhadas contam por trecho). Quando cheia, os trechos completos mais antigos em todos os seus servidores são removidos primeiro.
- **Retenção**: A expiração automática por idade fica desativada a menos que o operador defina `RECORD_RETENTION_DAYS`, o que expira trechos inteiros (incluindo os existentes) pelo horário da mensagem final deles.
- **Edições e exclusões**: Edições observadas na origem atualizam o texto armazenado e a contagem de anexos; exclusões observadas e exclusões de privacidade posteriores removem as cópias armazenadas. Eventos offline ou inacessíveis não podem ser observados, e arquivos baixados ou backups não são afetados. Consulte a [Política de Privacidade](/legal/privacy-policy/) e a [manutenção de gravações](/self-hosting/maintenance/#conversation-recording-storage).
