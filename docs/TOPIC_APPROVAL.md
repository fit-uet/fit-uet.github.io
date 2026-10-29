# Duyệt đề tài Dự án

Áp dụng DACN/DAKH theo từng `Enrollment`; Thực tập không có luồng duyệt đề tài này. SV gửi tên đề tài → **Pending · Chờ GVHD duyệt** → GVHD chính duyệt → **Đã duyệt**. Chưa khai tên là **Chưa đăng ký**.

## Quyền và phiên bản

- SV khai/sửa trong hạn đề tài hiện có. Thay tên chuyển Pending và tăng phiên bản đề tài; lưu cùng tên giữ kết quả duyệt. Đổi A → B → A vẫn là phiên bản mới.
- Chỉ GVHD chính hiện tại được duyệt hoặc **Sửa và duyệt**. Đồng hướng dẫn/GVNX chỉ xem. Tài khoản Khoa đồng thời GVHD chính có quyền của GVHD; Khoa điều chỉnh hồ sơ khác cần lý do và tên mới chuyển Pending. Không có trạng thái từ chối.
- GV duyệt/sửa từ thời điểm mở khai đề tài đến hết hạn chấm. Không dùng mốc mở chấm để trì hoãn duyệt đầu kỳ. Nhóm nháp/lưu trữ và lần học đã rút không sửa/duyệt.
- Thay GVHD chính giữ quyết định và người duyệt cũ, nhưng chỉ GVHD mới được thao tác tiếp. Hồ sơ chưa có GVHD vẫn vào lớp/khai đề tài, chờ phân công trước khi duyệt.
- Điểm đầu tiên khóa đề tài/bộ bài. Khoa phải mở lại bài theo cơ chế hiện có trước khi sửa. Mọi thao tác dùng `expectedRevision`, CAS toàn học vụ và kiểm tra phân công khi ghi.

## Nộp và chấm

API chặn nộp PDF/slide/video khi chưa duyệt, trước khi ghi R2. Bài nộp snapshot `topicVersion`. Đổi đề tài sau nộp chưa chấm giữ nguyên file/phiên bản cũ, hiện **Cần nộp lại theo đề tài mới**; SV phải xác nhận nộp lại sau khi duyệt. Có thể giữ PDF và hai liên kết hiện tại. Không ghép điểm bài cũ vào đề tài mới.

Chỉ chấm điểm khác 0 khi bài đã submitted theo phiên bản đề tài đã duyệt. Trường hợp bỏ môn/chưa có bài hợp lệ vẫn được ghi 0 với lý do, không đổi trạng thái thành submitted.

GV duyệt hoặc sửa rồi duyệt **sau hạn nộp** sẽ tự mở quyền nộp riêng hồ sơ đến `gradingCloseAt` nếu mốc này tồn tại và chưa hết. `topicSubmissionUntil` chỉ áp dụng nộp bài, không mở hạn SV sửa tên và không mở khóa điểm. Không có hạn chấm thì không tạo ngoại lệ vô thời hạn. Nếu Khoa rút ngắn hạn chấm, quyền nộp bổ sung cũng dừng theo hạn mới. Với HKI 2026–2027, hạn chấm là 27/12/2026 23:59:59 (UTC+7).

## Dữ liệu và API

- `Enrollment.topicReview`: `status` (`unregistered/pending/approved`), `version`, `updatedAt`, `source` (`legacy/advisor/null`), `approvedById`, `approvedByLecturerId`, `approvedByName`, `approvedAssignmentId`, `approvedAt`.
- `Enrollment.topicSubmissionUntil`: hạn nộp bổ sung hoặc null; độc lập `reopenUntil`. `SubmissionVersion.topicVersion` xác định phiên bản đề tài của bài.
- DTO `topicPermissions`: quyền sửa/duyệt/nộp, lý do chặn, cần nộp lại và bộ bài đủ điều kiện chấm. DTO SV tiếp tục không chứa điểm.
- `GET /api/enrollments/:enrollmentId/topic` trả tên, metadata, quyền và revision. `PUT` nhận `title`, `expectedRevision`, `reason` khi Khoa điều chỉnh; backend quyết định Pending hay tự duyệt theo vai trò thực tế.
- `POST /api/enrollments/:enrollmentId/topic/approve` nhận `expectedRevision`, duyệt chính xác đề tài hiện hành. Không tin cờ `approved` do client gửi.
- API danh sách/export campaign nhận `topicStatus`, tách khỏi `status` của lần học/điểm. XLSX Dự án thêm trạng thái/phiên bản/người duyệt/thời điểm và hạn nộp bổ sung.
- Import mới/đổi tên chuyển Pending; import cùng tên giữ duyệt. Lịch sử command lưu dữ liệu trước/sau và actor. Không tạo email tự động cho khai/duyệt/sửa đề tài.

## Chuyển đổi và phát hành

Trước nâng cấp, sao lưu database và xem trước:

```bash
npm run production:backup -- --env-file=internship-api.env --output=.staging/<release>/before.db
npm run academic:topics-preview -- --source=file:.staging/<release>/before.db --output=.staging/<release>/topics-preview.json
```

Lệnh preview chỉ đọc; có thể dùng `--env-file` thay `--source` để kiểm tra Turso trực tiếp. File có dữ liệu cá nhân, giữ private. Diễn tập `academic:stage` trên bản sao chạy đúng chuyển đổi startup.

Schema v3 bổ sung metadata trong JSON qua command nguyên tử có audit before/after, chỉ cho hồ sơ Dự án chưa có metadata. Tên có sẵn được công nhận `source=legacy`, không gán giả GV/người duyệt; tên trống là unregistered. Snapshot bài, ID, phân công, điểm và key R2 giữ nguyên. Chạy lại bỏ qua metadata đã có, kể cả sau khi SV/GV đã thao tác.

Startup hoàn tất chuyển đổi trước khi nhận request; `/api/ready` yêu cầu schema **3**. Pipeline đợi đúng SHA và schema trước khi publish Pages. Không rollback database chỉ để rollback giao diện; giữ audit để đối soát dữ liệu mới trước bất kỳ phục hồi nào.

Kiểm thử gồm trạng thái, quyền GV/Khoa, revision cũ, thay phân công, hạn và duyệt muộn, không gia hạn sửa tên, nộp lại với PDF cũ, điểm 0, migration lặp, import lặp và hai hồ sơ độc lập. Kiểm thử ghi dữ liệu dùng fixture hoặc bản sao local, không ghi đề tài/bài/điểm giả lên production.
