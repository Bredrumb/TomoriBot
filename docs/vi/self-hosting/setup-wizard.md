---
title: "Trình hướng dẫn thiết lập"
aiGenerated: false
sidebar:
  label: "Trình hướng dẫn thiết lập"
  order: 1
---

:::note
Người dùng muốn sử dụng Docker Compose nên bỏ qua trình hướng dẫn này, xem
[Docker Compose](/self-hosting/docker-compose/) để biết phương thức cài đặt bằng container.
:::

`bun run setup` là phương thức self-host được khuyến nghị cho các bản cài đặt cục bộ dựa trên Bun. Lệnh này cài đặt các phần phụ thuộc từ `bun.lock` trước khi nạp trình hướng dẫn, bao gồm cả trên bản clone mới. Trình hướng dẫn sẽ tạo `.env`, tạo một `CRYPTO_SECRET`, yêu cầu token bot Discord của bạn, hỏi có [cho phép mạng riêng tư](#private-networks) hay không và cấu hình PostgreSQL. Lệnh này an toàn để chạy lại; các giá trị `.env` hiện có sẽ được giữ nguyên trừ khi bạn chọn cấu hình lại chúng.

## Những thứ cần chuẩn bị sẵn

- **[Bun](https://bun.sh/)** để chạy bot và chính trình hướng dẫn.
- **Token bot Discord** với các privileged intent `GuildMembers`, `MessageContent` và `GuildPresences` đã được bật.
- **PostgreSQL đã cài đặt.** TomoriBot lưu trữ mọi thứ trong PostgreSQL. Bạn không cần thiết lập thủ công vì trình hướng dẫn sẽ thực hiện giúp bạn: hệ thống sẽ dùng PostgreSQL nếu bạn đã cài sẵn, hoặc chạy cho bạn trong [Docker](https://www.docker.com/) nếu chưa có. Chỉ cần đảm bảo một trong hai đã được cài đặt trước khi bắt đầu. TomoriBot tự động khởi tạo schema, seed dữ liệu, migration, `pgcrypto` và schema RAG khi khởi động lần đầu.

## Lấy code

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## Chạy trình hướng dẫn

Chạy trình hướng dẫn thiết lập bằng:

```bash
bun run setup
```

Sau khi chạy lệnh, bạn sẽ chọn một trong hai phương thức:

| Phương thức | Khi nào nên dùng | Tác vụ thực hiện |
|---|---|---|
| Full Install | Bạn muốn thiết lập được khuyến nghị cùng với các tiện ích bổ sung nhẹ. | Chạy Base Install, sau đó thử cài đặt các tiện ích bổ sung bên dưới. |
| Base Install | Bạn chỉ muốn bot tối thiểu có thể hoạt động. | Tạo/cấu hình `.env`, token Discord, PostgreSQL và các phần phụ thuộc. |

### Mạng riêng tư
<!-- anchor: private-networks -->

Trình hướng dẫn sẽ hỏi liệu TomoriBot có thể kết nối tới `localhost` và mạng LAN của bạn hay không, rồi lưu câu trả lời thành `ALLOW_PRIVATE_NETWORK` trong `.env`. Ngoài môi trường production, TomoriBot sẽ không khởi động cho đến khi biến này được thiết lập, vì vậy bản thiết lập thủ công cũng cần dòng này. Mọi thành viên có quyền thêm endpoint tùy chỉnh hoặc máy chủ MCP đều có thể truy cập những gì bạn cho phép tại đây, nên hãy chọn dựa trên đối tượng sử dụng bot:

| Giá trị | Chọn khi |
|---|---|
| `true` | Chỉ có bạn hoặc một cộng đồng Discord đáng tin cậy sử dụng bot. Các model cục bộ và máy chủ MCP trên `localhost` hoặc mạng LAN của bạn đều hoạt động, kể cả qua HTTP thuần. |
| Danh sách `host:port`, ví dụ `localhost:5001,localhost:8188` | Bạn chia sẻ các máy chủ cục bộ, chẳng hạn như KoboldCPP hoặc ComfyUI, với những thành viên mà bạn chưa hoàn toàn tin tưởng. Chỉ các máy chủ được liệt kê mới hoạt động, nên endpoint của họ không thể chạm tới bất kỳ dịch vụ nào khác trong mạng của bạn. |
| `false` | Có thành viên không đáng tin cậy dùng bot và bạn không chia sẻ máy chủ cục bộ nào. |

Các endpoint HTTPS công khai, chẳng hạn như các API tương thích OpenAI được lưu trữ trên mạng, hoạt động với mọi giá trị. Đối với model nằm trên một máy tính khác, hãy dùng [kết nối từ xa có xác thực](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/). Tunnel chỉ cung cấp đường kết nối và cần các cơ chế kiểm soát truy cập riêng. Môi trường production luôn từ chối các endpoint riêng tư bất kể giá trị của `ALLOW_PRIVATE_NETWORK`.

Danh sách sẽ khớp chính xác địa chỉ như khi endpoint được đăng ký, nên `localhost:5001` không bao gồm `127.0.0.1:5001`; hãy liệt kê mọi cách viết bạn sử dụng. Một máy chủ được liệt kê vẫn mở cho mọi thành viên ở mọi đường dẫn, vì vậy hãy bảo vệ các tính năng quản trị của chính nó bằng mật khẩu (với KoboldCPP là `--adminpassword`).

Địa chỉ Tailscale và tên miền `*.ts.net` được tính là mạng riêng tư, nên chúng cần `true` hoặc nằm trong danh sách; nếu đặt `false`, chỉ Tailscale Funnel hoạt động.

Hình ảnh, tệp và bản xem trước liên kết do thành viên gửi sẽ không bao giờ chạm tới địa chỉ riêng tư, bất kể bạn chọn giá trị nào. Công cụ `fetch_url` có cài đặt riêng là `FETCH_URL_ALLOW_PRIVATE_NETWORK` (mặc định tắt).

### Tiện ích bổ sung của Full Install

Full Install sẽ chạy Base Install trước, sau đó thử cài đặt các tiện ích bổ sung bên dưới. Nếu có tiện ích nào thất bại, hệ thống sẽ in lệnh hoặc hướng dẫn để bạn hoàn tất thủ công và tiếp tục tiến trình:

| Tiện ích bổ sung | Mục đích |
|---|---|
| `pgvector` | Tìm kiếm vector cho bộ nhớ tài liệu/RAG. |
| `pg_cron` | Tùy chọn dọn dẹp theo lịch trình cho các hàng cooldown/lời nhắc. |
| Tokenizer asset | Tokenizer asset cục bộ để tạo văn bản NovelAI và xử lý logit bias theo model. |

Để cài đặt thủ công bất kỳ tiện ích nào trong số này, hãy xem
[tiện ích bổ sung trong Cài đặt thủ công](/self-hosting/manual-setup/#optional-extras-the-manual-full-install).

## Sau khi thiết lập

```bash
bun run dev                          # chỉ bot
bun run launch --searxng --crawl4ai  # bot + máy chủ cục bộ (xem bun run launch --help)
```

Khi bot đã trực tuyến, hãy chạy `/setup` trong Discord. Lệnh sẽ hướng dẫn bạn kết nối nhà cung cấp AI hoặc đến endpoint tùy chỉnh của bạn.

## Cập nhật

Sử dụng lệnh cập nhật ưu tiên sao lưu: `bun run update`

Lệnh này chạy `bun run backup`, sau đó là `git pull --rebase --autostash`, rồi đến `bun install --frozen-lockfile`. Thêm `--build` nếu bạn chạy từ `dist/`, hoặc `--docker` cho bản triển khai Compose. Xem chi tiết đầy đủ trên trang [Bảo trì và sao lưu](/self-hosting/maintenance/).
