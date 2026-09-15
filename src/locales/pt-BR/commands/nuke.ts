export default {
  nuke: {
    description: "Apagar totalmente os dados do servidor. Requer executar /setup novamente depois.",
    confirmation_description: "Confirme se deseja excluir permanentemente os dados do servidor. Isso não pode ser desfeito.",
    confirmation_choice_yes: "Sim, apagar tudo",
    confirmation_choice_no: "Não, cancelar",
    preserve_personas_description: "Manter personas, atributos, configs e memórias intactos (ignora exclusão da árvore).",
    cancelled_title: "Exclusão Cancelada",
    cancelled_description: "Nenhum dado foi alterado. Os dados do servidor estão intactos.",
    success_full_title: "Servidor Apagado",
    success_full_description: "Todos os dados do servidor foram apagados, incluindo personas. Webhooks do Discord apagados: **{webhooks_deleted}** (falhas: **{webhooks_failed}**). Execute `/setup` para começar de novo.",
    success_preserved_title: "Servidor Apagado (Personas Preservadas)",
    success_preserved_description: "Configurações do servidor, listas de permissões, cotas, gatilhos e integrações foram apagados. Personas e seus atributos/memórias foram mantidos. Webhooks do Discord apagados: **{webhooks_deleted}** (falhas: **{webhooks_failed}**). Execute `/setup` para reconfigurar as definições do servidor.",
  },
};
