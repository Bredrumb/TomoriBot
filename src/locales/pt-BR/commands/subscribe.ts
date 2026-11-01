export default {
  subscribe: {
    conversion_nudge: "Para um serviço mais confiável, assine o TomoriBot com `/subscribe`, a partir de apenas $7/mês.",
    conversion_nudge_registration_failed:
      "Pule a configuração: assine o TomoriBot com `/subscribe` para ter acesso à IA sem precisar de sua própria chave de API ou endpoint, a partir de apenas $7/mês.",
    request: {
      title: `Acesso por Assinatura`,
      allowance_title: `Cota insuficiente`,
      minimum_balance_title: `Requisito de cota do modelo`,
      model_unknown: `Este modelo`,
      minimum_balance: `Sua cota restante não é suficiente para {model} iniciar a geração de imagem ou vídeo. Você ainda pode usar o que sobrou com outro modelo. Escolha um em {config}. {fallback}`,
      minimum_balance_reason: `Sua cota restante não é suficiente para {model} iniciar a geração de imagem ou vídeo. Escolha outro modelo em {config} para usar o que sobrou.`,
      scope: {
        personal: `Sua assinatura`,
        server: `A assinatura deste servidor`,
      },
      capabilities: {
        text: `texto`,
        vision: `análise de imagens`,
        image: `geração de imagens`,
        video: `geração de vídeo`,
        voice: `geração de voz`,
        decision: `Decision`,
        embedding: `embedding`,
      },
      renewal: `A cota é renovada em {period_end}.`,
      renewal_unknown: `Verifique {subscription} para a próxima renovação.`,
      allowance_reason: `{scope} não tem cota restante suficiente para esta solicitação. {renewal}`,
      capacity_reason: `{scope} não conseguiu concluir esta solicitação porque o serviço de assinatura do TomoriBot está sem capacidade disponível.`,
      fallback_failed: `Nenhum modelo reserva configurado conseguiu concluir esta solicitação.`,
      exhausted: `{scope} não tem cota restante suficiente para esta solicitação. {renewal} {fallback}\n\nQuem assina pode escolher um plano superior em {subscription}. Você também pode usar outro provedor de IA em {providers} enquanto aguarda.`,
      retry_at: `Tente novamente em {retry_at}.`,
      retry_later: `Tente novamente em alguns minutos.`,
      capacity: `{scope} está temporariamente indisponível porque o serviço de assinatura do TomoriBot atingiu a capacidade máxima. Sua cota não foi afetada. {retry} {fallback}\n\nVocê também pode usar outro provedor de IA em {providers}.`,
      capacity_unavailable: `{scope} está indisponível porque o serviço de assinatura do TomoriBot está sem capacidade, e tentar de novo não adiantará até que seja restaurado. Sua cota não foi afetada. {fallback}\n\nVocê pode usar outro provedor de IA em {providers} enquanto isso.`,
      unsupported: `{scope} não pode usar este modelo de {capability}. Escolha um modelo suportado ou outro provedor de IA em {providers}.`,
      pricing_unavailable: `O TomoriBot não conseguiu verificar o custo deste modelo de {capability}, portanto a solicitação não foi enviada. Tente novamente mais tarde ou escolha outro modelo em {config}.`,
    },
    tiers: {
      unknown: `Assinatura`,
      mochi: `Mochi ($7/mês)`,
      dango: `Dango ($12/mês)`,
      taiyaki: `Taiyaki ($20/mês)`,
    },
    description: `Assine ou vincule sua assinatura do Patreon para acesso à IA do TomoriBot.`,
    sponsorship: {
      errors: {
        title: `Patrocínio de Servidor Indisponível`,
        billing_unavailable: `Assinaturas não estão disponíveis neste bot.`,
        unlinked: `Sua conta do Discord ainda não está vinculada a uma assinatura do Patreon. Use /subscribe para vinculá-la.`,
        inactive: `Sua assinatura não está ativa no momento.`,
        inconsistent: `Há um problema com os dados da sua assinatura, então o patrocínio está pausado. Tente novamente mais tarde ou entre em contato com o suporte.`,
        unconfigured_tier: `Seu nível de assinatura não inclui patrocínio de servidores. Entre em contato com o suporte se isso parecer errado.`,
        exhausted: `Sua cota de assinatura foi esgotada para este período.`,
        missing_sponsorship: `Este servidor não é patrocinado por uma assinatura no momento.`,
        model_not_allowed: `Este modelo não está disponível para acesso por assinatura. Escolha outro modelo nas configurações do provedor.`,
        exhausted_generation: `A cota de assinatura deste servidor foi esgotada. Ela será renovada por volta de {period_end}. O patrocinador pode fazer upgrade pelo /subscribe. Você pode usar outro provedor de IA enquanto aguarda: gerencie provedores do servidor com /providers ou provedores pessoais com /personal providers.`,
      },
    },
    callback: {
      success: {
        title: `Vinculação do Patreon concluída`,
        message: `Sua assinatura do Patreon foi vinculada. Retorne ao Discord e selecione Verificar Assinatura no painel de configuração ou assinatura.`,
        linked_account: `Conta do Discord vinculada: {account}`,
      },
      authorization_denied: {
        title: `Vinculação do Patreon cancelada`,
        message: `O Patreon não autorizou a vinculação. Retorne ao Discord e selecione Vincular Assinatura do Patreon no painel de configuração ou assinatura para tentar novamente.`,
      },
      missing_code: {
        title: `Falha na vinculação do Patreon`,
        message: `A resposta do Patreon não incluiu um código de autorização. Retorne ao Discord e tente /subscribe novamente.`,
      },
      invalid_state: {
        title: `Falha na vinculação do Patreon`,
        message: `O estado da vinculação era inválido. Retorne ao Discord e inicie uma nova vinculação por /subscribe.`,
      },
      expired_state: {
        title: `Link do Patreon expirado`,
        message: `Este link expirou antes de ser concluído. Retorne ao Discord e inicie uma nova vinculação por /subscribe.`,
      },
      state_replay: {
        title: `Link do Patreon já utilizado`,
        message: `Este link já foi utilizado ou não é mais válido. Retorne ao Discord e inicie uma nova vinculação por /subscribe.`,
      },
      invalid_payload: {
        title: `Falha na vinculação do Patreon`,
        message: `O Patreon retornou dados de assinatura incompletos. Retorne ao Discord e tente /subscribe novamente mais tarde.`,
      },
      unlinked_membership: {
        title: `Nenhuma assinatura elegível do Patreon`,
        message: `Esta conta do Patreon não possui uma assinatura elegível. Escolha uma assinatura no Patreon, depois retorne ao Discord e selecione Verificar Assinatura.`,
      },
      wrong_campaign: {
        title: `Campanha do Patreon incorreta`,
        message: `Esta assinatura do Patreon não é da página do TomoriBot no Patreon. Nenhum acesso por assinatura foi concedido.`,
      },
      inactive: {
        title: `Assinatura do Patreon inativa`,
        message: `Esta assinatura do Patreon não está ativa no momento. Nenhum acesso por assinatura foi concedido.`,
      },
      unconfigured_tier: {
        title: `Nível do Patreon não configurado`,
        message: `Este nível do Patreon não inclui acesso ao TomoriBot. Nenhum acesso por assinatura foi concedido.`,
      },
      discord_mismatch: {
        title: `Conta do Patreon incompatível`,
        message: `Esta conta do Patreon está conectada a uma conta diferente do Discord. Execute /subscribe a partir dessa conta ou altere a conexão no Patreon.`,
      },
      patreon_unavailable: {
        title: `Vinculação do Patreon indisponível`,
        message: `Não foi possível alcançar o Patreon ou ele retornou uma resposta inválida. Retorne ao Discord e tente novamente mais tarde.`,
      },
      server_error: {
        title: `Falha na vinculação do Patreon`,
        message: `O TomoriBot não conseguiu concluir a vinculação. Retorne ao Discord e tente novamente mais tarde.`,
      },
    },
  },
};
