---
title: "Thiết lập: Crawl4AI"
sidebar:
  order: 4
---
# Thiết lập: Crawl4AI

Công cụ `fetch_url` sử dụng engine `safe_http` nội tiến trình theo mặc định. Công cụ này cũng có thể tùy chọn thử một máy chủ cục bộ kết xuất bằng trình duyệt trong các môi trường phát triển đáng tin cậy khi bạn cần nội dung được render cho các trang web sử dụng nhiều JavaScript.

Thứ tự engine mặc định là `safe_http`. Do Crawl4AI đi theo các chuyển hướng nằm ngoài tầm kiểm soát của HTTP client được bảo vệ trong TomoriBot, nó chỉ được chấp nhận ở những nơi cho phép thu thập qua mạng riêng tư. Bên ngoài môi trường production, điều này là tự động (không cần cấu hình). Trong môi trường production, tính năng này yêu cầu người dùng phải bật rõ ràng tùy chọn `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`, điều này không được khuyến nghị.

Crawl4AI là một máy chủ cục bộ trích xuất markdown kết xuất từ trình duyệt. Nó chạy một trình duyệt không đầu dựa trên Playwright và trích xuất markdown thân thiện với LLM ở phía máy chủ bằng các bộ lọc nội dung riêng (không cần xử lý hậu kỳ phía TomoriBot).

Chọn một phương thức thiết lập Crawl4AI:

### A. Docker Compose (khi TomoriBot chạy trong Docker)

Sử dụng phương thức này nếu bạn chạy TomoriBot bằng ngăn xếp Docker Compose của kho lưu trữ. Trước tiên, hãy đặt `CRAWL4AI_BASE_URL=http://crawl4ai:11235/` và `FETCH_URL_ENGINE_ORDER=crawl4ai,safe_http` trong `.env`. Bên ngoài production, bạn không cần bật tùy chọn mạng riêng tư; chỉ thêm `FETCH_URL_ALLOW_PRIVATE_NETWORK=true` nếu bạn chạy ngăn xếp này với `RUN_ENV=production`.

Sau đó, khởi động bằng:

```sh
docker compose --profile fetch-crawl4ai up -d
```

Lệnh này sẽ khởi động ngăn xếp Compose cùng container Crawl4AI trên mạng Docker của TomoriBot.

Nếu bạn chạy TomoriBot trực tiếp bằng `bun run dev`, hãy sử dụng phương thức độc lập bên dưới.

Nếu bạn cũng muốn dùng SearXNG, hãy kết hợp các profile:

```sh
docker compose --profile searxng --profile fetch-crawl4ai up -d
```

Nếu bạn bật xác thực API-token của Crawl4AI, hãy đặt `CRAWL4AI_TOKEN` trong `.env`; Compose sẽ truyền biến này vào container dưới tên `CRAWL4AI_API_TOKEN`, và TomoriBot sẽ gửi nó dưới dạng bearer token.

---

### B. Docker độc lập (khi chạy `bun run dev`)

Trước tiên, đặt `CRAWL4AI_BASE_URL=http://localhost:11235/` và `FETCH_URL_ENGINE_ORDER=crawl4ai,safe_http` trong `.env` để bot kết nối với cổng container được publish trên máy chủ lưu trữ. Bên ngoài production không cần bật mạng riêng tư; chỉ thêm `FETCH_URL_ALLOW_PRIVATE_NETWORK=true` nếu bạn chạy với `RUN_ENV=production`.

Sau đó, thay vì chạy TomoriBot trực tiếp bằng `bun run dev`, hãy sử dụng `bun run launch --crawl4ai`. Lệnh này sẽ tự động xử lý vòng đời của container và đợi máy chủ sẵn sàng hoạt động trước khi khởi động bot:

```sh
bun run launch --crawl4ai
```

Nếu bạn cũng muốn dùng SearXNG:

```sh
bun run launch --searxng --crawl4ai
```

Nếu bạn thích tự quản lý container, hãy giữ `CRAWL4AI_BASE_URL=http://localhost:11235/` trong `.env` và chạy:

**PowerShell:**

```powershell
docker run -d --name crawl4ai -p 11235:11235 --shm-size=3g `
  unclecode/crawl4ai:latest
```

**Bash (Linux/macOS):**

```bash
docker run -d --name crawl4ai -p 11235:11235 --shm-size=3g \
  unclecode/crawl4ai:latest
```

Nếu bạn bảo mật container, hãy truyền `-e CRAWL4AI_API_TOKEN=your_token` vào `docker run` và đặt `CRAWL4AI_TOKEN=your_token` trong `.env`.

Sau đó chạy `bun run dev` khi container đã ở trạng thái hoạt động tốt (`docker ps` hiển thị `(healthy)`).

---

### C. Không sử dụng máy chủ kết xuất bằng trình duyệt

Để trống `CRAWL4AI_BASE_URL`. Công cụ `fetch_url` sẽ sử dụng engine bảo vệ `safe_http`.

---

## Thứ tự khởi động (Quan trọng)

TomoriBot kiểm tra tình trạng hoạt động của máy chủ trong **lần gọi `fetch_url` đầu tiên sau khi khởi động** và lưu tạm kết quả trong 60 giây. Nếu container chưa sẵn sàng khi lần kiểm tra đầu tiên đó diễn ra, bot sẽ coi máy chủ không khả dụng trong một phút tiếp theo.

Đối với Docker độc lập, hãy khởi động container Crawl4AI trước khi khởi động TomoriBot. `bun run launch --crawl4ai` đã tự động thực hiện việc này cho bạn.

### Thiết lập lần đầu

1. Khởi động container và đợi cho đến khi nó hiển thị `(healthy)` trong `docker ps`:
   ```powershell
   docker ps
   ```
2. Đặt `CRAWL4AI_BASE_URL` trong `.env` bằng giá trị tương ứng với phương thức thiết lập của bạn ở trên.
3. Khởi động TomoriBot (`bun run dev` hoặc `docker compose up`).

### Khởi động lại sau này

Nếu container đã tồn tại từ lần chạy trước, hãy sử dụng `docker start` thay vì `docker run` để tránh xung đột tên:

```powershell
# Khởi động container hiện có
docker start crawl4ai

# Xác nhận trạng thái healthy trước khi khởi động TomoriBot
docker ps
```

Sau đó khởi động TomoriBot như bình thường. Việc khởi động lại `bun run dev` sẽ đặt lại bộ nhớ đệm kiểm tra tình trạng trong bộ nhớ, do đó miễn là container đã sẵn sàng từ trước thì engine chính xác sẽ được chọn ngay lập tức.

---

## Chèn Cookie (Thu thập có xác thực: Tùy chọn)

Crawl4AI hỗ trợ chèn cookie ở cấp độ trình duyệt để trình duyệt không đầu xuất hiện như đã đăng nhập khi thu thập một trang. Điều này hữu ích cho các trang web yêu cầu phiên đăng nhập để xem nội dung (ví dụ: tin tức có tường thu phí, diễn đàn riêng tư, bảng điều khiển yêu cầu đăng nhập).

Phương án dự phòng `safe_http` **không** hỗ trợ chèn cookie. Cookie chỉ áp dụng khi Crawl4AI đang hoạt động.

> **Hạn chế:** Chèn cookie giúp vượt qua tường đăng nhập nhưng không vượt qua được cơ chế nhận dạng bot. Các trang web có khả năng phát hiện bot nghiêmặt (đặc biệt là Twitter/X) sẽ phát hiện Playwright không đầu qua canvas/WebGL và trả về các trang trống ngay cả khi có cookie phiên hợp lệ. Chèn cookie hoạt động tốt cho các trang web chỉ chặn dựa trên xác thực.

### Lấy cookie của bạn

1. Mở trình duyệt của bạn và đăng nhập vào trang web đích.
2. Mở DevTools (`F12`) → thẻ **Application** → **Storage** → **Cookies** → chọn domain của trang web.
3. Sao chép `Value` của từng cookie bắt buộc (thường là token phiên; hãy kiểm tra tên cookie của trang web).

### Crawl4AI

Đặt `CRAWL4AI_COOKIES_JSON` trong `.env` dưới dạng một mảng JSON:

```dotenv
CRAWL4AI_COOKIES_JSON=[{"name":"session","value":"YOUR_SESSION_TOKEN","domain":".example.com"}]
```

Khi biến này được thiết lập, `fetch_url` sẽ tự động chuyển từ endpoint `/md` sang `/crawl` với `browser_config.cookies`. Endpoint `/md` không hỗ trợ chèn cookie.

### Các trường trong đối tượng cookie

| Trường | Bắt buộc | Mô tả |
|---|---|---|
| `name` | Có | Tên cookie |
| `value` | Có | Giá trị cookie |
| `domain` | Không | Phạm vi domain (ví dụ `.x.com`). Khuyến nghị cung cấp để đảm bảo tính chính xác. |
| `path` | Không | Phạm vi đường dẫn. Mặc định là `/` nếu bỏ qua. |

> **Lưu ý:** Các giá trị cookie rất nhạy cảm, vì vậy hãy xử lý chúng như mật khẩu. Chúng cấp toàn quyền truy cập phiên vào tài khoản của bạn. Không commit `.env` vào hệ thống quản lý phiên bản.

---

## Thứ tự engine và các biến môi trường

| Biến | Mặc định | Mô tả |
|---|---|---|
| `CRAWL4AI_BASE_URL` | không đặt | Bật Crawl4AI khi được thiết lập. Sử dụng `http://crawl4ai:11235/` từ Docker Compose, hoặc `http://localhost:11235/` khi TomoriBot chạy trực tiếp trên máy của bạn. |
| `CRAWL4AI_TOKEN` | không đặt | Token bearer tùy chọn. Phải khớp với `CRAWL4AI_API_TOKEN` trên container Crawl4AI khi được bật. |
| `FETCH_URL_ENGINE_ORDER` | `safe_http` | Danh sách các engine phân tách bằng dấu phẩy. `safe_http` luôn được thêm vào cuối cùng làm phương án dự phòng; tên cũ `mcp_fetch` là bí danh của nó. Các mục Crawl4AI sẽ bị bỏ qua ở những nơi không cho phép thu thập qua mạng riêng tư (production không có tùy chọn cho phép). |
| `FETCH_URL_TIMEOUT_MS` | `15000` | Thời gian chờ yêu cầu cho từng engine đối với Crawl4AI và các engine thu thập URL khác. |
| `FETCH_URL_MAX_CONTENT_LENGTH` | `50000` | Số ký tự tối đa được trả về bởi một lần gọi fetch trước khi cần tiếp tục. |
| `FETCH_URL_ALLOW_PRIVATE_NETWORK` | `false` | Tùy chọn chỉ dành cho production. Bên ngoài production (`RUN_ENV` != `production`), cơ chế bảo vệ SSRF sẽ tự động nới lỏng, giúp việc thu thập từ localhost/mạng riêng tư/nội bộ và gửi tới Crawl4AI hoạt động mà không cần thiết lập thêm. Chỉ đặt `true` để cho phép thu thập qua mạng riêng tư trong bản triển khai production đáng tin cậy. |
| `FETCH_URL_FILTER_MODE` | `fit` | Chế độ lọc `/md` của Crawl4AI. `fit` giữ cho markdown gọn gàng hơn khi dùng cho LLM; `fetch_url(..., raw=true)` sẽ ghi đè chế độ này cho từng yêu cầu. |
