export default {
  teach: {
    sampledialogue: {
      description: `新增一組使用者與 bot 的範例對話，作為我該怎麼回覆的參考。`,
    },
    attribute: {
      description: `新增一項描述我的個性屬性，供這個伺服器使用。`,
    },
    document: {
      description: `上傳文件，讓我用檢索增強生成（RAG）參考。`,
      main_persona_description: `主要人格`,
      alter_persona_description: `alter`,
    },
    personaprompt: {
      description: `設定附加在系統提示詞之後的人格專屬提示詞`,
      modal_title: `設定人格提示詞`,
      part1_placeholder: `例如：像身經百戰的戰術家，講話簡潔冷靜。`,
      part2_placeholder: `其他的人格指示...`,
      part3_placeholder: `更多的人格指示...`,
      part4_placeholder: `最後的人格指示...`,
      success_title: `人格提示詞已更新`,
      success_description: `已更新「{persona_name}」的人格提示詞。`,
    },
    memory: {
      description: `管理我的記憶`,
      personal: {
        description: `新增一則關於你的個人記憶，讓我在任何伺服器都記得。`,
      },
      server: {
        description: `新增一則伺服器記憶到我的知識庫。`,
      },
    },
  },
};
