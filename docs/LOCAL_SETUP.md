# Thiết lập TransitFlow trên máy mới

## Yêu cầu

- Node.js `20.19+` hoặc `22.12+`.
- npm đi kèm Node.js.
- MongoDB 7 chạy local, hoặc Docker Desktop có Docker Compose.

Phiên bản Node khuyến nghị được ghi trong `.nvmrc`.

## Cách nhanh nhất với Docker

Sau khi tải source:

```powershell
npm.cmd ci
npm.cmd run setup:docker
npm.cmd run dev
```

`setup:docker` khởi động MongoDB, chờ database sẵn sàng rồi chạy toàn bộ quy trình
khởi tạo. Volume Docker giữ dữ liệu giữa các lần khởi động.

## Khi đã cài MongoDB trên máy

Khởi động MongoDB, sau đó:

```powershell
npm.cmd ci
npm.cmd run setup:local
npm.cmd run dev
```

Nếu chưa có `server/.env` hoặc `server/.env.local`, bước setup tự tạo
`server/.env.local` từ `.env.example`. File này không được commit.

Tài khoản local mặc định:

```text
admin@local.test
<ADMIN_PASSWORD configured in server/.env.local>
```

Thông tin này chỉ dành cho máy phát triển và phải đổi khi triển khai.

## Quy trình `setup:local`

Lệnh setup luôn thực hiện theo cùng một thứ tự:

1. Kiểm tra phiên bản Node và cấu hình bắt buộc.
2. Kết nối MongoDB và lấy khóa để ngăn hai tiến trình setup chạy đồng thời.
3. Chạy các migration chưa được áp dụng.
4. Kiểm tra checksum của dữ liệu nguồn.
5. Đồng bộ tăng dần tuyến, điểm dừng và `RouteStop`.
6. Kiểm tra khóa trùng, thứ tự trùng, liên kết mồ côi và khoảng cách.
7. Ghi phiên bản/checksum đã đồng bộ vào `_transitflow_state`.

Lệnh có thể chạy lại nhiều lần. Khi database đã đúng, kết quả đồng bộ đều bằng
0 và migration cũ được bỏ qua.

Server cũng kiểm tra trạng thái này trước khi mở cổng HTTP. Nếu database trống,
thiếu migration hoặc source mới chưa được đồng bộ, server dừng và yêu cầu chạy:

```powershell
npm.cmd run setup:local
```

## Cập nhật dữ liệu nguồn

Sau khi chỉnh sửa có chủ đích `server/data/transit-data.json`:

```powershell
npm.cmd run data:manifest
npm.cmd run sync:data:dry
npm.cmd run setup:local
npm.cmd run verify:data
```

Commit cả `transit-data.json` và `transit-data.manifest.json`. Manifest giúp phát
hiện file thiếu, bị sửa một phần hoặc không đúng số lượng trước khi database bị
ghi.

Nếu thay đổi cấu trúc database, thêm một migration mới vào
`server/src/database/migrations.ts`; không sửa migration đã được phát hành.

## Các lệnh liên quan

```powershell
npm.cmd run db:start       # Khởi động MongoDB Docker
npm.cmd run db:stop        # Dừng container, không xóa volume
npm.cmd run setup:local    # Migration + sync + verify
npm.cmd run sync:data:dry  # Chỉ xem trước thay đổi
npm.cmd run verify:data    # Kiểm tra database hiện tại
```
