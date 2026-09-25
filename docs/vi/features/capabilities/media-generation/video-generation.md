---
title: "Tạo video"
sidebar:
  order: 2
---

TomoriBot có thể tạo video ngắn từ prompt văn bản hoặc bằng cách tạo chuyển động cho ảnh tham chiếu.
Hãy dùng lệnh `/generate video`, hoặc chỉ cần yêu cầu bot.

## Những việc bot có thể làm

- **Text-to-video**: tạo clip ngắn từ prompt.
- **Image-to-video**: tạo chuyển động cho ảnh tham chiếu (ảnh đầu tiên từ tin nhắn được tham chiếu
  sẽ trở thành khung hình bắt đầu).
- **Image-to-video lặp vô tận (looping)**: khi được yêu cầu qua đoạn chat, các model được hỗ trợ có thể tái
  sử dụng ảnh bắt đầu làm khung hình kết thúc.
- **Tùy chỉnh tỷ lệ khung hình**.

Image-to-video và tính năng lặp phụ thuộc vào khả năng xử lý khung hình đầu/cuối của model đã chọn.
TomoriBot sẽ kiểm tra danh mục model video hiện tại của OpenRouter trước khi gửi tác vụ tính phí và
yêu cầu bạn xóa ảnh, tắt chế độ lặp hoặc chọn model tương thích khi cần thiết.

Tính năng tạo video sử dụng **quy trình thăm dò không đồng bộ**: yêu cầu được gửi đi, sau đó
TomoriBot liên tục thăm dò nhà cung cấp cho đến khi clip hoàn tất và đăng lên khi sẵn sàng. Các clip
lớn có thể mất một khoảng thời gian.

## Thiết lập

1. Cấu hình model video bằng `/config` > Models > Switch Models.
2. Đảm bảo tính năng tạo hình ảnh/phương tiện được cho phép qua `/config` > Permissions.
3. Yêu cầu bot tạo video, hoặc chạy `/generate video`.

## Hỗ trợ nhà cung cấp

Tính năng tạo video nguyên bản khả dụng trên **Google, OpenRouter**, và **Z.ai**. Xem bảng tương thích
đầy đủ trong [Nhà cung cấp & model](/vi/features/setup-administration/providers-and-models/#supported-providers).

Để tạo video **cục bộ** qua ComfyUI (ví dụ: quy trình WAN image-to-video), hãy xem
[Cài đặt: ComfyUI](/vi/self-hosting/local-endpoints/setup-comfyui/).

Để tìm hiểu kiến trúc tạo nội dung và thăm dò nội bộ, hãy xem tài liệu tham khảo về
[tạo video](/en/architecture/subsystems/video-generation/).
