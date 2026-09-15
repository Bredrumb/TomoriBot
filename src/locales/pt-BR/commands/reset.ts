export default {
  reset: {
    description: "Redefine a configuração do servidor ou pessoal para os padrões.",
    config: {
      description: "Redefine a configuração deste servidor para os padrões do banco de dados.",
      confirm_title: "Redefinir Configuração do Servidor",
      confirm_description:
        "> Isso restaura as configurações do servidor para os padrões do banco de dados.\n> Prompts escritos, notas e listas de tags serão redefinidos.\n\n**Seções afetadas:**\n> • Persona: 0 configurações (todas as personas são preservadas)\n> • Comportamento: 9 configurações (prompt de sistema, notas, gatilhos)\n> • Canais: 6 configurações (regras de canal, autogatilhos)\n> • Permissões: 11 configurações (capacidades, permissões)\n> • Modelos: 3 configurações (amostradores, fallbacks; IDs preservados)\n\n**Não modificado:**\n> Personas: {persona_remove}\n> Memórias: {memories} ou {personal_memories}\n> Provedores: {providers} ou {personal_providers}\n> Tarefas agendadas: {scheduled_task_remove}\n> Limpeza completa do servidor: {nuke}\nO consumo de cota registrado e as integrações externas são mantidos intactos.",
      confirm_button: "Redefinir Configuração",
      no_permission_title: "Permissão Negada",
      no_permission_description: "Você precisa da permissão Gerenciar Servidor para redefinir a configuração deste servidor.",
      no_server_data_title: "Nenhum Dado do Servidor",
      no_server_data_description: "Nenhuma configuração foi encontrada para este servidor.",
      success_title: "Configuração Redefinida",
      success_description: "A configuração do servidor foi redefinida para os padrões do banco de dados.",
    },
    personal: {
      description: "Comandos de configuração pessoal.",
      config: {
        description: "Redefine sua configuração pessoal para os padrões do banco de dados.",
        confirm_title: "Redefinir Configuração Pessoal",
        confirm_description:
          "> Isso restaura as configurações pessoais para os padrões do banco de dados.\n\n**Seções afetadas:**\n> • Perfil: apelido, aparência, gênero, pronomes\n> • Privacidade: nível de privacidade, adesão entre servidores\n> • Avançado: modo de resposta, imitação, destaques\n> • Modelos: 0 configurações (todas as configurações do provedor preservadas)\n\n**Não modificado:**\n> Provedores: {personal_providers}\n> Memórias: {personal_memories}\n> Tarefas agendadas: {scheduled_task_remove}\nConfigurações de provedor salvas, endpoints personalizados e outros dados pessoais são mantidos intactos.",
        confirm_button: "Redefinir Configuração",
        success_title: "Configuração Pessoal Redefinida",
        success_description: "A configuração pessoal e os destaques de canal foram redefinidos para os padrões do banco de dados.",
      },
    },
  },
};
