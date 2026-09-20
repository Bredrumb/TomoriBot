export default {
  "scheduled-task": {
    description: `Gerenciar tarefas agendadas e lembretes.`,
    edit: {
      description: `Edita uma tarefa agendada ou lembrete.`,
      select_modal_title: `Editar Tarefa Agendada`,
      select_label: `Tarefa Agendada para Editar`,
      select_description: `Escolha qual tarefa agendada ou lembrete editar`,
      select_placeholder: `Selecione uma tarefa agendada...`,
      select_option_description: `[{persona_name}] {reminder_time} ({timezone}) {target_channel} | {reminder_type}{repeat_text}{manager_created_by_text}`,
      select_type_task: `tarefa`,
      select_type_reminder: `lembrete para {user_nickname}`,
      select_repeat_text: ` | repete a cada {hours}h`,
      select_manager_created_by_text: ` | criado por {creator_name}`,
      no_entries_title: `Nenhuma Tarefa Agendada`,
      no_entries: `Não há tarefas agendadas ou lembretes para editar. Defina um me pedindo para lembrá-lo ou agendando uma tarefa.`,
      confirm_title: `Editar Esta Tarefa Agendada?`,
      confirm_description: `**Conteúdo:** {reminder_purpose}
**Próximo Gatilho:** {reminder_time}
**Intervalo em Horas:** {repetition_interval_hours}
**Tipo:** {reminder_type}
**Usuário Alvo:** {target_user}
**Canal:** {target_channel}`,
      modal_title: `Editar Tarefa Agendada`,
      purpose_input_label: `Conteúdo do Lembrete/Tarefa`,
      purpose_input_description: `O texto que o bot vê quando isto é acionado.`,
      purpose_input_placeholder: `O que devo lembrar ou fazer?`,
      time_input_label: `Próximo Horário de Gatilho`,
      time_input_description: `Use o formato de 24 horas, como 14:30 ou 1430.`,
      time_input_placeholder: `14:30`,
      interval_input_label: `Intervalo em Horas`,
      interval_input_description: `Defina 0 para desativar a recorrência.`,
      interval_input_placeholder: `0`,
      reminder_checkbox_label: `É um lembrete para mim`,
      reminder_checkbox_description: `Irá pingar você a cada gatilho.`,
      type_reminder: `Lembrete`,
      type_task: `Tarefa`,
      target_none: `Nenhum`,
      invalid_content_title: `Conteúdo Inválido`,
      invalid_content_description: `O conteúdo da tarefa agendada não pode estar vazio.`,
      invalid_time_title: `Horário de Gatilho Inválido`,
      invalid_time_description: `Insira um horário de 24 horas como \`14:30\`, \`1430\`, \`00:00\` ou \`2400\`.`,
      invalid_interval_title: `Intervalo Inválido`,
      invalid_interval_description: `O intervalo deve ser um número inteiro de horas. Use \`0\` para desativar a recorrência.`,
      no_changes_title: `Sem Alterações`,
      no_changes_description: `A tarefa agendada não foi alterada.`,
      success_title: `Tarefa Agendada Atualizada`,
      success_description: `**Conteúdo:** {reminder_purpose}
**Próximo Gatilho:** {reminder_time}
**Intervalo em Horas:** {repetition_interval_hours}
**Tipo:** {reminder_type}
**Usuário Alvo:** {target_user}
**Canal:** {target_channel}`,
    },
    remove: {
      description: `Remove uma tarefa agendada ou lembrete.`,
      modal_title: `Remover Tarefa Agendada`,
      select_label: `Tarefa Agendada para Remover`,
      select_description: `Escolha qual tarefa agendada ou lembrete remover`,
      select_placeholder: `Selecione uma tarefa agendada...`,
      select_option_description: `[{persona_name}] {reminder_time} ({timezone}) #{target_channel}{repeat_text}{manager_created_by_text}`,
      select_repeat_text: ` | repete a cada {hours}h`,
      select_manager_created_by_text: ` | criado por {creator_name}`,
      no_entries_title: `Nenhuma Tarefa Agendada`,
      no_entries: `Não há tarefas agendadas ou lembretes para remover. Defina um me pedindo para lembrá-lo ou agendando uma tarefa.`,
      success_title: `Tarefa Agendada Removida`,
      success_description: `Removido com sucesso: "{reminder_purpose}"`,
    },
  },
};
