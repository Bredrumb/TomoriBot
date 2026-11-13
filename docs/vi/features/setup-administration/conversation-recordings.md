---
title: "Bản ghi cuộc trò chuyện"
description: "Lưu các trích đoạn xung quanh tin nhắn máy chủ của bạn và xuất riêng tư hoặc xóa bản ghi của bạn."
sidebar:
  order: 5
---

Bản ghi cuộc trò chuyện là một tính năng tự nguyện tham gia giúp lưu các trích đoạn xung quanh tin nhắn máy chủ của chính bạn chỉ cho mục đích sử dụng cá nhân, với các định danh Discord có cấu trúc được thay thế bằng trình giữ chỗ trước khi lưu trữ (văn bản tự do và liên kết ngoài vẫn có thể nhận diện được người gửi).

**Theo mặc định, TomoriBot không lưu tin nhắn của bạn, tính năng ghi là tùy chọn cho từng người dùng chỉ nhằm mục đích sử dụng cá nhân, và chỉ bắt đầu sau khi bạn xác nhận lệnh `/record`. TomoriBot không tự động xây dựng persona, không gọi đến nhà cung cấp AI, hay đưa các trích đoạn này vào bất kỳ quy trình huấn luyện nào.**

## Mục đích sử dụng

- Lưu trữ tài liệu lưu trữ cá nhân về tin nhắn máy chủ của bạn và ngữ cảnh xung quanh.
- Xem lại các cuộc thảo luận trước đây với dấu thời gian, thứ tự tin nhắn và liên kết trả lời.
- Xem lại phong cách viết của bản thân để soạn thảo ghi chú hoặc prompt persona ngoại tuyến.
- Xuất bản ghi có cấu trúc dưới dạng Markdown hoặc JSON để sử dụng ngoại tuyến cho riêng bạn.

## Bắt đầu và dừng ghi

- **`/record start`**: Chọn thời lượng và lưu chỉ tin nhắn của bạn hay bao gồm tin nhắn xung quanh, sau đó xác nhận. Tránh chọn `Cho đến khi dừng (không khuyến nghị)` trừ khi bạn định dừng theo cách thủ công.
- **Phiên hoạt động**: Bạn có thể có một phiên ghi hoạt động trên mỗi máy chủ. Chạy `/record start` khi đang hoạt động sẽ mở cài đặt của phiên: các thay đổi ngữ cảnh chỉ áp dụng cho trích đoạn mới; đổi thời lượng sẽ đặt thời điểm kết thúc mới tính từ bây giờ, trong khi giữ nguyên thời lượng sẽ duy trì thời điểm kết thúc hiện tại.
- **`/record stop`**: Dừng thu thập và giữ lại các trích đoạn đã lưu.
- **`/record data`**: Mở các bản ghi và cài đặt của bạn cho máy chủ hiện tại.
- **Phạm vi**: Không khả dụng trong DM. Quản lý máy chủ không thể xem, xuất hoặc xóa bản ghi của bạn.

## Những gì được lưu trữ

- **Kích hoạt**: Sau khi kích hoạt, mỗi tin nhắn thực tế bạn gửi có thể lưu một trích đoạn kết thúc bằng tin nhắn đó (ngay cả khi Tomori không trả lời). Tin nhắn mạo danh không kích hoạt tính năng ghi.
- **Ngữ cảnh**: Tối đa 10 tin nhắn đủ điều kiện trước đó trong cùng một kênh hoặc luồng từ một khung thời gian gần đây có giới hạn (chúng có thể gửi trước khi kích hoạt).
- **Chế độ**: `Chỉ tin nhắn của bạn` chỉ lưu tin nhắn của bạn. `Bao gồm tin nhắn xung quanh` cũng có thể lưu các thành viên khác, bot và webhook, ngay cả khi họ chưa từng bắt đầu ghi.
- **Kênh đủ điều kiện**: Các kênh và luồng máy chủ mà cả bạn và bot đều có quyền xem và đọc lịch sử, bao gồm các kênh bị giới hạn và luồng riêng tư. Các thành viên có quyền riêng tư Đầy đủ sẽ bị bỏ qua. Cài đặt quyền riêng tư của kênh và ngữ cảnh liên kênh không loại trừ bản ghi của bạn.
- **Khoảng trống và trùng lặp**: Các trích đoạn là những ảnh chụp nhanh chồng lấn kèm dấu thời gian, thứ tự và liên kết trả lời. Cùng một tin nhắn có thể xuất hiện trong nhiều trích đoạn. Thời gian ngừng hoạt động, sự kiện bị bỏ lỡ hoặc thiếu quyền sẽ để lại khoảng trống (không truy thu bổ sung).
- **Embed**: Lưu tiêu đề, phần mô tả, các trường, tên tác giả và chân trang của embed dưới dạng văn bản tin nhắn, với việc thay thế danh tính tương tự như văn bản thông thường.
- **Tệp đính kèm**: Lưu số lượng hình ảnh, video, âm thanh và tệp (các loại không xác định được tính là tệp). Không lưu byte phương tiện, tên tệp, URL đính kèm, OCR và phần mô tả phương tiện được tạo ra.

### Trình giữ chỗ danh tính dễ đọc

- Các lượt nhắc, kênh và vai trò có cấu trúc sử dụng các trình giữ chỗ phiên ổn định (`[SELF]`, `[PARTICIPANT_1]`, `[CHANNEL_1]`, `[ROLE_1]`).
- Tên và biệt danh đã biết duy nhất được thay thế không phân biệt chữ hoa chữ thường trước khi lưu (điều này có thể thay thế các từ thông thường trùng với tên). Các tên trùng lặp sẽ bị bỏ qua và không có tìm kiếm nào trên toàn máy chủ được thực hiện.
- Emoji tùy chỉnh của Discord trở thành `:name:`; emoji Unicode được giữ nguyên. Liên kết tin nhắn Discord trở thành một dấu hiệu chung; các URL bên ngoài được giữ nguyên.
- Việc thay thế là nỗ lực tối đa: văn bản tự do và liên kết bên ngoài vẫn có thể nhận diện được người gửi. Văn bản gõ trông giống trình giữ chỗ sẽ giữ nguyên dưới dạng văn bản gốc.

## Xuất và xóa

- **Xuất**: Trong `/record data`, chọn một khoảng thời gian và định dạng Markdown hoặc JSON. Khoảng thời gian tương đối kết thúc khi bạn gửi yêu cầu; `Toàn bộ thời gian` bao gồm tất cả các trích đoạn đã lưu. Các trích đoạn được chọn theo thời gian của tin nhắn kết thúc của chúng.
- **Chuyển giao**: Các tệp sẽ đến trong một câu trả lời riêng tư (hãy lưu lại trước khi câu trả lời hết hạn). Tên tệp bao gồm thời gian xuất UTC và một ID xuất ngắn; các tệp bị chia nhỏ cũng bao gồm số phần. Các bản xuất lớn sẽ chia tách giữa các trích đoạn hoàn chỉnh; hãy thu hẹp phạm vi nếu khoảng thời gian hoặc trích đoạn vượt quá giới hạn kích thước. Các trích đoạn đã lưu vẫn có thể xuất được ngay cả khi sau đó bạn mất quyền truy cập kênh nguồn.
- **ID trong JSON**: Mỗi lần xuất sẽ gán các ID mới không hiển thị chi tiết (các tin nhắn dùng chung giữ cùng một ID giữa các tệp bị chia nhỏ; các tin nhắn có nội dung văn bản giống hệt nhau sẽ nhận các ID khác nhau). Không có ID Discord hoặc ID đã lưu nào được xuất.
- **Xóa**: Dùng `Xóa bản ghi máy chủ` để chọn một khoảng thời gian, bao gồm `Toàn bộ thời gian`, sau đó xác nhận. Khoảng thời gian kết thúc khi bạn gửi lựa chọn; các tin nhắn được ghi sau đó vẫn được lưu. Việc xóa không dừng phiên ghi đang hoạt động, và việc dừng ghi không xóa các bản ghi đã lưu.

## Quyền riêng tư và lưu trữ

- **Quyền truy cập của người vận hành và AI**: Người vận hành bot lưu trữ các bản ghi trong cơ sở dữ liệu của họ và có thể có quyền truy cập cơ sở hạ tầng. Tính năng ghi không thực hiện cuộc gọi nào đến nhà cung cấp AI và không bắt đầu quy trình huấn luyện hay mạo danh nào.
- **Hạn ngạch**: 100 MiB nội dung bản ghi hợp lý trên tất cả các máy chủ (các tin nhắn dùng chung được tính theo từng trích đoạn). Khi đầy, các trích đoạn hoàn chỉnh cũ nhất trên các máy chủ của bạn sẽ bị thu hồi trước.
- **Lưu trữ**: Tính năng tự động hết hạn theo thời gian sẽ tắt trừ khi người vận hành đặt `RECORD_RETENTION_DAYS`, biến số này làm hết hạn toàn bộ trích đoạn (bao gồm cả các trích đoạn hiện có) theo thời gian tin nhắn kết thúc của chúng.
- **Chỉnh sửa và xóa bỏ**: Các chỉnh sửa nguồn được ghi nhận sẽ cập nhật văn bản và số lượng tệp đính kèm đã lưu; các thao tác xóa và loại trừ quyền riêng tư sau đó được ghi nhận sẽ xóa bản sao đã lưu. Không thể ghi nhận các sự kiện khi bot ngoại tuyến hoặc không có quyền truy cập, đồng thời các tệp đã tải xuống hoặc bản sao lưu sẽ không bị ảnh hưởng. Xem [Chính sách quyền riêng tư](/legal/privacy-policy/) và [bảo trì bản ghi](/self-hosting/maintenance/#conversation-recording-storage).
