# Giao diện theo bố cục trước mở rộng Dự án

Bố cục tham chiếu là commit `726271c`. Người dùng vẫn chọn **Học kỳ → Nhóm môn**, sau đó thao tác trong phạm vi đã chọn.

## Điều hướng và các vai trò

- Khoa vào **Tổng quan Quản trị**, xem thẻ thống kê và các ô chức năng như giao diện cũ. Thực tập giữ Sinh viên, Phân công, Báo cáo và Bảng điểm riêng; Dự án dùng một Danh sách sinh viên với thao tác trực tiếp tại dòng, import mở bằng nút riêng.
- Giảng viên vào danh sách sinh viên phụ trách; cửa sổ báo cáo có PDF bên cạnh nhận xét/chấm điểm. Tài khoản Khoa đồng thời giảng viên có thể chuyển sang các hồ sơ mình được phân công rồi trở lại quản trị.
- Sinh viên xem thẻ thông tin, tiến độ, thời hạn và bộ bài. Người học hai môn chọn rõ từng hồ sơ; giao diện không nhận dữ liệu điểm.
- Khung nhóm môn dùng một tiêu đề, bộ chọn học kỳ/nhóm cùng hàng và hàng chức năng chính; chức năng còn lại nằm trong **Thêm**. Header xanh, menu tài khoản và typography dùng hệ giao diện hiện có từ bản tham chiếu.
- Chat dùng danh sách hội thoại và vùng trao đổi; kế hoạch, FAQ, thông báo, thiết lập và kiểm tra kết nối email tiếp tục giữ phạm vi, quyền và chức năng hiện có.

## Dữ liệu và tương thích

Các URL `#/campaigns/:campaignId?tab=...`, `#/classes/:classId` và đường dẫn cũ vẫn hoạt động. Tham số `panel` chọn phần hồ sơ trong cửa sổ chi tiết; `view=lecturer` giữ chế độ giảng viên cho tài khoản có hai vai trò. Khi chuyển chức năng, giữ học phần/lớp/GV/từ khóa và đặt lại trạng thái/trang không còn phù hợp. Đóng cửa sổ hồ sơ giữ trang danh sách và trả focus về nút đã mở.

Dự án và Thực tập mới tiếp tục dùng API campaign/enrollment. Thực tập legacy dùng các màn cũ, mỗi lần chỉ mount một nguồn giao diện; mã học phần được chuẩn hóa để khớp cả tên lưu đầy đủ. Bộ lọc giảng viên/lớp của màn legacy được áp tại SQL trên toàn phạm vi, không giới hạn ở một trang. Hồ sơ chưa ánh xạ vẫn giữ lối vào riêng.

Đợt khôi phục bố cục không cần migration; đợt gộp bảng Dự án tiếp theo có migration bỏ riêng status, không import lại, tính lại điểm hoặc thay tệp R2. ID lớp/lần học/phiên bản, phân công, quyền truy cập và các mốc thời gian giữ nguyên.

## Kiểm chứng

`npm run test:academic:ui` kiểm tra bố cục mới, cửa sổ PDF, Escape/focus, import, lọc/xuất, chuyển vai trò, hai hồ sơ, chat, khóa/mở lại và cache. Fixture riêng có trang tham chiếu các màn cũ và sinh ảnh desktop/mobile của ba vai trò; ảnh/trace ở `scratch/academic-ui-results/`.

Nghiệm thu thêm bằng một bản sao private đã được chuẩn bị với `academic:stage`, chạy server bằng `academic:stage:serve -- --directory=<copy-dir> --port=4320`. Đặt `ACADEMIC_ACCEPTANCE_BASE=http://127.0.0.1:4320`, `ACADEMIC_ACCEPTANCE_LECTURER` và `ACADEMIC_ACCEPTANCE_STUDENT` là tài khoản có trong bản sao, rồi chạy kiểm thử giao diện. Luồng này chỉ mở danh sách/bộ lọc/hồ sơ; không nộp hoặc chấm dữ liệu thật. Mặc định kiểm thử này được bỏ qua khi chưa chỉ định bản sao; URL remote bị từ chối.

Trước khi phát hành, chạy TypeScript, build, kiểm thử học vụ/staging và giao diện. Pipeline hiện có đợi Render đúng SHA trước khi publish Pages. Sau deploy, đối chiếu số lượng hồ sơ, phân công, báo cáo, điểm và audit; không phục hồi database chỉ để đổi giao diện.

## Khôi phục trực tiếp component gốc

Bản trước chỉ mô phỏng bố cục dashboard và gom một số chức năng vào trang chung. Bản hiệu chỉnh dùng lại `AdminDashboard` từ `726271c`: giữ thẻ thống kê có màu/tỷ lệ, lưới ô chức năng, typography và nút thao tác gốc. Thực tập lấy thống kê từ nguồn legacy đầy đủ, kể cả hồ sơ chưa ánh xạ; số lượng theo nhóm vẫn có trong thống kê và danh sách, không lặp ở đầu mọi trang. Các danh mục và Thông báo & Email/Cài đặt hệ thống vẫn mở màn gốc dùng chung.

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

## Khung gọn, điều hướng và bộ lọc

`CampaignChrome` dùng chung cho ba vai trò và hai nhóm môn. Tiêu đề xuất hiện một lần, cùng bộ chọn nhóm/kỳ và nút tải lại; bỏ breadcrumb, phụ đề lặp, nhãn hoạt động và tổng số lớp/SV/lần học ở đầu trang. Khung tiêu đề/điều hướng cao 84 px trên desktop khi không có cảnh báo; giữ cảnh báo nháp, chờ chuyển đổi, lưu trữ. Không thay header xanh, chiều rộng bảng hay thẻ thống kê Tổng quan.

`campaignNavigation` phân chia mục chính/Thêm theo vai trò. Mobile hiện hai mục chính đầu tiên, phần còn lại vào Thêm; mục hiện tại có `aria-current`, kể cả khi ở trong Thêm. Bộ chọn nhóm chỉ tải danh sách được cấp quyền khi mở. Đổi nhóm xóa bộ lọc và hồ sơ đang chọn, giữ chế độ giảng viên và chức năng còn phù hợp. Giữ URL `campaignId`, `tab`, bộ lọc, trang và liên kết cũ.

`CampaignListToolbar` cung cấp một ô tìm kiếm (debounce 300 ms), nút Bộ lọc với số điều kiện và các thao tác của màn. Các bộ lọc học phần/lớp/GV/trạng thái nằm trong popover desktop hoặc bottom sheet mobile. Sửa điều kiện chưa gọi API; **Áp dụng** cập nhật URL một lần, về trang 1 và đóng hồ sơ cũ. **Hủy**, Escape hoặc đóng ngoài hộp bỏ bản nháp; **Xóa bộ lọc** bỏ điều kiện đã áp dụng nhưng giữ tìm kiếm. Số điều kiện không tính từ khóa hoặc giới hạn giảng viên bắt buộc. Export đọc cùng bộ lọc đã áp dụng, lấy đủ các trang.

`CampaignLayoutContext` cho các màn legacy dùng chung tiêu đề và chuyển các nút nghiệp vụ gốc sang thanh thao tác qua portal. Các đường dẫn standalone giữ bố cục gốc; màn nhúng có một tiêu đề và một ô tìm kiếm. Bộ lọc GVHD chính theo tên (nguồn legacy) được giữ riêng với bộ lọc giảng viên phân công. Phân trang và bộ lọc legacy đồng bộ vào URL, không tự quay về trang 1 khi mở liên kết trang 2. Kế hoạch, hồ sơ, FAQ và chat không có bộ lọc danh sách; Thông báo có điều khiển chọn phạm vi người nhận riêng.

Không đổi API, database, quy tắc nghiệp vụ hoặc cơ chế cache. Hồi quy giao diện gồm ba vai trò desktop/mobile, Apply/Hủy/Xóa, thao tác nhanh sau lọc, phân trang legacy, menu không tải trước dữ liệu, đổi nhóm/vai trò, export nhiều trang, trình soạn, PDF, duyệt đề tài và chat. Bản sao local dùng email provider `none`, không gọi Google OAuth/R2/email thật.

## Phân công GV nhận xét do người phụ trách thực hiện

Khoa/Quản trị viên mở **Dự án → Danh sách sinh viên → Phân công**, kiểm tra phương án rồi bấm **Xác nhận phân công** để lưu. Đóng cửa sổ hoặc hủy không thay đổi GVNX; mở trang, đăng nhập, import và tải lại không tự phân công. Giữ các quy tắc ưu tiên bộ môn, cân bằng DACN/DAKH, quota và chỉ bổ sung hồ sơ chưa có GVNX.

Công cụ `npm run academic:reviewers-reset` mặc định chỉ xem trước. `--apply` yêu cầu nguồn database tường minh, campaign Dự án, tài khoản quản trị, revision đã đối soát, lý do và backup mới. Công cụ chặn toàn bộ tác vụ nếu có hồ sơ đã chấm/khóa, nhóm không hoạt động hoặc revision đã đổi; một lệnh ghi nguyên tử chỉ gỡ vai trò reviewer và lưu lịch sử trước/sau. Giữ GVHD, đề tài, bài nộp, điểm, quota, tệp và dữ liệu Thực tập; không gửi email/thông báo. Chạy lại sau khi gỡ xong không tạo thay đổi mới.

Chi tiết bảng gộp, bản nháp nhiều dòng, PDF riêng và xóa lần học: [PROJECT_STUDENT_LIST.md](PROJECT_STUDENT_LIST.md).
