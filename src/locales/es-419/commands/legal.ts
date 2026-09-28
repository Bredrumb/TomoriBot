export default {
  legal: {
    description: `Consulta los términos de servicio, la política de privacidad y la licencia de TomoriBot.`,
    // The two policy leaves register only on the hosted instance, so a self-hosted bot advertises
    // the license alone rather than a document set it does not expose.
    "license-only": {
      description: `Consulta la licencia de código abierto de TomoriBot.`,
    },
    "privacy-policy": {
      description: `Consulta la política de privacidad de TomoriBot`,
      title: `Política de privacidad`,
      description_text: `Consulta la política de privacidad de TomoriBot para entender cómo manejo tus datos. Esto aplica a la instancia oficial alojada. Las instancias autoalojadas controlan su propio manejo de datos.`,
      link_title: `Política de privacidad completa`,
    },
    "terms-of-service": {
      description: `Consulta los términos de servicio de TomoriBot`,
      title: `Términos de servicio`,
      description_text: `Consulta los términos de servicio de TomoriBot para entender las reglas y pautas de uso del bot. Esto aplica a la instancia oficial alojada. Las instancias autoalojadas se rigen por la licencia AGPLv3.`,
      link_title: `Términos de servicio completos`,
    },
    license: {
      description: `Consulta la licencia de código abierto de TomoriBot`,
      title: `Licencia de código abierto`,
      description_text: `TomoriBot es software de código abierto licenciado bajo la Licencia Pública General de Affero de GNU v3.0 (AGPLv3). Esta licencia te permite usar, modificar y distribuir el código libremente, con el requisito de que cualquier modificación a instancias públicamente alojadas también debe ser de código abierto.`,
      link_title: `Licencia AGPLv3 completa`,
    },
  },
};
