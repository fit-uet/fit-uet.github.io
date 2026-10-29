# Giao diện theo bố cục trước mở rộng Dự án

Bố cục tham chiếu là commit `726271c`. Người dùng vẫn chọn **Học kỳ → Nhóm môn**, sau đó thao tác trong phạm vi đã chọn.

## Điều hướng và các vai trò

- Khoa vào **Tổng quan Quản trị**, xem thẻ thống kê và các ô chức năng như giao diện cũ. Sinh viên, Phân công, Báo cáo và Bảng điểm là các màn riêng với cột và thao tác phù hợp; import mở bằng nút trong màn Sinh viên.
- Giảng viên vào danh sách sinh viên phụ trách; cửa sổ báo cáo có PDF bên cạnh nhận xét/chấm điểm. Tài khoản Khoa đồng thời giảng viên có thể chuyển sang các hồ sơ mình được phân công rồi trở lại quản trị.
- Sinh viên xem thẻ thông tin, tiến độ, thời hạn và bộ bài. Người học hai môn chọn rõ từng hồ sơ; giao diện không nhận dữ liệu điểm.
- Thanh chức năng dài được thay bằng tổng quan, đường dẫn quay lại và danh sách chọn chức năng. Header xanh, menu tài khoản và typography dùng hệ giao diện hiện có từ bản tham chiếu.
- Chat dùng danh sách hội thoại và vùng trao đổi; kế hoạch, FAQ, thông báo, thiết lập và kiểm tra kết nối email tiếp tục giữ phạm vi, quyền và chức năng hiện có.

## Dữ liệu và tương thích

Các URL `#/campaigns/:campaignId?tab=...`, `#/classes/:classId` và đường dẫn cũ vẫn hoạt động. Tham số `panel` chọn phần hồ sơ trong cửa sổ chi tiết; `view=lecturer` giữ chế độ giảng viên cho tài khoản có hai vai trò. Khi chuyển chức năng, giữ học phần/lớp/GV/từ khóa và đặt lại trạng thái/trang không còn phù hợp. Đóng cửa sổ hồ sơ giữ trang danh sách và trả focus về nút đã mở.

Dự án và Thực tập mới tiếp tục dùng API campaign/enrollment. Thực tập legacy dùng các màn cũ, mỗi lần chỉ mount một nguồn giao diện; mã học phần được chuẩn hóa để khớp cả tên lưu đầy đủ. Bộ lọc giảng viên/lớp của màn legacy được áp tại SQL trên toàn phạm vi, không giới hạn ở một trang. Hồ sơ chưa ánh xạ vẫn giữ lối vào riêng.

Đợt thay giao diện không cần migration, import lại, tính lại điểm hoặc thay tệp R2. ID lớp/lần học/phiên bản, phân công, quyền truy cập và các mốc thời gian giữ nguyên.

## Kiểm chứng

`npm run test:academic:ui` kiểm tra bố cục mới, cửa sổ PDF, Escape/focus, import, lọc/xuất, chuyển vai trò, hai hồ sơ, chat, khóa/mở lại và cache. Fixture riêng có trang tham chiếu các màn cũ và sinh ảnh desktop/mobile của ba vai trò; ảnh/trace ở `scratch/academic-ui-results/`.

Nghiệm thu thêm bằng một bản sao private đã được chuẩn bị với `academic:stage`, chạy server bằng `academic:stage:serve -- --directory=<copy-dir> --port=4320`. Đặt `ACADEMIC_ACCEPTANCE_BASE=http://127.0.0.1:4320`, `ACADEMIC_ACCEPTANCE_LECTURER` và `ACADEMIC_ACCEPTANCE_STUDENT` là tài khoản có trong bản sao, rồi chạy kiểm thử giao diện. Luồng này chỉ mở danh sách/bộ lọc/hồ sơ; không nộp hoặc chấm dữ liệu thật. Mặc định kiểm thử này được bỏ qua khi chưa chỉ định bản sao; URL remote bị từ chối.

Trước khi phát hành, chạy TypeScript, build, kiểm thử học vụ/staging và giao diện. Pipeline hiện có đợi Render đúng SHA trước khi publish Pages. Sau deploy, đối chiếu số lượng hồ sơ, phân công, báo cáo, điểm và audit; không phục hồi database chỉ để đổi giao diện.

## Khôi phục trực tiếp component gốc

Bản trước chỉ mô phỏng bố cục dashboard và gom một số chức năng vào trang chung. Bản hiệu chỉnh dùng lại `AdminDashboard` từ `726271c`: giữ thẻ thống kê có màu/tỷ lệ, lưới ô chức năng, typography và nút thao tác gốc. Thực tập lấy thống kê từ nguồn legacy đầy đủ, kể cả hồ sơ chưa ánh xạ; số lớp/lần học được hiển thị riêng theo nhóm. Các danh mục và Thông báo & Email/Cài đặt hệ thống vẫn mở màn gốc dùng chung.

| Chức năng | Màn hiển thị và nguồn dữ liệu |
| --- | --- |
| Tổng quan | Component `AdminDashboard` gốc, nhận context campaign |
| Kế hoạch triển khai | `PlanSettingsAdmin`: Word → Markdown, bản soạn và xem trước |
| Quy định Thực tập | `RegistrationRulesSettingsAdmin`: khôi phục mặc định, soạn/xem trước |
| Hướng dẫn GV | `LecturerGuideSettingsAdmin`: import Word, bản soạn/xem trước |
| Cài đặt FAQ | `FAQSettingsAdmin`: hai tab SV/GV, import Word, thống kê nội dung |
| Thực tập: FAQ/chat | `FAQView`/`FAQQuestionsAdmin` và `ChatView` gốc; giữ file, xem trước, thu hồi, liên kết hội thoại |
| Thực tập: hồ sơ/nộp báo cáo | Tách `Dashboard` và `StudentFinalReportView` thành hai chức năng riêng |
| Dự án | Giữ hai lần học độc lập, duyệt đề tài, GVHD/GVNX, PDF/Drive và điểm 60/40 |

Các trình soạn dùng `CampaignEditorContext` để đọc/lưu cấu hình của nhóm đang chọn qua revision/API campaign. Không dùng API `user_id` cho Dự án; không ghi nhầm cấu hình vào học kỳ/nhóm khác. Liên kết cũ `/admin/plan`, `/admin/lecturer-guide`, `/admin/faq` mở đúng trình soạn riêng. Chat legacy giữ thread khi chuyển liên kết vào URL campaign. Không hiển thị hai bộ tiêu đề/bảng khi dùng màn legacy.

Cache RAM, lazy loading và SQL phân trang được giữ theo [PERFORMANCE.md](PERFORMANCE.md). Các trang soạn không tải danh sách/PDF; PDF legacy dùng cache 8 mục theo phiên và kiểm quyền bằng ETag trước tái sử dụng. Các ca giao diện đối chiếu đủ ô chức năng gốc, lưu nội dung độc lập giữa nhóm, export nhiều trang, xem lại PDF 304 và thu hồi quyền 403.
