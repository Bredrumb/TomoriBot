---
title: "Thiết lập: ComfyUI"
aiGenerated: false
sidebar:
  label: "ComfyUI"
  order: 2
---

TomoriBot có thể tạo hình ảnh và video thông qua instance [ComfyUI](https://github.com/comfyanonymous/ComfyUI) của riêng bạn. Bot điều khiển ComfyUI bằng cách gửi một quy trình làm việc định dạng API với prompt/kích thước của bạn được thay thế vào, sau đó liên tục thăm dò endpoint `/history` của ComfyUI cho đến khi kết quả sẵn sàng.

Hướng dẫn này bao gồm việc cài đặt/chạy ComfyUI và đăng ký dịch vụ. Để tạo hoặc chỉnh sửa quy trình làm việc tương thích với TomoriBot (các placeholder `{TOMORI_*}`), hãy sử dụng [README quy trình làm việc](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows) trên GitHub.

:::note[Không cần biến môi trường]
ComfyUI được đăng ký thông qua các lệnh slash trên Discord và được lưu trữ mã hóa trong cơ sở dữ liệu. Xem [trung tâm endpoint cục bộ](/self-hosting/local-endpoints/).
:::

## Yêu cầu phần cứng

Việc tạo hình ảnh và video phụ thuộc vào GPU: chi phí nặng nề nhất là VRAM (bộ nhớ card đồ họa, tách biệt với RAM hệ thống), được quyết định bởi checkpoint model mà quy trình làm việc nạp vào. Bạn rất nên sử dụng GPU NVIDIA. Hai quy trình làm việc đi kèm TomoriBot đều là các model hiện đại và nặng hơn SDXL:

| Quy trình làm việc đi kèm | Model nền tảng | VRAM thực tế | Ghi chú |
|---|---|---|---|
| Anima v1 (hình ảnh) | Qwen-Image (~20B), fp8 | ~16 GB mức tối thiểu · 24 GB thoải mái | Bộ mã hóa văn bản + VAE chiếm thêm ~8-10 GB overhead. Dưới 16 GB, hãy sử dụng bản dựng GGUF + `--lowvram`. |
| WAN i2v loop (video) | Wan 2.2 14B, fp8 + 4-step LightX2V LoRAs | ~16 GB dùng được · 24 GB+ thoải mái | Tùy chọn nặng nhất, dự kiến mất vài phút cho mỗi clip. Giảm tải bộ mã hóa văn bản UMT5 sang RAM (`t5_cpu`, yêu cầu 24 GB+ RAM hệ thống) trên các card nhỏ hơn. |

Cả hai checkpoint đi kèm đều đã được lượng hóa fp8 để vừa vặn với card đồ họa phổ thông. Nếu bạn có ít VRAM hơn, hãy đổi UNET sang bản quant nhỏ hơn và bật `--lowvram` / CPU offload của ComfyUI. Việc tạo ảnh hoàn toàn bằng CPU là không thực tế (mất nhiều phút cho mỗi hình ảnh, thậm chí lâu hơn cho video) và có thể vượt quá thời gian thăm dò của TomoriBot, vì vậy GPU gần như là bắt buộc để sử dụng thường xuyên.

:::tip[Giảm dung lượng hơn nữa: chọn bản quant GGUF]
Để thu nhỏ hơn nữa, hãy tải bản dựng GGUF của model từ Hugging Face: mã trong các tên như `Q4_K_M` / `Q5_K_M` là số bit trên mỗi trọng số, và 4-bit (Q4) hoặc 5-bit (Q5) là điểm cân bằng lý tưởng giữ lại hầu hết chất lượng với dung lượng chỉ bằng một phần nhỏ so với fp8/fp16. Việc tải UNET GGUF trong ComfyUI cần custom node [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF).
:::

## 1. Chạy ComfyUI với API được bật

Cài đặt ComfyUI theo [README của dự án](https://github.com/comfyanonymous/ComfyUI) và khởi động để ứng dụng lắng nghe trên mạng:

```sh
python main.py --listen 0.0.0.0 --port 8188
```

`--listen 0.0.0.0` rất quan trọng nếu TomoriBot chạy trong Docker hoặc trên một máy khác: cấu hình mặc định chỉ liên kết với loopback. Xác nhận khả năng truy cập từ máy mà bot đang chạy:

```sh
curl http://127.0.0.1:8188/system_stats
```

Nếu muốn kiểm tra, hãy tải các checkpoint model mà quy trình bạn chọn yêu cầu và thực hiện một lần tạo ảnh thủ công trên giao diện web ComfyUI để xác nhận hệ thống hoạt động thông suốt từ đầu đến cuối trước khi kết nối với TomoriBot.

## 2. Lấy quy trình làm việc TomoriBot

Tải xuống quy trình làm việc định dạng API sẵn sàng sử dụng. Các ví dụ có thể tìm thấy trong repo tại [`assets/comfyui-workflows/`](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows):

| Quy trình làm việc | Các chế độ |
|---|---|
| Anima v1 (hình ảnh) : `tomoribot-anima-v1-comfyui.json` | `txt2img`, `img2img`, `inpaint` |
| WAN i2v loop (video) : `tomoribot-wan-i2v-loop-video.json` | image-to-video |

Các tệp này ở định dạng API (JSON mà ComfyUI xuất thông qua *Save (API Format)*), không phải định dạng lưu giao diện thông thường. Nếu bạn tự tạo quy trình riêng, tệp phải chứa các placeholder `{TOMORI_*}` mà TomoriBot thay thế (prompt, width/height, seed, ảnh tham chiếu, v.v.). Xem [README quy trình làm việc](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows) và trang `Custom Endpoints` trong mục `Providers` tại `/help`.

## 3. Đăng ký trong Discord

Chạy `/providers` (hoặc `/personal providers`), chọn `Thêm endpoint tùy chỉnh mới`, và nhập:

| Trường | Giá trị cho ComfyUI |
|---|---|
| `endpoint_label` | Tên bạn chọn, ví dụ `home-comfy` |
| API Compatibility | `ComfyUI` |
| `endpoint_url` | `http://127.0.0.1:8188` (gốc, không có `/v1`) |
| `auth_token` | *(để trống trừ khi ComfyUI của bạn yêu cầu xác thực)* |

Sau khi lưu kết nối, chọn kết nối đó và chọn `+ Add new Image Model` hoặc `+ Add new Video Model` từ dropdown model. Nhập chính xác code name của checkpoint và tải tệp `.json` quy trình làm việc đã tải về từ Bước 2 vào `ComfyUI Workflow`. Tính năng của model phải khớp với quy trình làm việc (quy trình hình ảnh → `image`, quy trình video → `video`).

Việc thêm model sẽ tự động đặt model đó làm model `image`/`video` đang hoạt động. Kích hoạt tạo ảnh/video bằng cách yêu cầu trực tiếp Tomori trong chat. Nếu vì lý do nào đó model chưa hoạt động, hãy chạy `/config` > Models > Switch Models và chọn endpoint ComfyUI đã đăng ký của bạn.

## Khắc phục sự cố

- **Không thể kết nối khi thêm:** ComfyUI chỉ liên kết với loopback trong khi bot chạy trong Docker hoặc trên máy chủ khác. Khởi động ComfyUI với `--listen 0.0.0.0` và sử dụng `http://host.docker.internal:8188` hoặc IP mạng LAN.
- **Quá trình tạo không bao giờ hoàn tất:** TomoriBot liên tục kiểm tra `/history` cho đến khi kết quả xuất hiện. Việc khởi động nguội và các model lớn chạy trên CPU có thể vượt quá khoảng thời gian chờ thăm dò.
- **Bỏ qua prompt/kích thước hoặc kích thước đầu ra sai:** quy trình làm việc bị thiếu các placeholder `{TOMORI_*}` bắt buộc, hoặc bạn đã tải lên tệp xuất dạng UI thay vì định dạng API.
- **Sai tính năng:** quy trình làm việc `image` được đăng ký dưới dạng `video` (hoặc ngược lại) sẽ không thể chạy. Hãy thêm lại dưới đúng tính năng tương ứng.
