---
title: "Nhà cung cấp và model"
sidebar:
  order: 1
---

TomoriBot không tích hợp sẵn model AI nào, bạn cần kết nối model từ một nhà cung cấp. Một **nhà cung cấp** là một dịch vụ AI (Google Gemini, OpenRouter, NovelAI, một endpoint cục bộ, …), và một **model** là một model cụ thể trên nhà cung cấp đó. Bạn cần ít nhất một nhà cung cấp để có thể sử dụng bot.

## API key
<!-- anchor: api-keys -->

Thêm key của nhà cung cấp trong lần thiết lập đầu tiên bằng lệnh `/setup`, hoặc sau này từ `/providers` bằng cách chọn `Thêm nhà cung cấp mới`. Các key được **mã hóa khi lưu trữ**, vì vậy không ai, kể cả quản trị viên máy chủ, có thể đọc lại được.

Lệnh `/setup` sẽ hỏi cách chuyển câu trả lời đến model trước tiên, và câu trả lời sẽ quyết định những thông tin cần thu thập:

| Chế độ | Thông tin thu thập |
|---|---|
| **Nhà cung cấp AI (Khuyên dùng)** | Một nhà cung cấp từ danh mục kèm theo API key, được xác thực và mã hóa dưới dạng bản nháp. |
| **Endpoint tùy chỉnh (Nâng cao)** | Kết nối của endpoint và một model văn bản, được đăng ký bên trong trình hướng dẫn. Xem [Endpoint tùy chỉnh](#endpoint-tuy-chinh). |
| **BYOK người dùng** (chỉ dành cho máy chủ) | Không có gì: không gian làm việc không giữ nhà cung cấp riêng nào, vì vậy các thành viên phải tự cung cấp nhà cung cấp cá nhân. |

Không có gì được ghi lại cho đến khi nhấn `Hoàn tất thiết lập`, vì vậy việc hủy bỏ hoặc để trình hướng dẫn hết hạn sẽ giữ nguyên các hàng nhà cung cấp hiện có của không gian làm việc. Để thay thế một key đã lưu, hãy sử dụng `/providers`, vì `/setup` từ chối chạy trên một không gian làm việc đã được cấu hình.

Mỗi nhà cung cấp có các bước tạo key riêng. Hãy chạy **`/help`**, chọn `Thiết lập`, sau đó chọn **Step 1: Get an API Key**, và chọn nhà cung cấp của bạn để xem hướng dẫn từng bước chính xác, hoặc sử dụng các điểm bắt đầu sau:

| Nhà cung cấp | Ghi chú | Lấy key |
|---|---|---|
| **Google Gemini** | Gói miễn phí, chạy được mọi tính năng. Khuyến nghị cho lần thiết lập đầu tiên. | [AI Studio](https://aistudio.google.com/apikey) |
| **OpenRouter** | Một key, nhiều model (một số model miễn phí). | [OpenRouter keys](https://openrouter.ai/settings/keys) |
| **NovelAI** | Trả phí định kỳ; kể chuyện/nhập vai không kiểm duyệt (chỉ văn bản). | [NovelAI](https://novelai.net/) |
| **DeepSeek** | Model suy luận trả phí theo mức sử dụng. | [DeepSeek](https://platform.deepseek.com/api_keys) |
| **NVIDIA NIM** | Văn bản, embedding và hình ảnh được lưu trữ sẵn. | [NVIDIA Build](https://build.nvidia.com/) |
| **Anthropic** | Các model Claude qua API (không phải Claude Code). | - |
| **Z.ai** | Dòng GLM. ⚠️ Điều khoản dịch vụ giới hạn sử dụng cho lập trình/tác tử. | [Z.ai](https://z.ai/) |
| **Vertex AI** | Google Cloud qua `gcloud` ADC (tốt nhất cho thiết lập chạy cục bộ/phát triển). | xem bên dưới |
| **Vertex AI Express** | Google Cloud API key BYOK (Bản xem trước, tập hợp con của Gemini). | [Express Mode](https://console.cloud.google.com/expressmode) |
| **Custom** | Bất kỳ endpoint nào tương thích OpenAI (Ollama, vLLM, LiteLLM, …). | xem [Endpoint tùy chỉnh](#endpoint-tuy-chinh) |

:::caution
Không bao giờ chia sẻ API key của bạn với bất kỳ ai khác. Thêm hoặc thay thế mã thông báo xác thực Bearer của endpoint tùy chỉnh từ hành động `Sửa endpoint` trong `/providers`.
:::

**Vertex AI** xác thực bằng Application Default Credentials (ADC) thay vì khóa bí mật được lưu trữ. Đối với host cục bộ, ADC có thể lấy từ `gcloud`; các bản triển khai trên dịch vụ lưu trữ nên sử dụng workload identity hoặc tài khoản dịch vụ (service account). Riêng API key của AI Studio không thể xác thực toàn bộ Vertex AI. Dự án được chọn phải bật thanh toán và Vertex AI API, đồng thời danh tính của máy chủ cần có quyền truy cập Vertex. Hướng dẫn thiết lập có sẵn từ mục **Google Vertex AI** trên trang **API Keys** trong `/help`.

Thiết lập nhà cung cấp do Google hỗ trợ xác thực thông tin đăng nhập qua endpoint liệt kê model đã được chứng thực. Thao tác này không tạo văn bản hay phụ thuộc vào model trò chuyện nào hiện được đánh dấu là mặc định của danh mục, do đó một model mặc định bị khai tử không thể ngăn cản việc lưu thông tin đăng nhập hợp lệ.

### Tùy chọn: Key Brave Search

Brave Search tách biệt với nhà cung cấp AI của bạn và chỉ tăng cường tính năng tìm kiếm web (thêm tìm kiếm hình ảnh, video và tin tức). Thiết lập bằng `/providers`. ⚠️ Brave bao gồm 5 USD/tháng tín dụng miễn phí, vì vậy hãy đặt hạn mức sử dụng 5 USD trong trang quản trị của Brave để tránh phát sinh chi phí.

## Chọn model

Lệnh `/providers` quản lý thông tin xác thực của máy chủ, danh mục model và đăng ký endpoint, trong khi `/config` > Models > Switch Models chọn các chỉ định tính năng dùng chung mà mọi thành viên của máy chủ này sử dụng. Cả hai đều yêu cầu quyền cần thiết trong máy chủ. Các thành viên riêng lẻ quản lý thông tin xác thực và danh mục model của riêng mình bằng `/personal providers`, sau đó chọn model cá nhân trong `/personal config`. Cài đặt cá nhân đi theo họ trên mọi máy chủ mà họ sử dụng TomoriBot. Xem [Cá nhân hóa](/vi/features/knowledge/personalization/#your-own-providers) để biết thêm chi tiết.

Các bảng điều khiển có tiêu đề `Nhà cung cấp của máy chủ` và `Nhà cung cấp cá nhân` để quyền sở hữu của chúng vẫn hiển thị rõ ràng sau khi tương tác lệnh mở ra.

Sau khi thiết lập nhà cung cấp, hãy dùng `/config` > Models > Switch Models để chọn các chỉ định tính năng dùng chung. Sáu vị trí thông thường chọn các mục model từ danh mục của nhà cung cấp:

- `/config` > Models > Switch Models: model trò chuyện chính
- `/config` > Models > Switch Models: model thị giác (để đọc hình ảnh khi model trò chuyện không hỗ trợ)
- `/config` > Models > Switch Models: embedding cho [cơ sở tri thức tài liệu](/vi/features/knowledge/memory/#document-knowledge-base-rag)
- `/config` > Models > Switch Models: tạo ảnh tiêu chuẩn (xem [Tạo ảnh](/vi/features/capabilities/media-generation/image-generation/))
- `/config` > Models > Switch Models: tạo ảnh NovelAI
- `/config` > Models > Switch Models: tạo video
- `/config` > Models > Switch Models: endpoint chuyển văn bản thành giọng nói (TTS)
- `/config` > Models > Switch Models: endpoint chuyển giọng nói thành văn bản (STT)

Sáu mục đầu tiên chọn các bản ghi danh mục model. Các vị trí TTS và STT chọn các endpoint trong phạm vi không gian làm việc, vì vậy chúng kích hoạt endpoint đã chọn thay vì ghi vào một cột model. Đăng ký và chỉnh sửa các endpoint đó trong `/providers`; trình điều khiển kích hoạt endpoint của lệnh này vẫn hoạt động. Lệnh `/personal config` giữ lại sáu vị trí định tuyến model cá nhân và không thêm bộ chọn endpoint TTS/STT cá nhân.

Bạn cũng có thể quản lý các key dự phòng của máy chủ này để tự động chuyển đổi dự phòng và cân bằng tải bằng `/providers`.

## Endpoint tùy chỉnh
<!-- anchor: custom-endpoints -->

Các endpoint tùy chỉnh cho phép bạn đăng ký các dịch vụ tự host hoặc thông qua proxy (Ollama, LM Studio, LiteLLM, vLLM, ComfyUI, TTS/STT cục bộ) dưới dạng **các gói nhà cung cấp có nhãn**.

- **Phạm vi máy chủ:** mở `/providers` để đăng ký và chỉnh sửa endpoint của không gian làm việc.
- **Phạm vi cá nhân:** mở `/personal providers` cho danh mục model cá nhân (chỉ riêng bạn: xem [Cá nhân hóa](/vi/features/knowledge/personalization/#your-own-providers)). Các endpoint giọng nói cá nhân không được chọn từ `/personal config`.

Một **nhãn (label)** là tên menu hiển thị cho người dùng và gom nhóm các tính năng dưới một gói khi chúng dùng chung một URL endpoint. Nhãn không bao giờ được gửi đến endpoint từ xa. Các tính năng được phân phối từ các URL khác nhau cần có các nhãn riêng biệt. Chọn `Thêm endpoint tùy chỉnh mới`, chọn tính tương thích API và lưu kết nối. Việc lưu sẽ chuẩn bị các tính năng được giao thức đó hỗ trợ mà không cần đăng ký bất kỳ model nào. Sau đó chọn endpoint mới và sử dụng menu thả xuống model của endpoint để đăng ký chính xác mã model và tính năng. Việc thêm một model sẽ kích hoạt model đó cho tính năng tương ứng. Sử dụng cùng một menu thả xuống để đính kèm thêm model hoặc chỉnh sửa đăng ký do không gian làm việc thêm vào. Các model văn bản tự khai báo tính năng của mình trong biểu mẫu đó, và các model hình ảnh khai báo chế độ yêu cầu mà chúng hỗ trợ.

Đối với TTS và STT, hãy đăng ký endpoint và model của nó trong `/providers`, sau đó chọn và kích hoạt endpoint trong `/config` > Models > Switch Models. Các vị trí giọng nói đó chọn một endpoint thay vì một mục danh mục model. `/providers` vẫn là giao diện đăng ký endpoint, thiết lập model và chỉnh sửa.

Tính tương thích API xác định đường dẫn yêu cầu và payload mà dịch vụ triển khai, do đó nó cũng xác định các vị trí tính năng mà kết nối chuẩn bị. Việc đăng ký model chính xác cho các vị trí đó là một bước riêng biệt, và giao thức không thể suy luận một cách đáng tin cậy từ URL endpoint.

Chế độ `Endpoint tùy chỉnh (Nâng cao)` của `/setup` thực hiện hai bước tương tự bên trong trình hướng dẫn: `Cấu hình kết nối` lưu tính tương thích API, nhãn, URL và mã thông báo xác thực tùy chọn phía sau bước kiểm tra khả năng tiếp cận, và `Cấu hình model văn bản` đăng ký model văn bản chính xác cùng các khai báo tính năng của nó. Nút model vẫn bị tắt cho đến khi kết nối được xác thực, và việc lưu lại kết nối sẽ xóa khai báo model vì các khai báo phụ thuộc vào tính tương thích API. Trình hướng dẫn tạo kết nối, nhà cung cấp đã lưu, model và các hàng model đang hoạt động cùng nhau khi bạn nhấn `Hoàn tất thiết lập`, vì vậy nó không bao giờ để lại một kết nối không có model văn bản khả dụng. Nó chỉ đăng ký model văn bản; các tính năng hình ảnh, video, TTS và STT vẫn được đăng ký trong `/providers`.

Để xem hướng dẫn đầy đủ về cách chạy các máy chủ, hãy xem:

- [Thiết lập: LLM cục bộ](/vi/self-hosting/local-endpoints/setup-local-llm/): Ollama, KoboldCPP, LM Studio, vLLM, LiteLLM.
- [Thiết lập: ComfyUI](/vi/self-hosting/local-endpoints/setup-comfyui/): tạo hình ảnh/video cục bộ.
- [Thiết lập: ChatMock](/vi/self-hosting/local-endpoints/setup-chatmock/): tài khoản ChatGPT / Codex CLI.

## Các nhà cung cấp được hỗ trợ
<!-- anchor: supported-providers -->

Nếu bạn không có phần cứng để tự host model của riêng mình, TomoriBot hỗ trợ nhiều loại dịch vụ. Không phải mọi tính năng đều có sẵn trên mọi nhà cung cấp.

### Nhà cung cấp LLM

| Nhà cung cấp | Truyền phát (Streaming) | Gọi công cụ (Tool Calling) | Nhận diện hình ảnh (Image Input) | Embeddings | Ghi chú |
|---|---|---|---|---|---|
| **Google Gemini** | ✅ | ✅ | ✅ | ✅ | Có sẵn các model miễn phí |
| **OpenRouter** | ✅ | ✅ | ✅ | ✅ | Có sẵn các model miễn phí |
| **Anthropic (API)** | ✅ | ✅ | ✅ | - | Không phải Claude Code |
| **NovelAI** | ✅ | ✅ | - | - | Chỉ GLM 4.6 có thể dùng công cụ |
| **NVIDIA NIM** | ✅ | ✅ | ✅ | ✅ | Có sẵn các model miễn phí |
| **DeepSeek** | ✅ | ✅ | - | - | - |
| **Z.ai** | ✅ | ✅ | ✅ | - | Model miễn phí; ⚠️ Điều khoản dịch vụ = chỉ dùng cho lập trình/tác tử |
| **Z.ai Coding** | ✅ | ✅ | - | - | Gói thuê bao trả phí |
| **Google Vertex AI** | ✅ | ✅ | ✅ | ✅ | Bao gồm phiên bản Express 'miễn phí' |
| **Codex CLI (qua ChatMock)** | ✅ | ✅ | ✅ | - | [Thiết lập](/vi/self-hosting/local-endpoints/setup-chatmock/) |

### Tạo hình ảnh

| Nhà cung cấp | Văn bản thành ảnh | Ảnh thành ảnh | Vẽ đè (Inpainting) | Ghi chú |
|---|---|---|---|---|
| **Google** | ✅ | ✅ | - | - |
| **OpenRouter** | ✅ | ✅ | - | - |
| **NovelAI** | ✅ | ✅ | ✅ | Có thể kết hợp với các nhà cung cấp khác |
| **NVIDIA** | ✅ | - | - | Chỉ hỗ trợ chuyển văn bản thành ảnh; ảnh tham chiếu bị bỏ qua |
| **Z.ai** | ✅ | - | - | - |

Đây là các thiết lập **mặc định** mà model hình ảnh của nhà cung cấp bắt đầu, và NovelAI chạy qua quy trình riêng của nó thay vì bảng này. Việc đăng ký model hình ảnh thông qua `/providers` cho phép bạn khai báo các chế độ riêng của model đó, đó là cách bạn bật inpainting trên quy trình làm việc ComfyUI hoặc trên model của nhà cung cấp có API hỗ trợ chỉnh sửa theo vùng chọn (mask). Một model bạn không bao giờ khai báo sẽ tiếp tục tuân theo các giá trị mặc định ở trên, do đó một chỉnh sửa sau này cho chúng sẽ tự động áp dụng cho model đó. Chỉ khai báo những gì model thực sự hỗ trợ: Tomori cung cấp cho công cụ chính xác các chế độ bạn đánh dấu, và một chế độ mà API từ chối sẽ khiến quá trình tạo ảnh thất bại.

### Tạo video

| Nhà cung cấp | Văn bản thành video | Ảnh thành video | Ghi chú |
|---|---|---|---|
| **Google** | ✅ | ✅ | Quy trình thăm dò không đồng bộ |
| **OpenRouter** | ✅ | ✅ | Quy trình thăm dò không đồng bộ |
| **Z.ai** | ✅ | ✅ | Quy trình thăm dò không đồng bộ |

### Giọng nói và âm thanh

| Nhà cung cấp | Chuyển văn bản thành giọng nói (TTS) | Chuyển giọng nói thành văn bản (STT) |
|---|---|---|
| **ElevenLabs** | ✅ | ✅ |

Các công cụ giọng nói cục bộ được trình bày trong [Self-Hosting](/vi/self-hosting/). Đối với các công cụ tìm kiếm web và đọc URL tích hợp sẵn, hãy xem [Công cụ và tiện ích mở rộng](/vi/features/capabilities/tools-and-extensions/#web-search--url-reading).
