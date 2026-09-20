export default {
  legal: {
    description: `Ver os termos de serviço, política de privacidade e licença do TomoriBot.`,
    // The two policy leaves register only on the hosted instance, so a self-hosted bot advertises
    // the license alone rather than a document set it does not expose.
    "license-only": {
      description: `Ver a licença de código aberto do TomoriBot.`,
    },
    "privacy-policy": {
      description: `Ver a Política de Privacidade do TomoriBot`,
      title: `Política de Privacidade`,
      description_text: `Veja a Política de Privacidade do TomoriBot para entender como eu lido com seus dados. Isso se aplica à instância hospedada oficial. Instâncias com hospedagem própria controlam seu próprio manuseio de dados.`,
      link_title: `Política de Privacidade Completa`,
    },
    "terms-of-service": {
      description: `Ver os Termos de Serviço do TomoriBot`,
      title: `Termos de Serviço`,
      description_text: `Veja os Termos de Serviço do TomoriBot para entender as regras e diretrizes de uso do bot. Isso se aplica à instância hospedada oficial. Instâncias com hospedagem própria são regidas pela licença AGPLv3.`,
      link_title: `Termos de Serviço Completos`,
    },
    license: {
      description: `Ver a licença de código aberto do TomoriBot`,
      title: `Licença de Código Aberto`,
      description_text: `TomoriBot é um software de código aberto licenciado sob a GNU Affero General Public License v3.0 (AGPLv3). Esta licença permite que você use, modifique e distribua o código livremente, com o requisito de que quaisquer modificações para instâncias hospedadas publicamente também devem ser de código aberto.`,
      link_title: `Licença AGPLv3 Completa`,
    },
  },
};
