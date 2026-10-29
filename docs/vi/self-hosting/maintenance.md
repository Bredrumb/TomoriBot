---
title: "Bảo trì và sao lưu"
sidebar:
  order: 5
aiGenerated: true
---

Quản lý instance TomoriBot self-hosting của bạn bằng cách sử dụng các script bảo trì CLI để cập nhật code, sao lưu hoặc khôi phục dữ liệu, xoay vòng khóa mã hóa và kiểm tra các biến môi trường. Chạy các lệnh này từ terminal trên máy chủ hoặc môi trường Docker của bạn. Để xuất và xóa dữ liệu trong Discord, hãy xem [Xử lý dữ liệu](/features/knowledge/data-handling/).

TomoriBot áp dụng các migration cơ sở dữ liệu đang chờ xử lý khi khởi động. Một số migration có thể xóa dữ liệu và không tự động rollback, vì vậy hãy sao lưu trước khi cập nhật hoặc chuyển đổi nhánh.

## Các script bảo trì

| Lệnh | Mô tả |
|---|---|
| `bun run setup` | Mở trình hướng dẫn thiết lập cho bản cài đặt cơ bản và các module tùy chọn. |
| `bun run update` | Sao lưu trước, sau đó kéo code mới nhất và cài đặt các phần phụ thuộc. |
| `bun run backup` | Tạo một bundle trong `backups/` chứa bản dump cơ sở dữ liệu và siêu dữ liệu phiên bản mã hóa bắt buộc. Các secret được giữ riêng biệt. |
| `bun run restore-backup` | Khôi phục cơ sở dữ liệu bằng các khóa mã hóa được cung cấp riêng biệt (`--latest` hoặc `--from backups/<dir>`). |
| `bun run backup:personas` | CHỈ xuất các persona (kèm theo bộ nhớ máy chủ) trên tất cả các máy chủ: nhập lại qua `/persona import`. |
| `bun run nuke-db` | Xóa tất cả các bảng (khởi động bot sau đó để khởi tạo lại). |
| `bun run purge-commands` | Xóa tất cả các lệnh slash Discord đã đăng ký. |
| `bun run rotate-keys --bot-stopped` | Mã hóa lại tất cả các trường đã mã hóa sang phiên bản khóa hiện tại. |
| `bun run env-doctor` | Kiểm tra cấu hình ở chế độ chỉ đọc: liệt kê các mục `.env` không có mã nào đọc (chỉ tên, không bao giờ hiển thị giá trị) và nơi từng biến được sử dụng. |

Lệnh `bun run backup` trên máy chủ cần `pg_dump`, và `bun run restore-backup` trên máy chủ cần `psql` trong PATH. `bun run update` cần `pg_dump` cho bản sao lưu của nó. Lộ trình cập nhật `--docker` chạy sao lưu trong container, do đó cần Bun, Git và Docker trên máy chủ nhưng không cần các công cụ PostgreSQL trên máy chủ.

Đối với avatar cục bộ, hãy giữ lại các webhook do TomoriBot quản lý: việc xóa chúng sẽ khiến bot không thể chỉnh sửa các tin nhắn webhook cũ hơn.

## Sao lưu cơ sở dữ liệu và khóa khôi phục
<!-- anchor: database-backups-and-recovery-keys -->

Các bundle cơ sở dữ liệu chứa dữ liệu riêng tư và danh mục các phiên bản mã hóa bắt buộc. Chúng không chứa `.env` hoặc tệp media. Hãy bảo vệ bundle và lưu trữ riêng biệt từng khóa mã hóa bắt buộc; nếu thiếu khóa cũ, các thông tin xác thực được mã hóa bằng khóa đó sẽ không thể khôi phục.

Để khôi phục một bản sao lưu đáng tin cậy:

1. Dừng mọi instance của bot. Cấu hình cơ sở dữ liệu đích, Discord token và các khóa mã hóa gốc.
2. Cài đặt `psql` và các extension cơ sở dữ liệu bắt buộc, bao gồm cả `pgvector`. Tài khoản cơ sở dữ liệu phải có quyền bật `pgcrypto`, hoặc quản trị viên phải bật extension này trước.
3. Chạy `bun run restore-backup --latest` hoặc `bun run restore-backup --from backups/<bundle-directory>`. Kiểm tra đích và xác nhận các lời nhắc. Quá trình khôi phục sẽ kiểm tra các khóa trước khi thực thi các lệnh SQL mang tính phá hủy.
4. Chạy `bun run audit-keys` và `bun run rotate-keys --dry-run` trước khi khởi động lại. Nếu thông tin xác thực cần migration, hãy chạy `bun run rotate-keys --bot-stopped` và audit lại. Nếu khôi phục thất bại, hãy giữ bot ở trạng thái dừng: các câu lệnh SQL trước đó có thể đã làm thay đổi cơ sở dữ liệu.

Sao lưu riêng thư mục `data/` cục bộ, bao gồm avatar, mẫu giọng nói và `data/custom-expressions/`. Khôi phục các tệp về cùng đường dẫn. Đối với biểu cảm trên GCS hoặc S3, hãy sao lưu các đối tượng `custom-expressions/` và khôi phục các key của chúng về cùng bucket đã cấu hình. Các biểu cảm dạng liên kết phụ thuộc vào máy chủ bên ngoài của chúng.

Trong môi trường phi production, quá trình khởi động sẽ tạo bản sao lưu cơ sở dữ liệu khi phiên bản bot thay đổi hoặc bản sao lưu mới nhất đã cũ ít nhất `TOMORI_AUTO_BACKUP_INTERVAL_HOURS` (mặc định là 24 giờ). Hệ thống giữ lại `TOMORI_AUTO_BACKUP_MAX` bản sao lưu (mặc định là 5 bản); đặt `TOMORI_AUTO_BACKUP_ENABLED=false` để tắt tính năng này. Các bản sao lưu này không bao gồm media hoặc khóa mã hóa.

Các bundle cũ hơn có thể chứa secret trong `config.env`. Quá trình khôi phục không nạp tệp này; hãy tự kiểm tra riêng tư và cung cấp các khóa bắt buộc thông qua nguồn secret thông thường của bạn.

## Xoay vòng khóa mã hóa
<!-- anchor: rotating-encryption-keys -->

1. Sao lưu cơ sở dữ liệu và lưu giữ tất cả các khóa hiện có trong bộ lưu trữ được bảo vệ. Hãy thử nghiệm khôi phục trên một cơ sở dữ liệu dùng một lần trước khi ngừng sử dụng bất kỳ khóa nào.
2. Tạo một khóa mới bằng `openssl rand -base64 32`. Thêm khóa đó vào nguồn secret của bot dưới dạng `CRYPTO_SECRET_V<version>` và chọn khóa bằng `CRYPTO_SECRET_CURRENT`. Giữ lại các phiên bản cũ hơn; `CRYPTO_SECRET` là V1.
3. Dừng mọi instance bot và các tiến trình ghi thông tin xác thực. Sử dụng cùng một nguồn secret và cài đặt cơ sở dữ liệu như bot; các script trên production cũng cần `RUN_ENV=production`.
4. Chạy `bun run audit-keys` và `bun run rotate-keys --dry-run`. Cả hai đều phải thành công trước khi tiếp tục.
5. Chạy `bun run rotate-keys --bot-stopped`, sau đó chạy `bun run audit-keys`. Nếu một trong hai thất bại, hãy giữ bot ở trạng thái dừng và giữ sẵn tất cả các phiên bản khóa trong khi bạn khắc phục lỗi.
6. Thử nghiệm cơ sở dữ liệu dùng một lần đã được khôi phục với khóa hiện tại được giữ lại. Thử nghiệm các bản sao lưu cũ hơn với các khóa lưu trữ của chúng trước khi xóa các phiên bản cũ khỏi nguồn secret đang hoạt động. Giữ các khóa đã lưu trữ chừng nào các bản sao lưu của chúng còn tồn tại, sau đó khởi động lại bot.

`--bot-stopped` ghi nhận xác nhận của bạn; nó không thể phát hiện một instance khác đang chạy hoặc xóa cache thông tin xác thực của instance đó.

## Cập nhật

Trước tiên hãy dừng bot đang chạy, sau đó sử dụng trình cập nhật sao lưu trước:

```sh
bun run update
```

Trình cập nhật sẽ sao lưu cơ sở dữ liệu, kéo code và cài đặt các phần phụ thuộc. Sử dụng `--build` nếu bạn chạy từ `dist/`. Đối với Compose, hãy xem [Docker Compose](/self-hosting/docker-compose/#maintenance-updating-and-backups). Sao lưu riêng media và khóa mã hóa.

Sử dụng một cơ sở dữ liệu riêng biệt để thử nghiệm các nhánh: chuyển đổi ngược lại không hoàn tác các migration. Nếu một migration thất bại, hãy giữ bot ở trạng thái dừng, kiểm tra log và làm theo các bước khôi phục ở trên trước khi quay về phiên bản trước. Hãy ghi lại commit hiện tại bằng `git rev-parse HEAD` trước khi cập nhật để hỗ trợ khôi phục.

### Các thay đổi về môi trường

Chạy `bun run env-doctor` để tìm các cài đặt không sử dụng trong `.env`. Cooldown của lệnh sử dụng `COMMAND_COOLDOWN_SCALE` (mặc định `1`; `0` sẽ tắt cooldown).

Các máy chủ TTS cục bộ không còn xác thực yêu cầu bằng cài đặt bearer-token trước đây. Hãy xem lại [Truy cập mạng](/self-hosting/local-endpoints/text-to-speech/#network-access) trước khi mở chúng ra ngoài máy của bạn. Mỗi engine sử dụng cài đặt cổng riêng.

## Sao lưu và khôi phục

```sh
bun run backup
bun run restore-backup --latest
# Hoặc chọn một bundle:
bun run restore-backup --from backups/<bundle-directory>
```

Các bundle được lưu trữ trong `backups/` hoặc `TOMORI_BACKUP_DIR`. Hãy làm theo các [bước khôi phục](#database-backups-and-recovery-keys) trước khi khôi phục. `bun run backup:personas` chỉ xuất các persona và bộ nhớ máy chủ cho `/persona import`; lệnh này không thể khôi phục cơ sở dữ liệu.

## Sao lưu trong Docker Compose

Docker Compose hỗ trợ sao lưu tự động khi khởi động bên trong container ứng dụng. Các bundle được ghi vào thư mục `backups/` của máy chủ lưu trữ vì Compose gắn kết thư mục này vào trong container.

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

## Cài đặt lại sạch sẽ

`bun run nuke-db` xóa tất cả các bảng; việc khởi động bot sau đó sẽ khởi tạo lại schema, seed dữ liệu và migration từ đầu. Hãy sử dụng lệnh này cùng với một bản `bun run backup` mới khi bạn muốn có một khởi đầu sạch sẽ mà vẫn có thể rollback: không bao giờ chạy lệnh này mà không có bản sao lưu hiện tại.
