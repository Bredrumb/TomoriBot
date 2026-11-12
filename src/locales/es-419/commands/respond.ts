export default {
  respond: {
    description: `Activa manualmente una respuesta al último mensaje en este canal.`,
    prompt_description: `Prompt de sistema opcional para añadir al final del contexto.`,
    prefill_description: `Prellenado opcional del asistente que quieres que continúe.`,
    prefill_instruction_notice: `Este modelo no puede continuar un prellenado, así que lo transmití como una instrucción.`,
    success_title: `Respuesta manual activada`,
    success_description: `Respondiendo al último mensaje en este canal como la última persona...`,
    no_smart_model_title: `No se encontró ningún modelo de razonamiento`,
    no_smart_model_description: `No se encontró ningún modelo de razonamiento para tu proveedor de IA actual. Usa \`/config\` > Modelos > Cambiar modelos para cambiar a un proveedor que admita modelos de razonamiento.`,
    no_messages_title: `No se encontraron mensajes`,
    no_messages_description: `No se encontraron mensajes en este canal. Envía al menos un mensaje antes de usar \`/respond\`.`,
    cooldown_active: `Los administradores de este servidor configuraron un enfriamiento. Espera **{seconds}** segundos antes de usar \`/respond\` de nuevo. Este enfriamiento se comparte con las activaciones por mensaje.`,
    channel_not_whitelisted: `Este servidor tiene restricciones de lista blanca activas. \`/respond\` solo se puede usar en canales autorizados por miembros con roles autorizados, y solo con personas permitidas en este canal.`,
    persona_access_blocked: `Tus permisos actuales de lista blanca y tu configuración personal de spotlight no dejan ninguna persona disponible para \`/respond\` en este canal.`,
  },
};
