---
title: "Trình hướng dẫn thiết lập"
sidebar:
  label: "Trình hướng dẫn thiết lập"
  order: 1
aiGenerated: false
---

:::note
Người dùng muốn sử dụng Docker Compose nên bỏ qua trình hướng dẫn này, xem
[Docker Compose](/vi/self-hosting/docker-compose/) để biết phương thức cài đặt bằng container.
:::

`bun run setup` là phương thức self-host được khuyến nghị cho các bản cài đặt cục bộ dựa trên Bun. Lệnh này sẽ tạo tệp `.env`, tạo `CRYPTO_SECRET`, yêu cầu token bot Discord của bạn, định cấu hình PostgreSQL và cài đặt chính xác các phần phụ thuộc từ `bun.lock` theo cách tương tác, vì vậy bạn chỉ cần làm theo các lời nhắc. Lệnh này an toàn để chạy lại; các giá trị `.env` hiện có sẽ được giữ nguyên trừ khi bạn chọn cấu hình lại chúng.

## Lấy mã nguồn

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## Chọn một phương thức

Sau khi chạy lệnh, bạn sẽ chọn một trong hai phương thức:

```bash
bun run setup
```

| Phương thức | Khi nào nên dùng | Tác vụ thực hiện |
|---|---|---|
| Full Install | Bạn muốn thiết lập được khuyến nghị cùng với các tiện ích bổ sung nhẹ. | Chạy Base Install, sau đó thử cài đặt bốn tiện ích bổ sung bên dưới. |
| Base Install | Bạn chỉ muốn bot tối thiểu có thể hoạt động. | Tạo và cấu hình `.env`, token Discord, PostgreSQL cùng các phần phụ thuộc. |

## Những thứ cần chuẩn bị sẵn

- [Bun](https://bun.sh/) để chạy bot và chính trình hướng dẫn này.
- Token bot Discord với các privileged intent `GuildMembers`, `MessageContent` và `GuildPresences` đã được bật.
- Cơ sở dữ liệu. TomoriBot lưu trữ mọi thứ trong PostgreSQL. Bạn không cần thiết lập thủ công vì trình hướng dẫn sẽ thực hiện giúp bạn: hệ thống sẽ dùng PostgreSQL nếu bạn đã cài sẵn, hoặc chạy cơ sở dữ liệu cho bạn trong [Docker](https://www.docker.com/) nếu chưa có. Bạn chỉ cần đảm bảo một trong hai đã được cài đặt trước khi bắt đầu.

:::caution
- Docker PostgreSQL đi kèm chỉ chạy cơ sở dữ liệu trong Docker. Bản thân bot, các bản sao lưu khi khởi động, `bun run backup` và `restore-backup` vẫn chạy thông qua Bun của máy chủ lưu trữ và các công cụ client PostgreSQL của máy chủ lưu trữ. Nếu bạn muốn chạy toàn bộ trong Docker, hãy sử dụng [Docker Compose](/vi/self-hosting/docker-compose/) để thay thế.
:::

Nếu thiếu `psql` hoặc việc cấp phát thất bại, trình hướng dẫn sẽ in ra câu lệnh SQL để bạn chạy thủ công. Dù bằng cách nào, TomoriBot cũng sẽ tự động khởi tạo schema, seed dữ liệu, migration, `pgcrypto` và schema RAG khi khởi động lần đầu.

## Tiện ích bổ sung của Full Install

Full Install sẽ chạy Base Install trước, sau đó thử cài đặt các tiện ích bổ sung bên dưới. Nếu có tiện ích nào thất bại, hệ thống sẽ in lệnh hoặc hướng dẫn để bạn hoàn tất thủ công và tiếp tục tiến trình:

| Tiện ích bổ sung | Mục đích |
|---|---|
| `pgvector` | Tìm kiếm vector cho bộ nhớ tài liệu/RAG. |
| `pg_cron` | Tùy chọn dọn dẹp theo lịch trình cho các hàng cooldown/lời nhắc. |
| Tokenizer asset | Tokenizer asset cục bộ để xử lý logit bias theo model. |

Để cài đặt thủ công bất kỳ tiện ích nào trong số này, hãy xem
[tiện ích bổ sung trong Cài đặt thủ công](/vi/self-hosting/manual-setup/#optional-extras-the-manual-full-install).

## Sau khi thiết lập

```bash
bun run dev                          # chỉ bot
bun run launch --searxng --crawl4ai  # bot + máy chủ cục bộ (xem bun run launch --help)
```

Khi bot đã trực tuyến, hãy chạy `/setup` trong Discord. Lệnh sẽ hướng dẫn bạn kết nối nhà cung cấp AI; xem [Bắt đầu nhanh](/introduction/quickstart/) để biết các thông tin cần thiết ở mỗi bước.

## Cập nhật

Sử dụng lệnh cập nhật ưu tiên sao lưu: `bun run update`

Lệnh này sẽ chạy `bun run backup`, sau đó là
`git pull --rebase --autostash`, rồi đến `bun install --frozen-lockfile`. Thêm `--build` nếu bạn chạy từ `dist/`,
hoặc `--docker` cho bản triển khai Compose. Xem chi tiết đầy đủ trên trang
[Bảo trì và sao lưu](/vi/self-hosting/maintenance/).
