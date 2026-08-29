# Đồng bộ dữ liệu TransitFlow

Nguồn chuẩn hiện nằm tại `server/data/transit-data.json`. Cơ chế mới đồng bộ tăng
dần và không xóa toàn bộ cơ sở dữ liệu như cơ chế nhập dữ liệu cũ.

Trên máy mới, nên chạy pipeline đầy đủ bằng `npm.cmd run setup:local` thay vì gọi
từng bước riêng. Xem thêm [hướng dẫn thiết lập local](LOCAL_SETUP.md).

## Cách chạy

Xem trước thay đổi, không ghi vào MongoDB:

```powershell
npm.cmd run sync:data:dry
```

Áp dụng thay đổi:

```powershell
npm.cmd run sync:data
```

Kiểm tra tính toàn vẹn sau đồng bộ:

```powershell
npm.cmd run verify:data
```

Cơ chế `seed` cũ và các script sinh dữ liệu phá hủy đã được loại khỏi dự án.
Việc cập nhật database chỉ đi qua `sync:data`.

## Quy tắc đồng bộ

- Tuyến được nhận diện ổn định bằng `Route.code`.
- Điểm dừng được nhận diện bằng `Stop.sourceKey`, tạo từ tên đã chuẩn hóa và tọa
  độ có 6 chữ số thập phân.
- Các điểm có cùng khóa được gộp thành một bản ghi `Stop`; mọi `RouteStop` được
  nối lại tới bản ghi đó.
- Một điểm vật lý vẫn có thể xuất hiện nhiều lần trong cùng một tuyến. Mỗi lần
  xuất hiện có `RouteStop.syncKey` riêng.
- Bản ghi không còn trong tệp nguồn không bị xóa tự động.
- Tuyến, điểm dừng và liên kết do quản trị viên thêm được giữ lại. Liên kết thủ
  công được neo gần vị trí cũ khi thứ tự nguồn thay đổi.
- Dữ liệu do nguồn quản lý chỉ được ghi khi giá trị thực sự thay đổi. Chạy lại
  cùng một tệp sẽ cho kết quả không có thay đổi.
- Nếu quản trị viên xóa hoặc đổi thứ tự một `RouteStop` thuộc nguồn, lần đồng bộ
  tiếp theo sẽ khôi phục thứ tự nguồn. `RouteStop` có `managedBy: "admin"` thì
  được giữ.

## Mốc hoàn tác

Mốc trước khi chuyển cơ chế nằm tại:

```text
.undo/20260729-before-incremental-sync
```

Để phục hồi database, dừng TransitFlow rồi chạy:

```powershell
npm.cmd exec --workspace=server -- tsx ".undo/20260729-before-incremental-sync/restore-database.ts" --confirm
```

Lệnh phục hồi có chủ đích thay thế toàn bộ dữ liệu bằng snapshot cũ. Hướng dẫn
đầy đủ nằm trong `RESTORE.md` của mốc hoàn tác.
