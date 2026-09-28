export default {
  // The config panel reads several strings from this namespace even though every `/model` leaf but
  // `override remove` is dissolved, so pruning it wholesale breaks the Channels and Models pages.
  model: {
    description: `Gerencia os modelos de IA padrão deste servidor.`,
    providerPicker: {
      no_providers_title: `Nenhum Provedor Salvo`,
      no_providers_description: `Nenhum provedor salvo está disponível para esta capacidade. Adicione um com \`/providers\` primeiro.`,
    },
    text: {
      no_models_title: `Nenhum Modelo Encontrado`,
      no_models_description: `Não foi possível carregar os modelos de IA disponíveis do banco de dados.`,
      invalid_model_title: `Modelo Inválido`,
      invalid_model_description: `O nome do modelo selecionado não é válido ou não está disponível.`,
      success_title: `Modelo Atualizado`,
      scope_set_persona_success: `Modelo para **{persona}** definido como **{model}**`,
    },
    fallback: {
      custom_provider_label: `Personalizado`,
      no_models_description: `Não há modelos disponíveis para o provedor selecionado.`,
    },
    override: {
      remove: {
        description: `Remove substituições de modelos de canais e personas.`,
        modal_title: `Remover Substituições de Modelo`,
        channel_unknown: `Desconhecido`,
        channel_checkbox_label: `Substituições de Canal`,
        channel_checkbox_label_continued: `Substituições de Canal (Continuação)`,
        channel_checkbox_description: `Desmarque qualquer substituição de canal que deseja remover. Editado em /config > Canais > Substituições.`,
        persona_checkbox_label: `Substituições de Persona`,
        persona_checkbox_label_continued: `Substituições de Persona (Continuação)`,
        persona_checkbox_description: `Desmarque qualquer substituição de persona que deseja remover. Editado em /config > Persona > Substituições.`,
        mixed_checkbox_label: `Substituições de Canal & Persona`,
        mixed_checkbox_label_continued: `Substituições de Canal & Persona (Continuação)`,
        mixed_checkbox_description: `Desmarque qualquer substituição de canal ou persona que deseja remover.`,
        none_title: `Nenhuma Substituição de Modelo`,
        none_description: `Este servidor não tem substituições de modelo de canal ou persona configuradas.`,
        no_removals_title: `Nenhuma Substituição de Modelo Removida`,
        no_removals_description: `Nenhuma substituição foi desmarcada. As substituições de modelo permanecem inalteradas.`,
        success_title: `Substituições de Modelo Atualizadas`,
        success_description: `As seguintes substituições de modelo foram removidas.
{removed_overrides}`,
        page_select_prompt: `Encontrou {total} substituições de modelo. Selecione um lote para remover:`,
        page_select_prompt_capped: `Encontrou {total} substituições de modelo. As primeiras {shown} são exibidas em 25 lotes; remova algumas para alcançar o resto.`,
      },
      description: `Gerencia substituições de modelos de canais e personas.`,
    },
  },
};
