---
title: "Thiết lập: ComfyUI"
aiGenerated: false
sidebar:
  label: "ComfyUI"
  order: 3
---

TomoriBot có thể tạo hình ảnh và video thông qua instance [ComfyUI](https://github.com/comfyanonymous/ComfyUI) của riêng bạn. Bot điều khiển ComfyUI bằng cách gửi một quy trình làm việc định dạng API với prompt và kích thước của bạn được thay thế vào, sau đó liên tục thăm dò endpoint `/history` của ComfyUI cho đến khi kết quả sẵn sàng.

Hướng dẫn này bao gồm việc cài đặt, chạy ComfyUI và đăng ký dịch vụ. Để tạo hoặc chỉnh sửa quy trình làm việc tương thích với TomoriBot (các placeholder `{TOMORI_*}`), hãy sử dụng [README quy trình làm việc](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows) trên GitHub.

:::note[Không cần biến môi trường]
ComfyUI được đăng ký thông qua các lệnh slash trên Discord và được lưu trữ mã hóa trong cơ sở dữ liệu. Xem [trung tâm endpoint cục bộ](/self-hosting/local-endpoints/).
:::

## Yêu cầu phần cứng

Việc tạo hình ảnh và video phụ thuộc vào GPU: chi phí nặng nề nhất là VRAM (bộ nhớ card đồ họa, tách biệt với RAM hệ thống), được quyết định bởi checkpoint model mà quy trình làm việc nạp vào. Bạn rất nên sử dụng GPU NVIDIA. Hai nhóm quy trình làm việc đi kèm TomoriBot yêu cầu:

| Quy trình làm việc đi kèm | Model nền tảng | VRAM thực tế | Ghi chú |
|---|---|---|---|
| Anima turbo (hình ảnh) | Anima Turbo v1.1 (2B), bf16 | ~8 GB dùng được · 12 GB+ thoải mái | Model 4.2 GB cộng với bộ mã hóa văn bản 1.2 GB, ở 10 bước cộng một lượt nâng cấp 2x ngắn. Tham chiếu nhân vật làm thời gian tạo tăng thêm khoảng một nửa. |
| Anima detailed (hình ảnh) | Anima Aesthetic v1.1 (2B), bf16 | ~8 GB dùng được · 12 GB+ thoải mái | Cùng mức bộ nhớ với turbo, nhưng 30 bước cộng bộ tinh chỉnh khuôn mặt và bàn tay, nên chậm hơn vài lần cho mỗi ảnh. Các model Anima khác nằm trong [thư mục model](https://huggingface.co/circlestone-labs/Anima/tree/main/split_files/diffusion_models); README quy trình làm việc hướng dẫn cách chuyển đổi. |
| WAN i2v loop (video) | Wan 2.2 14B, fp8 + 4-step LightX2V LoRAs | ~16 GB dùng được · 24 GB+ thoải mái | Tùy chọn nặng nhất, mất vài phút cho mỗi clip. Giảm tải bộ mã hóa văn bản UMT5 sang RAM (`t5_cpu`, cần 24 GB+ RAM hệ thống) trên các card nhỏ hơn. |

Checkpoint Wan đã được lượng hóa fp8 để vừa vặn với card đồ họa phổ thông. Nếu bạn có ít VRAM hơn, hãy đổi UNET sang bản quant nhỏ hơn và bật `--lowvram` hoặc CPU offload của ComfyUI. Việc chạy diffusion hoàn toàn bằng CPU là không thực tế (mất nhiều phút cho mỗi hình ảnh, thậm chí lâu hơn cho video) và có thể vượt quá khoảng thời gian thăm dò của TomoriBot, vì vậy GPU gần như là bắt buộc để sử dụng thường xuyên.

:::tip[Giảm dung lượng hơn nữa: chọn bản quant GGUF]
Để thu nhỏ hơn nữa, hãy tải bản dựng GGUF của model từ Hugging Face: mã trong các tên như `Q4_K_M` hoặc `Q5_K_M` là số bit trên mỗi trọng số, và 4-bit (Q4) hoặc 5-bit (Q5) là điểm cân bằng lý tưởng giữ lại hầu hết chất lượng với dung lượng chỉ bằng một phần nhỏ so với fp8/fp16. Việc tải UNET GGUF trong ComfyUI cần custom node [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF).
:::

## 1. Chạy ComfyUI với API được bật

Cài đặt ComfyUI theo [README của dự án](https://github.com/comfyanonymous/ComfyUI). Với bot chạy trên cùng máy hoặc trình kết nối Cloudflare Tunnel trên PC này, hãy giữ ComfyUI trên loopback:

```sh
python main.py --listen 127.0.0.1 --port 8188
```

Với bot production được lưu trữ riêng, hãy làm theo [cấu hình ComfyUI trong hướng dẫn Cloudflare Tunnel](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/). Cách này cung cấp một endpoint HTTPS công khai trong khi ComfyUI vẫn giữ trên loopback. Hãy dùng URL tunnel của nó khi đăng ký bên dưới; xem mục [rủi ro đã biết](/self-hosting/local-endpoints/proxies-and-remote-access/cloudflare-tunnel/#known-risks) trong hướng dẫn nếu bạn chia sẻ mà không có xác thực.

Với bot chạy trong Docker hoặc trên mạng LAN tin cậy, việc liên kết với `0.0.0.0` cho phép bot kết nối tới cổng của máy chủ vật lý. Hãy giới hạn quyền truy cập bằng tường lửa của máy chủ; bất kỳ ai kết nối được vào một ComfyUI không có xác thực đều có thể gửi quy trình làm việc. TomoriBot ngoài môi trường production cũng cần `ALLOW_PRIVATE_NETWORK` để cho phép địa chỉ máy chủ và cổng của endpoint.
Xác nhận API cục bộ phản hồi:

```sh
curl http://127.0.0.1:8188/system_stats
```

Nếu muốn kiểm tra, hãy tải các checkpoint model mà quy trình bạn chọn yêu cầu và thực hiện một lần tạo ảnh thủ công trên giao diện web ComfyUI để xác nhận hệ thống hoạt động thông suốt từ đầu đến cuối trước khi kết nối với TomoriBot.

## 2. Lấy quy trình làm việc TomoriBot

Tải xuống quy trình làm việc định dạng API sẵn sàng sử dụng. Các ví dụ có thể tìm thấy trong repo tại [`assets/comfyui-workflows/`](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows):

| Quy trình làm việc | Các chế độ |
|----------|-------|
| Anima turbo (hình ảnh, nhanh): `tomoribot-anima-image-turbo.json` | văn bản thành hình ảnh, tham chiếu nhân vật, inpaint/outpaint |
| Anima detailed (hình ảnh, chậm hơn, tinh chỉnh khuôn mặt và bàn tay): `tomoribot-anima-image-detailed.json` | văn bản thành hình ảnh, tham chiếu nhân vật, inpaint/outpaint |
| MOSS standard (hình ảnh, prompt được viết lại bởi bộ mã hóa đa phương thức): `tomoribot-moss-image.json` | văn bản thành hình ảnh, tham chiếu nhân vật |
| MOSS detailed (hình ảnh, chậm hơn, nâng cấp 2x với tinh chỉnh khuôn mặt và bàn tay): `tomoribot-moss-image-detailed.json` | văn bản thành hình ảnh, tham chiếu nhân vật |
| WAN i2v loop (video): `tomoribot-wan-i2v-loop-video.json` | image-to-video |

Mỗi quy trình làm việc cần các custom node và tệp model cụ thể nằm trong các thư mục ComfyUI tương ứng. [README quy trình làm việc](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows) liệt kê đầy đủ cho các quy trình Anima và MOSS, kèm liên kết tải xuống và thư mục đặt từng tệp. Hãy cài đặt chúng trước khi đăng ký, nếu không quá trình tạo sẽ thất bại với lỗi thiếu node hoặc `Value not in list`.

Các tệp này ở định dạng API (JSON mà ComfyUI xuất thông qua *Save (API Format)*), không phải định dạng lưu giao diện thông thường. Nếu bạn tự tạo quy trình riêng, tệp phải chứa các placeholder `{TOMORI_*}` mà TomoriBot thay thế (prompt, width/height, seed, ảnh tham chiếu, v.v.). Xem [README quy trình làm việc](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows) và trang `Custom Endpoints` trong mục `Providers` tại `/help`.

## 3. Đăng ký trong Discord

Chạy `/providers` (hoặc `/personal providers`), chọn `Thêm endpoint tùy chỉnh mới`, và nhập:

| Trường | Giá trị cho ComfyUI |
|-------|-------------------|
| `endpoint_label` | Tên bạn chọn, ví dụ `home-comfy` |
| `Độ tương thích API` | `ComfyUI` |
| `endpoint_url` | Bot trên cùng máy: `http://127.0.0.1:8188`; tunnel production: `https://engine.example.com` (gốc, không có `/v1`) |
| `auth_token` | Để trống trừ khi cổng kết nối (gateway) của endpoint yêu cầu client key |

Sau khi lưu kết nối, chọn kết nối đó và chọn `+ Thêm model Hình ảnh mới` hoặc `+ Thêm model Video mới` từ dropdown model. Nhập chính xác code name của checkpoint và tải tệp `.json` quy trình làm việc đã tải về từ Bước 2 vào `Quy trình ComfyUI`. Tính năng của model phải khớp với quy trình làm việc (quy trình hình ảnh → `image`, quy trình video → `video`).

Đối với các quy trình Anima, hãy đánh dấu `Văn bản thành hình ảnh`, `Hình ảnh tham chiếu` và `Inpainting` trong mục `Tính năng hình ảnh`. `Hình ảnh tham chiếu` là tùy chọn cho phép Tomori vẽ người dùng hoặc persona dựa trên ảnh tham chiếu nhân vật của họ.

Việc thêm model sẽ tự động đặt model đó làm model `image`/`video` đang hoạt động. Kích hoạt tạo ảnh hoặc video bằng cách yêu cầu trực tiếp Tomori trong chat. Nếu vì lý do nào đó model chưa hoạt động, hãy chạy `/config` > `Model` > `Chuyển đổi model` và chọn endpoint ComfyUI đã đăng ký của bạn.

## Khắc phục sự cố

- **Không thể kết nối khi thêm:** Với môi trường production, hãy kiểm tra tunnel, định tuyến `/system_stats` và client key nếu cổng kết nối của bạn yêu cầu. Với Docker hoặc mạng LAN tin cậy, hãy kiểm tra trình lắng nghe, tường lửa, địa chỉ máy chủ và tùy chọn cho phép mạng riêng trong TomoriBot.
- **Quá trình tạo không bao giờ hoàn tất:** TomoriBot liên tục kiểm tra `/history` cho đến khi kết quả xuất hiện. Việc khởi động nguội và các model lớn chạy trên CPU có thể vượt quá khoảng thời gian chờ thăm dò.
- **Bỏ qua prompt/kích thước hoặc kích thước đầu ra sai:** quy trình làm việc bị thiếu các placeholder `{TOMORI_*}` bắt buộc, hoặc bạn đã tải lên tệp xuất dạng UI thay vì định dạng API.
- **Thiếu node hoặc `Value not in list`:** một gói custom node hoặc tệp model trong README quy trình làm việc chưa được cài đặt, hoặc tệp model đã bị đổi tên. Hãy cài đặt nó, khởi động lại ComfyUI và thử lại. Bạn không cần tải lại quy trình làm việc.
- **Sai tính năng:** quy trình làm việc `image` được đăng ký dưới dạng `video` (hoặc ngược lại) sẽ không thể chạy. Hãy thêm lại dưới đúng tính năng tương ứng.
