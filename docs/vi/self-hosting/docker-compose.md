---
title: "Docker Compose"
sidebar:
  order: 3
aiGenerated: true
---

Docker Compose chạy TomoriBot và PostgreSQL cùng nhau trong các thùng chứa. Đây là tùy chọn cài đặt thứ ba cùng với [trình hướng dẫn thiết lập](/vi/self-hosting/setup-wizard/) và [thiết lập thủ công](/vi/self-hosting/manual-setup/): chọn tùy chọn này khi bạn muốn chạy mọi thứ trong Docker mà không cần cài đặt Bun hoặc PostgreSQL trên hệ thống máy chủ của mình. Nó bỏ qua trình hướng dẫn thiết lập tương tác và tự động cấu hình kết nối cơ sở dữ liệu.

:::caution[Host tools for updates]
`bun run update --docker` cần máy chủ Bun và Git để thực hiện các thay đổi mã. Bản sao lưu cơ sở dữ liệu của nó chạy bên trong vùng chứa ứng dụng. Bạn cũng có thể chạy sao lưu và khôi phục thủ công thông qua Compose; xem [Bảo trì & Sao lưu](/vi/self-hosting/maintenance/).
:::

## 1. Lấy mã nguồn

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## 2. Các giá trị `.env` bắt buộc

Bắt đầu từ tệp ví dụ:

```sh
cp .env.example .env
```

Đặt các biến bắt buộc này trong `.env`:

| Biến | Giá trị |
|---|---|
| `DISCORD_TOKEN` | Mã thông báo bot Discord của bạn (bật các ý định đặc quyền `GuildMembers`, `MessageContent` và `GuildPresences`). |
| `CRYPTO_SECRET` | Khóa mã hóa 32 ký tự được sử dụng để mã hóa các khóa API được lưu trữ. |
| `POSTGRES_PASSWORD` | Mật khẩu cơ sở dữ liệu. Mọi giá trị `POSTGRES_*` khác đều được cấu hình tự động. |

Tạo giá trị 32 ký tự ngẫu nhiên cho `CRYPTO_SECRET` bằng Docker, sau đó sao chép nó vào `.env`:

```sh
docker run --rm alpine:3.22 sh -c "head -c 24 /dev/urandom | base64"
```

Tạo mật khẩu riêng cho `POSTGRES_PASSWORD`. Bạn có thể sao chép cài đặt điều chỉnh tùy chọn từ `.env.optional.example`.

:::note[Database connection is automatic]
Không đặt `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER` hoặc `POSTGRES_DB` trong `.env`; Compose tự động cấu hình chúng.
:::

Trên Linux, tạo các thư mục gắn kết liên kết trên máy chủ và gán quyền sở hữu cho UID 1001 trước khi khởi động vùng chứa. Docker tạo các điểm gắn kết bị thiếu dưới dạng root, điều này ngăn vùng chứa bot lưu các bản sao lưu, nhật ký hoặc tải lên:

```sh
mkdir -p backups logs data
sudo chown 1001:1001 backups logs data
```

## 3. Xây dựng và chạy

```sh
docker compose build   # first time, or after code/dependency changes
docker compose up      # bot + database
```

Để bắt đầu sau này, chỉ `docker compose up` là đủ trừ khi bạn thay đổi mã hoặc phần phụ thuộc. Sau khi bot kết nối với Discord, hãy chạy `/setup` trong bất kỳ kênh máy chủ nào để thêm khóa nhà cung cấp AI của bạn. Xem [Khởi động nhanh](/vi/introduction/quickstart/) để biết các tùy chọn thiết lập trong Discord.

Soạn các chân `RUN_ENV=development` trong định nghĩa dịch vụ của nó để các bí mật `.env` và điểm cuối HTTP cục bộ hoạt động. Kiểm tra tình trạng vùng chứa báo cáo xem quy trình bot có đang chạy hay không; nó không kiểm tra kết nối cổng Discord. Để biết sự khác biệt của chế độ sản xuất (`RUN_ENV=production`) (trình quản lý bí mật, hạn chế mạng và số liệu), hãy xem [Kiến trúc bảo mật](/en/architecture/subsystems/security/).

## Cấu hình shard tùy chọn trên một máy chủ

Để trống `SHARD_COUNT` và `SHARD_IDS` cho hành vi mặc định: một tiến trình duy nhất sở hữu tất cả các shard được Discord đề xuất khi khởi động. Các cài đặt quy mô nhỏ thường chỉ nhận một shard. Chế độ này không sử dụng cơ chế lease cho shard hoặc bộ lắng nghe vô hiệu hóa bộ nhớ đệm. Nhiều shard có thể dùng chung một tiến trình.

Để chạy bốn shard trong dịch vụ hiện có, hãy thêm `SHARD_COUNT=4` vào `.env` và để trống `SHARD_IDS`. Thêm ghi đè dịch vụ này trong `compose.override.yaml` để cho phép quá trình tắt có giới hạn hoàn tất:

```yaml
services:
  tomoribot:
    stop_grace_period: 40s
```

Tạo lại dịch vụ bằng lệnh `docker compose up -d --build tomoribot`. Nếu một tập lệnh gọi `docker stop` hoặc cung cấp thời gian chờ dừng Compose riêng, hãy cho phép ít nhất 40 giây ở đó. Tính năng tự động lựa chọn không thay đổi số lượng shard khi đang chạy; việc thay đổi tổng số yêu cầu phải khởi động lại đồng bộ.

Các tập con tĩnh tùy chọn yêu cầu một dịch vụ riêng biệt cho mỗi nhóm có cùng `SHARD_COUNT` rõ ràng và `SHARD_IDS` rời rạc, ví dụ `0,1` và `2,3` với tổng số là `4`. Đặt cho các dịch vụ những tên ổn định riêng biệt, tên container và bất kỳ cổng kiểm tra trạng thái nào được phát hành. Ứng dụng sẽ suy ra các nhãn chỉ số ổn định từ mỗi nhóm. Giữ một cơ sở dữ liệu duy nhất, chạy khởi tạo một lần hiện có `bun run src/db/initializeCli.ts` với thông tin xác thực quản lý lược đồ trước khi khởi động gateway, và đặt `DATABASE_SCHEMA_MANAGEMENT_ENABLED=false` trên mọi tiến trình gateway. Không khởi động dịch vụ sở hữu tất cả shard ban đầu cùng với các nhóm đó. Hãy dừng các tiến trình cũ trước khi thay đổi tổng số hoặc phân vùng.

Chế độ tập con sẽ từ chối cầu nối Matrix đã được cấu hình đầy đủ. Giới hạn lượt phản hồi và tải lên cho mỗi người dùng vẫn được tính theo từng tiến trình, vì vậy hãy cân nhắc xem mức hạn ngạch được nhân lên có thể chấp nhận được hay không trước khi bật tiến trình thứ hai. Các hệ thống sử dụng tính năng thanh toán người ủng hộ chỉ có trên bản phát hành cũng yêu cầu kiểm soát chi tiêu chung và đối soát trước khi phục vụ các yêu cầu được tài trợ từ nhiều tiến trình. Xem [phân mảnh và quyền sở hữu tiến trình](/architecture/subsystems/sharding/) để biết các giới hạn an toàn và trạng thái hoạt động.

## 4. Các máy chủ cục bộ tùy chọn (Compose profile)

Chạy các máy chủ trợ giúp cục bộ tùy chọn với cấu hình Compose để bạn chỉ bắt đầu những gì mình cần:

```sh
# SearXNG (private web search) + Crawl4AI (browser-rendered fetch)
docker compose --profile searxng --profile fetch-crawl4ai up
```

Khi bật SearXNG, hãy đặt `SEARXNG_BASE_URL=http://searxng:8080/` trong `.env`. Nếu không thì không đặt nó. Đặt `SEARXNG_SECRET` thành một giá trị ngẫu nhiên riêng cho việc ký yêu cầu SearXNG.

Xem [SearXNG](/vi/self-hosting/local-endpoints/setup-searxng/), [Crawl4AI](/vi/self-hosting/local-endpoints/setup-crawl4ai/) và [Giám sát cục bộ](/vi/self-hosting/local-monitoring/) để biết thiết lập dành riêng cho máy chủ.

## Bảo trì, cập nhật và sao lưu

Sử dụng `bun run update --docker` để cập nhật bản sao lưu đầu tiên khi triển khai Compose. Để sao lưu hoặc khôi phục cơ sở dữ liệu Compose của bạn, hãy xem [Bảo trì và sao lưu](/vi/self-hosting/maintenance/).
