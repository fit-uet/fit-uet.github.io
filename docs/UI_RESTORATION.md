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

Dự án và Thực tập mới tiếp tục dùng API campaign/enrollment. Thực tập legacy dùng các màn cũ, mỗi lần chỉ mount một nguồn giao diện; mã học phần được chuẩn hóa để khớp cả tên lưu đầy đủ. Bộ lọc giảng viên của màn legacy lấy đủ danh sách thành viên được phép qua API campaign, không giới hạn ở một trang. Hồ sơ chưa ánh xạ vẫn giữ lối vào riêng.

Đợt thay giao diện không cần migration, import lại, tính lại điểm hoặc thay tệp R2. ID lớp/lần học/phiên bản, phân công, quyền truy cập và các mốc thời gian giữ nguyên.

## Kiểm chứng

`npm run test:academic:ui` kiểm tra bố cục mới, cửa sổ PDF, Escape/focus, import, lọc/xuất, chuyển vai trò, hai hồ sơ, chat, khóa/mở lại và cache. Fixture riêng có trang tham chiếu các màn cũ và sinh ảnh desktop/mobile của ba vai trò; ảnh/trace ở `scratch/academic-ui-results/`.

Nghiệm thu thêm bằng một bản sao private đã được chuẩn bị với `academic:stage`, chạy server bằng `academic:stage:serve -- --directory=<copy-dir> --port=4320`. Đặt `ACADEMIC_ACCEPTANCE_BASE=http://127.0.0.1:4320`, `ACADEMIC_ACCEPTANCE_LECTURER` và `ACADEMIC_ACCEPTANCE_STUDENT` là tài khoản có trong bản sao, rồi chạy kiểm thử giao diện. Luồng này chỉ mở danh sách/bộ lọc/hồ sơ; không nộp hoặc chấm dữ liệu thật. Mặc định kiểm thử này được bỏ qua khi chưa chỉ định bản sao; URL remote bị từ chối.

Trước khi phát hành, chạy TypeScript, build, kiểm thử học vụ/staging và giao diện. Pipeline hiện có đợi Render đúng SHA trước khi publish Pages. Sau deploy, đối chiếu số lượng hồ sơ, phân công, báo cáo, điểm và audit; không phục hồi database chỉ để đổi giao diện.
