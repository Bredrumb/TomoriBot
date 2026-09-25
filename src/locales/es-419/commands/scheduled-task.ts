export default {
  "scheduled-task": {
    description: `Administra tareas programadas y recordatorios.`,
    edit: {
      description: `Edita una tarea programada o un recordatorio.`,
      select_modal_title: `Editar tarea programada`,
      select_label: `Tarea programada a editar`,
      select_description: `Elige qué tarea programada o recordatorio editar`,
      select_placeholder: `Selecciona una tarea programada...`,
      select_option_description: `[{persona_name}] {reminder_time} ({timezone}) {target_channel} | {reminder_type}{repeat_text}{manager_created_by_text}`,
      select_type_task: `tarea`,
      select_type_reminder: `recordatorio para {user_nickname}`,
      select_repeat_text: ` | se repite cada {hours}h`,
      select_manager_created_by_text: ` | creado por {creator_name}`,
      no_entries_title: `No hay tareas programadas`,
      no_entries: `No hay tareas programadas ni recordatorios para editar. Configura uno pidiéndome que te recuerde algo o que programe una tarea.`,
      confirm_title: `¿Editar esta tarea programada?`,
      confirm_description: `**Contenido:** {reminder_purpose}
**Próxima activación:** {reminder_time}
**Intervalo en horas:** {repetition_interval_hours}
**Tipo:** {reminder_type}
**Usuario objetivo:** {target_user}
**Canal:** {target_channel}`,
      modal_title: `Editar tarea programada`,
      purpose_input_label: `Contenido del recordatorio/tarea`,
      purpose_input_description: `El texto que el bot verá cuando esto se active.`,
      purpose_input_placeholder: `¿Qué debo recordar o hacer?`,
      time_input_label: `Próxima hora de activación`,
      time_input_description: `Usa formato de 24 horas, como 14:30 o 1430.`,
      time_input_placeholder: `14:30`,
      interval_input_label: `Intervalo en horas`,
      interval_input_description: `Configura 0 para desactivar la recurrencia.`,
      interval_input_placeholder: `0`,
      reminder_checkbox_label: `Es un recordatorio para mí`,
      reminder_checkbox_description: `Te mencionará en cada activación.`,
      type_reminder: `Recordatorio`,
      type_task: `Tarea`,
      target_none: `Ninguno`,
      invalid_content_title: `Contenido no válido`,
      invalid_content_description: `El contenido de la tarea programada no puede estar vacío.`,
      invalid_time_title: `Hora de activación no válida`,
      invalid_time_description: `Ingresa una hora en formato de 24 horas como \`14:30\`, \`1430\`, \`00:00\` o \`2400\`.`,
      invalid_interval_title: `Intervalo no válido`,
      invalid_interval_description: `El intervalo debe ser un número entero de horas. Usa \`0\` para desactivar la recurrencia.`,
      no_changes_title: `Sin cambios`,
      no_changes_description: `La tarea programada no fue modificada.`,
      success_title: `Tarea programada actualizada`,
      success_description: `**Contenido:** {reminder_purpose}
**Próxima activación:** {reminder_time}
**Intervalo en horas:** {repetition_interval_hours}
**Tipo:** {reminder_type}
**Usuario objetivo:** {target_user}
**Canal:** {target_channel}`,
    },
    remove: {
      description: `Elimina una tarea programada o un recordatorio.`,
      modal_title: `Eliminar tarea programada`,
      select_label: `Tarea programada a eliminar`,
      select_description: `Elige qué tarea programada o recordatorio eliminar`,
      select_placeholder: `Selecciona una tarea programada...`,
      select_option_description: `[{persona_name}] {reminder_time} ({timezone}) #{target_channel}{repeat_text}{manager_created_by_text}`,
      select_repeat_text: ` | se repite cada {hours}h`,
      select_manager_created_by_text: ` | creado por {creator_name}`,
      no_entries_title: `No hay tareas programadas`,
      no_entries: `No hay tareas programadas ni recordatorios para eliminar. Configura uno pidiéndome que te recuerde algo o que programe una tarea.`,
      success_title: `Tarea programada eliminada`,
      success_description: `Se eliminó correctamente: "{reminder_purpose}"`,
    },
  },
};
