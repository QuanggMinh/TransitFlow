# TransitFlow

Ứng dụng web quản lý tuyến xe buýt và dự báo thời gian đến theo tình trạng giao
thông.

## Cấu trúc

```text
transitflow/
├── client/                 React, Vite và TypeScript
├── server/
│   ├── data/               Dữ liệu nguồn chuẩn
│   └── src/
│       ├── models/         Mongoose schemas
│       ├── routes/         API endpoints
│       ├── services/       Hành trình, ETA và giao thông
│       ├── syncData.ts     Đồng bộ tăng dần
│       └── verifyTransitData.ts
└── docs/
```

## Cài đặt và chạy

Cách nhanh nhất với Docker:

```powershell
npm.cmd ci
npm.cmd run setup:docker
npm.cmd run dev
```

Nếu MongoDB đã chạy sẵn trên máy, thay `setup:docker` bằng `setup:local`.
Quy trình setup tự tạo cấu hình local, chạy migration, đồng bộ dữ liệu và kiểm
tra tính toàn vẹn. Xem [hướng dẫn thiết lập local](docs/LOCAL_SETUP.md).

Trang người dùng chạy tại `/`, trang quản trị tại `/admin`.

Tài khoản quản trị được cấu hình bằng:

```env
ADMIN_USERNAME=admin@local.test
ADMIN_PASSWORD=change-me-to-a-strong-unique-password
```

Đây chỉ là tài khoản mặc định cho local; phải thay đổi khi triển khai.

## Quản trị

- Thêm và chỉnh sửa tuyến xe.
- Thêm, chỉnh sửa và thay đổi vị trí điểm dừng trên bản đồ.
- Thêm, gỡ và kéo-thả để thay đổi thứ tự điểm dừng trong từng tuyến.
- Chỉnh danh sách điểm dừng dưới dạng bản nháp và chỉ ghi database khi bấm lưu.
- Tự chuẩn hóa thứ tự và tính lại khoảng cách giữa các điểm.

## Đồng bộ dữ liệu

Nguồn chuẩn là `server/data/transit-data.json`. Cơ chế đồng bộ nhận diện tuyến
bằng `code`, điểm dừng bằng `sourceKey`, giữ nguyên dữ liệu quản trị không thuộc
nguồn và không xóa toàn bộ database.

Xem [hướng dẫn đồng bộ](docs/DATA_SYNC.md) để biết quy tắc cập nhật và cách dùng
mốc hoàn tác.

## API chính

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/routes` | Danh sách tuyến |
| GET | `/api/routes/:id` | Chi tiết tuyến |
| GET | `/api/routes/:id/stops` | Điểm dừng của tuyến |
| GET | `/api/stops` | Danh sách điểm dừng |
| GET | `/api/eta?routeId=&targetStopIndex=` | Tính ETA |
| GET | `/health` | Kiểm tra server |

Các API quản trị nằm dưới `/api/admin` và yêu cầu phiên đăng nhập hợp lệ.
