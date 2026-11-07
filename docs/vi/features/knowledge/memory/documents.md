---
title: "Tài liệu"
sidebar:
  order: 3
aiGenerated: false
---

Tài liệu cung cấp cho TomoriBot một cơ sở tri thức mà bot sẽ tìm kiếm khi trả lời: sổ luật chơi của một game, phần FAQ của máy chủ, bản xuất wiki hoặc ghi chú cốt truyện. Chúng chứa tài liệu quá dài để trở thành [bộ nhớ dài hạn](/features/knowledge/memory/long-term-memory/).

## Lý do nên dùng tài liệu

Một bộ nhớ dài hạn đang hoạt động sẽ được gửi đầy đủ trong mỗi câu trả lời, vì vậy mỗi bộ nhớ đều tiêu tốn không gian prompt dù cuộc trò chuyện có cần đến nó hay không. Thay vào đó, tài liệu sẽ được tìm kiếm. Mỗi câu trả lời nhận tối đa 10 đoạn khớp với cuộc trò chuyện, do đó ngay cả một cuốn sổ luật 40 trang cũng chỉ thêm tối đa khoảng ba trang văn bản vào một câu trả lời, và những phần không ai hỏi tới sẽ không tốn chi phí.

Hãy dùng bộ nhớ dài hạn cho một dữ kiện ngắn mà bot luôn cần biết. Hãy dùng tài liệu cho tài liệu tham khảo mà bot nên tra cứu khi được nhắc tới.

## Cách tìm kiếm hoạt động
<!-- anchor: how-search-works -->

Khi bạn thêm một tài liệu, TomoriBot sẽ chia nó thành các đoạn gồm một vài đoạn văn, gọi là chunk. Một model embedding sau đó sẽ chuyển đổi từng chunk thành một danh sách các con số mô tả ý nghĩa của nó. Các chunk về chủ đề tương tự sẽ nhận được các con số tương tự ngay cả khi chúng dùng từ ngữ khác nhau.

Với mỗi tin nhắn, bot sẽ chuyển tin nhắn mới nhất thành các con số theo cách tương tự và chọn các chunk có ý nghĩa gần nhất. Bot cũng kiểm tra các chunk có chung từ ngữ chính xác, giúp phát hiện tên riêng và các thuật ngữ tự tạo mà một model embedding có thể không biết. Các kết quả khớp nhất sẽ được đưa vào prompt của bot cho câu trả lời đó. Kỹ thuật này được gọi là tạo tăng cường truy xuất (RAG).

Ví dụ, một tài liệu nêu "Các thành viên bang hội gặp nhau vào thứ Sáu hàng tuần tại bến tàu." Câu hỏi "khi nào bang hội tụ họp?" sẽ tìm thấy chunk đó ngay cả khi câu hỏi không bao giờ nhắc đến từ "gặp" hay "thứ Sáu".

Vì bot chỉ thấy các chunk khớp, bot không thể tóm tắt toàn bộ tài liệu hay đếm các mục trên toàn bộ tài liệu. Các câu hỏi về một chi tiết cụ thể hoạt động tốt nhất. Các tiêu đề Markdown sẽ rất hữu ích: mỗi chunk giữ nguyên các tiêu đề mục của nó, vì vậy một tài liệu được tổ chức tốt sẽ mang lại các kết quả khớp rõ ràng hơn.

## Thiết lập tài liệu

Tài liệu cần một model embedding. Hãy chọn một model trong vị trí `Embeddings`; xem [Nhà cung cấp & model](/features/setup-administration/providers-and-models/).

Quản lý tài liệu trong `/memories` > `Tài liệu`. Chọn `Thêm tài liệu mới` để tải lên tệp `.txt`, `.md` hoặc `.pdf`. Một tài liệu có thể thuộc về một persona hoặc dùng chung giữa các persona, và có thể được giới hạn trong các kênh đã chọn và luồng của chúng. Bạn có thể đọc các chunk đã lưu và chỉnh sửa hoặc xóa bất kỳ chunk nào trong số đó. Để chuyển một bộ nhớ máy chủ dài thành một tài liệu, hãy mở nó trong `/memories` và chọn `Vector hóa`.

Trong các máy chủ mới, việc quản lý tài liệu được giới hạn cho các thành viên có quyền `Quản lý máy chủ` theo mặc định; người quản lý có thể cấp quyền truy cập qua `/moderation` > `Quyền thành viên`.

## Giới hạn tài liệu

Theo mặc định, một tệp có thể có dung lượng tối đa 4 MB và văn bản tối đa 120.000 ký tự (khoảng 20.000 từ tiếng Anh), được chia thành tối đa 150 chunk. Tài liệu của mỗi persona và tập hợp dùng chung có thể chứa 20 tài liệu và 1.000 chunk. Người self-hosting có thể thay đổi các giới hạn này bằng `MAX_DOCUMENT_SIZE_MB`, `MAX_DOCUMENT_TEXT_LENGTH`, `MAX_DOCUMENT_CHUNKS`, `MAX_DOCUMENTS_PER_SERVER` và `MAX_DOCUMENT_CHUNKS_PER_SERVER`.

## Học từ lịch sử trò chuyện

Lệnh `/learn history` đọc tối đa 100 tin nhắn trong kênh hiện tại, trích xuất các dữ kiện trong đó và lưu các dữ kiện dưới dạng một tài liệu. Lệnh này yêu cầu quyền `Quản lý máy chủ` và một model hỗ trợ đầu ra có cấu trúc.

Nhập lịch sử cung cấp các prompt cho hội thoại, nhập vai và góc nhìn của một persona. Bạn có thể xem lại và điều chỉnh prompt trước khi nhập. Chọn đối tượng tiếp nhận kết quả bằng `learner`: một persona (persona chính nếu để trống), từng persona đã nói chuyện, hoặc tất cả các persona cùng nhau.
