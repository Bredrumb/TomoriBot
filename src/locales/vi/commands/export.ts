export default {
  export: {
    description: "Xuất cấu hình hoặc bộ nhớ thành tệp di động.",
    config: {
      description: "Xuất cấu hình máy chủ này thành tệp di động.",
    },
    memories: {
      description: "Xuất bộ nhớ thành tệp di động.",
      scope_description: "Chọn loại bộ nhớ cần xuất.",
      persona_description: "Persona cần xuất bộ nhớ. Chỉ áp dụng cho phạm vi Persona đã chọn.",
      scope_choice_main: "Persona chính",
      scope_choice_persona: "Persona đã chọn",
      scope_choice_all: "Tất cả persona",
    },
    personal: {
      description: "Xuất cấu hình hoặc bộ nhớ thuộc sở hữu của tài khoản bạn.",
      config: {
        description: "Xuất cấu hình cá nhân của bạn thành tệp di động.",
      },
      memories: {
        description: "Xuất bộ nhớ thuộc sở hữu tài khoản bạn thành tệp di động.",
        scope_description: "Chọn bộ nhớ cá nhân nào cần xuất.",
        persona_description: "Persona cần xuất bộ nhớ. Chỉ áp dụng cho phạm vi Persona đã chọn.",
        scope_choice_global: "Toàn cục",
        scope_choice_persona: "Persona đã chọn",
        scope_choice_all: "Tất cả persona",
      },
    },
  },
};
