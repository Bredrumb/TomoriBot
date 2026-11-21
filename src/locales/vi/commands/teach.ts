export default {
  teach: {
    sampledialogue: {
      description: `Thêm cặp đối thoại mẫu người dùng/bot làm ví dụ về cách mình nên trả lời.`,
    },
    attribute: {
      description: `Thêm thuộc tính tính cách miêu tả mình cho máy chủ này.`,
    },
    document: {
      description: `Tải lên tài liệu để mình tham khảo bằng Retrieval-Augmented Generation.`,
      main_persona_description: `Persona chính`,
      alter_persona_description: `Alter persona`,
    },
    personaprompt: {
      description: `Đặt prompt riêng cho persona được gắn sau prompt hệ thống`,
      modal_title: `Đặt prompt persona`,
      part1_placeholder: `Ví dụ: Nói như một chiến thuật gia kỳ cựu, ngắn gọn và điềm tĩnh.`,
      part2_placeholder: `Chỉ dẫn bổ sung cho persona...`,
      part3_placeholder: `Thêm chỉ dẫn cho persona...`,
      part4_placeholder: `Chỉ dẫn cuối cho persona...`,
      success_title: `Đã cập nhật prompt persona`,
      success_description: `Đã cập nhật prompt persona cho "{persona_name}".`,
    },
    memory: {
      description: `Quản lý bộ nhớ của mình`,
      personal: {
        description: `Thêm bộ nhớ cá nhân về bạn mà mình có thể nhớ trên mọi máy chủ.`,
      },
      server: {
        description: `Thêm bộ nhớ máy chủ vào cơ sở tri thức của mình.`,
      },
    },
  },
};
