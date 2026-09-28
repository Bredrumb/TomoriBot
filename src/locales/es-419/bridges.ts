export default {
  matrix: {
    notices: {
      invited: `TomoriBot se unió a esta sala.

Para terminar la configuración:
1. En Discord, ejecuta {link_command} en el canal que quieras vincular.
2. Pega el ID interno de esta sala desde {room_id_path}.

Importante:
- Esta sala debe permanecer sin cifrado.
- Una vez vinculada, puedes hablar aquí normalmente.
- Los únicos comandos de texto de Matrix son {kill_command} y {refresh_command}.

Usa {help_command} en Discord para consultar la guía completa y la lista de limitaciones.`,
      linked: `Esta sala ahora está vinculada al canal de Discord {channel_name}.

Consejos rápidos:
- Chatea aquí normalmente para hablar con TomoriBot.
- Los únicos comandos de texto de Matrix son {kill_command} y {refresh_command}.
- Los comandos de barra, los mensajes directos y fijar mensajes no están disponibles desde Matrix.
- Los emojis personalizados y el Markdown no se muestran de forma confiable, y los embeds se retransmiten como texto plano.
- Las memorias personales de usuarios de Matrix recurren a las memorias del servidor.

Usa {help_command} en Discord para consultar la guía completa y las limitaciones actuales.`,
    },
  },
};
