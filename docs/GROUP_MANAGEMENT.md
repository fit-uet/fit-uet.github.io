# Quản lý theo học kỳ và nhóm môn

Đơn vị vận hành là **học kỳ → nhóm môn**, gồm Thực tập và Dự án. Trong một nhóm có nhiều học phần/lớp; mỗi sinh viên vẫn có lần học độc lập theo lớp. Dự án công nghệ và Dự án khoa học cùng thuộc nhóm Dự án trong kỳ.

## Cách sử dụng

1. Sau đăng nhập, chọn học kỳ và mở nhóm Thực tập hoặc Dự án. Lựa chọn nhóm/kỳ được giữ khi chuyển chức năng. Các URL lớp cũ chuyển đến nhóm với bộ lọc lớp tương ứng.
2. Khoa dùng Tổng quan, Sinh viên, Phân công, Báo cáo, Bảng điểm, Thông báo và Thiết lập. Nhóm TT có thêm Đăng ký/Nơi thực tập. Danh mục người dùng, GV và DN vẫn dùng chung toàn hệ thống.
3. Mặc định xem toàn nhóm; lọc học phần, lớp học phần, GV và trạng thái khi cần. Danh sách phân trang ở server. XLSX lấy toàn bộ kết quả được quyền xem theo bộ lọc, không chỉ trang đang mở.
4. Thiết lập hạn, kế hoạch Markdown/import Word, quy định TT, hướng dẫn, FAQ và thông báo hoàn tất một lần cho nhóm. Kích hoạt/lưu trữ/mở lại toàn nhóm; không còn thiết lập riêng từng lớp.
5. GV chỉ thấy hồ sơ được phân công trong nhóm. SV chọn hồ sơ DACN/DAKH hoặc TT của mình, không nhận điểm qua API. Một SV học cả DACN/DAKH được tính một người và hai lần học; đề tài, bài, phân công, điểm không gộp.

Thực tập Hè 2025–2026 mở trong cùng giao diện. Các màn đăng ký/xác nhận/phân công/báo cáo/điểm cũ được giữ qua adapter và dùng nguồn dữ liệu gốc. Bộ lọc lớp legacy tương ứng học phần TT đã ánh xạ; không bịa số lớp đào tạo. Các tác vụ đề xuất/quota GVHD nằm trong mục Phân công. Các hồ sơ thiếu/mơ hồ mã môn vẫn cần đối soát trước ánh xạ.

Chat nhóm gộp theo **nhóm môn + học kỳ + GVHD**, dù SV học ở nhiều lớp. Chat riêng theo lần học. Bộ lọc lớp trên danh sách không thay đổi thành viên nhóm chat; nhãn chat cho biết phạm vi toàn nhóm. Lịch sử, thời gian, file và dấu đọc được giữ; khi dung lượng lịch sử vượt quota, vẫn đọc/gửi chữ được và chỉ chặn file mới. Rút hết lớp được hướng dẫn hoặc thay phân công thu hồi quyền tương ứng.

## Dữ liệu và API

`CourseCampaign` có id, semesterId, group, status, settings, revision, legacy. Bảng `academic_campaigns` unique theo semester/group. Mỗi lớp có campaignId; status/settings trong DTO lớp là giá trị kế thừa. Native settings ghi ở campaign; cấu hình TT legacy đọc/ghi các key gốc như implementation_plan_md để API cũ và mới cùng nguồn. Schema academic phiên bản **2** dùng command trigger v2 cho campaign và các ghi nghiệp vụ nguyên tử.

| API | Hành vi |
| --- | --- |
| `GET /api/me/campaigns` | Nhóm/kỳ được truy cập và metadata đã lọc vai trò |
| `GET /api/campaigns/:id` | Tổng quan, lớp được phép, giảng viên, quota, số người và lần học |
| `GET /api/campaigns/:id/enrollments` | Bộ lọc courseCode/classId/lecturerId/status/q và page/limit; trả items,total,studentCount,page,limit,totalPages |
| `PATCH /api/admin/campaigns/:id` | Đổi trạng thái có revision, lý do khi lưu trữ/mở lại |
| `PUT /api/admin/campaigns/:id/settings` | Lưu cấu hình chung, có expectedRevision |
| `GET /api/campaigns/:id/exports/:dataset.xlsx` | students, assignments, reports, grades; registrations/final-internships chỉ TT |
| `PUT /api/admin/campaigns/:id/grade-locks` | Khóa/mở theo bộ lọc; bỏ qua hồ sơ chưa đủ điểm |
| `POST /api/admin/campaigns/:id/internship/auto-advisors` | Tự phân công TT mới; quota tính cả nhóm trong kỳ |
| `GET/POST /api/campaigns/:id/questions` | Câu hỏi chung; câu chưa trả lời chỉ người hỏi và Khoa thấy |
| `PUT /api/admin/campaigns/:id/questions/:questionId` | Khoa trả lời, kiểm revision |
| `POST /api/admin/campaigns/:id/announcements/preview` | Xem trước nội dung và danh sách người nhận toàn nhóm hoặc lớp/học phần; khử trùng email |
| `POST /api/admin/announcement-previews/:previewId/apply` | Kiểm lại người nhận/revision, gửi đúng bản đã xem, xác nhận lặp an toàn |
| `POST /api/admin/campaigns/:id/announcements` | API gửi trực tiếp tương thích; vẫn kiểm phạm vi/quyền và tư cách trước giao thư |

API đề tài/bài nộp/điểm tiếp tục theo enrollmentId. Bộ lọc lớp/học phần ngoài nhóm/kỳ bị từ chối. SV không được xuất danh sách quản lý; GV chỉ xuất phần được phân công, đồng HD không được xuất điểm. Công thức 20/20/60 và 60/40, điểm 0/thiếu điểm, khóa và phiên bản được giữ.

Các endpoint chat theo lớp được giữ tương thích: chat nhóm truy vấn hợp nhất các lớp thuộc campaign; chat riêng vẫn kiểm tra đúng enrollment. File cũ giữ nguyên key. Cache PDF được xóa khi đổi nhóm/kỳ hoặc đăng xuất; mỗi lần lấy lại file đều kiểm quyền. Tin nhắn Thực tập cũ đọc và ghi ở bảng nguồn; tin nhắn native cũ hợp nhất bằng scope khi đọc, không nhân bản ID/dấu đọc.

## Chuyển đổi từ cấu hình riêng từng lớp

Trên UI, Khoa xem trước → chọn cấu hình/trạng thái khi có xung đột → kiểm tra lại → áp dụng. Các nhóm chưa chuyển chỉ Khoa được xử lý, chưa cấp thao tác SV/GV. Nếu cấu hình/trạng thái trùng nhau, chuyển nguyên giá trị chung. Không chọn ngầm một lớp làm chuẩn khi khác nhau. Chuyển đổi giữ nguyên lần học, phân công, phiên bản, điểm và key file.

CLI chỉ nhận SQLite local, yêu cầu Node 22.16+, mặc định dry-run trên bản sao tạm; file chỉ định không thay đổi:

```bash
npm run academic:campaign-migrate -- --database=file:/path/staging.db

# Dừng server ghi vào bản sao, xem trước/giải quyết xung đột rồi áp dụng.
npm run academic:campaign-migrate -- --database=file:/path/staging.db --apply
```

`--apply` tạo backup nhất quán bằng SQLite backup API trước khi thêm schema v2 và chuyển cấu hình. Nếu có xung đột, chưa công bố campaign đã giải quyết một phần; DB giữ trạng thái chờ Khoa xử lý. Có thể dùng `--resolutions=/path/choices.json`, ví dụ:

```json
{
  "2026-2027-1:project": {
    "sourceClassId": "id-lop-duoc-khoa-chon",
    "status": "active"
  }
}
```

Có thể cung cấp settings đầy đủ thay sourceClassId. Chạy lại không nhân bản nhóm/lần học, không tạo lại email hoặc hội thoại. Endpoint sửa trạng thái/cấu hình từng lớp trả `CAMPAIGN_CONTEXT_REQUIRED` và campaignId để chuyển caller sang phạm vi mới.

Bản staging hiện có tại `.staging/academic-LCsr6X` đã được sao lưu và chuyển **một nhóm TT legacy**; thêm ba nhóm còn thiếu cho các học kỳ có trong bản sao. Đã đối soát và nhập danh sách Dự án trên staging: 535 lần học / 532 SV / tám lớp, 97 GV; 408 hồ sơ có GVHD, 127 chưa có GVHD. Nhóm Dự án đã kích hoạt trên staging; khai/sửa đề tài 07/09–20/12, nộp bộ bài 14–20/12, chấm 14–27/12/2026 (giờ Việt Nam). Đã gán 408 GVNX, 127 hồ sơ chưa có GVHD được giữ chưa phân công. Nghiệm thu nộp/chấm/GVNX được thực hiện trên bản sao riêng; không ghi điểm/file giả vào staging chính. Mở [Khoa local](http://127.0.0.1:4319/__local_staging/login); quy trình chạy lại ở [LOCAL_STAGING.md](LOCAL_STAGING.md). Ngày 29/10/2026 đã tiếp nhận dữ liệu vào Turso vận hành sau backup/diễn tập riêng; xem [quy trình phát hành](PRODUCTION_RELEASE.md).

## Nghiệm thu

Backend kiểm tra 45 kiểm thử học vụ bao phủ tám lớp cùng nhóm, một người/hai lần học, cấu hình/lưu trữ chung, độc lập nhóm/kỳ, lọc sai lớp, export hơn 25 dòng, quyền chấm/ẩn điểm, xung đột/idempotency migration, chat hợp nhất và lịch sử legacy. Trình duyệt kiểm tra tạo nhóm/lớp, nộp/chấm/khóa/mở lại, mobile, FAQ/thông báo, xuất XLSX đúng lớp, chọn hai hồ sơ và chat xuyên lớp cùng GVHD.

Tiếp tục dùng các lệnh `test:academic`, `test:academic:ui`, `test:academic:d1`, `test:staging`, `lint` và `build`. Cần đối soát bản sao dữ liệu production trước khi nghiệm thu vận hành thực tế; database local gốc hiện trống hồ sơ TT.
