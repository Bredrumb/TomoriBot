---
title: "Thiết lập: LLM cục bộ"
aiGenerated: false
sidebar:
  label: "LLM cục bộ"
  order: 1
---

TomoriBot có thể sử dụng bất kỳ máy chủ LLM cục bộ nào tương thích với OpenAI để tạo văn bản và vector nhúng.

:::note[Không cần biến môi trường]
Các model cục bộ được đăng ký thông qua các lệnh slash Discord và được lưu trữ mã hóa trong cơ sở dữ liệu. Không có cài đặt `.env` nào cho chúng.
:::

## 1. Chạy máy chủ model của bạn

Hướng dẫn này sẽ đi qua quy trình bằng cách sử dụng Ollama làm ví dụ vì đây là công cụ dễ bắt đầu nhất, bạn có thể sử dụng bất kỳ thứ gì mình muốn, đặc biệt nếu bạn đã là người dùng có chuyên môn kỹ thuật hơn!

Cài đặt [Ollama](https://ollama.com). Các ví dụ dưới đây sử dụng Gemma 4 của Google, nhưng bất kỳ thứ gì trong [thư viện của Ollama](https://ollama.com/library) đều hoạt động.

### Tôi nên tải kích thước nào?
<!-- anchor: which-size-should-i-pull -->

Các model cục bộ chạy trong VRAM GPU của bạn (bộ nhớ tích hợp trên card đồ họa, tách biệt với RAM hệ thống). Quy tắc ngón tay cái: một model cần lượng VRAM trống ít nhất bằng dung lượng tải xuống của nó, cộng thêm ~1-2 GB dung lượng dự phòng cho ngữ cảnh cuộc trò chuyện. Hãy chọn phiên bản Gemma 4 lớn nhất vừa vặn với card của bạn:

| VRAM GPU của bạn | Bản phù hợp nhất | Dung lượng tải xuống (ước tính) |
|---|---|---|
| ~8 GB | `gemma4:e2b` | 7.2 GB |
| ~12 GB | `gemma4:12b` | 7.6 GB |
| ~16 GB | `gemma4:12b` (vừa hoàn toàn), hoặc `gemma4:26b` | 7.6 / 18 GB |
| 24 GB+ | `gemma4:26b` hoặc `gemma4:31b` | 18 / 20 GB |

Dung lượng tải xuống là các kích thước lượng hóa mặc định của Ollama; xem [trang model](https://ollama.com/library/gemma4) để biết số liệu chính xác. Bạn không chắc mình có bao nhiêu VRAM? Trên Windows: `Task Manager` > `Performance` > `GPU`, đọc mục "Dedicated GPU memory."

Tải kích thước bạn đã chọn và khởi động máy chủ:

```sh
ollama pull gemma4:12b     # thay bằng tag phù hợp với VRAM của bạn
ollama serve               # lắng nghe tại http://127.0.0.1:11434
```

Xác nhận có thể kết nối từ máy mà TomoriBot đang chạy:

```sh
curl http://127.0.0.1:11434/v1/models
```

Ghi lại tag chính xác đã cài đặt, vì đây là Model Name bạn sẽ đăng ký:

```sh
ollama list
# NAME              ID            SIZE
# gemma4:12b        a1b2c3d4...   7.6 GB
```

## 2. Đăng ký trong Discord

Chạy `/providers` (toàn máy chủ) hoặc `/personal providers` (chỉ riêng bạn), chọn `Add New Custom Endpoint`, và nhập:

| Trường | Giá trị cho Ollama |
|---|---|
| `endpoint_label` | Tên bạn chọn, ví dụ `home-ollama` |
| API Compatibility | `OpenAI-Compatible` (khuyến nghị) hoặc `Ollama` |
| `endpoint_url` | `http://127.0.0.1:11434/v1` cho OpenAI-Compatible · `http://127.0.0.1:11434` cho Ollama |
| `auth_token` | *(để trống)* |

:::tip[Chọn URL khớp với khả năng tương thích API]
Cả `OpenAI-Compatible` và `Ollama` đều chấp nhận URL gốc và chuẩn hóa về đường dẫn cơ sở `/v1`. `/chat/completions` được tự động thêm vào, vì vậy đừng thêm nó. Các URL đã có sẵn đường dẫn, chẳng hạn như `https://openrouter.ai/api/v1` hoặc tiền tố gateway, được lưu nguyên văn.
:::

Sau khi lưu kết nối, chọn kết nối đó và chọn `+ Add new Text Model` từ dropdown model của nó. Điền:

- **Model Name (ID API chính xác):** `gemma4:12b`, tag chính xác từ `ollama list`.
- **Context Window Override:** tùy chọn, chỉ dành cho Ollama / KoboldCPP. Đặt giá trị này (ví dụ `8192`, `16384`) để tăng `num_ctx` mặc định của Ollama, vì mặc định khá nhỏ có thể cắt bớt ngữ cảnh dài của TomoriBot. Để trống để sử dụng mặc định của máy chủ.
- **Nút bật tắt:** bật `Tool calling` nếu model hỗ trợ gọi hàm; chỉ bật `Image input` cho model thị giác; `Structured output` nếu model xử lý tốt JSON schema. Đối với ví dụ của chúng ta, Gemma 4 hỗ trợ tất cả, vì vậy hãy đánh dấu chọn tất cả.

TomoriBot xác thực kết nối khi bạn lưu. Nếu báo lỗi không thể kết nối tới endpoint, nguyên nhân phổ biến là do không khớp giữa `localhost`/Docker hoặc thiếu/thừa `/v1` (xem [các lưu ý](#notes--gotchas)).

Việc thêm model sẽ tự động đặt nó làm model `text` đang hoạt động. Hãy bắt đầu trò chuyện để dùng thử. Nếu vì lý do nào đó model chưa hoạt động, hãy chạy `/config` > Models > Switch Models và chọn model mới đăng ký của bạn.

## 3. (Tùy chọn) Vector nhúng cục bộ cho RAG

Chọn endpoint đã lưu và sử dụng dropdown model của nó để thêm một model Embedding (ví dụ `ollama pull nomic-embed-text`, Model Name `nomic-embed-text:latest`). Các tính năng RAG cũng yêu cầu pgvector được cài đặt trong Postgres. Bạn có thể xem hướng dẫn [cài đặt thủ công](/self-hosting/manual-setup/) tại đây.

## 4. (Tùy chọn) Chia sẻ một GPU với ComfyUI
<!-- anchor: 4-optional-share-one-gpu-with-comfyui -->

Nếu model văn bản và ComfyUI chạy trên cùng một GPU, TomoriBot có thể dỡ nạp (unload) model văn bản trong khi tác vụ hình ảnh hoặc video của ComfyUI đang chạy. Các câu trả lời văn bản đến trong quá trình xử lý tác vụ sẽ chờ cho đến khi GPU được giải phóng trở lại.

Mở endpoint đã lưu, nhấn `Edit Endpoint` và đánh dấu chọn `Unload model during ComfyUI jobs` trong mục `Endpoint Behavior`. TomoriBot sẽ kiểm tra máy chủ nào đang ở URL khi bạn lưu:

- **Ollama:** hoạt động ngay khi cài đặt. TomoriBot yêu cầu Ollama dỡ nạp model trước tác vụ, và Ollama sẽ nạp lại model ở yêu cầu văn bản tiếp theo.
- **KoboldCpp:** khởi động KoboldCpp với `--admin` và `--admindir`, đồng thời đặt auth token của endpoint thành mật khẩu admin. TomoriBot sử dụng API reload admin của KoboldCpp để dỡ nạp model và nạp lại sau đó.

Bất kỳ máy chủ nào khác đều bị từ chối khi bạn lưu, vì các máy chủ tương thích OpenAI thông thường không có cách thức chung để dỡ nạp một model.

## Các máy chủ khác
<!-- anchor: other-servers -->

TomoriBot hỗ trợ bất kỳ endpoint nào tương thích với OpenAI, nhưng các máy chủ bên dưới được khuyến nghị. Tất cả đều sử dụng cùng một quy trình: chỉ có URL và một vài lưu ý là thay đổi.

### KoboldCPP

- Khởi động với OpenAI-compat được bật (tích hợp sẵn). Mặc định: `http://127.0.0.1:5001/v1`.
- API Compatibility: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:5001/v1`.
- Hỗ trợ `Context Window Override` tương tự như Ollama.
- Để dỡ nạp model trong các tác vụ ComfyUI, hãy khởi chạy thêm với `--admin` và `--admindir` (xem [Chia sẻ một GPU với ComfyUI](#4-optional-share-one-gpu-with-comfyui)).
- Nạp các model GGUF; Model Name là bất kỳ tên nào mà model đã nạp báo cáo (thường là phần tên tệp), hãy kiểm tra phản hồi `/v1/models` của KoboldCPP.

### llama.cpp (`llama-server`)

- Biên dịch hoặc cài đặt [llama.cpp](https://github.com/ggml-org/llama.cpp), sau đó phục vụ một tệp GGUF bằng máy chủ tương thích OpenAI đi kèm:
  ```sh
  llama-server -m model.gguf -c 16384 --host 0.0.0.0 --port 8080
  ```
- API Compatibility: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:8080/v1`.
- Thiết lập cửa sổ ngữ cảnh khi khởi chạy bằng `-c`, vì tùy chọn `Context Window Override` trong modal chỉ dành cho Ollama/KoboldCPP và không có tác dụng ở đây.
- Model Name là bất kỳ tên nào mà `/v1/models` báo cáo; hãy đặt tên gọn gàng bằng `--alias my-model`.
- Nếu bạn khởi động với `--api-key`, hãy nhập key đó vào `auth_token`.

### LM Studio

- Trong LM Studio, khởi động `Local Server` (tab `Developer`). Mặc định: `http://127.0.0.1:1234/v1`.
- API Compatibility: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:1234/v1`.
- Model Name là định danh mà LM Studio hiển thị cho model đã nạp.

### vLLM

- Phục vụ bằng máy chủ tương thích OpenAI: `vllm serve <model>` → `http://127.0.0.1:8000/v1`.
- API Compatibility: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:8000/v1`.
- Nếu bạn khởi chạy vLLM với `--api-key`, hãy nhập key đó vào `auth_token`.
- Model Name là đường dẫn/tên model được phục vụ (khớp với `/v1/models`).

### LiteLLM (proxy qua nhiều backend)

- Chạy proxy LiteLLM; mặc định: `http://127.0.0.1:4000/v1`.
- API Compatibility: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:4000/v1`.
- Model Name là alias của model bạn đã định nghĩa trong cấu hình của LiteLLM.
- Nếu proxy thực thi master key, hãy đặt key đó trong `auth_token`.

### ChatMock (tài khoản ChatGPT / Codex CLI)

Có hướng dẫn chuyên biệt riêng do giải pháp thay thế prompt system:
[Thiết lập: ChatMock](/self-hosting/local-endpoints/setup-chatmock/).

## Chọn model từ Hugging Face

Bên cạnh thư viện tuyển chọn của Ollama, [Hugging Face](https://huggingface.co) lưu trữ hàng nghìn model cộng đồng. KoboldCPP, llama.cpp và LM Studio đều có thể nạp định dạng GGUF, là một gói tệp đơn lẻ mà bạn tải về và trỏ máy chủ vào đó.

1. **Tìm tệp GGUF.** Tìm kiếm trên Hugging Face tên model của bạn kèm "GGUF", các tác giả quant cộng đồng như [bartowski](https://huggingface.co/bartowski) thường xuất bản các bản dựng GGUF cho hầu hết các model phổ biến ngay sau khi phát hành. Hãy ưu tiên biến thể instruct/chat (tên kết thúc bằng `-Instruct` hoặc `-Chat`); các model nền tảng không thể duy trì cuộc trò chuyện.
2. **Chọn mức quant phù hợp với VRAM của bạn.** Một repo sẽ liệt kê cùng một model ở nhiều mức quant, và dung lượng tệp ≈ lượng VRAM nó cần (cộng thêm ~1-2 GB cho ngữ cảnh, cùng quy tắc như [bảng kích thước](#which-size-should-i-pull) ở trên). Tải tệp `.gguf` đơn lẻ cho lựa chọn của bạn.
3. **Nạp model.** Khởi động KoboldCPP hoặc `llama-server` với tệp đó (xem [Các máy chủ khác](#other-servers)), sau đó đăng ký endpoint trong Discord như bình thường.

:::tip[Nên chọn mức quant nào? Q4 hoặc Q5 là điểm cân bằng lý tưởng]
Lượng hóa lưu trữ từng trọng số bằng ít bit hơn để thu nhỏ model, với mức đánh đổi chất lượng rất nhỏ. Mã trong các tên như `Q4_K_M` / `Q5_K_M` là số bit trên mỗi trọng số: **4-bit (Q4) hoặc 5-bit (Q5) thường là điểm cân bằng lý tưởng** khi giữ lại hầu hết chất lượng với kích thước chỉ bằng khoảng một nửa so với 8-bit. Dưới 4-bit sẽ giảm sút chất lượng nhanh chóng. Và với một mức ngân sách VRAM cố định, một **model lớn hơn ở mức Q4 thường đánh bại model nhỏ hơn ở mức Q8**.
:::

## Lưu ý và các vấn đề thường gặp
<!-- anchor: notes--gotchas -->

- **Một mục endpoint cho mỗi nhãn.** Để đăng ký nhiều model dùng chung một máy chủ, hãy chọn endpoint đã lưu và sử dụng lại dropdown model của nó. Sử dụng các nhãn riêng biệt cho các máy chủ hoặc giao thức API thực sự khác nhau.
- **Model Name là định danh API.** Đây là chuỗi chính xác được gửi đến máy chủ. Điền sai tên này là nguyên nhân phổ biến nhất dẫn đến tình trạng "kết nối được nhưng phản hồi thất bại".
- **Chạy TomoriBot trong Docker?** `localhost` bên trong container không phải là máy chủ lưu trữ của bạn. Hãy sử dụng `http://host.docker.internal:<port>` (Windows/macOS) hoặc IP mạng LAN của máy chủ lưu trữ, và liên kết máy chủ model với `0.0.0.0`.
- **Sử dụng Compose?** Cài đặt `RUN_ENV=development` của Compose cho phép các endpoint HTTP cục bộ. Môi trường chạy production sẽ thực thi HTTPS và chặn các đích đến thuộc mạng riêng tư trừ khi phía gọi cho phép rõ ràng. `FETCH_URL_ALLOW_PRIVATE_NETWORK=true` cho phép các mục tiêu riêng tư đối với `fetch_url` trong production; biến này không làm thay đổi các quy tắc endpoint của nhà cung cấp. Các địa chỉ metadata đám mây luôn bị chặn trong mọi chế độ.
