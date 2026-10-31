# Danh sách sinh viên Dự án

Áp dụng cho Khoa và giảng viên trong campaign Dự án; Thực tập và trang cá nhân sinh viên giữ quy trình riêng. Đây là thay đổi kế tiếp sau [khôi phục giao diện](UI_RESTORATION.md) và [duyệt đề tài](TOPIC_APPROVAL.md).

## Yêu cầu và nghiệm thu

| Mã | Vai trò / điều kiện | Hành vi và tiêu chí nghiệm thu |
| --- | --- | --- |
| REQ-LST-01 | Khoa/GV mở Dự án | Hai mục **Danh sách sinh viên** và **Chấm điểm**, một dòng/lần học; không còn Tư cách, cột Thao tác hoặc cửa sổ hồ sơ tổng quát. DACN/DAKH của cùng SV vẫn là hai dòng. |
| REQ-LST-02 | Người có quyền sửa ô | Đề tài, phân công và phản hồi sửa tại dòng Danh sách, chỉ ghi khi Lưu thay đổi. Điểm/nhận xét, khóa/mở lại thuộc Chấm điểm; lưu riêng sinh viên đang chọn. Chỉ đúng GVHD/GVNX nhập điểm; đồng HD chỉ xem bài, không xem điểm. |
| REQ-LST-03 | Có bản nháp | RAM giữ bản gốc và expectedRevision. Lưu các dòng hợp lệ; một dòng lỗi không lưu một phần, giữ bản nháp và đánh dấu lỗi. Chuyển trang/lọc/chức năng/nhóm/vai trò phải chọn Lưu, Bỏ hoặc Ở lại. Tải lại dữ liệu không ghi đè bản nháp. |
| REQ-LST-04 | Lọc/xuất | Học phần, lớp, GV, đề tài, phân công, bài và điểm là các bộ lọc riêng. XLSX dùng cùng điều kiện và đủ các trang; vẫn có xuất chuyên biệt. Không xuất Tư cách cho Dự án. |
| REQ-LST-05 | Khoa phân công GVNX | Nút Phân công mở quy trình xem trước/xác nhận; phải lưu hoặc bỏ bản nháp bảng trước. Không phân công khi chỉ mở trang/import/tải lại. |
| REQ-DEL-01 | Khoa/Admin, nhóm đang hoạt động | Chọn 1–100 lần học, xem trước MSSV/lớp/số phiên bản/điểm/tệp/chat riêng, nhập lý do và xác nhận một lần. Nhóm lưu trữ phải mở lại trước. Xung đột revision yêu cầu xem trước lại. |
| REQ-DEL-02 | Áp dụng xóa | Xóa lần học, đề tài, phân công, bài/điểm mọi phiên bản, chat riêng/dấu đọc và các bản sao liên quan trong audit/import preview; hủy thông báo/hàng đợi của lần học. Giữ tài khoản, các lần học khác, chat nhóm và lịch sử của chúng. Chỉ giữ audit tối thiểu người/thời điểm/ID/lý do xóa. |
| REQ-DEL-03 | Xóa có tệp | Xóa DB và ghi hàng đợi tệp trong một giao dịch; thu hồi quyền ngay. R2 lỗi giữ trạng thái đang xử lý và thử lại. Chỉ hoàn tất khi hàng đợi hết; tệp còn được tham chiếu trong lần học/chat nhóm/Thực tập được giữ. |
| REQ-DEL-04 | Sau xóa | JWT còn hạn không cấp lại quyền đã mất; nếu vẫn học DAKH thì quyền DAKH còn nguyên. Import lại tạo ID mới, không phục hồi bài/điểm cũ. Không tự xóa khi SV vắng file import. |
| REQ-LST-MIG | Trước khởi động bản mới | Preview, backup, bỏ status khỏi JSON Dự án; nếu có withdrawn thì dừng để đối soát. Không đổi đề tài/phân công/điểm/phiên bản/file; TT giữ status. Chạy lại không tăng revision hoặc tạo trùng. |

## Giao diện và dữ liệu

Các cột Danh sách: Sinh viên; Học phần/lớp; Đề tài; GVHD/Đồng HD; GVNX; Bài nộp. Bảng Chấm điểm riêng có bài nộp, GVHD/GVNX, hai phần điểm, tổng kết và trạng thái khóa. GV thấy vai trò của mình, chỉ thấy phần điểm được phép xem. Mobile cuộn bên trong bảng; chiều rộng trang giữ nguyên.

PDF chỉ tải khi bấm Xem PDF; cửa sổ riêng hỗ trợ chọn phiên bản và cache có kiểm quyền. Không dùng dữ liệu lịch sử cho bảng phân trang. Các URL `tab=assignments|reports` chuyển về `tab=students`, chuyển bộ lọc trạng thái phù hợp. `tab=grades` giữ màn Chấm điểm; `panel=grades` cũ cũng chuyển tới đó. `enrollmentId` định vị dòng hoặc sinh viên đang chấm. Nếu không chỉ định page, backend tìm trang chứa dòng trong chính phạm vi/bộ lọc đang có.

`ProjectStudentList` giữ bản nháp theo instance tài khoản/vai trò/campaign và Enrollment. `CampaignWorkspace` tải `projection=students` cho Danh sách (không có đánh giá/điểm số), `projection=grades` cho Chấm điểm. `student-list` giữ cho tương thích và xuất tổng hợp. Khung điều hướng, tìm kiếm 300 ms, ETag, export theo bộ lọc và cache RAM tiếp tục dùng cơ chế hiện có. Bảng không gắn handler mở hồ sơ vào tên SV.

## API và giao dịch

| API | Hợp đồng |
| --- | --- |
| `GET /api/campaigns/:campaignId/enrollments?projection=student-list` | SQL lọc quyền/phân trang; chỉ phiên bản hiện hành và đánh giá hiện hành được phép xem. Các bộ lọc bổ sung: `assignmentStatus`, `submissionStatus`, `gradeStatus`; `topicStatus` độc lập. |
| `PATCH /api/campaigns/:campaignId/enrollments/bulk` | `{rows:[{enrollmentId,expectedRevision,assignments?,topic?,grades?,review?,gradeLock?,reopen?}]}`; 1–25 dòng. Trả `results` theo ID, `ok`, DTO đã lưu hoặc lỗi code/message/field. |
| `GET /api/campaigns/:campaignId/exports/student-list.xlsx` | Tổng hợp theo cùng bộ lọc, đủ mọi trang; các export students/assignments/reports/grades vẫn có. |
| `POST /api/campaigns/:campaignId/deletions/preview` | `{enrollmentIds}`; trả preview thuộc người tạo, hạn dùng và thống kê. |
| `POST /api/campaigns/:campaignId/deletions/:previewId/apply` | `{reason}`; kiểm lại quyền, trạng thái campaign, revision preview và từng lần học. Retry cùng preview trả job cũ. |
| `GET /api/campaigns/:campaignId/deletions/:jobId` | `status=files_pending|complete`, `pendingFiles`, `enrollmentIds`. Chỉ Khoa/Admin. |
| `POST /api/campaigns/:campaignId/deletions/:jobId/retry` | Thử lại hàng đợi rồi trả trạng thái; không khôi phục lần học. |

Bulk tái sử dụng các hàm kiểm tra đề tài, phân công, điểm, thời hạn và khóa. Mỗi dòng được thử trên bản sao độc lập, tính quota/pool theo phân công cuối của các dòng hợp lệ; dòng bị loại không giải phóng quota. Ghi tất cả dòng đạt bằng một command/CAS. Writer đồng thời làm tải lại snapshot và kiểm lại revision; không ghi đè dữ liệu mới.

Schema **4** dùng JSON Enrollment hiện có, bỏ riêng status Dự án. Trigger command đồng thời xóa dữ liệu và ghi `academic_file_cleanup`; `academic_deletions` giữ audit tối thiểu. Dữ liệu nhạy cảm của lần học bị xóa được loại khỏi command lịch sử, và command xóa không giữ lại payload trước/sau hoặc khóa tệp. Worker chạy lúc startup và mỗi 60 giây, tối đa 100 tệp/lượt; lỗi giữ số lần thử để tiếp tục ở lần khởi động sau. Không có cấu hình R2 ở production được coi là lỗi xóa, không báo hoàn tất giả.

## Chuyển đổi và phát hành

```sh
npm run academic:membership -- --database=file:/absolute/path/copy.db
npm run academic:membership -- --database=file:/absolute/path/copy.db --apply
```

Dry-run không ghi; apply chỉ nhận bản sao local và tự tạo backup cùng báo cáo. Có thể preview Turso hoặc D1 bằng `--env-file=/absolute/path/private.env` với provider tường minh khi database hoạt động; công cụ không hỗ trợ apply remote. Backend khởi động chuyển metadata trước khi readiness schema 4 thành công. Sao lưu production mới và đối soát preview trước khi cho Render tự deploy; sau đó chờ đúng commit/schema rồi phát hành Pages theo [PRODUCTION_RELEASE.md](PRODUCTION_RELEASE.md).

Nếu provider hiện hành bị chặn vì quota, dừng các probe/backup lặp, hoàn tất kiểm thử local và giữ thay đổi trên nhánh riêng. Không push main tự deploy hoặc tuyên bố nghiệm thu production khi chưa lấy được backup/kiểm tra database. Migration không tự xóa bất kỳ lần học thật nào; backup cũ giữ theo chính sách vận hành và không dùng để tự khôi phục lần học đã xóa.

Bản tích hợp giữ các cập nhật giao diện trên main và quy tắc STT trong [REQUIREMENTS.md](REQUIREMENTS.md#đính-chính-danh-sách-dự-án-theo-stt). Việc loại 127 hồ sơ trống ngoài danh sách là tác vụ đối soát riêng đã được Khoa xác nhận, không nằm trong migration hoặc import thường. Nếu phát hành cùng đợt: backup và preview membership trước deploy; sau khi metadata schema 4 hoàn tất phải tạo lại preview STT theo revision mới rồi mới áp dụng. Danh sách cuối là 408 lần học/405 sinh viên; Thực tập và R2 được giữ nguyên.


## Trạng thái phát hành

Đã phát hành production ngày **30/10/2026** ở bản ứng dụng `68d9548`, Render/D1 schema **4** và Pages cùng phiên bản. Đã kiểm tra giao diện Khoa/GV desktop/mobile không còn Tư cách/Thao tác/Mở hồ sơ, quyền đọc, ETag, export tám lớp và bảo toàn dữ liệu. Hiệu chỉnh STT riêng đã hoàn tất: **408 lần học / 405 SV**; xem [D1_FAILOVER.md](D1_FAILOVER.md#đã-áp-dụng-ngày-30102026). Nút xóa hàng loạt được nghiệm thu trên bản sao local có dữ liệu và lỗi tệp/retry; không xóa hồ sơ có bài/điểm thật để thử production.


## Chấm điểm riêng và thêm sinh viên — 31/10/2026

| Mã | Vai trò / điều kiện | Hành vi và nghiệm thu |
| --- | --- | --- |
| REQ-GUI-GRADE-01 | Khoa/GV, chỉ Dự án | Chấm điểm là chức năng riêng; chọn SV mới tải chi tiết và PDF. Desktop PDF cạnh biểu mẫu; mobile Báo cáo/Đánh giá. Có phiên bản cũ chỉ đọc, slide/video, Trước/Sau theo lọc. |
| REQ-GUI-GRADE-02 | GV đúng phân công, trong hạn | Lưu điểm hoặc Lưu & tiếp theo; không tự lưu. Chuyển SV/lọc/màn/nhóm khi còn nháp phải lưu/bỏ/ở lại. Xung đột giữ nháp, yêu cầu tải lại; không chấm bản cũ, ngoại lệ 0 có lý do giữ nguyên. |
| REQ-GUI-GRADE-03 | Khoa | Tiến độ GVHD/GVNX tính toàn bộ kết quả lọc ở SQL, không đếm riêng trang. Xuất đủ bảng điểm; khóa/mở lại ở chức năng chấm. Không có phân công thì chỉ theo dõi/quản trị, không nhập thay điểm. |
| REQ-MANUAL-01 | Khoa, nhóm draft/active đã chuyển đổi | Nút Thêm sinh viên: MSSV 8 chữ số, họ tên, lớp học phần bắt buộc; ngày sinh/lớp khóa học tùy chọn. Lookup theo MSSV; dùng thông tin người cũ chỉ đọc hoặc tạo người mới. |
| REQ-MANUAL-02 | Xác nhận thêm | Tài khoản và enrollment được ghi cùng command/CAS. Trùng MSSV+lớp, sai phạm vi/identity hoặc thay đổi đồng thời không ghi một phần. Không upsert/sửa tài khoản dùng chung; người mới có legacy_internship_access=0. |
| REQ-MANUAL-03 | Sau thêm | Không có đề tài, GVHD/GVNX, bài/điểm; không tự phân công hoặc chuyển lớp. DACN/DAKH độc lập. Xóa rồi tiếp nhận lại tạo ID mới, không phục hồi nội dung cũ. |

`GET /api/admin/campaigns/:campaignId/student-lookup?studentId=…` trả `{revision,found,student,enrollments}` trong phạm vi Khoa. Không tải toàn danh mục. `POST /api/admin/campaigns/:campaignId/enrollments` nhận `{expectedRevision,studentId,classId,name,dob?,className?}` và trả `{enrollment,createdAccount}`. Revision ở đây là revision học vụ từ lookup, không phải revision lớp. Người cũ lấy thông tin hiện hành từ tài khoản, bỏ qua các trường tên/ngày sinh/lớp do client gửi.

Guard `academic_project_admission_guard` kiểm lại trạng thái/revision campaign, lớp và identity ngay trước command. Ghi dùng trigger/CAS hiện có, không thêm bảng hay chuyển đổi dữ liệu nghiệp vụ; schema readiness vẫn là 4. Guard lỗi và lỗi constraint phải rollback cả account/enrollment/audit. Projection `grades` thêm `gradingSummary={advisorSubmitted,reviewerSubmitted,completed,locked}` tính trên cùng điều kiện lọc; chỉ các hồ sơ có quyền xem điểm được cộng.

GET/PUT đánh giá theo enrollment/version được tái sử dụng. Cache, SQL phân trang, ETag, quota đọc và tiêu chí đo theo [PERFORMANCE.md](PERFORMANCE.md) tiếp tục áp dụng; không tải trang tiếp theo/PDF trước khi cần.
