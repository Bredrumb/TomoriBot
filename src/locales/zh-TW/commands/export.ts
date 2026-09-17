export default {
  export: {
    description: "把你的設定或記憶匯出成可攜檔案。",
    config: {
      description: "把這個伺服器的設定匯出成可攜檔案。",
    },
    memories: {
      description: "把記憶匯出成可攜檔案。",
      scope_description: "要匯出哪些記憶。",
      persona_description: "要匯出哪個人格的記憶。只有「選定的人格」範圍會用到。",
      scope_choice_main: "主要人格",
      scope_choice_persona: "選定的人格",
      scope_choice_all: "所有人格",
    },
    personal: {
      description: "匯出你的帳號擁有的設定或記憶。",
      config: {
        description: "把你的個人設定匯出成可攜檔案。",
      },
      memories: {
        description: "把你帳號擁有的記憶匯出成可攜檔案。",
        scope_description: "要匯出你的哪些記憶。",
        persona_description: "要匯出哪個人格的記憶。只有「選定的人格」範圍會用到。",
        scope_choice_global: "全域",
        scope_choice_persona: "選定的人格",
        scope_choice_all: "所有人格",
      },
    },
  },
};
