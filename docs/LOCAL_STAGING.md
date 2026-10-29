# Staging cục bộ để nghiệm thu học kỳ và Dự án

Bản này chạy Express/React trên **127.0.0.1**, dùng database bản sao có lưu lại thay đổi. Nó khác bản demo RAM `academic:preview`: bạn có thể đóng/mở lại và tiếp tục đối soát danh sách. Database nguồn không được dùng làm database phục vụ web.

**Đã chuyển staging hiện có sang học kỳ → nhóm môn**, gồm cả Thực tập cũ trong giao diện chung. Xem [GROUP_MANAGEMENT.md](GROUP_MANAGEMENT.md) cho API, chuyển cấu hình lớp và backup migration.

## Tạo bản sao và báo cáo đối soát

Công cụ yêu cầu **Node.js 22.16+** có `node:sqlite` và SQLite backup API; đã chạy với Node 24.18. Không cần thông tin truy cập cloud.

```bash
npm run academic:stage -- \
  --source=file:./internship-db.db \
  --workbook="HKI-26-27 GVHD DACN_DAKH_20261007.xlsx" \
  --lecturers=data/seed/lecturers-list.csv
```

`--source` phải là file SQLite có sẵn, không nhận URL remote. `--workbook` và `--lecturers` là tùy chọn; chỉ chỉ định CSV giảng viên khi danh mục bản sao còn trống. Nếu nguồn đã có giảng viên, bỏ `--lecturers` để dùng đúng danh mục đó. `--output=/path/private-dir` thay vị trí mặc định `.staging`.

Mỗi lần chạy tạo một thư mục mới, không ghi đè lần trước:

| File | Nội dung |
| --- | --- |
| `before.db` | Snapshot nhất quán trước chuyển đổi, lấy cả dữ liệu đã commit trong WAL |
| `staging.db` | Bản sao qua khởi tạo schema hiện tại và ánh xạ học vụ |
| `REPORT.md` | Kết quả đối soát dễ đọc, giới hạn dữ liệu đầu vào |
| `report.json` | Số hàng/checksum các bảng, thống kê ánh xạ và lỗi, đường dẫn bản sao |
| `import-preview.json` | Kết quả đọc/gộp/dò lỗi danh sách Dự án, có dữ liệu cá nhân; chưa commit tiếp nhận |

Thư mục mới có quyền 0700, database/báo cáo 0600 và `.staging/` đã được gitignore. Không đưa các file này lên repository, thư mục static hoặc chia sẻ công khai.

Quy trình mở nguồn chỉ đọc và dùng SQLite backup, sau đó chạy **cả khởi tạo ứng dụng cũ và schema academic** trên bản sao. Đối soát so sánh giá trị các cột nguồn trước/sau, không chỉ đếm hàng. Cho phép thêm cấu hình mặc định và giảng viên từ CSV được chỉ định; không cho sửa/xóa hồ sơ, điểm hoặc tham chiếu file nguồn. Thay đổi điểm lịch sử do startup, kể cả làm tròn khác giá trị lưu, làm báo cáo thất bại và không được phục vụ bản sao đó. Ánh xạ được chạy thử lần hai để xác nhận không tạo trùng.

Tool **không nhập danh sách Dự án**, không tự sửa MSSV hoặc ánh xạ GV chưa khớp. Nếu đã có file quyết định đối soát theo khóa `DACN:<hàng>`/`DAKH:<hàng>`, có thể thêm `--resolutions=/path/resolutions.json` để tính lại bản xem trước; kết quả vẫn chưa được commit.

Database nguồn có tham chiếu PDF/chat không đồng nghĩa nội dung file đã có trong bản sao. Công cụ hiện giữ nguyên key trong DB, chưa tải/copy file R2 hoặc kho `.storage` cũ; cần bổ sung file vào kho staging riêng trước khi nghiệm thu tải báo cáo lịch sử. File mới nộp trong staging được lưu riêng ở bước dưới.

## Mở giao diện

Dùng đường dẫn `directory` mà lệnh chuẩn bị đã in ra:

```bash
npm run academic:stage:serve -- --directory=.staging/academic-LCsr6X
```

Đường dẫn trên là bản đã chuẩn bị trong workspace này; khi tạo bản mới, thay bằng đường dẫn mới. Mở [Khoa trên staging local](http://127.0.0.1:4319/__local_staging/login). Tùy chọn `--port=4320` đổi cổng khi cần.

Đây là đăng nhập thử **chỉ tồn tại trong script local**, không dùng Google OAuth. Script tạo tài khoản `academic-staging-admin@local.invalid` trong bản sao. Sau khi tiếp nhận danh sách, có thể thử tài khoản đã có bằng URL `/__local_staging/login?email=<email-trong-ban-sao>` ở cửa sổ trình duyệt khác. JWT được tạo mới mỗi lần khởi động; mở lại URL đăng nhập khi khởi động lại server.

Các giới hạn được áp dụng khi chạy script:

- Chỉ nghe trên 127.0.0.1 và chấp nhận hostname localhost/127.0.0.1.
- Chỉ phục vụ `staging.db` trong thư mục có báo cáo đối soát đạt; không nhận database nguồn tùy ý.
- Email tắt, cron tắt, bỏ credentials R2/Sheets/provider email khỏi môi trường tiến trình. Không chạy bộ xả email định kỳ của entrypoint production.
- PDF và đính kèm mới lưu ở `.staging/<lần-chạy>/.storage`, không dùng kho file gốc.
- Vite không phục vụ trực tiếp database, báo cáo đối soát, workbook và kho `.storage`; tải bài/đính kèm đi qua API kiểm tra quyền.
- `/api/health` kiểm tra tiến trình; `/api/ready` trả 200 khi đọc được schema academic, 503 khi DB/schema chưa sẵn sàng; không lộ credentials hoặc lỗi SQL.
- Route OAuth thật bị chặn trong script local. Việc xác thực Google, quyền Drive, R2 và email thực tế được nghiệm thu sau trên staging HTTPS riêng.

## Kết quả diễn tập với dữ liệu hiện có

Database `internship-db.db` local hiện trống sinh viên, phân công, PDF và điểm. Đã đối soát bản sao và xác nhận file nguồn giữ nguyên SHA-256; kết quả này **chưa xác nhận dữ liệu Thực tập production**. Kiểm thử tự động riêng có dữ liệu Thực tập hư cấu để kiểm tra bảo toàn điểm/phân công/key PDF, WAL và phát hiện sai khác.

Danh mục ban đầu từ CSV có 83 giảng viên và bản xem trước có 48 nhóm lỗi. Sau khi đối chiếu `danh_sach_giang_vien.xlsx` cùng các xác nhận của Khoa ngày 29/10/2026, staging đã có **97 giảng viên**; hai dòng test/thiếu dữ liệu không được bổ sung. MSSV `134` được sửa thành `23021527`, gộp với dòng có sẵn cùng lớp; email GVHD lấy theo danh mục VNU đã chốt.

**Đã xác nhận nhập trên staging cục bộ:**

- 697 dòng nguồn → **535 lần học / 532 sinh viên / 8 lớp**, không còn lỗi đối soát.
- DAKH INT3131 lớp 1–4: **58 / 65 / 55 / 43** lần học; DACN INT3132 lớp 1–4: **80 / 78 / 80 / 76** lần học.
- **408 hồ sơ có GVHD, 127 hồ sơ chưa có GVHD**. Các hồ sơ thiếu GVHD được tiếp nhận, chưa tự gán người thay thế.
- Ba sinh viên học cả DACN/DAKH có hai enrollment độc lập. Nhập lại không tạo thêm hoặc sửa hồ sơ: 535 giữ nguyên.
- Export sinh viên/phân công/báo cáo/điểm lấy đủ 535 dòng; export riêng tám lớp đúng số lượng. Bộ lọc lớp ngoài nhóm/kỳ bị từ chối.
- Nhóm Dự án đã **kích hoạt trên staging** với lịch Khoa xác nhận theo V1 và tuần 1 bắt đầu 07/09/2026. Nhóm Thực tập cũ không bị thay đổi. Nội dung kế hoạch, hướng dẫn, FAQ dùng chung cả tám lớp.

Nguồn Excel đã đối soát nằm trong `outputs/project-reconciliation-20261029-confirmed/`. Báo cáo nhập và các export kiểm chứng ở `.staging/academic-LCsr6X/acceptance-20261029/`; backup trước nhập nằm cùng thư mục. Báo cáo chuẩn bị ban đầu `report.json` giữ nguyên ý nghĩa lịch sử; trạng thái nhập hiện tại xem `acceptance-20261029/admission-report.json`.

Đã diễn tập thêm trên **bản sao riêng** của dữ liệu vừa nhập, không đưa điểm/file giả vào staging chính: 13 kiểm tra gồm phân quyền nháp, chia GVNX, nộp PDF, điểm 60/40, ẩn điểm SV, khóa/mở lại, hai hồ sơ độc lập, chat và lưu trữ nhóm. Phương án GVNX trong bản sao có **408 phân công dự kiến** (405 cùng đơn vị, 3 khác đơn vị); **127 chưa phân công vì thiếu GVHD**. **Sau nghiệm thu đã áp dụng trên staging chính:** 408 GVNX, 127 hồ sơ thiếu GVHD vẫn chưa gán. Chạy lại chỉ còn 127 hồ sơ chưa có GVHD, không đổi người đã gán. Đã tạo 69 tài khoản giảng viên thử từ danh mục để dùng route đăng nhập local; không dùng Google OAuth thật và không gửi email. Xem `acceptance-20261029/rehearsal-report.json`.

### Lịch đã chốt trên staging

Giờ Việt Nam (UTC+7); bộ bài theo tuần 15, chấm tuần 15–16. Tuần 16 là 21–27/12/2026, ký danh sách thi theo thông báo cụ thể của Khoa.

| Nội dung | Mở | Đóng |
| --- | --- | --- |
| Khai/sửa đề tài | 07/09/2026 00:00 | 20/12/2026 23:59:59 |
| Nộp PDF + slide/video | 14/12/2026 00:00 | 20/12/2026 23:59:59 |
| GVHD/GVNX nhập, sửa điểm | 14/12/2026 00:00 | 27/12/2026 23:59:59 |

Đã kiểm tra tài khoản SV học hai môn chỉ thấy hai hồ sơ, không nhận điểm; GV chỉ xem hồ sơ được phân công. Nộp bài/chấm trước 14/12 bị API từ chối; không có bài/điểm giả trên staging chính. Chi tiết tại `acceptance-20261029/activation-report.json` và `live-role-report.json`. Danh sách 127 hồ sơ cần bổ sung GVHD cùng phân công GVNX đã xuất trong `outputs/project-reconciliation-20261029-confirmed/`.

## Kiểm thử và bước sau local

```bash
npm run test:staging
npm run test:academic
npm run test:academic:ui
npm run lint
npm run build
```

Đã có 11 kiểm thử staging cho sao lưu/đối soát, WAL, nguồn bị từ chối, health/ready, cron, cấu hình và email chuyển về hộp thư thử. Kiểm thử email dùng transport giả, không gửi email thật.

Khi chuyển sang staging HTTPS, dùng database/bucket/Google OAuth riêng và `APP_ENV=staging`, `NODE_ENV=production`. Entry point kiểm tra cấu hình staging trước khi khởi tạo DB; không chấp nhận ID database/bucket production mặc định đã biết. Email mặc định `none`; nếu bật provider, bắt buộc `STAGING_EMAIL_RECIPIENT`, toàn bộ thư chuyển đến hộp thư đó và bỏ CC. Tác vụ định kỳ vẫn tắt trừ khi đặt `STAGING_RUN_JOBS=true`. Health check triển khai có thể dùng `/api/ready` theo [hướng dẫn health check của Render](https://render.com/docs/health-checks).

Chưa tạo tài nguyên cloud hoặc deploy trong bước chuẩn bị local này. Dừng server bằng Ctrl+C; giữ thư mục staging để xem lại. Không phục hồi `before.db` đè lên database đang có ghi mới nếu chưa đối soát thay đổi phát sinh.

Sau bước local, Khoa đã chọn triển khai trên production hiện có. Đã sao lưu Turso/R2 và diễn tập với dữ liệu thật; xem [PRODUCTION_RELEASE.md](PRODUCTION_RELEASE.md). Kết quả local trong tài liệu này giữ phạm vi của riêng bản sao.

## Duyệt đề tài Dự án

Bản sao chuẩn bị mới chạy cả chuyển đổi metadata schema v3. Dùng `academic:topics-preview` trên file nguồn trước khi tạo bản sao để đối chiếu số đề tài được công nhận. Nghiệm thu SV gửi Pending, GVHD chính duyệt/sửa và nộp lại theo đề tài mới trên bản sao, không dùng tài khoản thử trên production. Quy tắc và API tại [TOPIC_APPROVAL.md](TOPIC_APPROVAL.md).

## Nghiệm thu tải dữ liệu và cache

Áp dụng [PERFORMANCE.md](PERFORMANCE.md) trên bản sao có 535 hồ sơ Dự án và nguồn Thực tập cũ. Kiểm tra Network: Tổng quan/Kế hoạch/Thiết lập không gọi danh sách hoặc PDF; danh sách chỉ lấy 25 dòng; quay lại nhận 304; F5 và Tải lại nhận JSON mới. Export phải đủ các trang và đúng bộ lọc. Mở hai tab cùng tài khoản để kiểm tra lưu ở tab này cập nhật màn đang mở ở tab kia; đổi vai trò/nhóm hoặc bị thu hồi quyền không nhận dữ liệu cũ. Không gửi email thật trong nghiệm thu local.

## Nghiệm thu Danh sách sinh viên Dự án

Trước chuẩn bị staging mới, chạy `npm run academic:membership -- --database=file:/absolute/path/copy.db` để đối soát status. Nếu có withdrawn, dừng và xuất danh sách để Khoa quyết định; không tự tiếp nhận lại. `--apply` sao lưu rồi chuyển metadata trên bản sao; nguồn production và R2 không được dùng cho thao tác thử. Readiness hiện yêu cầu schema 4.

Kiểm thử lưu nhiều dòng có lỗi/revision xung đột và phân công cuối/quota; chuyển nhóm khi còn nháp; mở PDF theo phiên bản; export vượt trang; xóa một trong hai hồ sơ DACN/DAKH với bài/điểm/chat; R2 lỗi/retry; token cũ mất quyền; tệp dùng chung còn nguyên. Đối soát cả 208 hồ sơ legacy chưa ánh xạ và bảo toàn dữ liệu TT. `ACADEMIC_PREVIEW_PORT` cho phép chạy bộ UI test ở cổng khác khi có phiên làm việc song song. [Chi tiết API và tiêu chí](PROJECT_STUDENT_LIST.md).

## Đính chính nguồn STT

Các số 535 lần học/532 sinh viên ở các lần diễn tập trên là số trước khi bổ sung điều kiện STT. Nguồn chính thức chỉ gồm dòng có STT của `DACN`, `DAKH`: 215 + 193 = **408 lần học / 405 sinh viên**, phân bổ DACN 44/51/60/60 và DAKH 50/58/47/38. File đã đối soát giữ nguyên STT gốc và MSSV 23021527 đã được Khoa xác nhận. Import lại phải preview cùng điều kiện này, không biến dòng trắng STT thành thành viên.
