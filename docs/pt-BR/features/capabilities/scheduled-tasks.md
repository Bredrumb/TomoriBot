---
title: "Tarefas Agendadas"
sidebar:
  order: 2
---

A TomoriBot pode definir lembretes e agendar tarefas para mais tarde: pontuais ou recorrentes. A forma mais fácil é simplesmente **pedir a ela**; ela cria a tarefa por meio de sua ferramenta `create_task`. As tarefas agendadas são específicas de cada persona.

Cada persona mantém suas tarefas próprias pendentes no contexto sempre que responde, independentemente de quais membros aparecem na conversa recente. Lembretes direcionados a humanos são mais seletivos: o alvo deve estar presente ou referenciado no contexto da conversa ativa, e o lembrete deve pertencer à persona ativa.

## Criando uma Tarefa

Basta dizer a ela no chat:

```text
lembre-me de enviar o relatório às 14:30
toda sexta-feira às 20h, poste um lembrete de que a noite de jogos está começando
```

Ela analisa o horário e a recorrência e faz o agendamento. Os lembretes **mencionam o usuário-alvo** quando disparam; as tarefas são ações próprias silenciosas que a persona executa no horário agendado.

## Fusos Horários

Horários absolutos ("at 14:30", "on Friday at 8pm") são interpretados no **fuso horário do servidor** (`/config` > Engine > General) por padrão. Se você tiver configurado um fuso horário pessoal com `/personal config`, a IA verá seu relógio local no contexto e rotulará seus horários com seu deslocamento UTC ao criar a tarefa. O bot então faz a conversão de forma determinística, de modo que "remind me at 9am" signifique as *suas* 9h, mesmo se o servidor estiver em outro continente. Horários relativos ("in 2 hours") não dependem de fuso horário e são sempre seguros.

Quando um lembrete tem como alvo um usuário cujo fuso horário pessoal difere do servidor, o embed de confirmação mostra **ambos os relógios** (horário do servidor e o horário local do alvo), para que um horário rotulado incorretamente fique imediatamente visível e possa ser corrigido com uma mensagem de acompanhamento ou com `/scheduled-task edit`.

## Gerenciando Tarefas

Dois comandos slash permitem revisar e ajustar agendamentos existentes:

- `/scheduled-task edit`: altera o conteúdo de uma tarefa, o próximo horário de disparo, o intervalo de recorrência ou se é um lembrete. Defina o intervalo como `0` para desativar a recorrência.
- `/scheduled-task remove`: exclui um lembrete ou tarefa.

Ambos abrem um seletor listando seus agendamentos existentes (persona, horário, canal e recorrência), para que você não precise se lembrar de IDs.

## Como Funciona a Entrega

Os lembretes são entregues por um agendador interno do aplicativo e só são marcados como concluídos **após o sucesso da entrega**; se uma entrega for abortada ou a fila do canal for limpa, ela será repetida automaticamente. Os atrasos de repetição não alteram a cadência recorrente original.

Tentativas automatizadas não publicam uma mensagem de erro a cada tentativa. Se a entrega ainda falhar após o limite de repetições, a TomoriBot publicará um aviso contendo o conteúdo agendado inalterado e seu ID. Lembretes humanos com falha mencionam o alvo para que o lembrete não seja perdido; tarefas próprias com falha não mencionam ninguém. Os agendamentos pontuais são então removidos, enquanto os agendamentos recorrentes permanecem ativos para a próxima ocorrência original e podem ser gerenciados com `/scheduled-task edit` ou `/scheduled-task remove`. Para obter detalhes do runtime, consulte a [visão geral da arquitetura](/en/architecture/#runtime-extensions).

---

O agendamento é uma das várias capacidades de agente; veja [Ferramentas & Extensões](/pt-BR/features/capabilities/tools-and-extensions/) para obter uma visão completa.
