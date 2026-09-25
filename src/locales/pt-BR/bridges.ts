export default {
  matrix: {
    notices: {
      invited: `TomoriBot entrou nesta sala.

Para concluir a configuração:
1. No Discord, execute {link_command} no canal que você deseja vincular.
2. Cole o ID Interno da Sala a partir de {room_id_path}.

Importante:
- Esta sala deve permanecer sem criptografia.
- Uma vez vinculada, você pode conversar aqui normalmente.
- Os únicos comandos de texto do Matrix são {kill_command} e {refresh_command}.

Use {help_command} no Discord para o guia completo e a lista de limitações.`,
      linked: `Esta sala agora está vinculada ao canal do Discord {channel_name}.

Dicas rápidas:
- Converse aqui normalmente para falar com a TomoriBot.
- Os únicos comandos de texto do Matrix são {kill_command} e {refresh_command}.
- Comandos de barra, DMs e mensagens fixadas não estão disponíveis pelo Matrix.
- Emojis personalizados e Markdown não são renderizados de forma confiável, e os embeds são retransmitidos como texto simples.
- As memórias pessoais para usuários do Matrix usam as memórias do servidor como alternativa.

Use {help_command} no Discord para o guia completo e as limitações atuais.`,
    },
  },
};
