---
title: "Thống kê và thông tin chuyên sâu"
sidebar:
  order: 4
---

TomoriBot theo dõi mức sử dụng để bạn có thể xem ai trò chuyện với ai, persona và model nào được sử dụng, và công cụ nào được kích hoạt (sau đó chuyển thành một thẻ đồ họa thông tin có thể chia sẻ).

## Bảng điều khiển dạng văn bản

Ba lệnh mở một bảng điều khiển tương tác theo dạng thẻ (Tổng quan, Persona, Model và chi phí, Công cụ và lệnh, Biểu cảm, Người dùng yêu thích, Bảng xếp hạng):

Các thẻ văn bản là bảng điều khiển công khai bền vững do người gọi lệnh kiểm soát. Chúng vẫn khả dụng cho đến khi tin nhắn bị xóa, và người dùng khác không thể thao tác các nút điều khiển.

- `/stats personal`: mức sử dụng của chính bạn.
- `/stats persona`: mức sử dụng của một persona trên máy chủ này.
- `/stats server`: mức sử dụng trên toàn máy chủ.

Hầu hết các lệnh đều hỗ trợ khung thời gian (**timeframe**), và số liệu thống kê cá nhân có thể được giới hạn trong máy chủ này hoặc trên tất cả các máy chủ.

:::note
**Số lượng token** là mức sử dụng do chính nhà cung cấp báo cáo khi có sẵn (ước tính dựa trên ký tự chỉ được sử dụng cho các nhà cung cấp không báo cáo). **Chi phí** định giá các token đó theo mức giá niêm yết trong danh mục model, vì vậy nó có thể khác với hóa đơn thực tế của bạn (bộ nhớ đệm prompt, giảm giá, hạn ngạch gói miễn phí, v.v.).
:::

## Thẻ đồ họa thông tin có thể chia sẻ

Lệnh `/stats generate` tạo ra một thẻ hình ảnh chỉn chu mà bạn có thể gửi vào cuộc trò chuyện:

- **Tổng kết cá nhân**: hoạt động cá nhân của bạn, theo phong cách Spotify Wrapped.
- **Độ thân thiết persona**: số liệu thống kê của một persona trên máy chủ này.
- **Bảng xếp hạng máy chủ**: thứ hạng trên toàn máy chủ.

Người dùng ở chế độ hoàn toàn riêng tư (`/personal config`) không thể tạo thẻ cá nhân.

Để biết cách các thẻ được cấu thành và hiển thị, hãy xem tài liệu tham khảo kiến trúc về [hệ thống con đồ họa thông tin thống kê](/en/architecture/subsystems/stats-infographic/).
