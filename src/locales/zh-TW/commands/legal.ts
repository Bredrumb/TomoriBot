export default {
  legal: {
    description: `查看 TomoriBot 的服務條款、隱私權政策與授權條款。`,
    // The two policy leaves register only on the hosted instance, so a self-hosted bot advertises
    // the license alone rather than a document set it does not expose.
    "license-only": {
      description: `查看 TomoriBot 的開源授權條款。`,
    },
    "privacy-policy": {
      description: `查看 TomoriBot 的隱私權政策`,
      title: `隱私權政策`,
      description_text: `查看 TomoriBot 的隱私權政策，了解我如何處理你的資料。這適用於官方託管執行個體。自架執行個體自行決定其資料處理方式。`,
      link_title: `完整隱私權政策`,
    },
    "terms-of-service": {
      description: `查看 TomoriBot 的服務條款`,
      title: `服務條款`,
      description_text: `查看 TomoriBot 的服務條款，了解使用這個 bot 的規則與準則。這適用於官方託管執行個體。自架執行個體則受 AGPLv3 授權條款規範。`,
      link_title: `完整服務條款`,
    },
    license: {
      description: `查看 TomoriBot 的開源授權條款`,
      title: `開源授權條款`,
      description_text: `TomoriBot 是採用 GNU Affero 通用公眾授權條款第 3 版（AGPLv3）授權的開源軟體。這個授權條款允許你自由使用、修改與散布程式碼，但要求任何對外託管執行個體的修改也必須開源。`,
      link_title: `完整 AGPLv3 授權條款`,
    },
  },
};
