export default {
  legal: {
    description: `查看 TomoriBot 的服务条款、隐私政策与许可协议。`,
    // The two policy leaves register only on the hosted instance, so a self-hosted bot advertises
    // the license alone rather than a document set it does not expose.
    "license-only": {
      description: `查看 TomoriBot 的开源许可协议。`,
    },
    "privacy-policy": {
      description: `查看 TomoriBot 的隐私政策`,
      title: `隐私政策`,
      description_text: `查看 TomoriBot 的隐私政策，了解我如何处理你的数据。这适用于官方托管实例。自部署实例自行决定其数据处理方式。`,
      link_title: `完整隐私政策`,
    },
    "terms-of-service": {
      description: `查看 TomoriBot 的服务条款`,
      title: `服务条款`,
      description_text: `查看 TomoriBot 的服务条款，了解使用这个 bot 的规则与准则。这适用于官方托管实例。自部署实例受 AGPLv3 许可协议约束。`,
      link_title: `完整服务条款`,
    },
    license: {
      description: `查看 TomoriBot 的开源许可协议`,
      title: `开源许可协议`,
      description_text: `TomoriBot 是按 GNU Affero 通用公共许可证 v3.0（AGPLv3）授权的开源软件。这个许可允许你自由使用、修改和分发代码，但要求对公开托管实例所做的任何修改也必须开源。`,
      link_title: `完整 AGPLv3 许可协议`,
    },
  },
};
