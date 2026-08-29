# Đối chiếu stop vật lý cho 21 tuyến TransitFlow

Trạng thái: **dry-run**. Chưa thay đổi `server/data/transit-data.json` hoặc MongoDB.

- Giữ nguyên đủ 21 tuyến và toàn bộ metadata tuyến.
- Khớp đủ 21/21 mã tuyến với BusMap Hà Nội, gồm cả `02TC` và `32TC`.
- Chọn đúng chiều hiện có của TransitFlow (BusMap `stationDirection=1` cho cả 21 tuyến).
- Bộ ứng viên có 719 lượt ghé trạm, tương ứng 556 stop vật lý duy nhất theo BusMap `stationId`.
- Đối chiếu phụ với TimBus hiện hành cho 19 tuyến và OSM cho 19 tuyến; hai tuyến TC không có trong hai nguồn phụ hiện hành.

| Tuyến | Stop cũ | Stop BusMap | Chiều được chọn | Stop cũ gần BusMap ≤100m | Trung vị lệch cũ (m) | TimBus gần BusMap ≤100m | BusMap gần OSM ≤100m |
|---|---:|---:|---|---:|---:|---:|---:|
| 01 | 37 | 37 | (A) BX Gia Lâm → (B) BX Yên Nghĩa | 37/37 | 0 | 35/38 | 30/37 |
| 02TC | 47 | 47 | (B) BX Yên Nghĩa → Trung tâm Triển lãm Quốc gia (Đến) | 47/47 | 0 | 0/0 | 0/0 |
| 07 | 25 | 25 | Điểm cuối Cầu Giấy tuyến 20A → (B) Nội Bài | 25/25 | 0 | 24/28 | 22/25 |
| 08A | 38 | 38 | (A) Long Biên → (B) SVĐ Đông Mỹ | 38/38 | 0 | 35/36 | 33/38 |
| 08B | 37 | 37 | (A) Yên Phụ - điểm đầu cuối → (B) Vạn Phúc | 37/37 | 0 | 26/30 | 26/37 |
| 09A | 43 | 43 | (A) Điểm đỗ xe Trần Khánh Dư - Cuối tuần → (B) Đại học Mỏ - Tuyến 09A | 43/43 | 0 | 23/34 | 36/43 |
| 09B | 30 | 30 | (A) Điểm đỗ xe Trần Khánh Dư - Cuối tuần → (B) BX Mỹ Đình | 30/30 | 0 | 28/30 | 29/30 |
| 11 | 27 | 27 | CV Thống Nhất - Trần Nhân Tông → (B) Học viện Nông Nghiệp Việt Nam | 27/27 | 0 | 23/28 | 24/27 |
| 16 | 27 | 27 | (A) BX Mỹ Đình → BX Nước Ngầm | 27/27 | 0 | 26/28 | 27/27 |
| 17 | 43 | 43 | (A) Long Biên → (B) Nội Bài | 43/43 | 0 | 40/45 | 38/43 |
| 22A | 38 | 38 | (A) BX Gia Lâm → (B) Điểm đầu cuối KĐT Kiến Hưng | 38/38 | 0 | 38/38 | 35/38 |
| 22B | 32 | 32 | (A) BX Giáp Bát → (B) KĐT Đô Nghĩa | 32/32 | 0 | 31/32 | 29/32 |
| 26 | 31 | 31 | (A) Mai Động → (B) SVĐ Quốc Gia (đối diện bệnh viện thể thao) | 31/31 | 0 | 28/36 | 29/31 |
| 28 | 33 | 33 | (A) Bến xe Nước Ngầm → (B) ĐH Mỏ | 33/33 | 0 | 33/35 | 26/33 |
| 31 | 37 | 37 | (A) Đại học Bách Khoa → (B) ĐH Mỏ | 37/37 | 0 | 30/32 | 35/37 |
| 32 | 33 | 33 | (A) BX Giáp Bát → (B) Nhổn | 33/33 | 0 | 31/38 | 28/33 |
| 32TC | 21 | 21 | (A) BX Giáp Bát → Trung tâm Triển lãm Quốc gia (Đến) | 21/21 | 0 | 0/0 | 0/0 |
| 33 | 44 | 44 | (A) Cụm CN Thanh Oai → Trường Đại học Nội vụ Hà Nội | 44/44 | 0 | 43/43 | 42/44 |
| 34 | 26 | 26 | Bến xe Mỹ Đình → Bến xe Gia Lâm | 26/26 | 0 | 25/29 | 25/26 |
| 36 | 29 | 29 | (A) Long Biên - Tuyến 36 → (B) Yên Xá | 29/29 | 0 | 28/28 | 23/29 |
| 38 | 41 | 41 | A - Tân Xuân → (B) Mai Động | 41/41 | 0 | 38/40 | 38/41 |
