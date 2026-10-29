---
title: "Thiết lập PluralBuddy OAuth"
description: "Ủy quyền cho instance TomoriBot self-hosting của bạn xác minh tin nhắn từ các instance PluralBuddy đã được phê duyệt."
sidebar:
  order: 8
---

Một instance TomoriBot self-hosting cần một ứng dụng PluralBuddy đã được ủy quyền cho dịch vụ chính thức và từng instance tùy chỉnh đã được phê duyệt.

Nếu bạn sử dụng [bot được triển khai công khai](https://discord.com/oauth2/authorize?client_id=841644102059556915), bạn không cần phải hoàn tất thiết lập phía máy chủ này. Hãy chọn PluralBuddy bằng `/personal message-proxy service:pluralbuddy`; xem [Hỗ trợ message-proxy](/features/integrations/message-proxy-support/#pluralbuddy).

## Trước khi bắt đầu

- Chạy phiên bản TomoriBot hiện tại trên cơ sở dữ liệu PostgreSQL đã hoàn tất migration.
- Sử dụng máy tính có trình duyệt và quyền truy cập vào cơ sở dữ liệu đó cùng khóa mã hóa của TomoriBot. Helper ủy quyền sẽ lắng nghe trên địa chỉ loopback của máy tính đó. Nếu cơ sở dữ liệu ở từ xa, hãy thu xếp quyền truy cập tạm thời và bị hạn chế từ máy tính này.
- Chọn một cổng cục bộ chưa sử dụng và đăng ký đúng một URL callback chính xác trong cổng thông tin nhà phát triển, ví dụ `http://127.0.0.1:<port>/oauth/callback`. Hãy ghi lại URL này; bạn sẽ sử dụng nó trong mọi bước bên dưới.

## Ủy quyền instance chính thức

1. Đăng nhập vào [cổng thông tin nhà phát triển PluralBuddy](https://pluralbuddy.app/developers/applications) và tạo một ứng dụng OAuth. Sử dụng ứng dụng riêng để thử nghiệm. Chọn `profile` và `offline_access`. Đăng ký callback của bạn chính xác như đã chọn ở trên. Giữ bí mật client ID và secret.
2. Từ repository TomoriBot, chạy helper với ID instance chính thức và cùng callback đó:

   ```sh
   bun scripts/db/authorize-pluralbuddy-instance.ts pluralbuddy:official <callback-url>
   ```

3. Nhập client ID và secret tại các lời nhắc trong terminal. Mở URL ủy quyền được in ra trong trình duyệt trên máy tính đó, đăng nhập vào PluralBuddy và chấp thuận màn hình đồng ý. Helper sẽ đóng lại sau một lần callback hoặc ba phút và lưu kết nối vào PostgreSQL.
4. Khởi động TomoriBot với cùng cơ sở dữ liệu và khóa mã hóa. Chọn `/personal message-proxy service:pluralbuddy` trên tài khoản Discord có sử dụng PluralBuddy, sau đó gửi tin nhắn repost qua webhook để kiểm tra xem TomoriBot có nhận diện alter hay không.

Helper đọc các cài đặt cơ sở dữ liệu và khóa mã hóa từ `.env` hoặc bundle JSON `SECRET_FILE`. Giữ bundle bên ngoài repository và sao lưu khóa mã hóa. Hãy nhập client secret tại lời nhắc thay vì lưu trữ trong `.env` hoặc truyền dưới dạng tham số. Nếu PluralBuddy thu hồi kết nối, hãy lặp lại việc ủy quyền với cùng instance ID.

## Thêm một instance đã được phê duyệt

Sử dụng một origin HTTPS công khai không có đường dẫn (path), chuỗi truy vấn (query) hoặc fragment. Instance đó phải chạy cả proxy bot và API tương ứng của nó.

1. Trên máy tính có quyền truy cập cơ sở dữ liệu triển khai, đăng ký một instance đã bị vô hiệu hóa:

   ```sh
   bun scripts/db/register-message-proxy-instance.ts register pluralbuddy https://<instance-host> "<display-name>" <bot-user-id>
   bun scripts/db/register-message-proxy-instance.ts inspect
   ```

   Đối với PluralKit, sử dụng `pluralkit` làm dịch vụ. ID người dùng của bot giúp tránh việc chờ đợi tra cứu không cần thiết trong các máy chủ không có bot đó.
2. Đối với PluralBuddy, đăng ký một ứng dụng OAuth riêng biệt trên instance đó với cùng mẫu callback loopback như trên. Ủy quyền cho nó bằng cách sử dụng instance ID được trả về từ bước đăng ký:

   ```sh
   bun scripts/db/authorize-pluralbuddy-instance.ts <instance-id> <callback-url>
   ```

   Lặp lại việc ủy quyền để thay thế thông tin xác thực hoặc khôi phục sau khi refresh token bị thu hồi. PluralKit không yêu cầu bước này.
3. Từ một tin nhắn được viết bởi proxy bot tương ứng, hãy ghi lại ID tin nhắn repost trên Discord và ID tài khoản người gửi. Kiểm tra xem API của instance có phân giải repost đó hay không, sau đó kích hoạt nó:

   ```sh
   bun scripts/db/register-message-proxy-instance.ts enable <instance-id> <repost-id> <sender-id>
   ```

   Đối với một bản fork mới, hãy thử nghiệm bot, trao đổi và làm mới OAuth, cùng việc tra cứu TomoriBot trong một môi trường triển khai dùng một lần trước khi kích hoạt cho người dùng.
4. Người dùng chọn instance đã kích hoạt bằng `/personal message-proxy service:pluralbuddy instance:<name>`. Để trống `instance` sẽ chọn instance chính thức. Vô hiệu hóa một instance sẽ dừng các lượt tra cứu mới mà không làm thay đổi các hồ sơ đã lưu.

Nếu proxy bot tùy chỉnh được thay thế, hãy cập nhật ID người dùng bot Discord của nó trước khi cung cấp lại instance:

```sh
bun scripts/db/register-message-proxy-instance.ts set-bot <instance-id> <bot-user-id>
```

Vô hiệu hóa hoặc xóa một instance tùy chỉnh bằng:

```sh
bun scripts/db/register-message-proxy-instance.ts disable <instance-id>
bun scripts/db/register-message-proxy-instance.ts remove <instance-id>
```

Việc xóa sẽ xóa kết nối OAuth và ngăn vĩnh viễn việc đăng ký lại origin đó. Sử dụng `disable` nếu bạn có thể tiếp tục sử dụng instance sau này. Các danh tính và bộ nhớ hiện có vẫn khả dụng, và các thay đổi sẽ có hiệu lực mà không cần khởi động lại.

Xem [Hỗ trợ message-proxy](/features/integrations/message-proxy-support/#pluralbuddy) để biết cách thiết lập của người dùng và [kiến trúc message-proxy](/architecture/integrations/message-proxy/) để biết cơ chế lưu trữ và làm mới token.
