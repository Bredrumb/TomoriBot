---
title: "NovelAI"
sidebar:
  order: 4
aiGenerated: true
---

NovelAI kết nối các model văn bản (`GLM 4.6`, `Xialong`, `Kayra`, `Erato`) và tính năng tạo hình ảnh anime. Bạn có thể sử dụng NovelAI cho cả hai hoặc kết hợp tính năng tạo hình ảnh của NovelAI với một nhà cung cấp trò chuyện khác.

## Model văn bản và gói thuê bao
<!-- anchor: text-models-and-subscription -->

`GLM 4.6` là model văn bản mặc định. `Xialong` và `Erato` yêu cầu gói thuê bao Opus đang hoạt động. Việc chọn `Xialong` sẽ kiểm tra key máy chủ hoặc cá nhân đã lưu của bạn; nếu bạn chọn trước khi thêm key, quá trình kiểm tra sẽ chạy khi bạn thêm key. Gói thuê bao của key đang phục vụ quyết định hạn ngạch ngữ cảnh cho phép. Quản lý máy chủ có thể kiểm tra hạn ngạch tạo lượt của Opus bằng `/novelai usage`.

[Hướng dẫn định dạng chat](https://docs.novelai.net/en/text/chatformat/) của NovelAI mô tả cách tiếp cận theo phong cách cốt truyện được dùng cho `Kayra` và `Erato`; `GLM 4.6` và `Xialong` dùng các mẫu chat riêng biệt. Việc lọc và trau chuốt dưới đây là các điều chỉnh của TomoriBot.

## Preset lấy mẫu
<!-- anchor: sampling-presets -->

Việc chuyển đổi model văn bản sẽ tải `Carefree-Kayra`, `Erato-Shosetsu` hoặc `Default-Xialong` cho model đã chọn; `GLM 4.6` sử dụng các giá trị mặc định riêng. Thao tác chuyển đổi đặt lại temperature, top-k, top-p và min-p, đồng thời bật các bộ lấy mẫu đó cho cả việc chuyển đổi model của máy chủ lẫn cá nhân. Hãy thay đổi preset hoặc bộ lấy mẫu trong `/config` > `Model` > `Bộ lấy mẫu & Tham số văn bản`; các chỉnh sửa sau đó vẫn duy trì hoạt động và việc thay thế key trên cùng một model sẽ giữ nguyên chúng.

## Ngữ cảnh và cài đặt
<!-- anchor: context-and-settings -->

Các cài đặt bị lược bỏ vẫn được lưu trong `/config` > `Hành vi` > `Hành vi chung` cho các nhà cung cấp khác.

| Nội dung hoặc cài đặt | Cách NovelAI xử lý |
|---|---|
| Thuộc tính persona, đoạn hội thoại mẫu, cuộc trò chuyện và bộ nhớ | Được giữ lại, bao gồm cả bộ nhớ cá nhân và bộ nhớ ngắn hạn hiển thị. Các bộ lọc quyền riêng tư và thẻ bộ nhớ vẫn được áp dụng. |
| Prompt hệ thống, persona và kênh; ghi chú ngữ cảnh; quy tắc humanizer; điều hòa hành vi; chỉ dẫn SillyTavern | Bị lược bỏ. Xialong sử dụng prompt hệ thống của NovelAI; GLM, Kayra và Erato không có khối hệ thống. |
| Trạng thái, thông tin thời gian/kênh/máy chủ, tài liệu và danh sách emoji/sticker/sprite | Bị lược bỏ. |
| Lời nhắc công cụ bộ nhớ | Bị lược bỏ, bao gồm cả các lời nhắc được tạo trước tùy chỉnh cá nhân hoặc dự phòng. |
| Siêu dữ liệu ATTG và số sao chất lượng | ATTG là viết tắt của Tác giả (Author), Tiêu đề (Title), Thẻ (Tags) và Thể loại (Genre). Xialong đặt siêu dữ liệu lên đầu thông tin cố định và mặc định 4 sao. Erato dùng số sao đã cấu hình; Kayra bỏ qua số sao. |
| Prefill phản hồi | Được giữ lại khi các điều khiển prefill cho phép. |
| Công cụ và phương tiện | Không có lệnh gọi công cụ hay đầu vào hình ảnh/video cho model văn bản. Các lệnh slash và lệnh tạo hình ảnh riêng biệt vẫn khả dụng. |
| Giới hạn token | Được đếm cục bộ và dành sẵn chỗ cho câu trả lời. Độ dài câu trả lời đã cấu hình được ưu tiên hơn độ dài của preset và có thể bị giảm để vừa vặn. |

Nhãn người nói bên ngoài đã biết và các dòng đứng một mình dạng `---` hoặc `***` sẽ dừng đầu ra, ngay cả khi cài đặt dừng người nói dùng chung bị tắt. Tên, biệt danh và nhãn sprite của persona đang trả lời vẫn được cho phép. Bộ bảo vệ cục bộ giữ nguyên mã nguồn; điểm dừng API nguyên bản vẫn có thể khớp bên trong mã được tạo.

## Cắt tỉa ngữ cảnh
<!-- anchor: context-trimming -->

Bộ nhớ sử dụng tối đa 20% cửa sổ ngữ cảnh, trong đó các mục cũ hơn sẽ bị xóa trước. Nếu prompt vẫn không vừa, TomoriBot sẽ cắt tỉa theo thứ tự sau:

| Thứ tự | Nội dung bị xóa | Nội dung được bảo vệ |
|---|---|---|
| 1 | Các đoạn hội thoại mẫu thừa | Một lượt trao đổi mẫu khả dụng |
| 2 | Bộ nhớ, các mục cũ hơn trước | Không có mức tối thiểu |
| 3 | Lịch sử cuộc trò chuyện cũ | Tối đa hai lượt trao đổi gần đây |

Thuộc tính persona, siêu dữ liệu ATTG và lượt hiện tại cũng được bảo vệ. Quá trình tạo sẽ thất bại nếu ngữ cảnh được bảo vệ không thể vừa vặn. Việc cắt tỉa không làm thay đổi các bộ nhớ và tin nhắn đã lưu.

`/tool prompt snapshot` hiển thị prompt cuối cùng, số lượng token, giới hạn câu trả lời và báo cáo cắt tỉa.

## Trau chuốt văn bản và gửi tới Discord
<!-- anchor: text-polishing-and-discord-delivery -->

Việc trau chuốt chỉ thay đổi bản sao của lịch sử, bộ nhớ và đoạn hội thoại mẫu gửi tới cả bốn model NovelAI trước khi đếm token. Văn bản đã lưu và các nhà cung cấp khác không bị thay đổi; ngữ pháp không bị viết lại.

- **Văn bản được viết hoa đúng cách**: các từ đầu câu và đầu dòng bằng chữ cái Latinh được viết hoa; tên persona đã biết sử dụng kiểu viết hoa/thường đã cấu hình.
- **Các dòng văn xuôi nhận dấu câu**: dấu chấm cuối dòng bị thiếu sẽ được thêm vào trong khi dấu câu hiện có, ngắt dòng và dòng trống vẫn được giữ nguyên.
- **Văn xuôi có định dạng được trau chuốt**: `*kisses juno*` trở thành `*Kisses Juno.*`. Chữ đậm, gạch dưới, gạch ngang và spoiler tuân theo cùng quy tắc; nhấn mạnh nội dòng giữ nguyên kiểu chữ ngoại trừ tên riêng.
- **Mã nguồn và định dạng đánh dấu được bảo toàn**: mã nguồn, URL, lượt nhắc tới (@mention), định dạng Discord, danh sách, tiêu đề, trích dẫn, bảng và đường phân cách giữ nguyên nội dung hoặc cấu trúc.
- **Tôn trọng phần bắt đầu và kết thúc không phải văn xuôi**: các dòng bắt đầu bằng khối mã, URL, lượt nhắc tới, emoji hoặc ký tự không phải Latinh sẽ bỏ qua định dạng câu. Phần kết thúc bằng emoji, kaomoji, mã nguồn và liên kết không bị thêm dấu chấm.
- **Bộ nhớ dài hạn dùng nội dung thuần túy**: nhãn chủ sở hữu, ID cơ sở dữ liệu và tiền tố thẻ bổ sung bị lược bỏ; tên đã phân giải được giữ lại.
- **Xóa chú thích lịch sử được tạo**: lược bỏ tham chiếu câu trả lời, siêu dữ liệu cảm xúc và thông báo quản trị. Cử chỉ trở thành hành động; phân cảnh và tóm tắt mất phần vỏ bọc hệ thống. Văn bản nguyên văn của người dùng chứa `System:` được giữ lại.
- **Prefill được giữ chính xác**: prefill phản hồi rõ ràng và các phân đoạn tiếp nối không bị thay đổi.
- **Gửi tới Discord tuân theo cài đặt của bạn**: humanizer vẫn kiểm soát kiểu viết hoa, dấu câu và việc tách tin nhắn. Lịch sử sau đó được trau chuốt lại; dấu câu bị mất không thể khôi phục hoàn toàn chính xác.

## Tạo hình ảnh
<!-- anchor: image-generation -->

Gán một model vào ô `Hình ảnh NovelAI` trong `/config` > `Model` > `Chuyển đổi model`. Thành viên có thể tạo hình ảnh trực tiếp bằng `/novelai generate image` hoặc yêu cầu trong cuộc trò chuyện khi nhà cung cấp văn bản đang hoạt động có hỗ trợ gọi công cụ.

Preset `Default + Image Generation Expert` sử dụng các thẻ theo phong cách imageboard cho NovelAI, kèm theo mô tả ngắn khi cần thiết cho các tương tác hoặc vị trí đặt văn bản. Đối với các phân cảnh có nhiều nhân vật, TomoriBot tách biệt bối cảnh chung và chỉ hướng góc quay khỏi ngoại hình cùng hành động của từng nhân vật.

Để có lời thoại rõ ràng, hãy yêu cầu TomoriBot đưa vào đoạn hội thoại chính xác. Công cụ hình ảnh NovelAI sẽ tự động đặt lời thoại của nhân vật vào phần `Text:` ở cuối. V4 và V4.5 hỗ trợ văn bản tiếng Anh; V5 hỗ trợ thêm tiếng Nhật và tiếng Trung. Văn bản trên biển hiệu hoặc màn hình có thể được mô tả trong prompt phân cảnh chung. Hãy giữ văn bản được yêu cầu ngắn gọn và tránh đặt `no text` trong các thẻ tích cực. Vị trí và kiểu chữ (bao gồm cả chữ viết tiếng Nhật dọc) chỉ là gợi ý chứ không được đảm bảo.
