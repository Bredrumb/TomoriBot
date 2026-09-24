---
title: "Docker Compose"
sidebar:
  order: 3
---

Docker Compose xây dựng và chạy TomoriBot **cùng** PostgreSQL dưới dạng các container. Đây là
phương thức cài đặt thứ ba bên cạnh [trình hướng dẫn thiết lập](/vi/self-hosting/setup-wizard/) và
[cài đặt thủ công](/vi/self-hosting/manual-setup/): hãy chọn phương thức này khi bạn muốn chạy mọi thứ trong Docker thay vì
cài đặt Bun và PostgreSQL trên máy chủ lưu trữ. Phương thức này **không** sử dụng trình hướng dẫn thiết lập; cơ sở dữ liệu
sẽ được tự động cấu hình kết nối cho bạn.

:::caution[Các script phía máy chủ lưu trữ vẫn cần công cụ trên máy chủ]
Việc chạy bot và cơ sở dữ liệu trong Docker không đóng gói các script bảo trì.
`bun run backup`, `bun run restore-backup`, `bun run update`, `bun run rotate-keys` cùng
các script liên quan vẫn chạy thông qua Bun của máy chủ lưu trữ và các công cụ client PostgreSQL của máy chủ lưu trữ. Xem
[Bảo trì và sao lưu](/vi/self-hosting/maintenance/) để biết các quy trình dành riêng cho Compose.
:::

## 1. Lấy mã nguồn

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## 2. Các giá trị `.env` bắt buộc

Bắt đầu từ tệp mẫu:

```sh
cp .env.example .env
```

Sau đó thiết lập tối thiểu các mục sau:

| Biến | Giá trị |
|---|---|
| `DISCORD_TOKEN` | Token bot Discord của bạn (bật các privileged intent `GuildMembers`, `MessageContent` và `GuildPresences`). |
| `CRYPTO_SECRET` | Khóa mã hóa 32 ký tự dùng để mã hóa các khóa API đã lưu. |
| `POSTGRES_PASSWORD` | Mật khẩu cơ sở dữ liệu. Mọi giá trị `POSTGRES_*` khác đều được tự động cấu hình. |

Không giống như trình hướng dẫn thiết lập, Compose sẽ không tự tạo `CRYPTO_SECRET` cho bạn, vì vậy hãy tự thiết lập giá trị này
(bất kỳ chuỗi 32 ký tự nào). Các giá trị tùy chỉnh bổ sung có thể được sao chép từ
`.env.optional.example`.

:::note[Kết nối cơ sở dữ liệu được cấu hình tự động]
Dịch vụ PostgreSQL của Compose chạy ở chế độ phát triển (không có SSL) trên mạng nội bộ của Docker,
và image đi kèm đã được cấu hình sẵn `pgvector` cùng `pg_cron`, do đó
bộ nhớ tài liệu/RAG và tính năng dọn dẹp theo lịch trình hoạt động ngay mà không cần cấu hình thêm. Không đặt `POSTGRES_HOST`,
`POSTGRES_PORT`, `POSTGRES_USER` hoặc `POSTGRES_DB` cho Compose; các biến này được quản lý tự động cho bạn.
:::

## 3. Xây dựng và chạy

```sh
docker compose build   # lần đầu tiên, hoặc sau khi thay đổi mã nguồn/phần phụ thuộc
docker compose up      # bot + cơ sở dữ liệu
```

Đối với các lần khởi động sau, chỉ cần chạy `docker compose up` là đủ trừ khi bạn đã thay đổi mã nguồn hoặc
các phần phụ thuộc. Khi bot trực tuyến, hãy chạy `/setup` trong Discord để thêm khóa nhà
cung cấp AI của bạn: xem [Bắt đầu nhanh](/vi/introduction/quickstart/) cho các thao tác trong Discord.

## 4. Các máy chủ cục bộ tùy chọn (Compose profile)

Các máy chủ cục bộ có thể kích hoạt tùy chọn qua các profile của Compose, giúp bạn chỉ chạy những gì mình cần:

```sh
# SearXNG (tìm kiếm web riêng tư) + Crawl4AI (thu thập nội dung được render bởi trình duyệt)
docker compose --profile searxng --profile fetch-crawl4ai up
```

Xem [SearXNG](/vi/self-hosting/local-endpoints/setup-searxng/), [Crawl4AI](/vi/self-hosting/local-endpoints/setup-crawl4ai/),
và [Giám sát cục bộ](/vi/self-hosting/local-monitoring/) để biết chi tiết về từng máy chủ.

## Bảo trì, cập nhật và sao lưu

Sử dụng `bun run update --docker` cho quy trình cập nhật ưu tiên sao lưu trên bản
triển khai Compose. Việc sao lưu và khôi phục cơ sở dữ liệu của Compose (bao gồm việc chạy các script phía máy chủ lưu trữ
với cơ sở dữ liệu này) được trình bày trên trang [Bảo trì và sao lưu](/vi/self-hosting/maintenance/). Trước khi kéo
phiên bản mới về, hãy bắt đầu với [Di chuyển an toàn](/vi/self-hosting/safe-migration/).
