# Tải dữ liệu theo chức năng và cache trong phiên

Áp dụng cho giao diện Học kỳ → Nhóm môn của cả Thực tập và Dự án. Không đổi dữ liệu nghiệp vụ, công thức điểm, duyệt đề tài, hạn thao tác hay tệp R2. Bổ sung chỉ mục kỹ thuật khi cần để giới hạn lượng đọc.

## Tải theo nhu cầu

- Trang chọn nhóm chỉ lấy danh mục tối thiểu. Tổng quan chỉ lấy thống kê; Kế hoạch/Thiết lập không gọi danh sách hoặc hồ sơ.
- Các danh sách lấy trang hiện tại, mặc định 25 dòng. Chọn hồ sơ mới lấy chi tiết và toàn bộ lịch sử; mở viewer mới lấy PDF.
- Import, chat, FAQ, thiết lập và các màn legacy nạp module khi mở. SheetJS, Mammoth/Turndown và JSZip nạp khi thực hiện thao tác tương ứng.
- Tìm kiếm chờ 300 ms sau lần gõ cuối. Request rời màn được hủy; phản hồi cũ không ghi đè phạm vi mới.
- Export không tải lại nhóm; XLSX/ZIP lấy toàn bộ kết quả theo bộ lọc, không giới hạn ở trang hiển thị. Danh sách người nhận nhắc báo cáo chỉ lấy đầy đủ khi mở hộp thoại.
- Header gọi `/api/me/unread-counts` thay vì tải nội dung thông báo và hội thoại. Giữ chu kỳ 180 giây, bỏ qua khi tab ẩn; khi quay lại, kiểm tra theo nhịp hiện có.

## Cache JSON dùng chung

`src/shared/utils/requestCache.ts` là cache RAM của các API học vụ và màn legacy. Không ghi dữ liệu nghiệp vụ vào localStorage; dữ liệu cache JSON cũ được dọn khỏi localStorage. F5 tạo RAM mới; đăng xuất/xác thực hết hạn xóa cache.

Khóa gồm token phiên, chế độ vai trò khi áp dụng, URL chuẩn hóa, campaign/enrollment, chức năng, bộ lọc và trang. Tối đa **100 mục hoặc 20 MiB**; loại mục ít dùng trước. Mục không dùng quá **5 phút** bị dọn khi truy cập cache tiếp theo.

Mỗi lần mở lại chức năng hoặc quay về tab trình duyệt đều xác thực lại với server bằng `If-None-Match`. Backend kiểm tra tài khoản, phân công và dữ liệu hiện hành trước trả **304**; cache chỉ cung cấp JSON sau xác nhận này. `fetch` dùng `cache: no-store` để không tạo cache HTTP thay thế ngoài RAM. Lỗi mạng, 401 hoặc 403 không trả dữ liệu cũ làm fallback.

GET giống nhau đang chạy dùng chung request. Hủy một người dùng request không hủy người khác còn dùng; nếu không còn người dùng, request được hủy. Request đang đọc trùng thời điểm ghi sẽ kiểm tra lại trước trả kết quả. Nút **Tải lại** bỏ ETag/cache.

Ghi thành công vô hiệu hóa dữ liệu nhóm liên quan, danh mục hoặc số chưa đọc. `BroadcastChannel` chỉ chuyển thông tin vô hiệu hóa, không chuyển payload nghiệp vụ. Tab khác kiểm tra lại màn đang mở; tab ẩn kiểm tra khi quay lại. JSON của nhóm khác được giữ riêng. Cache PDF tiếp tục giới hạn 8 mục, kiểm quyền trước 304 và thu hồi Blob URL khi đổi nhóm/kỳ hoặc đăng xuất.

Facade `PaginatedVirtualProxy` được giữ cho nơi gọi cũ nhưng không giữ bản payload hoặc TTL riêng; cache và gộp request nằm ở lớp HTTP chung. Không tự nạp trang kế tiếp.

## API đọc

| API | Chế độ mới |
| --- | --- |
| `GET /api/me/campaigns?section=base` | Danh mục và cấu hình tối thiểu |
| `GET /api/campaigns/:id?section=base` | Khung nhóm, quyền và lớp |
| `section=overview` | Thống kê tổng hợp SQL, phân biệt SV duy nhất/lần học |
| `section=content` | Kế hoạch/hướng dẫn |
| `section=management` | Danh mục GV/quota cần cho quản lý, không gửi Markdown |
| Không có `section` | Giữ hợp đồng đầy đủ cũ |
| `GET /api/campaigns/:id/enrollments?projection=students\|assignments\|reports\|grades` | Phân quyền, lọc, đếm, sắp xếp và phân trang tại DB; chỉ DTO cần cho màn hiện tại |
| `GET /api/enrollments/:id` | Một hồ sơ và các phiên bản/đánh giá theo quyền |
| `GET /api/me/unread-counts` | `{notifications, chats}`, không có nội dung |

`server/academic/reads.ts` tách luồng đọc khỏi snapshot CAS dành cho thao tác ghi. Dự án không hydrate hồ sơ Thực tập. Danh mục, tổng quan và chi tiết một hồ sơ Dự án dùng một lệnh DB cho read model; danh sách dùng một lệnh, export dùng hai lệnh, chưa tính một truy vấn xác thực. Chat/hỏi đáp dùng roster giới hạn phạm vi, không lấy lịch sử bài nộp hoặc điểm.

Các GET legacy đăng ký, nơi thực tập, phân công, đề xuất, báo cáo, bảng điểm và danh sách GV phụ trách hỗ trợ `pagination=1&page=1&limit=25`. Trả `{items,total,studentCount,page,limit,totalPages,summary}`; phân công có thêm danh mục GV. `limit` tối đa 100. Hỗ trợ bộ lọc học phần/lớp/GV, `q`, trạng thái và sắp xếp tương ứng màn. Không có `pagination=1` vẫn trả mảng/đối tượng cũ. Mã `INT4002` khớp tên học phần đầy đủ. API phân trang không tự phân công hoặc backfill khi đọc; các thao tác quản trị ghi giữ API riêng. GET bảng điểm không UPDATE dữ liệu; chuẩn hóa tên/điểm hiển thị tại DTO.

ETag SHA-256 dựa trên vai trò/tài khoản và JSON hiện hành sau kiểm quyền, gồm dữ liệu nguồn legacy mới nhất; không chỉ dựa revision học vụ. Header `Cache-Control: private, no-cache`, `Vary: Authorization`; CORS công khai `ETag`, `Server-Timing`, `Content-Disposition` cho frontend đọc.

## Khắc phục khuếch đại lượt đọc D1 — 30/10/2026

Query Insights cho thấy nhóm truy vấn `WITH actor_input…` chiếm 92,81% thời gian SQL, đọc 152,76 triệu dòng qua 187 lần chạy trong khoảng thời gian của dashboard. Đây không phải số dòng trả về hoặc số sinh viên. Chưa xác định được toàn bộ chênh lệch giữa kế hoạch thực thi D1 production và runtime local; không dùng số đo local thay cho hóa đơn/quota thực tế.

- Materialize lớp và lần học thuộc phạm vi quyền trước khi nối nguồn legacy. Dự án dùng nhánh riêng; nhánh nối tài khoản/báo cáo/điểm legacy không có dòng đầu vào khi mở Dự án.
- `base`, `content`, danh mục nhóm và phần metadata không tham chiếu nhánh hồ sơ/bài/điểm không dùng. Một `WHERE` sai đặt sau CTE materialized không bảo đảm SQLite bỏ qua việc dựng CTE.
- Tra cứu sinh viên dùng chỉ mục `academic_enrollment_email` trên `lower(json_extract(data,'$.email'))`; mở hồ sơ dùng PK `id`. Chỉ mục mới không sửa JSON hoặc tăng revision nghiệp vụ.
- Danh sách giảng viên liên quan và tập SV legacy được phân công được tính một lần, thay vì quét lại theo từng giảng viên/lần học.
- GET metadata lạnh chỉ dùng một read model, không đọc revision trong một chuyến DB riêng. Cache backend Dự án có TTL tối đa 30 giây, hết hạn sớm tại mốc mở/đóng; khi dùng lại luôn kiểm revision và danh tính giảng viên hiện hành. Cache tách theo database/tài khoản/vai trò/phạm vi; `Cache-Control: no-cache/no-store` bỏ qua cache.
- Legacy có đường ghi ngoài revision học vụ: không dùng cache backend metadata/catalog có legacy. Thu hồi phân công phải có hiệu lực ngay; frontend vẫn revalidate ETag bình thường.
- Khi cache trang Dự án còn hợp lệ, conditional GET chỉ đọc dấu revision/danh tính rồi kiểm ETag; hết TTL phải đọc truy vấn có phạm vi. Không trả cache cũ khi database lỗi.
- JSON fetch vẫn dùng `cache: no-store` để không giữ cache HTTP của browser, đồng thời đặt rõ `Cache-Control: max-age=0` cho lượt bình thường. Nếu bỏ header này, browser tự thêm `no-cache` và vô tình bắt server bỏ cache mỗi lần revalidate. `forceRefresh` gửi `no-cache`; nút Tải lại/F5 bỏ ETag, backend đọc mới cả trang lẫn metadata. Kiểm tra header thực tế bằng Chromium, không chỉ mock fetch.

### Đo có thể chạy lại, không dùng database remote

```bash
npm run academic:profile-reads -- \
  --database=/private/verified-backup.db \
  --campaign=2026-2027-1:project \
  --baseline-ref=68d9548 --assert \
  --output=/private/read-budget-report.json
```

Công cụ mở nguồn SQLite chỉ đọc, dùng SQLite backup API để bao gồm WAL, tạo D1 workerd riêng rồi xóa bản tạm. Chỉ nhận file có sẵn; không đọc cấu hình production hoặc gọi OAuth/R2/email. Báo cáo chỉ có vai trò và số liệu tổng hợp. Baseline chỉ nhận commit đáng tin cậy trong repo, nạp mã đọc trong RAM; không đổi checkout. `--assert` kiểm giảm ít nhất 50% dòng đọc cho từng ca, danh sách/count/DTO giữ nguyên, mọi GET không ghi và revalidation không vượt 10 dòng. Khi có legacy khác nhóm, thêm 1.000 hồ sơ giả trên bản tạm để kiểm lượng đọc trang Dự án không tăng theo nguồn khác.

Trên bản sao 1.099 lần học (408 Dự án), danh sách trang đầu 25 dòng đạt: Khoa **15.692 → 6.031**, GV **13.319 → 1.087**, SV **13.045 → 212** dòng đọc; revalidation **1–2 dòng**, chưa tính một truy vấn xác thực HTTP. Đây là `meta.rows_read` của **D1 workerd local**, không phải số đo production và không phải thời gian người dùng chờ mạng/Render cold start.

### Theo dõi trên Render

D1 adapter cộng `meta.rows_read`, `rows_written`, `duration` cho mọi statement có metadata do D1 trả về, kể cả batch. Mỗi request API có số liệu ghi một dòng `[database-request]`: method, mẫu route, vai trò, HTTP status, số query, tổng rowsRead/rowsWritten/durationMs và ba fingerprint đọc nhiều nhất. Không ghi SQL, tham số, MSSV, email, token hoặc ID học phần cụ thể. Truy vấn ngoài request đọc từ 10.000 dòng được ghi `[database-query]` để phát hiện tác vụ nền tốn quota. Việc thu thập không phát sinh truy vấn DB; lỗi bị D1 chặn trước khi trả metadata không được suy đoán số dòng.

Sau khi D1 mở lại, deploy backend đúng SHA rồi kiểm một vòng nhỏ ba vai trò: cold GET, conditional GET, force refresh và thu hồi quyền trên bản sao. Đối chiếu log thực tế với Query Insights/Row Metrics cùng cửa sổ thời gian. Không lặp export toàn bộ hoặc sao lưu/quét lại mọi bảng để đo hiệu năng. Nếu một GET Dự án vẫn đọc hàng trăm nghìn dòng, lấy SQL fingerprint và kế hoạch thực thi D1 trước khi mở rộng nghiệm thu. Chưa đánh dấu phát hành thành công khi readiness/đo production chưa đạt.

## Kiểm chứng và đo

```bash
npm run lint
npm run build
npm run test:academic
npm run test:staging
npm run test:academic:d1
npm run test:academic:ui
```

Nghiệm thu trên bản sao production theo [LOCAL_STAGING.md](LOCAL_STAGING.md); đặt `ACADEMIC_ACCEPTANCE_BASE` là địa chỉ loopback, cùng `ACADEMIC_ACCEPTANCE_LECTURER` và `ACADEMIC_ACCEPTANCE_STUDENT` để chạy ba ca dữ liệu thật. Không chạy API ghi thử trên production.

Các ca mới bao phủ cache 304, giới hạn dung lượng/số mục, TTL, role/session/scope, hủy/gộp request, 401/403, ghi đồng thời, truy vấn SQL/phân quyền, Unicode, phân trang/export nhiều trang, tải theo màn và vô hiệu hóa giữa hai tab. Bộ hồi quy giữ duyệt đề tài, hai hồ sơ DACN/DAKH, nộp/chấm, khóa/mở lại, PDF và chat trên desktop/mobile.

Khi đo trước/sau, dùng cùng tài khoản, API/bộ lọc, máy khách và server đã hoạt động; ghi TTFB, thời gian hoàn tất, byte JSON, `Server-Timing`, số truy vấn và kích thước gzip của dependency JavaScript tải đầu. Đo thêm lần 304 không có body. Mục tiêu giảm ít nhất 50% thời gian GET đang chạy; cold start Render được ghi riêng. Báo cáo riêng và backup có dữ liệu thật phải ở thư mục bỏ qua Git.

Phát hành theo [PRODUCTION_RELEASE.md](PRODUCTION_RELEASE.md): backup, kiểm thử bản sao, push `main`, chờ Render đúng SHA/schema **4** rồi mới publish Pages. Khi D1 hết quota, giữ bản vá đã kiểm thử và hoãn deploy tới khi đọc lại được; không cố chạy migration hoặc readiness trong vòng lặp. Không có chuyển đổi nghiệp vụ cho thay đổi này; đối chiếu gọn số lượng hồ sơ/điểm/báo cáo, không ghi hoặc xóa R2.
