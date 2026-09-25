export default {
  nuke: {
    description: `Borra completamente todos los datos del servidor. Requiere ejecutar /setup después.`,
    confirmation_description: `Confirma eliminar permanentemente los datos de este servidor. Esto no se puede deshacer.`,
    confirmation_choice_yes: `Sí, bórralo`,
    confirmation_choice_no: `No, cancelar`,
    preserve_personas_description: `Conserva personas y sus atributos/ajustes/memorias (omite eliminar el árbol de personas).`,
    cancelled_title: `Borrado cancelado`,
    cancelled_description: `No se modificó ningún dato. Los datos del servidor están intactos.`,
    success_full_title: `Servidor borrado`,
    success_full_description: `Todos los datos del servidor fueron borrados, incluyendo personas. Webhooks de Discord eliminados: **{webhooks_deleted}** (errores: **{webhooks_failed}**). Ejecuta \`/setup\` para empezar de nuevo.`,
    success_preserved_title: `Servidor borrado (personas preservadas)`,
    success_preserved_description: `Ajustes del servidor, listas blancas, cuotas, activaciones e integraciones fueron borrados. Las personas y sus atributos/memorias se mantuvieron. Webhooks de Discord eliminados: **{webhooks_deleted}** (errores: **{webhooks_failed}**). Ejecuta \`/setup\` para reconfigurar los ajustes a nivel de servidor.`,
  },
};
