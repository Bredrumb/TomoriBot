---
title: "Xử lý dữ liệu"
sidebar:
  order: 4
---

Xuất, sao lưu, nhập hoặc xóa cài đặt, kỷ niệm và cá tính của bạn bằng lệnh gạch chéo Discord. Để biết điều khoản dịch vụ và chi tiết về quyền riêng tư, hãy xem `/legal terms-of-service` và `/legal privacy-policy`.

:::note
Trang này bao gồm các điều khiển của người dùng trong Discord. Trên các phiên bản self-hosting, sao lưu và khôi phục cơ sở dữ liệu đầy đủ là các hoạt động phía máy chủ; xem [Bảo trì & Sao lưu](/vi/self-hosting/maintenance/).
:::

## Những gì cô ấy lưu trữ

### Dữ liệu được lưu trữ

- Máy chủ và ký ức cá nhân
- Hồ sơ cá nhân, đặc điểm và ví dụ đối thoại
- Cài đặt cấu hình máy chủ
- Khóa API của nhà cung cấp được mã hóa
- Siêu dữ liệu biểu thức, quy tắc truy cập cá nhân và phương tiện biểu thức được tải lên

### Không được lưu trữ

- Lịch sử tin nhắn Discord (tin nhắn không được lưu trữ trong nhật ký tin nhắn liên tục)

### Đã gửi tới nhà cung cấp AI của bạn

Bất cứ khi nào được kích hoạt, TomoriBot sẽ tìm nạp các tin nhắn gần đây trong kênh cùng với các bộ nhớ có liên quan làm bối cảnh cho model. Cô ấy không đọc hoặc xử lý tin nhắn bên ngoài những yếu tố kích hoạt đó.

:::note
Nhà cung cấp AI mà bạn đã chọn (Google, OpenRouter, NovelAI, …) xử lý tin nhắn theo chính sách quyền riêng tư của riêng họ. Tránh chia sẻ thông tin cá nhân nhạy cảm hoặc dữ liệu bí mật.
:::

## Xuất dữ liệu của bạn

Dữ liệu có thể xuất được gửi tới DM của bạn dưới dạng tệp JSON:

- `/export config`: giá trị cấu hình máy chủ (không bao gồm khóa và thông tin xác thực API).
- `/export personal config`: cài đặt hồ sơ cá nhân (quyền riêng tư, thẻ xuất hiện, đặt tên).
- `/export memories`: bộ nhớ máy chủ, trong phạm vi persona chính, một persona hoặc tất cả các persona.
- `/export personal memories`: ký ức cá nhân, có phạm vi toàn cầu hoặc từng cá nhân.
- `/persona export`: định nghĩa đầy đủ về tính cách.

Phương tiện biểu thức đã tải lên được lưu trữ trên máy chủ lưu trữ và nằm ngoài các bản xuất JSON này. Người self-hosting phải sao lưu cơ sở dữ liệu lưu trữ và nội dung đa phương tiện cùng nhau; xem [sao lưu phương tiện tùy chỉnh](/vi/self-hosting/safe-migration/#custom-expression-media-backups).

## Nhập dữ liệu của bạn

Đính kèm tệp đã xuất để khôi phục tệp đó:

- `/import config`: cấu hình máy chủ (yêu cầu Quản lý máy chủ). Chọn phần nào để áp dụng.
- `/import personal config`: cài đặt cá nhân. Chọn những phần được phát hiện để áp dụng.
- `/import memories`: bộ nhớ máy chủ (yêu cầu Quản lý máy chủ). Hợp nhất hoặc thay thế và ánh xạ các cá tính.
- `/import personal memories`: ký ức cá nhân. Hợp nhất hoặc thay thế và ánh xạ các cá tính.
- `/persona import`: khôi phục persona. Đồng thời nhập thẻ SillyTavern PNG, thẻ JSON và kho lưu trữ `.charx` (xem [Hỗ trợ SillyTavern](/vi/features/integrations/sillytavern-support/)).

## Xóa dữ liệu của bạn

Những hành động này sẽ xóa vĩnh viễn hoặc đặt lại dữ liệu đã lưu trữ:

- `/personal memories`: quản lý hoặc xóa ký ức cá nhân.
- `/memories`: quản lý hoặc xóa bộ nhớ máy chủ (yêu cầu Quản lý máy chủ).
- `/personal nuke`: xóa vĩnh viễn tất cả dữ liệu cá nhân trên các máy chủ.
- `/nuke`: xóa dữ liệu máy chủ, bao gồm các biểu thức tùy chỉnh và quy tắc truy cập cá nhân. Đặt `preserve_personas: true` để giữ các cá tính trong khi xóa các biểu thức và phương tiện tùy chỉnh.
- `/reset config`: khôi phục cấu hình máy chủ về mặc định cơ sở dữ liệu.
  - **Bảo tồn**: gán model đang hoạt động, khóa API, điểm cuối tùy chỉnh, cá tính, bộ nhớ máy chủ và tích hợp.
  - **Xóa**: ghi đè kênh, quy tắc tự động kích hoạt, danh sách đen của người dùng và danh sách trắng của kênh.
  - Yêu cầu quyền Quản lý máy chủ trong máy chủ; cũng có sẵn trong DM.
- `/reset personal config`: khôi phục cài đặt hồ sơ cá nhân và tiêu điểm kênh về mặc định.
  - **Bảo tồn**: danh tính người dùng, ký ức cá nhân, khóa API của nhà cung cấp đã lưu, điểm cuối tùy chỉnh và tác vụ đã lên lịch.
  - **Xóa**: ghi đè biệt hiệu, thẻ xuất hiện, đại từ, kiểu xưng hô và tiêu điểm kênh.
  - Có sẵn cho tất cả người dùng trong máy chủ và DM.

Để biết chính xác các bảng cơ sở dữ liệu và danh sách cột được giữ nguyên, hãy xem [kiến trúc lược đồ cơ sở dữ liệu](/en/architecture/subsystems/database-schema/#reset-domain-classifications).

## Từ chối tham gia

- `/personal config`: kiểm soát khả năng hiển thị của bạn, tối đa khả năng tàng hình hoàn toàn (chọn không tham gia bối cảnh bộ nhớ).
- `/config` > `Quyền hạn`: người quản lý máy chủ có thể tắt các tính năng tự học và bộ nhớ.

Xem [Bộ nhớ](/vi/features/knowledge/memory/) để biết cách quản lý bộ nhớ hàng ngày.
