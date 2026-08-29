# Bàn giao dự án TransitFlow cho ChatGPT

> Cập nhật: 05/08/2026  
> Mục đích: gửi nguyên file này cho một phiên ChatGPT/Codex khác để tiếp tục kiểm tra,
> sửa hoặc phát triển dự án mà không phải suy đoán lại lịch sử thay đổi.

## 1. Yêu cầu dành cho phiên tiếp quản

Hãy đọc file này, sau đó kiểm tra trực tiếp source code trước khi sửa. Không xóa hoặc tạo lại
toàn bộ MongoDB, không chạy cơ chế seed cũ và không ghi đè các thay đổi quản trị thủ công.
Trước thay đổi lớn về source hoặc database, hãy tạo checkpoint mới trong `.undo/` tương tự các
checkpoint hiện có. Không in hoặc commit giá trị thật của `TOMTOM_API_KEY` và mật khẩu admin.

## 2. Mô tả ngắn

TransitFlow là đồ án web quản lý tuyến xe buýt và tra cứu hành trình tại Hà Nội:

- Client: React 18, Vite, TypeScript, Leaflet.
- Server: Node.js, Express, TypeScript, Mongoose.
- Database: MongoDB 7, có thể chạy bằng Docker Compose.
- Trang người dùng: `/`.
- Trang quản trị: `/admin`.
- Client mặc định: `http://localhost:3000`.
- Server mặc định: `http://localhost:5000`.

Thư mục quan trọng:

```text
client/src/pages/AdminPage.tsx             giao diện quản trị
client/src/services/api.ts                 các lời gọi API
server/src/routes/adminRoutes.ts           API quản trị
server/src/services/routeStopAdminService.ts
server/src/services/journeyService.ts       tìm đường và ETA hành trình
server/src/services/liveTrafficService.ts   TomTom và mô phỏng giao thông
server/src/services/etaService.ts           công thức ETA đơn giản
server/src/syncData.ts                      đồng bộ dữ liệu tăng dần
server/src/database/migrations.ts           migration database
server/src/verifyTransitData.ts             kiểm tra toàn vẹn dữ liệu
server/data/transit-data.json               dữ liệu nguồn chuẩn
server/data/transit-data.manifest.json      checksum và số lượng nguồn
docs/LOCAL_SETUP.md                         thiết lập máy local mới
docs/DATA_SYNC.md                           quy tắc đồng bộ
.undo/                                      các checkpoint phục hồi
```

## 3. Trạng thái chức năng hiện tại

### Quản trị

Trang admin đã có:

- đăng nhập bằng session cookie;
- thêm và chỉnh sửa thông tin tuyến xe;
- thêm, chỉnh sửa tên/địa chỉ/tọa độ điểm dừng;
- chọn lại vị trí điểm dừng trên bản đồ;
- thêm hoặc gỡ một điểm dừng khỏi tuyến;
- kéo-thả để thay đổi thứ tự `RouteStop` thay cho nút mũi tên;
- chỉnh danh sách điểm dừng dưới dạng bản nháp;
- chỉ ghi database khi bấm **Lưu thay đổi**;
- nút hủy trả danh sách về trạng thái đã lưu;
- kiểm tra xung đột bằng `expectedRouteStopIds`, tránh ghi đè nếu dữ liệu đã bị thay đổi bởi
  phiên quản trị khác;
- sau khi lưu, server chuẩn hóa `order`, tính lại `distanceFromPrev` và xóa cache giao thông của
  tuyến bị ảnh hưởng.

Các endpoint chính nằm dưới `/api/admin`, được bảo vệ bằng middleware admin:

```text
POST   /api/admin/auth/login
POST   /api/admin/auth/logout
GET    /api/admin/auth/session
GET    /api/admin/stats
GET    /api/admin/routes
POST   /api/admin/routes
PATCH  /api/admin/routes/:id
GET    /api/admin/routes/:id/stops
POST   /api/admin/routes/:id/stops
DELETE /api/admin/routes/:id/stops/:routeStopId
PUT    /api/admin/routes/:id/stops/reorder
PUT    /api/admin/routes/:id/stops
GET    /api/admin/stops
POST   /api/admin/stops
PATCH  /api/admin/stops/:id
```

### Vì sao điểm dừng admin mới tạo chưa xuất hiện trong tra cứu

`Stop` chỉ là một địa điểm vật lý. Tra cứu đường đi xây mạng lưới từ bảng/collection
`RouteStop`, tức liên kết giữa một `Stop` và một `Route` theo thứ tự cụ thể. Do đó:

```text
Stop mới -> thêm Stop vào một tuyến -> tạo RouteStop -> bấm Lưu thay đổi
         -> RouteStop được ghi DB -> tra cứu hành trình mới sử dụng được điểm đó
```

Không tự động gán một `Stop` mới vào tuyến chỉ dựa vào khoảng cách, vì có thể tạo tuyến sai.
Admin phải chọn tuyến và vị trí chèn. Một `Stop` có thể thuộc nhiều tuyến; một điểm vật lý cũng
có thể xuất hiện nhiều lần trên cùng tuyến nếu lộ trình cần điều đó.

### Dữ liệu trùng tên điểm dừng

Danh sách điểm dừng lấy từ collection `stops`, model `server/src/models/Stop.ts`. Liên kết và thứ
tự thuộc collection `routestops`, model `server/src/models/RouteStop.ts`.

Tên giống nhau không đủ để kết luận là trùng vật lý. Cơ chế đồng bộ nhận diện điểm bằng
`Stop.sourceKey`, được tạo từ tên chuẩn hóa và tọa độ làm tròn 6 chữ số. Các bản ghi có cùng
`sourceKey` được gộp và mọi `RouteStop` được nối lại đến cùng `Stop`. Hai điểm cùng tên nhưng khác
tọa độ vẫn được giữ riêng.

## 4. Cơ chế dữ liệu hiện tại

Cơ chế seed phá hủy cũ đã bị loại bỏ. Nguồn chuẩn là `server/data/transit-data.json`, được đồng bộ
tăng dần thay vì xóa toàn bộ database.

Manifest hiện khai báo:

```text
sourceVersion: 1
routes: 21
uniqueStops: 207
routeStops: 354
sha256: 040b5fc0e29a6a0ef0b2e96dcfcd276a75c56892e99584ed6134eb0d28a40dbf
```

Quy tắc quan trọng:

- nhận diện tuyến nguồn bằng `Route.code`;
- nhận diện điểm nguồn bằng `Stop.sourceKey`;
- nhận diện lần xuất hiện của điểm trên tuyến bằng `RouteStop.syncKey`;
- không tự xóa bản ghi không còn trong file nguồn;
- giữ tuyến, điểm và `RouteStop` do admin tạo (`managedBy: "admin"`);
- liên kết admin được neo gần vị trí cũ khi thứ tự nguồn thay đổi;
- chạy lại cùng một nguồn phải cho kết quả idempotent, không có thay đổi;
- nếu admin sửa/xóa một `RouteStop` do nguồn quản lý thì lần sync sau có thể khôi phục nó;
- thay đổi schema phải thêm migration mới, không sửa migration đã phát hành.

Pipeline thiết lập máy mới:

```powershell
npm.cmd ci
npm.cmd run setup:docker
npm.cmd run dev
```

Nếu MongoDB local đã chạy, dùng `npm.cmd run setup:local` thay cho `setup:docker`.
`setup:local` thực hiện lần lượt kiểm tra cấu hình, migration, kiểm tra manifest, sync tăng dần,
verify và ghi trạng thái vào `_transitflow_state`.

Các lệnh an toàn khi cập nhật nguồn:

```powershell
npm.cmd run data:manifest
npm.cmd run sync:data:dry
npm.cmd run setup:local
npm.cmd run verify:data
```

Không chỉnh `transit-data.json` rồi quên cập nhật `transit-data.manifest.json`.

## 5. Tuyến 32 và checkpoint

Tuyến 32 từng bị xáo trộn và đã được phục hồi từ nguồn chuẩn. Snapshot riêng trước khi phục hồi:

```text
.undo/20260805T030110-before-route-32-restore/route.json
```

Checkpoint đầy đủ gần nhất được tạo sau khi:

- phục hồi tuyến 32;
- thêm cơ chế bản nháp và nút lưu danh sách điểm dừng;
- thay nút mũi tên bằng kéo-thả.

```text
.undo/20260805-route-drag-drop-checkpoint/
```

Checkpoint gồm `source.zip`, snapshot các collection, manifest, hướng dẫn và script phục hồi.
Để phục hồi database về checkpoint này, dừng TransitFlow rồi chạy từ thư mục gốc:

```powershell
npm.cmd exec --workspace=server -- tsx "../.undo/20260805-route-drag-drop-checkpoint/restore-database.ts" --confirm
```

Lệnh này có tính phá hủy vì thay dữ liệu hiện tại bằng snapshot; phải đọc `RESTORE.md`, tạo bản
sao lưu hiện trạng và chỉ chạy khi người dùng xác nhận rõ.

Checkpoint cũ trước khi chuyển sang đồng bộ tăng dần:

```text
.undo/20260729-before-incremental-sync/
```

## 6. ETA và giao thông

Mức ùn tắc được chuẩn hóa trong khoảng `0..1`. Hệ số thời gian đã được giảm thành:

```text
congestionLevel = 0.0 -> thời gian cơ sở x 1
congestionLevel = 0.5 -> thời gian cơ sở x 1.5
congestionLevel = 1.0 -> thời gian cơ sở x 2
```

Công thức hiện tại:

```text
ETA đoạn = baseTime * (1 + congestionLevel)
```

`calcSegmentETA()` nằm trong `server/src/services/etaService.ts`. Luồng tìm hành trình cũng dùng
hệ số cùng ý nghĩa trong `server/src/services/journeyService.ts`; khi thiếu dữ liệu giao thông,
luồng này đang có `DEFAULT_CONG = 0.15`. Cần giữ hai luồng nhất quán nếu tiếp tục sửa công thức.

`baseTime` của ETA đơn giản lấy từ `TrafficSegment.baseTime`; nếu thiếu thì dùng
`distanceFromPrev / 5`, tương đương tốc độ fallback 5 m/s (18 km/h).

### TomTom Traffic API

Dự án đã có tích hợp tùy chọn TomTom Flow Segment Data trong
`server/src/services/liveTrafficService.ts`:

- đọc key từ `TOMTOM_API_KEY` phía server;
- gọi tại trung điểm của từng cặp điểm dừng liền kề;
- tối đa 4 request song song;
- timeout 5 giây;
- cache theo tuyến trong 5 phút;
- tính `congestionLevel = 1 - currentSpeed/freeFlowSpeed`;
- nếu thiếu key, API lỗi, timeout hoặc hết quota thì tự rơi về mô phỏng theo giờ;
- truy vấn thời điểm tương lai luôn dùng mô phỏng;
- client hiển thị nguồn `tomtom` hoặc `simulation`.

Thiết kế hiện tại tốn một request cho mỗi đoạn kề nhau. Ví dụ tuyến 20 điểm cần khoảng 19 request
cho lần làm mới không có cache. Toàn bộ dữ liệu nguồn có 354 `RouteStop` trên 21 tuyến, tương
đương khoảng 333 request nếu làm mới mọi tuyến một lần (giả sử mỗi tuyến là một chuỗi liên tục).

TomTom có hạn mức miễn phí nhưng không nên coi API là miễn phí vô hạn. Khi triển khai nhiều người
dùng, nên cân nhắc cache 10–15 phút, giới hạn tuyến được gọi, theo dõi HTTP 429 và hạn mức trong
dashboard TomTom. Không đưa key xuống client hoặc commit key vào repository.

## 7. Cấu hình môi trường

Mẫu cấu hình nằm tại `server/.env.example`:

```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/transitflow
NODE_ENV=development
TOMTOM_API_KEY=
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
TRUST_PROXY=false
APP_USER_AGENT=TransitFlow/1.0 (contact: your-email@example.com)
ADMIN_USERNAME=admin@local.test
ADMIN_PASSWORD=change-me-to-a-strong-unique-password
```

Thông tin admin trên chỉ dành cho local và phải thay khi triển khai. Lỗi đăng nhập 503/401 trước
đây liên quan đến việc thiếu `ADMIN_USERNAME` và `ADMIN_PASSWORD`. Trên máy mới, chạy
`setup:local` để tạo `server/.env.local` từ mẫu nếu chưa có.

Server chỉ mở cổng sau khi MongoDB kết nối và `assertDatabaseReady()` xác nhận migration/source
đã sẵn sàng. Nếu server từ chối khởi động, hãy chạy `npm.cmd run setup:local`; endpoint `/health`
trả 503 khi database chưa kết nối.

## 8. Kiểm tra trước và sau khi sửa

Nên chạy tối thiểu:

```powershell
npm.cmd run verify:data
npm.cmd run build
npm.cmd run benchmark:journey
```

Kiểm tra thủ công quan trọng:

1. Đăng nhập `/admin` thành công.
2. Tạo một điểm dừng nhưng chưa gắn tuyến: điểm không được dùng trong tra cứu.
3. Gắn điểm vào tuyến, kéo đến đúng vị trí và bấm **Lưu thay đổi**.
4. Tải lại trang admin: thứ tự mới vẫn còn.
5. Tra cứu hành trình có thể dùng điểm vừa gắn.
6. Hủy bản nháp không làm thay đổi database.
7. Chạy `sync:data:dry` không báo xóa dữ liệu admin.
8. Không có `RouteStop` trùng `order`, liên kết mồ côi hoặc khoảng cách âm.
9. Khi TomTom lỗi/không có key, bản đồ và ETA vẫn hoạt động bằng mô phỏng.

## 9. Việc nên ưu tiên tiếp theo

- Thêm test tự động cho CRUD admin và thao tác lưu toàn bộ danh sách `RouteStop`.
- Thêm test hồi quy riêng cho tuyến 32.
- Thêm quota/circuit breaker và thống kê request TomTom phía server.
- Cân nhắc tăng cache TomTom lên 10–15 phút nếu triển khai công khai.
- Kiểm tra lại `getTrafficSource()`: hiện hàm có thể báo `tomtom` chỉ vì có key, dù request thực tế
  bị lỗi và từng segment đã fallback; response theo segment mới là nguồn đáng tin cậy hơn.
- Rà tính nhất quán giữa `etaService.ts` và `journeyService.ts` trước mọi thay đổi ETA.
- Bổ sung test end-to-end: tạo Stop -> gắn RouteStop -> lưu -> tra cứu hành trình.

## 10. Lưu ý về trạng thái Git

Tại thời điểm tạo tài liệu này, thư mục gốc có một mục `.git` nhưng lệnh `git status` trả về
`fatal: not a git repository`. Phiên tiếp quản cần kiểm tra lại metadata Git trước khi dựa vào
commit/tag để làm checkpoint. Trong lúc chưa khắc phục, các mốc có thể phục hồi đang nằm ở
`.undo/`; không được xóa thư mục này như file thừa.

## 11. Prompt gợi ý khi gửi cho ChatGPT khác

```text
Hãy đọc toàn bộ docs/CHATGPT_HANDOFF.md và các tài liệu mà file đó dẫn tới. Sau đó kiểm tra trực
tiếp source code và trạng thái database trước khi kết luận. Hãy giữ cơ chế đồng bộ tăng dần,
không dùng seed xóa toàn bộ dữ liệu, không làm mất dữ liệu do admin tạo và không tiết lộ secret.
Nếu cần sửa source/database lớn, hãy tạo checkpoint trong .undo trước. Cuối cùng chạy verify:data,
build và benchmark:journey, rồi báo rõ file đã sửa, kết quả kiểm thử và rủi ro còn lại.
```
