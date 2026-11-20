export default {
  // The config panel reads several strings from this namespace even though every `/model` leaf but
  // `override remove` is dissolved, so pruning it wholesale breaks the Channels and Models pages.
  model: {
    description: `Administra los modelos de IA predeterminados de este servidor.`,
    providerPicker: {
      no_providers_title: `No hay proveedores guardados`,
      no_providers_description: `No hay proveedores guardados disponibles para esta capacidad. Agrega uno con \`/providers\` primero.`,
    },
    text: {
      no_models_title: `No se encontraron modelos`,
      no_models_description: `No se pudieron cargar los modelos de IA disponibles desde la base de datos.`,
      invalid_model_title: `Modelo no válido`,
      invalid_model_description: `El nombre del modelo seleccionado no es válido o no está disponible.`,
      success_title: `Modelo actualizado`,
      scope_set_persona_success: `El modelo para **{persona}** se configuró en **{model}**`,
    },
    fallback: {
      custom_provider_label: `Personalizado`,
      no_models_description: `No hay modelos disponibles para el proveedor seleccionado.`,
    },
    override: {
      remove: {
        description: `Elimina las excepciones de modelo de canal y persona.`,
        modal_title: `Eliminar excepciones de modelo`,
        channel_unknown: `Desconocido`,
        channel_checkbox_label: `Excepciones de canal`,
        channel_checkbox_label_continued: `Excepciones de canal (continuación)`,
        channel_checkbox_description: `Desmarca cualquier excepción de canal que quieras eliminar. Se edita en /config > Canales > Excepciones.`,
        persona_checkbox_label: `Excepciones de persona`,
        persona_checkbox_label_continued: `Excepciones de persona (continuación)`,
        persona_checkbox_description: `Desmarca cualquier excepción de persona que quieras eliminar. Se edita en /config > Persona > Excepciones.`,
        mixed_checkbox_label: `Excepciones de canal y persona`,
        mixed_checkbox_label_continued: `Excepciones de canal y persona (continuación)`,
        mixed_checkbox_description: `Desmarca cualquier excepción de canal o persona que quieras eliminar.`,
        none_title: `Sin excepciones de modelo`,
        none_description: `Este servidor no tiene excepciones de modelo de canal ni de persona configuradas.`,
        no_removals_title: `No se eliminó ninguna excepción de modelo`,
        no_removals_description: `No se desmarcó ninguna excepción. Las excepciones de modelo permanecen sin cambios.`,
        success_title: `Excepciones de modelo actualizadas`,
        success_description: `Se eliminaron las siguientes excepciones de modelo.
{removed_overrides}`,
        page_select_prompt: `Se encontraron {total} excepciones de modelo. Selecciona un lote para eliminar:`,
        page_select_prompt_capped: `Se encontraron {total} excepciones de modelo. Las primeras {shown} se muestran en 25 lotes; elimina algunas para llegar al resto.`,
      },
      description: `Administra las excepciones de modelo de canal y persona.`,
    },
  },
};
