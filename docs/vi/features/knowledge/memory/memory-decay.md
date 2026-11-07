---
title: "Suy giảm bộ nhớ"
sidebar:
  order: 2
aiGenerated: false
---

Hãy hình dung các [bộ nhớ dài hạn](/features/knowledge/memory/long-term-memory/) của một persona giống như những mẩu giấy ghi chú trên bàn làm việc. Persona đọc lại từng mẩu ghi chú trên bàn trước mỗi câu trả lời, vì vậy một chiếc bàn đầy ắp sẽ khiến mỗi câu trả lời trở nên dài hơn và tốn kém hơn. Tính năng suy giảm bộ nhớ sẽ chuyển các ghi chú mà không ai cần tới trong một thời gian vào ngăn kéo. Chúng không bị vứt bỏ: khi cuộc trò chuyện nhắc đến một ghi chú trong ngăn kéo, persona sẽ lấy nó ra lại. Tài liệu này gọi các ghi chú trên bàn là *đang hoạt động* và ghi chú trong ngăn kéo là *tạm nghỉ*.

Suy giảm bộ nhớ cần có model embedding; xem [Nhà cung cấp & model](/features/setup-administration/providers-and-models/). Nếu không có model embedding, mọi bộ nhớ đều luôn ở trạng thái hoạt động.

## Cách một bộ nhớ tạm nghỉ và quay trở lại

1. Mỗi bộ nhớ có một bộ đếm số ngày không sử dụng. Bộ đếm bắt đầu từ 0.
2. Với mỗi câu trả lời, TomoriBot thực hiện một lượt tìm kiếm. Bot chuyển tin nhắn mới nhất thành một embedding (danh sách các con số mô tả ý nghĩa của tin nhắn; xem [Cách tìm kiếm hoạt động](/features/knowledge/memory/documents/#how-search-works)) và so sánh nó với từng bộ nhớ mà bot có thể sử dụng trong cuộc trò chuyện đó.
3. Tối đa 3 mục khớp nhất, trên cả bộ nhớ máy chủ và bộ nhớ cá nhân, được tính là đã sử dụng nếu chúng khớp ở mức hợp lý. Bộ đếm của chúng quay về 0.
4. Mọi bộ nhớ khác trong lượt tìm kiếm đó tăng thêm một ngày. Việc này diễn ra tối đa một lần mỗi ngày (UTC), bất kể có bao nhiêu tin nhắn được gửi đi.
5. Khi đủ 7 ngày được tính, bộ nhớ sẽ tạm nghỉ. Nó không còn được gửi kèm trong mỗi câu trả lời, nhưng vẫn được lưu và có thể tìm kiếm được.
6. Khi một tin nhắn sau đó khớp với một bộ nhớ đang tạm nghỉ, bot sẽ thêm nó vào câu trả lời đó và bộ đếm của nó được đặt lại, do đó nó hoạt động trở lại.

Đang hoạt động khác với được sử dụng. Một bộ nhớ chỉ duy trì trạng thái hoạt động khi nó tiếp tục là một trong những kết quả khớp hàng đầu cho một tin nhắn nào đó.

Chỉ những ngày mà tìm kiếm thành công mới được tính. Một ngày không có cuộc trò chuyện, hoặc một câu trả lời mà việc tìm kiếm thất bại, sẽ không làm thay đổi điều gì, vì vậy không có bộ nhớ nào tạm nghỉ chỉ vì thời gian trôi qua.

### Ví dụ

Một bộ nhớ máy chủ, "Mèo của Juno tên là Mochi":

| Ngày trò chuyện | Điều diễn ra | Bộ đếm | Trạng thái |
|---|---|---|---|
| Ngày được lưu | Đã lưu | 0 | Đang hoạt động |
| 6 ngày trò chuyện tiếp theo | Trò chuyện về game; Mochi không bao giờ được nhắc đến | 6 | Đang hoạt động |
| Một tuần yên tĩnh | Không ai trò chuyện | 6 | Đang hoạt động, tạm dừng |
| Ngày trò chuyện tiếp theo | Một cuộc trò chuyện khác không có Mochi | 7 | Tạm nghỉ |
| Một ngày trò chuyện sau đó | Juno hỏi "Mochi dạo này thế nào rồi?" | 0 | Được gợi lại cho câu trả lời đó, sau đó hoạt động |

## Cuộc trò chuyện của ai được tính

Bộ nhớ máy chủ tính tuổi vào những ngày persona trò chuyện trong máy chủ đó. Bộ nhớ cá nhân chỉ được tìm kiếm khi chủ sở hữu của chúng tham gia vào cuộc trò chuyện, vì vậy chúng chỉ tính tuổi vào những ngày đó. Bau ghé thăm mỗi tháng một lần, do đó các bộ nhớ của Bau cần 7 lần ghé thăm mà chúng không bao giờ được nhắc đến trước khi tạm nghỉ, và những ngày bận rộn của các thành viên quen thuộc không làm hao mòn chúng.

Các bộ nhớ bị ẩn bởi cài đặt quyền riêng tư, danh sách đen, giới hạn kênh hoặc thẻ sẽ không bao giờ được tìm kiếm, vì vậy chúng không tính tuổi cũng như không quay trở lại.

## Khi bộ nhớ bị đầy

Mỗi persona mặc định giữ 100 bộ nhớ máy chủ và 100 bộ nhớ cá nhân. Khi TomoriBot lưu một bộ nhớ mới vào một danh sách đã đầy, bot sẽ quên một bộ nhớ tạm nghỉ để nhường chỗ. Bộ nhớ chưa từng được khớp sẽ bị quên trước tiên, sau đó đến bộ nhớ được khớp cách đây lâu nhất. Xác nhận sẽ hiển thị nội dung đã được lưu và nội dung đã bị quên, tuân theo cài đặt hiển thị thông báo bộ nhớ của máy chủ.

Bot không bao giờ quên:

- một bộ nhớ cá nhân Toàn cục
- một bộ nhớ mà ai đó đã thêm hoặc chỉnh sửa bằng `/memories` hoặc `/personal memories`

Các bộ nhớ đã nhập không được bảo vệ. Để bảo vệ một bộ nhớ, hãy chỉnh sửa và lưu nó một lần bằng `/memories` hoặc `/personal memories`. Một bộ nhớ được bảo vệ vẫn có thể tạm nghỉ và quay trở lại thông qua tìm kiếm; việc bảo vệ chỉ giúp nó không bị quên.

Nếu không có bộ nhớ nào thỏa điều kiện, hoặc tính năng tìm kiếm không khả dụng cho lượt trả lời đó, yêu cầu lưu sẽ bị từ chối.

## Chỉ dẫn thuộc về nơi khác

Một bộ nhớ như "Luôn trả lời Juno bằng tiếng Tây Ban Nha" hiếm khi khớp với những gì mọi người nói, vì vậy nó có thể tạm nghỉ và ngừng áp dụng. Hãy đặt các chỉ dẫn luôn cần áp dụng vào [thuộc tính persona](/features/chatting-personality/multiple-personas/#attributes), prompt persona hoặc [mục lorebook luôn bật](/features/knowledge/memory/lorebooks/).

## Chi phí và caching prompt

Lượt tìm kiếm là một yêu cầu embedding cho mỗi câu trả lời, dùng chung với tìm kiếm [tài liệu](/features/knowledge/memory/documents/). Các bộ nhớ được gợi lại nằm gần cuối prompt, cạnh các tài liệu, vì vậy phần đầu của prompt giữ nguyên giữa các câu trả lời. Các nhà cung cấp giảm giá cho phần đầu lặp lại của prompt, vì vậy việc gợi lại vẫn giữ được mức giảm giá đó. Phần đầu chỉ thay đổi ở câu trả lời diễn ra sau khi một bộ nhớ chuyển đổi giữa trạng thái hoạt động và tạm nghỉ.

## Tắt tính năng suy giảm bộ nhớ

Người self-hosting có thể đặt `MEMORY_DECAY_ENABLED=false` để tắt tính năng suy giảm bộ nhớ cho toàn bộ hệ thống cài đặt. Khi đó, mọi bộ nhớ luôn ở trạng thái hoạt động, không có gì bị quên để nhường chỗ, và danh sách đầy sẽ từ chối các lượt lưu mới. Tìm kiếm tài liệu vẫn tiếp tục hoạt động. Tính năng suy giảm bộ nhớ cũng cần tiện ích mở rộng cơ sở dữ liệu `pgvector`; xem [Cài đặt thủ công](/self-hosting/manual-setup/#pgvector--documentrag-memory).
