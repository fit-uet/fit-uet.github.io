# Rà soát nghiệp vụ Dự án và Thực tập — 31/10/2026

Phạm vi: giao diện Khoa, giảng viên, sinh viên, điều hướng, hồ sơ dùng chung, import/phân công, bài nộp, chấm điểm, export và API tương thích. Đối chiếu [yêu cầu](REQUIREMENTS.md), [danh sách/chấm điểm Dự án](PROJECT_STUDENT_LIST.md) và [duyệt đề tài](TOPIC_APPROVAL.md).

## Các nhầm lẫn đã sửa

| Mã | Phát hiện | Hành vi sau sửa | Kiểm chứng |
| --- | --- | --- | --- |
| BA-01 | Tìm kiếm Dự án gợi ý “nơi thực tập” dù API tìm MSSV/họ tên/đề tài | Dự án và Thực tập mới ghi đúng trường tìm kiếm; màn nguồn legacy giữ tìm nơi thực tập | Unit và giao diện Khoa/GV desktop/mobile |
| BA-02 | XLSX điểm Dự án chứa cột tiến độ, báo cáo, đơn vị của công thức Thực tập; export TT có cột GVNX/slide/video không áp dụng | Export theo campaign chỉ lấy trường đúng nhóm; API/export theo lớp/kỳ phân biệt 60/40 với 20/20/60. Xuất kỳ gồm cả hai nhóm giữ cột tương ứng, để trống trường không áp dụng, căn ô theo khóa thay vì thứ tự giá trị. Dự án không có “Tư cách” | Đọc lại XLSX lớp, kỳ có hai nhóm, lớp trống; đối chiếu 8/8,5 → 8,2 và TT 5/6/9 → 7,6 |
| BA-03 | Hồ sơ cá nhân bắt SV chỉ học Dự án chọn học phần Thực tập và lấy danh sách lớp legacy | Không hiện bộ chọn học phần cũ hoặc gọi settings legacy cho tài khoản không có quyền legacy; ngày sinh/lớp khóa học không bắt buộc. Backend chặn dùng hồ sơ cá nhân để đổi học phần; giữ học phần cũ khi trường không được gửi. Hồ sơ TT cũ vẫn có điều khiển riêng và giữ được mã/tên học phần đã lưu | UI hai loại SV; API bảo toàn tài khoản, quyền và các lần học |
| BA-04 | Liên kết “Hướng dẫn sử dụng” mở Kế hoạch | Điều hướng tới `tab=guide` trong nhóm được phép truy cập | UI Khoa/GV |
| BA-05 | Chọn PDF cũ nhưng biểu mẫu vẫn hiển thị điểm/nhận xét của bản hiện tại | Báo cáo, điểm, nhận xét và tổng kết cùng phiên bản được chọn. Bản cũ ghi rõ lịch sử/chỉ xem; lưu chỉ áp dụng bản hiện hành, giữ kiểm revision/quyền ở backend | Unit thang điểm/điểm 0/phân quyền và UI xung đột/phiên bản cũ |
| BA-06 | Xóa ở danh mục dùng chung có thể xóa tài khoản còn hồ sơ học phần, để lại dữ liệu học vụ không nhất quán | Trả 409 trước khi dọn tệp hoặc xóa dữ liệu; Khoa quản lý lần học trong nhóm môn. Xóa một lần học Dự án vẫn giữ tài khoản và lần học khác | API xóa bị chặn, tài khoản/hồ sơ được giữ |
| BA-07 | API phân công GVHD của TT trả nhầm lỗi nguồn legacy khi gọi cho Dự án; preview GVNX nhận lớp TT rồi có thể cho kết quả rỗng | Báo rõ sai nghiệp vụ; SV không tự tham gia lớp Dự án, GVNX chỉ nhận các lớp Dự án trong đúng kỳ | API không phát sinh phân công hoặc lần học |
| BA-08 | Đối soát import cho chọn CN làm GVHD chính dù backend không cho phép | Khóa lựa chọn CN ở trường GVHD chính và ghi rõ chỉ đồng hướng dẫn | Rà giao diện và hồi quy import/kiểm quyền backend |
| BA-09 | Sửa tên hồ sơ giảng viên có thể làm mất/đổi tiền tố học vị đang dùng để kiểm điều kiện GVHD/GVNX và quota | Học vị/chức danh giữ theo danh mục Khoa; tự sửa chỉ thay họ tên. Cập nhật đúng giảng viên/tài khoản đó, kiểm thay đổi đồng thời của danh mục, bỏ đồng bộ hàng loạt người khác trong thao tác này | API: CN không tự nâng thành PGS.TS, TS không mất học vị khi nhập tên; tài khoản khác giữ nguyên |

## Những phần đã đối chiếu

- DACN INT3132 và DAKH INT3131 dùng lần học độc lập; không có tự đăng ký theo khóa, nguyện vọng hay xác nhận nơi thực tập. Danh mục SV/GV/doanh nghiệp vẫn là danh mục chung toàn hệ thống.
- Đề tài mới hoặc đổi tên phải Pending; chỉ GVHD chính duyệt/sửa rồi duyệt. Đồng HD/GVNX chỉ xem đề tài. Hạn, phê duyệt muộn, nộp lại và khóa sau điểm đầu tiên vẫn do backend kiểm tra.
- Dự án cần PDF tối đa 10 MB, Drive slide và video; TT không bị bắt bổ sung slide/video. Dữ liệu điểm không đưa tới SV; đồng HD không được nhập hoặc nhận dữ liệu điểm.
- Chấm Dự án theo GVHD 60%/GVNX 40%; TT giữ 20%/20%/60%. Điểm thiếu khác 0; ngoại lệ 0 vẫn cần lý do; mở lại tạo phiên bản cần chấm lại.
- Trên bản sao đã kiểm chứng, nội dung kế hoạch/hướng dẫn/FAQ của Dự án không chứa quy trình Thực tập. Hạn HKI 2026–2027 đúng: đề tài 07/09–20/12, nộp bộ bài 14–20/12, chấm 14–27/12, hết ngày theo giờ Việt Nam. Không thay nội dung hoặc thời hạn đang lưu.
- Không đổi database schema, công thức, dữ liệu, file R2 hoặc cache JSON/PDF. Giữ các tối ưu ở [PERFORMANCE.md](PERFORMANCE.md); đo trên bản sao, chỉ kiểm tra đọc có giới hạn ở production.

## Bộ kiểm chứng

- `tests/academic/business-scope.test.ts`: export/khóa trường theo nhóm, hồ sơ/quyền dùng chung, xóa tài khoản và điều kiện đúng luồng.
- `tests/academic/presentation.test.ts`: nội dung tìm kiếm và kết quả đúng phiên bản.
- `tests/academic-ui/workflows.spec.ts`: desktop/mobile, ba vai trò, import, nộp/chấm, khóa/mở lại, cache, liên kết cũ, hồ sơ Dự án và TT.
- TypeScript, build, toàn bộ kiểm thử học vụ/staging, D1 local và phép đo `rows_read` trên bản sao. Không gửi email thử hoặc ghi điểm/tạo sinh viên trên production.
