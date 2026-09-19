---
title: "Giám sát Grafana cục bộ"
sidebar:
  order: 7
---

Bạn có thể giám sát phiên bản TomoriBot cục bộ của mình bằng các bảng điều khiển Grafana thông qua một profile Docker Compose được cung cấp sẵn.

Để khởi động cả TomoriBot và Grafana cùng nhau trên máy của bạn:

```sh
docker compose -f docker-compose.yaml -f docker/compose.monitor.yaml up -d
```

Lệnh này sẽ:
- Khởi chạy TomoriBot cùng PostgreSQL (trên cổng 15432 cho DB)
- Khởi chạy Grafana trên cổng 3000 với nguồn dữ liệu PostgreSQL được cấu hình tự động
- Cung cấp sẵn bảng điều khiển **TomoriBot Overview**
- Kết nối cả hai dịch vụ trên cùng một mạng Docker

Truy cập Grafana tại [http://localhost:3000](http://localhost:3000):
- **Username**: `admin`
- **Password**: Thiết lập qua `GRAFANA_PASSWORD` trong `.env` (mặc định là `admin` nếu chưa đặt)

## Bảng điều khiển được cung cấp sẵn

Bảng điều khiển **TomoriBot Overview** xuất hiện tự động và không cần thiết lập thêm. Các panel của bảng điều khiển theo dõi bộ nhớ tiến trình,
số lượng mục bộ nhớ đệm, lỗi mỗi giờ, mức sử dụng token theo model, hoạt động theo giờ, các lệnh hàng đầu, ngôn ngữ
người dùng, đám mây cảm xúc, cùng các preset và model đang được sử dụng.

Mỗi panel chỉ đọc các bảng tồn tại trong mọi bản cài đặt, do đó cùng một bảng điều khiển có thể hoạt động tốt cho cả self-host
lẫn bản triển khai trên đám mây.

Một số panel sẽ ở trạng thái trống cho đến khi nguồn dữ liệu tương ứng được bật:

| Panel | Yêu cầu |
|---|---|
| Process Memory, Cache Entries | Các hàng `metric_samples`, được ghi sau mỗi `CACHE_METRICS_INTERVAL_MS`. Bộ thu thập chỉ chạy khi `RUN_ENV=production`, do đó phiên bản phát triển sẽ không hiển thị gì ở đây. |
| Errors per Hour by Type | `ERROR_DB_LOGGING_ENABLED` (bật theo mặc định). Một đường nằm ngang trong thời gian nghi ngờ có sự cố cũng có thể là do cơ chế ngắt mạch của kho lưu trữ đang mở, chứ không phải do lỗi đã dừng lại. |
| Host Memory and Swap Tiers, Host Pressure (PSI) and Swap-In Rate | Máy chủ Linux. Các panel này đọc `/proc/meminfo`, `/proc/pressure/*`, `/proc/swaps` và `/sys/block/zram0`, do đó chúng sẽ để trống trên macOS và Windows. Chuỗi zram cũng yêu cầu thiết bị zram swap; máy chủ không có thiết bị này vẫn báo cáo bộ nhớ và PSI. |

## Chỉnh sửa và lưu giữ các thay đổi

Các bảng điều khiển vẫn có thể chỉnh sửa được trên giao diện người dùng, điều này rất quan trọng trong quá trình xử lý sự cố. Các
chỉnh sửa chỉ tồn tại trong container và sẽ bị thay thế từ ổ đĩa trong lần khởi động lại tiếp theo, vì vậy hãy xuất JSON của bảng điều khiển và
commit vào `docker/grafana/dashboards/` để giữ lại thay đổi.

Để thêm bảng điều khiển của riêng bạn, chỉ cần đặt một tệp JSON vào cùng thư mục đó. Tham chiếu nguồn dữ liệu bằng uid
cố định `tomoribot-postgres`: Grafana sẽ gán một uid ngẫu nhiên khi nguồn dữ liệu không khai báo uid nào, và bảng điều khiển
trỏ đến uid ngẫu nhiên sẽ hiển thị các panel trống thay vì báo lỗi.
