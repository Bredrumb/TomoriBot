---
title: "Công cụ & tiện ích mở rộng"
sidebar:
  order: 1
---

TomoriBot hoạt động theo cơ chế agentic: ngoài việc trò chuyện, bot có thể gọi các **công cụ**
để tìm kiếm web, đọc tài liệu, tạo phương tiện, đặt lời nhắc, thực hiện hành động trong các kênh
khác và nhiều hơn nữa. Bot tự quyết định thời điểm sử dụng chúng dựa trên ngữ cảnh trò chuyện.
Trang này trình bày các công cụ tích hợp sẵn, cách mở rộng năng lực của bot với máy chủ MCP, và
cách giữ cho các khai báo công cụ gọn gàng với Chế độ công cụ có chủ đích.

## Công cụ tích hợp sẵn
<!-- anchor: built-in-tools -->

Các công cụ phụ thuộc vào việc nhà cung cấp/model đang hoạt động có hỗ trợ gọi công cụ (tool calling)
hay không, và nhiều công cụ được kiểm soát bởi một cờ tính năng (nút bật/tắt trong `/config` > Permissions),
một quyền Discord, năng lực của model, hoặc một khóa API tùy chọn.

| Công cụ | Macro prompt | Yêu cầu | Chức năng |
|---|---|---|---|
| Xem lại tính năng | `{capabilities_tool}` | - | Kiểm tra các khả năng chat hiện tại, lệnh hoặc cài đặt trước khi trả lời. |
| Tạo / cập nhật bộ nhớ dài hạn | `{memory_tool}` / `{memory_update_tool}` | `self_teaching_enabled` | Lưu hoặc thay thế một thông tin máy chủ ổn định hoặc tùy chọn của người dùng. |
| Cập nhật bộ nhớ ngắn hạn | `{short_term_memory_tool}` | (không hỗ trợ trên NovelAI) | Lưu bộ nhớ làm việc tạm thời cho kênh/cốt truyện hiện tại. |
| Tạo / cập nhật tác vụ | `{task_tool}` / `{task_update_tool}` | - | Lên lịch hoặc chỉnh sửa lời nhắc và tác vụ tự thực hiện (xem [Tác vụ theo lịch](/vi/features/capabilities/scheduled-tasks/)). |
| Gửi tin nhắn liên kênh | `{cross_channel_tool}` | (không hỗ trợ trên NovelAI) | Hành động trong một kênh/luồng khác, kèm tùy chọn báo cáo lại. |
| Tạo luồng | `{create_thread_tool}` | `thread_creation_enabled` + quyền quản lý luồng | Mở một luồng công khai và đăng tin nhắn khởi đầu. |
| Chọn sticker | `{sticker_tool}` | `sticker_usage_enabled` | Thêm một sticker máy chủ phù hợp vào phản hồi. |
| Quản lý tin nhắn | `{manage_message_tool}` | `manage_message_enabled` | Ghim, chỉnh sửa hoặc xóa các tin nhắn gần đây (ghim cần quyền Manage Messages). |
| Chặn / bỏ chặn người dùng | `{block_user_tool}` / `{unblock_user_tool}` | `user_blocking_enabled` | Tắt tiếng/chặn người dùng trong phạm vi persona (không ảnh hưởng đến bộ nhớ). |
| Tương tác với tin nhắn gần đây | `{message_interaction_tool}` | - | Thả cảm xúc hoặc gửi phản hồi ngắn cho một tin nhắn gần đây. |
| Xem ảnh đại diện | `{profile_picture_tool}` | model thị giác hoặc `vision_llm` | Kiểm tra avatar của người dùng hoặc của persona. |
| Đọc tài liệu | `{document_tool}` | - | Trích xuất văn bản từ PDF hoặc **bất kỳ** tệp văn bản UTF-8 nào: mã nguồn (`.py`/`.ts`/`.rs`/…), `.json`, `.yaml`, `.md`, `.txt`, và bất kỳ tệp đính kèm phi nhị phân nào. |
| Hiển thị siêu dữ liệu tin nhắn | `{message_metadata_tool}` | - | Chú thích các lượt hội thoại gần đây kèm tên định danh/mốc thời gian để nhắm mục tiêu chính xác. |
| Xử lý video YouTube | `{youtube_tool}` | model hỗ trợ video | Phân tích một liên kết YouTube cụ thể theo yêu cầu. |
| Phân tích hình ảnh | `{image_analysis_tool}` | đã cấu hình `vision_llm` | Ủy quyền khả năng hiểu hình ảnh cho một model thị giác riêng biệt. |
| Tạo hình ảnh / ảnh anime | `{image_generation_tool}` / `{anime_image_generation_tool}` | `imagegen_enabled` + nhà cung cấp đủ năng lực | Tạo hoặc chỉnh sửa hình ảnh (xem [Tạo phương tiện](/vi/features/capabilities/media-generation/)). |
| Tạo tin nhắn thoại | `{voice_message_tool}` | khóa ElevenLabs + giọng nói persona + `voice_message_enabled` | Gửi phản hồi bằng tin nhắn thoại Discord. |

:::note[Dành cho tác giả viết prompt]
Khi tùy chỉnh prompt hệ thống hoặc hướng dẫn persona của bot, hãy tham chiếu các công cụ bằng **macro
prompt** của chúng từ bảng trên thay vì viết cứng tên công cụ. Các macro này sẽ mở rộng thành tên chính
xác tại thời điểm ghép ngữ cảnh và hạ cấp nhẹ nhàng khi một công cụ không khả dụng.
`{pin_tool}` và `{timestamp_refresh_tool}` vẫn hoạt động như các bí danh tương thích cho
`{manage_message_tool}` và `{message_metadata_tool}`. Các công cụ tìm kiếm web và URL bên dưới
cũng có macro riêng: `{web_search_tool}`, `{image_search_tool}`, `{video_search_tool}`,
`{news_search_tool}`, `{url_fetch_tool}`, và `{url_metadata_tool}`: chúng phân giải động sang
engine tốt nhất hiện có, bao gồm cả các máy chủ MCP thay thế của máy chủ.
:::

### Khối prompt có điều kiện

Văn bản prompt hỗ trợ các macro công cụ ở trên cũng hỗ trợ các khối điều kiện theo phạm vi:

```text
{{if capability:self_teaching}}
Use {memory_tool} when a detail is worth remembering.
{{else}}
Do not promise to save long-term memories.
{{/if}}
```

Sử dụng `capability:<name>` cho một cài đặt TomoriBot đã bật, hoặc `tool:<function_name>` khi văn
bản chỉ nên xuất hiện nếu đúng công cụ đó khả dụng cho nhà cung cấp và model đang hoạt động. Sử dụng
`tool_family:url_fetch` khi trình đọc URL tích hợp sẵn hoặc công cụ MCP thay thế của máy chủ khả dụng.
Thêm tiền tố `!` vào trước điều kiện để đảo ngược nó. Các khối có thể lồng nhau và có thể chứa một
`{{else}}`; các biểu thức `and`/`or` tổng quát không được hỗ trợ.

Các tên tính năng được hỗ trợ là `tool_use`, `self_teaching`, `personal_memories`,
`emoji_usage`, `sticker_usage`, `web_search`, `manage_message`, `thread_creation`,
`image_generation`, `video_generation`, `voice_message`, `user_blocking`,
`short_term_memory`, và `time_awareness`.

Các điều kiện công cụ phản ánh sự hỗ trợ của nhà cung cấp/model, cấu hình máy chủ, các backend đã cấu
hình, công cụ MCP thay thế và danh sách cho phép hiện tại của Chế độ công cụ có chủ đích. Chúng không
bỏ qua hay dự đoán trước các bước kiểm tra quyền Discord được thực hiện khi công cụ thực thi. Tên tính
năng không xác định sẽ được đánh giá là sai và được ghi log; các khối sai cú pháp sẽ bị bỏ qua. Tin nhắn
chat thô, đầu ra của model và kết quả công cụ không bao giờ được coi là mẫu có điều kiện.

## Tìm kiếm web & đọc URL
<!-- anchor: web-search--url-reading -->

Model nhìn thấy một công cụ hợp nhất duy nhất là `web_search(query, category)`. Phía sau nó, một bộ điều
phối sẽ định tuyến mỗi lệnh gọi qua chuỗi engine và trả về kết quả thành công đầu tiên:

**Brave → SearXNG → DuckDuckGo → IAsk**

- **Brave** chạy đầu tiên khi khóa API Brave được cấu hình (thiết lập bằng `/providers`); nó bổ sung
  tìm kiếm hình ảnh, video và tin tức. ⚠️ Hãy đặt hạn mức sử dụng 5 USD trong bảng điều khiển Brave để
  tránh các khoản phí phát sinh ngoài ý muốn.
- **DuckDuckGo** là mặc định khi chưa đặt khóa, tự động chuyển tiếp sang **IAsk** nếu bị giới hạn tần suất
  hoặc kết quả trống.
- **SearXNG** và **Crawl4AI** là các sidecar self-hosted tùy chọn giúp mở khóa nhiều danh mục hơn và tìm
  nạp trang được render bằng trình duyệt; xem [Self-Hosting](/vi/self-hosting/).

Để đọc một trang cụ thể, bot sử dụng `fetch_url`. Tính năng này không khả dụng trên NovelAI.

## Máy chủ MCP
<!-- anchor: mcp-servers -->

Máy chủ [MCP](https://modelcontextprotocol.io/) (Model Context Protocol) mở rộng khả năng của bot với
các công cụ bên ngoài do bạn tự đăng ký.

### Thêm máy chủ MCP trực tuyến

Bất kỳ máy chủ MCP nào được lưu trữ công khai với endpoint HTTPS đều hoạt động. Lấy
[Smithery.ai](https://smithery.ai) làm ví dụ:

1. Tạo một tài khoản và tạo một khóa API từ hồ sơ của bạn.
2. Mở một MCP trong danh mục và sao chép **URL kết nối** của nó (ví dụ: `https://youtube.run.tools`).
3. Mở `/config` > Plugins > MCP Servers, chọn **+ Add MCP**, dán URL kết nối vào ô **URL**, dán khóa
   Smithery vào ô **Auth Token**, và chọn **Server Type** bắt buộc. Tùy chọn **General
   Purpose** được chọn theo mặc định.

Nếu máy chủ không yêu cầu xác thực, hãy để trống ô **Auth Token**. Mã xác thực của bạn được mã hóa ở trạng
thái lưu trữ và không bao giờ hiển thị lại. Hãy mở cùng trang Config đó để kiểm tra trạng thái cấu hình, bật
hoặc tắt máy chủ, hoặc xóa máy chủ với xác nhận rõ ràng. Việc xóa sẽ ngắt kết nối ngay lập tức và giải phóng
một vị trí. Mỗi hàng đã lưu cũng hiển thị tên các công cụ có giới hạn từ lần phát hiện thành công gần nhất.
**None discovered** là kết quả xác nhận không có công cụ nào; **Discovery unknown** xác định một hàng cũ
hoặc một máy chủ chưa có bản ghi nhanh thành công nào. Việc mở giao diện quản lý MCP chỉ đọc siêu dữ liệu đã
lưu và không liên hệ với máy chủ từ xa.

### Máy chủ MCP cục bộ

Máy chủ MCP cục bộ **chỉ được hỗ trợ trên các phiên bản self-hosted**, vì bot công khai yêu cầu HTTPS
và chặn các địa chỉ cục bộ/nội bộ. Nếu bạn tự vận hành phiên bản của riêng mình, hãy xem
[Cài đặt: Máy chủ MCP cục bộ](/vi/self-hosting/local-endpoints/setup-local-mcp/).

:::danger[Chỉ thêm máy chủ MCP bạn tin cậy]
Một máy chủ MCP độc hại có thể **prompt-inject** vào bot với các hướng dẫn ẩn, **chiếm đoạt dữ liệu**
mà người dùng gửi cho các công cụ của nó, hoặc trả về **kết quả sai lệch/gây hại** mà bot sẽ chuyển tiếp tới
máy chủ của bạn. Hãy đối xử với các máy chủ MCP như tiện ích mở rộng trình duyệt: nếu nghi ngờ, đừng thêm.
Luôn xem lại các công cụ được mô tả của một MCP trước khi thêm nó.
:::

## Chế độ công cụ có chủ đích
<!-- anchor: deliberate-tool-mode -->

Mỗi công cụ được khai báo đều làm tăng kích thước prompt. **Chế độ công cụ có chủ đích** (Deliberate Tool Mode)
giữ cho các khai báo công cụ không xuất hiện trong các lượt chat thông thường trừ khi tin nhắn có vẻ thực sự
cần một công cụ; điều này giúp giảm kích thước prompt và giúp các model nhỏ hơn/cục bộ trả lời nhanh hơn.

- Trước tiên bot kiểm tra tin nhắn để xác định **ý định gọi công cụ**. Các kích hoạt tích hợp sẵn bao gồm các
  yêu cầu phổ biến (lời nhắc, tìm kiếm web, cập nhật bộ nhớ, tin nhắn liên kênh, tạo hình ảnh/video/giọng nói,
  phân tích phương tiện, tạo luồng, hành động tin nhắn). Các câu hỏi về model hiện tại của bot, công cụ, cài
  đặt, hoặc lý do tại sao một tính năng không khả dụng sẽ đồng thời mở quyền xem lại tính năng và quyền truy
  cập tài liệu chính thức. Cách diễn đạt tiếp nối cũng hoạt động, như "làm lại cái đó nhưng giận dữ hơn" sau
  một yêu cầu tin nhắn thoại.
- Quản lý máy chủ có thể thêm các **cụm từ kích hoạt tùy chỉnh** bằng lệnh `/server trigger add`, ví dụ gán
  `pic`, `img`, hoặc `pfp` cho tính năng tạo hình ảnh.
- Các kích hoạt tích hợp sẵn đọc cách diễn đạt tiếng Anh. Các ngôn ngữ khác tiếp cận cùng các công cụ đó qua
  danh sách từ khóa của từng ngôn ngữ. Danh sách của mọi ngôn ngữ được phát hành đều được kiểm tra trên mỗi tin
  nhắn, bất kể cài đặt ngôn ngữ của bạn là gì, vì vậy một máy chủ song ngữ có thể hoạt động bằng cả hai ngôn ngữ.
- Các cụm từ tùy chỉnh bằng tiếng Nhật, tiếng Trung hoặc tiếng Hàn cũng khớp bên trong các từ dài hơn, vì các
  ngôn ngữ đó không phân tách từ bằng dấu cách. Cụm từ kết thúc bằng `*` sẽ khớp với bất kỳ từ nào bắt đầu bằng
  nó: `remind*` bao gồm cả `reminder` và `reminding`.

### Điều khiển

- `/server dtm`: người quản lý máy chủ bật hoặc tắt tính năng này.
- `/personal config`: người dùng tự ghi đè cho chính họ.
- Khi một kênh nhật ký suy nghĩ được cấu hình (`/server thought-logs`), các lệnh gọi công cụ thành công ở chế
  độ có chủ đích sẽ được ghi lại ở đó cùng với trigger đã kích hoạt công cụ.

Chế độ công cụ có chủ đích chỉ quyết định công cụ nào được *hiển thị* cho model, nhưng model vẫn phải tự lựa
chọn có gọi một công cụ hay không. Trong `/help`, chọn **Behavior**, sau đó chọn **Deliberate Tool Mode** để
xem tóm tắt trên Discord.

:::note
**Chế độ công cụ có chủ đích** (mục này) không liên quan đến **Chế độ kích hoạt có chủ đích**, vốn kiểm soát
cách *bot* được kích hoạt; xem
[Trò chuyện & từ kích hoạt](/vi/features/chatting-personality/chatting-and-triggers/#deliberate-trigger-mode).
Cả hai đều được viết tắt là "DTM" trong Discord.
:::

## Cập nhật thông tin người dùng có cấu trúc

Công cụ tích hợp sẵn `update_user_info` xử lý các yêu cầu rõ ràng nhằm thay đổi biệt danh, tiền tố, hậu tố,
bản dạng giới, đại từ, phong cách xưng hô hoặc độ lệch UTC bằng số của người dùng đã đăng ký. Công cụ sử dụng
cùng một trình phân giải tên, bí danh, lượt nhắc và Discord ID có khả năng xử lý xung đột giống như các công cụ
cá nhân khác. Bỏ qua đối tượng mục tiêu đồng nghĩa với người dùng đã kích hoạt lượt hội thoại; `all` và `everyone`
không bao giờ là các đối tượng đại diện chung (wildcard).

Mỗi trường là một tham số tùy chọn riêng, vì vậy một thay đổi được biểu thị bằng cách truyền trường đó. Việc
xóa là một danh sách `clear` chứa tên các trường, giúp duy trì một quy tắc duy nhất cho các trường văn bản,
enum và số; một chuỗi rỗng sẽ được gộp thành lệnh xóa thay vì bị từ chối. Không có tham số phạm vi hay hành
động, vì phạm vi tuân theo từng trường:

| Trường dữ liệu | Lưu trữ | Hiệu lực |
|---|---|---|
| nickname, prefix, suffix | theo nguồn gốc persona | chỉ persona thực hiện thay đổi mới xưng hô khác đi |
| gender identity, pronouns, addressing style, timezone | một lần cho mỗi người dùng | mọi persona đều đọc cùng một giá trị |

Sự phân chia đó tuân theo cách lưu trữ thay vì tùy chọn: các trường danh tính có một vị trí duy nhất cho mỗi
người dùng và không có trường tương đương theo từng persona. Thông báo thành công sẽ gắn nhãn các hàng theo
phạm vi persona bằng tên của persona đó, giúp sự khác biệt trở nên rõ ràng thay vì phải ngầm hiểu. Một hàng
không được gắn nhãn là áp dụng toàn cục, không cần giải thích thêm vì toàn cục là trường hợp thông thường.

Ngữ cảnh người tham gia đặt tên cho tiền tố và hậu tố của mỗi người dùng tách biệt khỏi biệt danh của họ, vì
vậy yêu cầu bỏ danh xưng sẽ được phân giải thành thay đổi phụ tố thay vì viết lại biệt danh. Một phụ tố đã xóa
được lưu trữ dưới dạng ngăn chặn rõ ràng, do đó việc xóa không thể bị hoàn tác bởi một lớp có độ ưu tiên thấp
hơn vẫn đang cung cấp giá trị.

Khi một biệt danh được gửi kèm phụ tố đã được phân giải, phụ tố dư thừa sẽ bị loại bỏ bằng cách so sánh với
giá trị đã phân giải; biệt danh không bao giờ bị cắt theo khoảng trắng để đoán ranh giới. Một bản cập nhật sẽ
báo cáo dạng xưng hô thu được bất cứ khi nào tên đó thực sự thay đổi, do đó việc chuyển đổi phong cách xưng
hô sẽ hiển thị ngay trong cùng lượt đó ngay cả khi không có trường tên nào xuất hiện trong đó, trong khi việc
chỉnh sửa đại từ hoặc múi giờ sẽ không nhắc lại tên mà không có gì tác động tới.

Mọi trường đều được xác thực trước một lần ghi nguyên tử (atomic write). Thiết lập quyền riêng tư hạn chế sẽ
chặn các bổ sung và thay đổi nhưng vẫn cho phép xóa các giá trị. Công cụ không thể chỉnh sửa các cách xưng hô
trên toàn bộ persona. Công tắc Bật/Tắt Cập nhật Thông tin Người dùng (User Info Updates) mặc định bật trong
`/config` > Permissions kiểm soát cả việc hiển thị công cụ lẫn phòng thủ các lệnh gọi cũ. Lệnh thủ công
`/personal config` vẫn khả dụng khi công tắc này bị tắt.
