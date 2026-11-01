export default {
  subscribe: {
    conversion_nudge: "Para un servicio más confiable, suscríbete a TomoriBot con `/subscribe`, desde solo $7/mes.",
    conversion_nudge_registration_failed:
      "Omite la configuración: suscríbete a TomoriBot con `/subscribe` para acceder a la IA sin tu propia clave de API ni endpoint, desde solo $7/mes.",
    request: {
      title: `Acceso por suscripción`,
      allowance_title: `Cuota insuficiente`,
      minimum_balance_title: `Requisito de cuota del modelo`,
      model_unknown: `Este modelo`,
      minimum_balance: `Tu cuota restante no alcanza para que {model} inicie la generación de imágenes o video. Aún puedes usar lo que te queda con otro modelo. Elige uno en {config}. {fallback}`,
      minimum_balance_reason: `Tu cuota restante no alcanza para que {model} inicie la generación de imágenes o video. Elige otro modelo en {config} para usar lo que te queda.`,
      scope: {
        personal: `Tu suscripción`,
        server: `La suscripción de este servidor`,
      },
      capabilities: {
        text: `texto`,
        vision: `análisis de imágenes`,
        image: `generación de imágenes`,
        video: `generación de video`,
        voice: `generación de voz`,
        decision: `Decision`,
        embedding: `embedding`,
      },
      renewal: `La cuota se renueva {period_end}.`,
      renewal_unknown: `Consulta {subscription} para la próxima renovación.`,
      allowance_reason: `{scope} no tiene suficiente cuota restante para esta solicitud. {renewal}`,
      capacity_reason: `{scope} no pudo completar esta solicitud porque el servicio de suscripción de TomoriBot no tiene capacidad disponible.`,
      fallback_failed: `Ningún modelo de respaldo configurado pudo completar esta solicitud.`,
      exhausted: `{scope} no tiene suficiente cuota restante para esta solicitud. {renewal} {fallback}\n\nEl suscriptor puede elegir un nivel superior mediante {subscription}. También puedes usar otro proveedor de IA a través de {providers} mientras esperas.`,
      retry_at: `Inténtalo de nuevo {retry_at}.`,
      retry_later: `Inténtalo de nuevo en unos minutos.`,
      capacity: `{scope} no está disponible temporalmente porque el servicio de suscripción de TomoriBot está al máximo de su capacidad. Tu cuota no se ve afectada. {retry} {fallback}\n\nTambién puedes usar otro proveedor de IA a través de {providers}.`,
      capacity_unavailable: `{scope} no está disponible porque el servicio de suscripción de TomoriBot no tiene capacidad y reintentar no servirá hasta que se restablezca. Tu cuota no se ve afectada. {fallback}\n\nPuedes usar otro proveedor de IA a través de {providers} mientras tanto.`,
      unsupported: `{scope} no puede usar este modelo de {capability}. Elige un modelo compatible u otro proveedor de IA a través de {providers}.`,
      pricing_unavailable: `TomoriBot no pudo verificar el costo de este modelo de {capability}, por lo que la solicitud no fue enviada. Inténtalo de nuevo más tarde o elige otro modelo en {config}.`,
    },
    tiers: {
      unknown: `Suscripción`,
      mochi: `Mochi ($7/mes)`,
      dango: `Dango ($12/mes)`,
      taiyaki: `Taiyaki ($20/mes)`,
    },
    description: `Suscríbete o vincula tu membresía de Patreon para acceder a la IA de TomoriBot.`,
    sponsorship: {
      errors: {
        title: `Patrocinio de servidor no disponible`,
        billing_unavailable: `Las suscripciones no están disponibles en este bot.`,
        unlinked: `Tu cuenta de Discord aún no está vinculada a una membresía de Patreon. Ejecuta /subscribe para vincularla.`,
        inactive: `Tu suscripción no está activa en este momento.`,
        inconsistent: `Hay un problema con los datos de tu suscripción, así que el patrocinio está en pausa. Inténtalo más tarde o contacta al soporte.`,
        unconfigured_tier: `Tu nivel de suscripción no incluye patrocinio de servidores. Contacta al soporte si crees que es un error.`,
        exhausted: `Tu cuota de suscripción se agotó para este período.`,
        missing_sponsorship: `Este servidor no está patrocinado por una suscripción en este momento.`,
        model_not_allowed: `Este modelo no está disponible para acceso por suscripción. Elige otro modelo en la configuración de proveedores.`,
        exhausted_generation: `Se agotó la cuota de suscripción de este servidor. Se renueva alrededor de {period_end}. Quien patrocina puede mejorar el plan mediante /subscribe. Puedes usar otro proveedor de IA mientras esperas: administra proveedores del servidor con /providers o proveedores personales con /personal providers.`,
      },
    },
    callback: {
      success: {
        title: `Vinculación con Patreon completa`,
        message: `Tu membresía de Patreon se vinculó. Vuelve a Discord y elige Verificar membresía en tu panel de configuración o suscripción.`,
        linked_account: `Cuenta de Discord vinculada: {account}`,
      },
      authorization_denied: {
        title: `Vinculación con Patreon cancelada`,
        message: `Patreon no autorizó la vinculación. Vuelve a Discord y elige Vincular membresía de Patreon en tu panel de configuración o suscripción para intentarlo de nuevo.`,
      },
      missing_code: {
        title: `Error al vincular con Patreon`,
        message: `La respuesta de Patreon no incluyó un código de autorización. Vuelve a Discord e intenta /subscribe de nuevo.`,
      },
      invalid_state: {
        title: `Error al vincular con Patreon`,
        message: `El estado del enlace no es válido. Vuelve a Discord e inicia un nuevo enlace de /subscribe.`,
      },
      expired_state: {
        title: `El enlace de Patreon caducó`,
        message: `Este enlace caducó antes de completarse. Vuelve a Discord e inicia un nuevo enlace de /subscribe.`,
      },
      state_replay: {
        title: `El enlace de Patreon ya se usó`,
        message: `Este enlace ya se usó o ya no es válido. Vuelve a Discord e inicia un nuevo enlace de /subscribe.`,
      },
      invalid_payload: {
        title: `Error al vincular con Patreon`,
        message: `Patreon devolvió datos de membresía incompletos. Vuelve a Discord e intenta /subscribe más tarde.`,
      },
      unlinked_membership: {
        title: `Sin membresía válida de Patreon`,
        message: `Esta cuenta de Patreon no tiene una membresía válida. Elige una membresía en Patreon, luego vuelve a Discord y elige Verificar membresía.`,
      },
      wrong_campaign: {
        title: `Campaña de Patreon incorrecta`,
        message: `Esta membresía de Patreon no pertenece a la página de Patreon de TomoriBot. No se otorgó acceso por suscripción.`,
      },
      inactive: {
        title: `Membresía de Patreon inactiva`,
        message: `Esta membresía de Patreon no está activa en este momento. No se otorgó acceso por suscripción.`,
      },
      unconfigured_tier: {
        title: `Nivel de Patreon no configurado`,
        message: `Este nivel de Patreon no incluye acceso a TomoriBot. No se otorgó acceso por suscripción.`,
      },
      discord_mismatch: {
        title: `Cuenta de Patreon no coincidente`,
        message: `Esta cuenta de Patreon está conectada a otra cuenta de Discord. Ejecuta /subscribe desde esa cuenta o cambia la conexión en Patreon.`,
      },
      patreon_unavailable: {
        title: `Vinculación con Patreon no disponible`,
        message: `No se pudo conectar con Patreon o devolvió una respuesta no válida. Vuelve a Discord e inténtalo de nuevo más tarde.`,
      },
      server_error: {
        title: `Error al vincular con Patreon`,
        message: `TomoriBot no pudo finalizar la vinculación. Vuelve a Discord e inténtalo de nuevo más tarde.`,
      },
    },
  },
};
