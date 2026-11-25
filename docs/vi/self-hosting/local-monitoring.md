---
title: "Giám sát Grafana cục bộ"
sidebar:
  order: 6
aiGenerated: true
---

Giám sát phiên bản TomoriBot cục bộ của bạn bằng bảng thông tin Grafana dựng sẵn để theo dõi mức sử dụng bộ nhớ, kích thước bộ đệm, mức tiêu thụ mã thông báo và lưu lượng lệnh.

Thêm mật khẩu Grafana vào `.env`. Compose từ chối chạy các lệnh giám sát nếu thiếu mật khẩu này, vì kết nối cơ sở dữ liệu của Grafana có toàn quyền truy cập dữ liệu của bạn:

```sh
GRAFANA_PASSWORD=choose-a-long-random-password
```

Bắt đầu TomoriBot và Grafana cùng nhau:

```sh
docker compose -f docker-compose.yaml -f docker/compose.monitor.yaml up -d
```

Lệnh này khởi chạy TomoriBot, PostgreSQL và Grafana cùng bảng điều khiển Tổng quan về TomoriBot.

Mở Grafana tại [http://localhost:3000](http://localhost:3000):
- **Tên người dùng**: `admin`
- **Mật khẩu**: giá trị `GRAFANA_PASSWORD` trong `.env`

Grafana chỉ chấp nhận kết nối từ máy tính đang chạy Docker. Để mở Grafana từ máy tính khác, hãy chuyển tiếp cổng qua SSH bằng `ssh -L 3000:localhost:3000 <user>@<host>`, rồi mở `http://localhost:3000` trên máy tính của bạn.

Nếu bạn đã khởi động Grafana trước khi nó yêu cầu mật khẩu, Grafana vẫn giữ mật khẩu đã lưu lần đầu. Hãy đăng nhập bằng mật khẩu đó (`admin` nếu bạn chưa từng đặt), rồi đổi mật khẩu trong hồ sơ Grafana của bạn.

## Bảng điều khiển được cung cấp sẵn

Bảng điều khiển Tổng quan TomoriBot tải tự động mà không cần cấu hình thủ công. Bảng điều khiển của nó hiển thị bộ nhớ quy trình, số lần nhập bộ đệm, lỗi mỗi giờ, mức sử dụng mã thông báo theo model, hoạt động hàng giờ, lệnh hàng đầu, ngôn ngữ người dùng, đám mây cảm xúc cũng như các model và cài đặt trước đang hoạt động.

Mọi bảng điều khiển đều truy vấn các bảng tiêu chuẩn có trong tất cả các cài đặt, cho phép bố cục bảng điều khiển giống nhau hoạt động cục bộ và trong môi trường đám mây.

Một số bảng nhất định yêu cầu cài đặt thời gian chạy cụ thể hoặc hỗ trợ máy chủ:

| bảng điều khiển | Nhu cầu |
|---|---|
| Xử lý bộ nhớ, mục nhập bộ đệm | Các hàng `metric_samples` được viết mỗi `CACHE_METRICS_INTERVAL_MS`. Bộ sưu tập chỉ chạy khi `RUN_ENV=production`, do đó phiên bản phát triển không hiển thị dữ liệu ở đây. |
| Lỗi mỗi giờ theo loại | `ERROR_DB_LOGGING_ENABLED` (được bật theo mặc định). Một đường thẳng trong khi xảy ra sự cố có thể cho biết rằng bộ ngắt mạch cơ sở dữ liệu đang mở chứ không phải lỗi đã chấm dứt. |
| Bộ nhớ máy chủ và mức chuyển đổi, áp suất máy chủ (PSI) và tốc độ chuyển đổi | Một máy chủ Linux. Chúng đọc `/proc/meminfo`, `/proc/pressure/*`, `/proc/swaps` và `/sys/block/zram0`, vì vậy chúng vẫn trống trên macOS và Windows. Dòng zram yêu cầu thiết bị trao đổi zram được định cấu hình; máy chủ không có zram vẫn báo cáo số liệu áp suất và bộ nhớ chung. |

## Chỉnh sửa và lưu giữ các thay đổi

Trang tổng quan vẫn có thể chỉnh sửa được trong giao diện Grafana để gỡ lỗi trực tiếp. Vì vùng chứa khởi động lại, thiết lập lại trang tổng quan sẽ chỉnh sửa trở lại các tệp trên đĩa, nên hãy xuất JSON trang tổng quan đã sửa đổi của bạn và lưu nó vào `docker/grafana/dashboards/` để lưu giữ các thay đổi của bạn.

Để thêm trang tổng quan mới, hãy đặt định nghĩa JSON của trang tổng quan đó vào `docker/grafana/dashboards/`. Nhắm mục tiêu nguồn dữ liệu PostgreSQL với uid cố định `tomoribot-postgres`: các nguồn dữ liệu không có uid rõ ràng sẽ nhận được số nhận dạng được tạo ngẫu nhiên, điều này khiến các trang tổng quan sử dụng uid không khớp sẽ hiển thị các bảng trống.
