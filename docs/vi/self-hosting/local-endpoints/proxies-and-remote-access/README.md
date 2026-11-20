---
title: "Proxy và truy cập từ xa"
sidebar:
  label: "Tổng quan"
  groupLabel: "Proxy và truy cập từ xa"
  order: 8
---

Kết nối TomoriBot thông qua proxy API cục bộ, hoặc kết nối an toàn tới engine đang chạy trên một máy tính khác.

## Chọn hướng dẫn

1. [ChatMock](/self-hosting/local-endpoints/proxies-and-remote-access/setup-chatmock/): kết nối cầu nối dùng tài khoản ChatGPT trên máy của bạn.
2. [CLIProxyAPI](/self-hosting/local-endpoints/proxies-and-remote-access/setup-cliproxyapi/): cài đặt proxy và đăng ký các model từ một backend được ủy quyền.
3. [Cloudflare Tunnel](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/): cấp cho engine cục bộ một URL HTTPS cho bot được lưu trữ riêng.
4. [Tùy chọn: Access và Caddy](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-access-and-caddy/): thêm một bước kiểm tra xác thực riêng và định tuyến API chặt chẽ hơn.

Hãy bắt đầu với hướng dẫn proxy nếu bạn cần. Chỉ làm theo hướng dẫn Cloudflare khi bot chạy trên một máy khác.

## Rủi ro tài khoản
<!-- anchor: account-risk -->

:::danger[Tự chịu rủi ro khi dùng proxy tài khoản CLI]
Việc sử dụng Codex, Claude Code, Antigravity hoặc tài khoản CLI khác thông qua cầu nối của bên thứ ba có thể vi phạm điều khoản của nhà cung cấp và dẫn đến tạm khóa hoặc chấm dứt tài khoản. Gói đăng ký trả phí hoặc việc đăng nhập thành công không đồng nghĩa với quyền sử dụng cho bot hoặc API mục đích chung. Hãy kiểm tra quy định đối với nhà cung cấp, gói dịch vụ và phương thức xác thực của bạn. TomoriBot không đưa ra bất kỳ đảm bảo an toàn tài khoản nào.
:::

Quy định của từng nhà cung cấp khác nhau:

- [Điều khoản của OpenAI](https://openai.com/policies/terms-of-use/) áp dụng cho việc sử dụng tài khoản cá nhân, với các điều khoản riêng cho dịch vụ API và doanh nghiệp. Hãy xem kỹ các điều khoản áp dụng cho tài khoản Codex của bạn và phương thức truy cập của cầu nối.
- [Chính sách xác thực của Anthropic](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use) hạn chế việc dùng OAuth của gói đăng ký và định tuyến qua bên thứ ba thay mặt người dùng. Chính sách này hướng dẫn các nhà phát triển xây dựng dịch vụ sử dụng API key hoặc các nhà cung cấp đám mây được hỗ trợ.
- [Điều khoản Antigravity của Google](https://antigravity.google/terms) nghiêm cấm rõ ràng việc truy cập từ bên thứ ba như cầu nối OAuth của Antigravity và cho phép tạm khóa hoặc chấm dứt tài khoản. Hướng dẫn này không khuyến nghị phương thức truy cập đó.

Chỉ sử dụng các backend mà bạn được phép truy cập. Đối với các tích hợp được nhà cung cấp hỗ trợ, hãy dùng nhà cung cấp tích hợp sẵn của TomoriBot khi khả dụng, chẳng hạn như Google với [Gemini API key](https://ai.google.dev/gemini-api/docs/api-key), hoặc một endpoint API được ủy quyền. CLIProxyAPI, CLI hoặc ứng dụng gốc và dịch vụ model thượng nguồn là các sản phẩm riêng biệt.
