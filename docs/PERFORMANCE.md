# Tải dữ liệu theo chức năng và cache trong phiên

Áp dụng cho giao diện Học kỳ → Nhóm môn của cả Thực tập và Dự án. Không đổi schema, công thức điểm, duyệt đề tài, hạn thao tác hay tệp R2.

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

`server/academic/reads.ts` tách luồng đọc khỏi snapshot CAS dành cho thao tác ghi. Dự án không hydrate hồ sơ Thực tập. Danh mục, tổng quan và chi tiết một hồ sơ Dự án dùng một lệnh DB cho read model; danh sách và export dùng hai lệnh, chưa tính một truy vấn xác thực. Chat/hỏi đáp dùng roster giới hạn phạm vi, không lấy lịch sử bài nộp hoặc điểm.

Các GET legacy đăng ký, nơi thực tập, phân công, đề xuất, báo cáo, bảng điểm và danh sách GV phụ trách hỗ trợ `pagination=1&page=1&limit=25`. Trả `{items,total,studentCount,page,limit,totalPages,summary}`; phân công có thêm danh mục GV. `limit` tối đa 100. Hỗ trợ bộ lọc học phần/lớp/GV, `q`, trạng thái và sắp xếp tương ứng màn. Không có `pagination=1` vẫn trả mảng/đối tượng cũ. Mã `INT4002` khớp tên học phần đầy đủ. API phân trang không tự phân công hoặc backfill khi đọc; các thao tác quản trị ghi giữ API riêng. GET bảng điểm không UPDATE dữ liệu; chuẩn hóa tên/điểm hiển thị tại DTO.

ETag SHA-256 dựa trên vai trò/tài khoản và JSON hiện hành sau kiểm quyền, gồm dữ liệu nguồn legacy mới nhất; không chỉ dựa revision học vụ. Header `Cache-Control: private, no-cache`, `Vary: Authorization`; CORS công khai `ETag`, `Server-Timing`, `Content-Disposition` cho frontend đọc.

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

Phát hành theo [PRODUCTION_RELEASE.md](PRODUCTION_RELEASE.md): backup, kiểm thử bản sao, push `main`, chờ Render đúng SHA/schema 3 rồi mới publish Pages. Không có chuyển đổi nghiệp vụ cho thay đổi này; đối chiếu bảng nghiệp vụ và tệp sau phát hành.
