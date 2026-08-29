# Nguồn stop BusMap cho TransitFlow

Ngày đối chiếu: 2026-08-17.

## Nguồn chính

- BusMap Web App Hà Nội: <https://map.busmap.vn/hn>
- Danh mục tuyến: `https://api-web.busmap.vn/web/public/route/list?regionCode=hn`
- Chi tiết tuyến và stop: `https://api-web.busmap.vn/web/public/route/detail?routeId=<id>&regionCode=hn`

API chi tiết cung cấp `stationId`, `stationName`, `stationAddress`, `lat`, `lng`,
`stationOrder` và `stationDirection`. Snapshot thô của đúng 21 tuyến nằm trong thư mục
`raw/`; `busmap-client.mjs` có thể tải lại dữ liệu và `build-candidate.mjs` tái tạo báo cáo.

## Chính sách ghép dữ liệu

- Giữ nguyên 21 route và toàn bộ metadata route của TransitFlow.
- Mỗi route TransitFlow hiện chỉ lưu một chuỗi stop có hướng, nên không nối hai chiều BusMap.
- Chọn chiều BusMap khớp hai đầu tuyến hiện có; cả 21 tuyến đều khớp
  `stationDirection=1`.
- Dùng `busmap:hn:station:<stationId>` làm khóa stop vật lý để các tuyến dùng chung
  đúng một stop.
- Giữ lại RouteStop do admin tạo; chỉ thay các RouteStop có `managedBy=sync`.

## Đối chiếu phụ

- TimBus hiện hành cho 19 tuyến thường: dữ liệu đã lưu tại checkpoint nghiên cứu trước.
- OpenStreetMap cho 19 tuyến thường: snapshot và Overpass query đã lưu tại checkpoint.
- `02TC` và `32TC` có dữ liệu đầy đủ trong BusMap nhưng không có trong danh mục TimBus/OSM
  hiện hành tại thời điểm đối chiếu.

Kết quả chi tiết: `comparison-report.md` và `comparison-report.json`.

## Hoàn tác

Checkpoint trước thay đổi nằm tại `.undo/20260817-before-hanoi-stop-research/`.
Thực hiện theo `RESTORE.md` trong checkpoint để phục hồi cả source và MongoDB.
