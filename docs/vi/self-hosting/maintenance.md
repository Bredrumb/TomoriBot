---
title: "Bảo trì và sao lưu"
sidebar:
  order: 5
---

Vận hành hàng ngày một phiên bản bot self-host: các script bảo trì, cách cập nhật, và
cách sao lưu và khôi phục cơ sở dữ liệu của bạn. Đây là các thao tác phía máy chủ lưu trữ: bạn chạy chúng từ
terminal shell, không phải từ Discord. Để biết các quy trình xuất/nhập/xóa theo từng người dùng trong Discord, hãy xem
[Xử lý dữ liệu](/vi/features/knowledge/data-handling/).

Nếu bạn chuẩn bị `git pull` phiên bản mới, hãy đọc [Di chuyển an toàn](/vi/self-hosting/safe-migration/) trước:
tài liệu này hướng dẫn cách sao lưu *trước khi* trình chạy migration khi khởi động can thiệp vào schema của bạn.

## Các script bảo trì

| Lệnh | Mô tả |
|---|---|
| `bun run setup` | Mở trình hướng dẫn thiết lập cho bản cài đặt cơ bản và các mô-đun tùy chọn. |
| `bun run update` | Sao lưu trước, sau đó kéo mã nguồn mới nhất và cài đặt các phần phụ thuộc. |
| `bun run backup` | Tạo một gói trong `backups/` chứa bản dump DB và `.env`: bao gồm toàn bộ dữ liệu của bạn. |
| `bun run restore-backup` | Khôi phục `.env` và cơ sở dữ liệu từ một gói (`--latest` hoặc `--from backups/<dir>`). |
| `bun run backup:personas` | CHỈ xuất các persona (kèm theo bộ nhớ máy chủ) trên tất cả các máy chủ; nhập lại qua `/persona import`. |
| `bun run nuke-db` | Xóa tất cả các bảng (khởi động lại bot sau đó để tái khởi tạo). |
| `bun run purge-commands` | Xóa tất cả các lệnh slash Discord đã đăng ký. |
| `bun run rotate-keys` | Mã hóa lại tất cả các trường đã mã hóa sang phiên bản khóa hiện tại. |

`bun run backup` và `bun run update` yêu cầu các công cụ client PostgreSQL (`pg_dump`, `psql`)
có sẵn trong biến môi trường PATH của bạn.

## Cập nhật

Trước tiên hãy dừng bot đang chạy, sau đó sử dụng công cụ cập nhật ưu tiên sao lưu:

```sh
bun run update
```

Lệnh này sẽ chạy `bun run backup`, sau đó là `git pull --rebase --autostash`, rồi đến `bun install --frozen-lockfile`. Gói
sao lưu được ghi vào `backups/` và bao gồm cả bản dump cơ sở dữ liệu lẫn tệp `.env`. Thêm
`--skip-backup` để bỏ qua việc sao lưu trước khi cập nhật. Quy trình thủ công thay thế:

```sh
bun run backup
git pull --rebase --autostash
bun install --frozen-lockfile
```

Chạy từ thư mục `dist/`? Sử dụng `bun run update --build`. Chạy Docker Compose? Sử dụng
`bun run update --docker`.

## Sao lưu và khôi phục

`bun run backup` tạo một gói có gắn nhãn thời gian trong `backups/` (hoặc thư mục `TOMORI_BACKUP_DIR` nếu
được ghi đè trong `.env`) chứa toàn bộ cơ sở dữ liệu PostgreSQL của bạn cùng tệp `.env`. Khôi phục
gói mới nhất bằng:

```sh
bun run restore-backup --latest
```

Hoặc khôi phục một gói cụ thể:

```sh
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

`bun run backup:personas` là một bản xuất hẹp hơn: chỉ bao gồm các preset persona và
bộ nhớ máy chủ theo từng persona, trên tất cả các máy chủ. Bản này **bắt buộc** phải được nhập lại thủ công qua `/persona import`
và **không thể** sử dụng với `restore-backup` (điều đó sẽ gây ra xung đột khóa chính primary key).

TomoriBot cũng thực hiện **sao lưu tự động khi khởi động** trong môi trường không phải production, và việc
khôi phục hoàn chỉnh đòi hỏi tiện ích mở rộng `pgvector` phải có sẵn trên cơ sở dữ liệu đích. Cả hai điều này
đều được trình bày chi tiết trong [Di chuyển an toàn](/vi/self-hosting/safe-migration/), cùng với quy trình sử dụng `pg_dump` /
`pg_restore` thủ công nếu bạn muốn thao tác trực tiếp với các công cụ.

## Sao lưu trong Docker Compose

Docker Compose hỗ trợ sao lưu tự động khi khởi động bên trong container ứng dụng. Các gói
sao lưu được ghi vào thư mục `backups/` của máy chủ lưu trữ do Compose gắn kết thư mục này vào trong container.

Để sao lưu Docker thủ công:

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run backup
docker compose start tomoribot
```

Để khôi phục Docker:

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run restore-backup --latest
docker compose up -d
```

Các script phía máy chủ lưu trữ như `bun run backup`, `bun run update` và `bun run nuke-db` không
tự động chạy qua Docker. Để chạy các script này với cơ sở dữ liệu Compose,
hãy chạy chúng trên máy chủ lưu trữ có cài sẵn Bun cùng các công cụ client PostgreSQL, và thiết lập:

```dotenv
POSTGRES_HOST=localhost
POSTGRES_PORT=15432
POSTGRES_USER=tomori
POSTGRES_PASSWORD=your_password
POSTGRES_DB=tomodb
```

## Cài đặt lại sạch sẽ

`bun run nuke-db` xóa tất cả các bảng; việc khởi động bot sau đó sẽ khởi tạo lại schema,
seed dữ liệu và migration từ đầu. Hãy sử dụng lệnh này cùng với một bản `bun run backup` mới khi bạn
muốn có một khởi đầu sạch sẽ mà vẫn có thể quay lui lại được: không bao giờ chạy lệnh này mà không có bản sao lưu hiện tại.

## Xem thêm

- [Di chuyển an toàn](/vi/self-hosting/safe-migration/): sao lưu trước khi kéo mã nguồn mới, và điều kiện tiên quyết khôi phục `pgvector`
- [Xử lý dữ liệu](/vi/features/knowledge/data-handling/): xuất/nhập/xóa theo từng người dùng trong Discord
- [Trình hướng dẫn thiết lập](/vi/self-hosting/setup-wizard/): cài đặt có hướng dẫn bằng `bun run setup`
