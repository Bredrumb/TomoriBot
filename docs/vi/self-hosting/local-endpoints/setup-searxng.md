---
title: "Thiết lập: SearXNG (Sidecar)"
sidebar:
  order: 3
---

Công cụ `web_search` định tuyến qua một chuỗi các engine: **Brave → SearXNG → DuckDuckGo → IAsk**. Bằng cách chạy phiên bản SearXNG của riêng mình, chúng ta tránh được các giới hạn tần suất của từng engine đơn lẻ cũng như sự cố trích xuất dữ liệu, đồng thời mở khóa các danh mục chỉ có trên SearXNG: `science`, `it`, `files`, và `music`.

Chọn một phương thức thiết lập SearXNG:

### A. Docker Compose (khi TomoriBot chạy trong Docker)

Sử dụng phương thức này nếu bạn chạy TomoriBot bằng ngăn xếp Docker Compose của kho lưu trữ. Sau đó chạy với profile `searxng`:

```sh
docker compose --profile searxng up -d
```
Lệnh này khởi động dịch vụ `searxng` cùng với TomoriBot. Bot sẽ tự động kết nối tới dịch vụ tại `http://searxng:8080/`.

Nếu bạn chạy TomoriBot trực tiếp bằng `bun run dev`, hãy sử dụng phương thức độc lập bên dưới.

Nếu sử dụng trong môi trường production, hãy đặt `SEARXNG_SECRET` trong `.env` thành bất kỳ chuỗi nào từ 32 ký tự trở lên (biến này được tự động gán mặc định trong môi trường dev).

---

### B. Docker độc lập (khi chạy `bun run dev`)
Trước tiên, hãy đặt `SEARXNG_BASE_URL=http://localhost:8080/` trong `.env` để bot biết nơi kết nối.

Sau đó, thay vì chạy TomoriBot trực tiếp bằng `bun run dev`, hãy sử dụng `bun run launch --searxng`. Lệnh này sẽ tự động xử lý vòng đời của container và đợi container ở trạng thái hoạt động tốt trước khi khởi động bot:

```sh
bun run launch --searxng
```

Nếu bạn thích tự quản lý container, hãy giữ `SEARXNG_BASE_URL=http://localhost:8080/` trong `.env` và chạy:

**PowerShell:**
```powershell
docker run -d --name searxng -p 8080:8080 `
  -v "${PWD}/servers/searxng:/etc/searxng:rw" `
  -e SEARXNG_SECRET=dev-only-not-for-production `
  searxng/searxng:latest
```

**Bash (Linux/macOS):**
```bash
docker run -d --name searxng -p 8080:8080 \
  -v "${PWD}/servers/searxng:/etc/searxng:rw" \
  -e SEARXNG_SECRET=dev-only-not-for-production \
  searxng/searxng:latest
```

Sau đó chạy `bun run dev` khi container đã ở trạng thái hoạt động tốt (`docker ps` hiển thị `(healthy)`).

---

### C. Không sử dụng SearXNG
Để trống `SEARXNG_BASE_URL`. Chuỗi tìm kiếm sẽ tự động chuyển sang `Brave → DuckDuckGo → IAsk`.

Khi không có sidecar SearXNG nào được cấu hình, schema `web_search` được tổng hợp sẽ không còn thông báo các danh mục chỉ có trên SearXNG. Các danh mục thông thường (`text`, `image`, `video`, `news`) vẫn xuất hiện khi Brave được cấu hình, và tìm kiếm chỉ dạng văn bản xuất hiện khi chỉ có phương án dự phòng MCP DuckDuckGo/IAsk.

---

## Tinh chỉnh kết quả hình ảnh

Kết quả hình ảnh từ SearXNG được xác thực bằng yêu cầu HEAD, có thể nén tùy chọn và được gửi dưới dạng tệp đính kèm Discord: trải nghiệm người dùng giống hệt với tìm kiếm hình ảnh của Brave. Nếu tất cả các URL ứng viên đều không vượt qua xác thực, SearXNG sẽ trả về danh sách liên kết hình ảnh dạng văn bản thay vì báo lỗi nghiêm trọng.

| Biến | Mặc định | Mô tả |
|---|---|---|
| `SEARXNG_IMAGE_COUNT` | `3` (tối đa 10) | Số lượng hình ảnh hợp lệ được gửi tới Discord. Bị ghi đè bởi đối số `count` của LLM. |
| `SEARXNG_IMAGE_POOL` | `10` | Tập hợp các URL ứng viên khi LLM không chỉ định `count`. Khi `count` được chỉ định, tập hợp sẽ là `count × 3` (tối đa 30) để xử lý các lỗi chặn hotlink. |
| `WEB_SEARCH_TIMEOUT_MS` | không đặt | Thời gian chờ yêu cầu cho từng engine. |

*(Xem `.env.optional.example` để biết tất cả các tùy chọn cấu hình.)*
