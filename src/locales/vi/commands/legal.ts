export default {
  legal: {
    description: `Xem điều khoản dịch vụ, chính sách quyền riêng tư và giấy phép của TomoriBot.`,
    // The two policy leaves register only on the hosted instance, so a self-hosted bot advertises
    // the license alone rather than a document set it does not expose.
    "license-only": {
      description: `Xem giấy phép nguồn mở của TomoriBot.`,
    },
    "privacy-policy": {
      description: `Xem chính sách quyền riêng tư của TomoriBot`,
      title: `Chính sách quyền riêng tư`,
      description_text: `Xem chính sách quyền riêng tư của TomoriBot để hiểu cách mình xử lý dữ liệu của bạn. Quy định này áp dụng cho phiên bản máy chủ chính thức. Các phiên bản self-hosting tự kiểm soát việc xử lý dữ liệu của mình.`,
      link_title: `Chính sách quyền riêng tư đầy đủ`,
    },
    "terms-of-service": {
      description: `Xem điều khoản dịch vụ của TomoriBot`,
      title: `Điều khoản dịch vụ`,
      description_text: `Xem điều khoản dịch vụ của TomoriBot để hiểu các quy tắc và hướng dẫn khi sử dụng bot. Quy định này áp dụng cho phiên bản máy chủ chính thức. Các phiên bản self-hosting chịu sự điều chỉnh của giấy phép AGPLv3.`,
      link_title: `Toàn văn điều khoản dịch vụ`,
    },
    license: {
      description: `Xem giấy phép nguồn mở của TomoriBot`,
      title: `Giấy phép nguồn mở`,
      description_text: `TomoriBot là phần mềm nguồn mở được cấp phép theo Giấy phép Công cộng GNU Affero v3.0 (AGPLv3). Giấy phép này cho phép bạn tự do sử dụng, sửa đổi và phân phối mã nguồn, với yêu cầu mọi sửa đổi trên các phiên bản lưu trữ công khai cũng phải được mở mã nguồn.`,
      link_title: `Toàn văn giấy phép AGPLv3`,
    },
  },
};
