export default {
  subscribe: {
    conversion_nudge: "Để có dịch vụ ổn định hơn, hãy đăng ký TomoriBot bằng `/subscribe`, chỉ từ $7/tháng.",
    conversion_nudge_registration_failed:
      "Bỏ qua thiết lập: đăng ký TomoriBot bằng `/subscribe` để truy cập AI mà không cần API key hay endpoint riêng của bạn, chỉ từ $7/tháng.",
    request: {
      title: `Quyền truy cập gói đăng ký`,
      allowance_title: `Hạn mức không đủ`,
      minimum_balance_title: `Yêu cầu hạn mức model`,
      model_unknown: `Model này`,
      minimum_balance: `Hạn mức còn lại của bạn không đủ để {model} bắt đầu tạo hình ảnh hoặc video. Bạn vẫn có thể dùng phần còn lại với model khác. Hãy chọn một model trong {config}. {fallback}`,
      minimum_balance_reason: `Hạn mức còn lại của bạn không đủ để {model} bắt đầu tạo hình ảnh hoặc video. Hãy chọn model khác trong {config} để dùng phần còn lại.`,
      scope: {
        personal: `Gói đăng ký của bạn`,
        server: `Gói đăng ký của máy chủ này`,
      },
      capabilities: {
        text: `văn bản`,
        vision: `phân tích hình ảnh`,
        image: `tạo hình ảnh`,
        video: `tạo video`,
        voice: `tạo giọng nói`,
        decision: `Decision`,
        embedding: `embedding`,
      },
      renewal: `Hạn mức sẽ được làm mới vào {period_end}.`,
      renewal_unknown: `Kiểm tra {subscription} để biết lần làm mới tiếp theo.`,
      allowance_reason: `{scope} không còn đủ hạn mức để xử lý yêu cầu này. {renewal}`,
      capacity_reason: `{scope} không thể hoàn thành yêu cầu này vì dịch vụ đăng ký của TomoriBot không còn dung lượng phục vụ.`,
      fallback_failed: `Không có model dự phòng nào được cấu hình có thể hoàn tất yêu cầu này.`,
      exhausted: `{scope} không còn đủ hạn mức để xử lý yêu cầu này. {renewal} {fallback}\n\nNgười đăng ký có thể chọn gói cao hơn qua {subscription}. Bạn cũng có thể dùng nhà cung cấp AI khác qua {providers} trong khi chờ đợi.`,
      retry_at: `Hãy thử lại vào {retry_at}.`,
      retry_later: `Hãy thử lại sau vài phút.`,
      capacity: `{scope} tạm thời không khả dụng vì dịch vụ đăng ký của TomoriBot đang quá tải. Hạn mức của bạn không bị ảnh hưởng. {retry} {fallback}\n\nBạn cũng có thể dùng nhà cung cấp AI khác qua {providers}.`,
      capacity_unavailable: `{scope} không khả dụng vì dịch vụ đăng ký của TomoriBot đã hết công suất, việc thử lại sẽ không có tác dụng cho đến khi dịch vụ được phục hồi. Hạn mức của bạn không bị ảnh hưởng. {fallback}\n\nTrong lúc đó, bạn có thể dùng nhà cung cấp AI khác qua {providers}.`,
      unsupported: `{scope} không thể dùng model {capability} này. Hãy chọn một model được hỗ trợ hoặc nhà cung cấp AI khác qua {providers}.`,
      pricing_unavailable: `TomoriBot không thể kiểm tra chi phí của model {capability} này, vì vậy yêu cầu chưa được gửi. Hãy thử lại sau hoặc chọn model khác trong {config}.`,
    },
    tiers: {
      unknown: `Gói đăng ký`,
      mochi: `Mochi ($7/tháng)`,
      dango: `Dango ($12/tháng)`,
      taiyaki: `Taiyaki ($20/tháng)`,
    },
    description: `Đăng ký hoặc liên kết tư cách thành viên Patreon để truy cập AI của TomoriBot.`,
    sponsorship: {
      errors: {
        title: `Không thể tài trợ máy chủ`,
        billing_unavailable: `Bot này không hỗ trợ gói đăng ký.`,
        unlinked: `Tài khoản Discord của bạn chưa được liên kết với tư cách thành viên Patreon. Hãy chạy /subscribe để liên kết.`,
        inactive: `Gói đăng ký của bạn hiện không hoạt động.`,
        inconsistent: `Dữ liệu gói đăng ký của bạn đang gặp sự cố nên việc tài trợ tạm dừng. Hãy thử lại sau hoặc liên hệ hỗ trợ.`,
        unconfigured_tier: `Gói đăng ký của bạn không bao gồm tài trợ máy chủ. Hãy liên hệ hỗ trợ nếu bạn thấy điều này không đúng.`,
        exhausted: `Hạn mức gói đăng ký của bạn đã dùng hết trong chu kỳ này.`,
        missing_sponsorship: `Máy chủ này hiện không được tài trợ bởi gói đăng ký nào.`,
        model_not_allowed: `Model này không khả dụng cho quyền truy cập đăng ký. Hãy chọn model khác trong cài đặt nhà cung cấp.`,
        exhausted_generation: `Hạn mức đăng ký của máy chủ này đã hết. Hạn mức sẽ làm mới vào khoảng {period_end}. Người tài trợ có thể nâng cấp qua /subscribe. Bạn có thể dùng nhà cung cấp AI khác trong khi chờ: quản lý nhà cung cấp máy chủ bằng /providers hoặc nhà cung cấp cá nhân bằng /personal providers.`,
      },
    },
    callback: {
      success: {
        title: `Liên kết Patreon hoàn tất`,
        message: `Tư cách thành viên Patreon của bạn đã được liên kết. Hãy quay lại Discord và chọn Xác minh tư cách thành viên trong bảng thiết lập hoặc đăng ký.`,
        linked_account: `Tài khoản Discord đã liên kết: {account}`,
      },
      authorization_denied: {
        title: `Đã hủy liên kết Patreon`,
        message: `Patreon không ủy quyền cho liên kết này. Hãy quay lại Discord và chọn Liên kết tư cách thành viên Patreon trong bảng thiết lập hoặc đăng ký để thử lại.`,
      },
      missing_code: {
        title: `Liên kết Patreon thất bại`,
        message: `Phản hồi từ Patreon không chứa mã ủy quyền. Hãy quay lại Discord và thử lại /subscribe.`,
      },
      invalid_state: {
        title: `Liên kết Patreon thất bại`,
        message: `Trạng thái liên kết không hợp lệ. Hãy quay lại Discord và bắt đầu liên kết /subscribe mới.`,
      },
      expired_state: {
        title: `Liên kết Patreon đã hết hạn`,
        message: `Liên kết này đã hết hạn trước khi hoàn tất. Hãy quay lại Discord và bắt đầu liên kết /subscribe mới.`,
      },
      state_replay: {
        title: `Liên kết Patreon đã được sử dụng`,
        message: `Liên kết này đã được sử dụng hoặc không còn hiệu lực. Hãy quay lại Discord và bắt đầu liên kết /subscribe mới.`,
      },
      invalid_payload: {
        title: `Liên kết Patreon thất bại`,
        message: `Patreon đã trả về dữ liệu thành viên không đầy đủ. Hãy quay lại Discord và thử lại /subscribe sau.`,
      },
      unlinked_membership: {
        title: `Không có tư cách thành viên Patreon hợp lệ`,
        message: `Tài khoản Patreon này không có tư cách thành viên hợp lệ. Hãy chọn một gói thành viên trên Patreon, sau đó quay lại Discord và chọn Xác minh tư cách thành viên.`,
      },
      wrong_campaign: {
        title: `Sai chiến dịch Patreon`,
        message: `Tư cách thành viên Patreon này không thuộc trang Patreon của TomoriBot. Chưa cấp quyền truy cập gói đăng ký.`,
      },
      inactive: {
        title: `Tư cách thành viên Patreon không hoạt động`,
        message: `Tư cách thành viên Patreon này hiện không hoạt động. Chưa cấp quyền truy cập gói đăng ký.`,
      },
      unconfigured_tier: {
        title: `Gói Patreon chưa được cấu hình`,
        message: `Gói Patreon này không bao gồm quyền truy cập TomoriBot. Chưa cấp quyền truy cập gói đăng ký.`,
      },
      discord_mismatch: {
        title: `Tài khoản Patreon không khớp`,
        message: `Tài khoản Patreon này được kết nối với một tài khoản Discord khác. Hãy chạy /subscribe từ tài khoản đó, hoặc thay đổi kết nối trên Patreon.`,
      },
      patreon_unavailable: {
        title: `Liên kết Patreon không khả dụng`,
        message: `Không thể kết nối đến Patreon hoặc nhận được phản hồi không hợp lệ. Hãy quay lại Discord và thử lại sau.`,
      },
      server_error: {
        title: `Liên kết Patreon thất bại`,
        message: `TomoriBot không thể hoàn tất liên kết. Hãy quay lại Discord và thử lại sau.`,
      },
    },
  },
};
