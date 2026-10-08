---
title: "Thiết lập: Crawl4AI"
sidebar:
  order: 4
---

Kết xuất các trang web nặng JavaScript thành Markdown sạch cho TomoriBot bằng máy chủ [Crawl4AI](https://github.com/unclecode/crawl4ai) cục bộ.

Theo mặc định, công cụ `fetch_url` tích hợp sử dụng công cụ `safe_http` nhẹ. Crawl4AI bổ sung trình duyệt Playwright không đầu tùy chọn để thực thi các tập lệnh phía máy khách và trích xuất nội dung trang trước khi trả lại Markdown cho bot.

Vì Crawl4AI tuân theo các chuyển hướng bên ngoài ứng dụng khách HTTP được bảo vệ của TomoriBot nên nó chỉ được chấp nhận khi cho phép tìm nạp mạng riêng. Bên ngoài sản xuất (`RUN_ENV` != `production`), tính năng tìm nạp mạng riêng được bật tự động. Trong môi trường sản xuất, nó yêu cầu cài đặt `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`.

Chọn đường dẫn thiết lập:

### Tùy chọn A: Docker Compose (khi TomoriBot chạy trong Docker)

Sử dụng đường dẫn này nếu bạn chạy TomoriBot với ngăn xếp Docker Compose của repo. Đầu tiên, đặt `CRAWL4AI_BASE_URL=http://crawl4ai:11235/` và `FETCH_URL_ENGINE_ORDER=crawl4ai,safe_http` trong `.env`. Sản xuất bên ngoài không cần chọn tham gia mạng riêng; chỉ thêm `FETCH_URL_ALLOW_PRIVATE_NETWORK=true` nếu bạn chạy ngăn xếp này với `RUN_ENV=production`.

Sau đó, bắt đầu với:

```sh
docker compose --profile fetch-crawl4ai up -d
```

Thao tác này khởi động ngăn xếp Soạn thư với vùng chứa Crawl4AI trên mạng Docker của TomoriBot.

Nếu bạn chạy trực tiếp TomoriBot bằng `bun run dev`, hãy sử dụng đường dẫn độc lập bên dưới.

Nếu bạn cũng muốn SearXNG, hãy xâu chuỗi các cấu hình:

```sh
docker compose --profile searxng --profile fetch-crawl4ai up -d
```

Nếu bạn bật xác thực mã thông báo Crawl4AI API, hãy đặt `CRAWL4AI_TOKEN` trong `.env`; Compose chuyển nó tới vùng chứa dưới dạng `CRAWL4AI_API_TOKEN` và TomoriBot gửi nó dưới dạng mã thông báo mang.

---

### Tùy chọn B: Docker độc lập (khi chạy `bun run dev`)

Đầu tiên, đặt `CRAWL4AI_BASE_URL=http://localhost:11235/` và `FETCH_URL_ENGINE_ORDER=crawl4ai,safe_http` trong `.env` để bot kết nối với cổng container do máy chủ xuất bản. Sản xuất bên ngoài không cần chọn tham gia mạng riêng; chỉ thêm `FETCH_URL_ALLOW_PRIVATE_NETWORK=true` nếu bạn chạy với `RUN_ENV=production`.

Sau đó, thay vì chạy trực tiếp TomoriBot với `bun run dev`, hãy sử dụng `bun run launch --crawl4ai`. Điều này tự động xử lý vòng đời của vùng chứa và đợi máy chủ hoạt động tốt trước khi khởi động bot:

```sh
bun run launch --crawl4ai
```

Nếu bạn cũng muốn SearXNG:

```sh
bun run launch --searxng --crawl4ai
```

Nếu bạn muốn tự mình quản lý vùng chứa, hãy giữ `CRAWL4AI_BASE_URL=http://localhost:11235/` trong `.env` và chạy:

PowerShell:

```powershell
docker run -d --name crawl4ai -p 11235:11235 --shm-size=3g `
  unclecode/crawl4ai:latest
```

Bash (Linux/macOS):

```bash
docker run -d --name crawl4ai -p 11235:11235 --shm-size=3g \
  unclecode/crawl4ai:latest
```

Nếu bạn bảo mật vùng chứa, hãy chuyển `-e CRAWL4AI_API_TOKEN=your_token` sang `docker run` và đặt `CRAWL4AI_TOKEN=your_token` trong `.env`.

Sau đó chạy `bun run dev` khi vùng chứa hoạt động tốt (`docker ps` hiển thị `(healthy)`).

---

### Tùy chọn C: Không có máy chủ kết xuất trình duyệt

Không đặt `CRAWL4AI_BASE_URL`. Công cụ `fetch_url` sử dụng công cụ `safe_http` được bảo vệ.

---

## Thứ tự bắt đầu

TomoriBot thăm dò tình trạng máy chủ trong lệnh gọi `fetch_url` đầu tiên sau khi khởi động và lưu kết quả vào bộ nhớ đệm trong 60 giây. Nếu vùng chứa chưa sẵn sàng khi đầu dò đầu tiên kích hoạt thì bot sẽ coi vùng chứa đó là không có sẵn trong phút tiếp theo.

Đối với Docker độc lập, hãy khởi động vùng chứa Crawl4AI của bạn trước khi khởi động TomoriBot. `bun run launch --crawl4ai` đã làm điều này cho bạn.

### Thiết lập lần đầu

1. Khởi động vùng chứa và đợi cho đến khi nó hiển thị `(healthy)` trong `docker ps`:
   ```powershell
   docker ps
   ```
2. Đặt `CRAWL4AI_BASE_URL` trong `.env` bằng cách sử dụng giá trị cho đường dẫn thiết lập của bạn ở trên.
3. Bắt đầu TomoriBot (`bun run dev` hoặc `docker compose up`).

### Trở lại sau khi khởi động lại

Nếu vùng chứa đã tồn tại từ lần chạy trước, hãy sử dụng `docker start` thay vì `docker run` để tránh xung đột đặt tên:

```powershell
# Start an existing container
docker start crawl4ai

# Confirm healthy before starting TomoriBot
docker ps
```

Sau đó khởi động TomoriBot như bình thường. Việc khởi động lại `bun run dev` sẽ đặt lại bộ nhớ đệm tình trạng trong bộ nhớ, do đó, miễn là vùng chứa sẵn sàng trước thì động cơ chính xác sẽ được chọn ngay lập tức.

---

## Chèn cookie

Crawl4AI hỗ trợ chèn cookie cấp trình duyệt để trình duyệt không có giao diện người dùng có vẻ như đã đăng nhập khi tìm nạp một trang. Điều này hữu ích cho các trang web yêu cầu phiên để xem nội dung (ví dụ: tin tức có tường phí, diễn đàn riêng tư, trang tổng quan có cổng đăng nhập).

Dự phòng `safe_http` không hỗ trợ chèn cookie. Cookie chỉ áp dụng khi Crawl4AI hoạt động.

:::note[Bot detection limits]
Việc chèn cookie vượt qua các bức tường đăng nhập nhưng không vượt qua được dấu vân tay của bot. Các trang web có tính năng phát hiện chống bot tích cực (đặc biệt là Twitter/X) phát hiện Nhà viết kịch không có đầu thông qua dấu vân tay canvas/WebGL và phân phối các trang trống ngay cả với cookie phiên hợp lệ. Việc chèn cookie hoạt động tốt đối với các trang web chỉ xác thực.
:::

### Lấy cookie của bạn

1. Mở trình duyệt của bạn và đăng nhập vào trang web mục tiêu.
2. Mở DevTools (`F12`) > tab `Application` > `Storage` > `Cookies` > chọn miền của trang web.
3. Sao chép `Value` của từng cookie được yêu cầu (thường là mã thông báo phiên; kiểm tra tên cookie của trang web).

### Crawl4AI

Đặt `CRAWL4AI_COOKIES_JSON` trong `.env` dưới dạng mảng JSON:

```dotenv
CRAWL4AI_COOKIES_JSON=[{"name":"session","value":"YOUR_SESSION_TOKEN","domain":".example.com"}]
```

Khi điều này được đặt, `fetch_url` sẽ tự động chuyển từ điểm cuối `/md` sang `/crawl` với `browser_config.cookies`. `/md` không hỗ trợ chèn cookie.

### Trường đối tượng cookie

| Cánh đồng | Yêu cầu | Sự miêu tả |
|---|---|---|
| `name` | Đúng | Tên cookie |
| `value` | Đúng | Giá trị cookie |
| `domain` | KHÔNG | Phạm vi miền (ví dụ: `.x.com`). Đề xuất cho tính chính xác. |
| `path` | KHÔNG | Phạm vi đường dẫn. Mặc định là `/` nếu bị bỏ qua. |

:::caution[Protect session tokens]
Giá trị cookie rất nhạy cảm, vì vậy hãy coi chúng như mật khẩu. Họ cấp quyền truy cập phiên đầy đủ vào tài khoản của bạn. Không cam kết `.env` kiểm soát phiên bản.
:::

---

## Thứ tự động cơ và các biến môi trường

| Biến | Mặc định | Sự miêu tả |
|---|---|---|
| `CRAWL4AI_BASE_URL` | bỏ đặt | Bật Crawl4AI khi được đặt. Sử dụng `http://crawl4ai:11235/` từ Docker Compose hoặc `http://localhost:11235/` khi TomoriBot chạy trực tiếp trên máy của bạn. |
| `CRAWL4AI_TOKEN` | bỏ đặt | Mã thông báo mang tùy chọn. Phải khớp `CRAWL4AI_API_TOKEN` trên vùng chứa Crawl4AI khi được bật. |
| `FETCH_URL_ENGINE_ORDER` | `safe_http` | Danh sách động cơ được phân tách bằng dấu phẩy. `safe_http` luôn được thêm vào làm phương án dự phòng cuối cùng; tên `mcp_fetch` kế thừa đặt bí danh cho nó. Các mục Crawl4AI bị bỏ qua khi không cho phép tìm nạp mạng riêng (sản xuất mà không chọn tham gia). |
| `FETCH_URL_TIMEOUT_MS` | `15000` | Hết thời gian chờ yêu cầu trên mỗi công cụ cho Crawl4AI và các công cụ tìm nạp URL khác. |
| `FETCH_URL_MAX_CONTENT_LENGTH` | `50000` | Số ký tự tối đa được trả về bởi một lệnh gọi tìm nạp trước khi cần tiếp tục. |
| `FETCH_URL_ALLOW_PRIVATE_NETWORK` | `false` | Chọn tham gia chỉ dành cho sản xuất. Quá trình sản xuất bên ngoài (`RUN_ENV` != `production`), bộ bảo vệ SSRF tự động thư giãn, do đó, quá trình tìm nạp localhost/private/nội bộ và gửi Crawl4AI hoạt động mà không cần thiết lập. Chỉ đặt `true` để cho phép tìm nạp mạng riêng trong quá trình triển khai sản xuất đáng tin cậy. |
| `FETCH_URL_FILTER_MODE` | `fit` | Chế độ lọc Crawl4AI `/md`. `fit` giữ sạch dấu vết khi sử dụng LLM; `fetch_url(..., raw=true)` ghi đè nó theo yêu cầu. |
