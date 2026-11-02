# Rà soát UX chỉnh sửa và lưu dữ liệu — 02/11/2026

Đợt rà soát tập trung vào danh sách sinh viên, đề tài, phân công, yêu cầu sửa bài, chấm điểm, cửa sổ thao tác và các trang biên tập nội dung. Áp dụng trong giao diện học kỳ/nhóm môn; giữ bố cục, API và nghiệp vụ hiện hành.

| Khu vực | Vấn đề tìm thấy | Xử lý |
| --- | --- | --- |
| Yêu cầu sửa bài | Phải cuộn lên để lưu; có thể tiếp tục nhập khi yêu cầu lưu đang chạy | Có Lưu/Hủy sửa tại ô; khóa điều khiển khi đang lưu |
| Đề tài, phân công, duyệt đề tài | Các thao tác lưu/hủy chưa thống nhất; kết quả chỉ hiện đầu bảng | Dùng chung thao tác theo dòng; báo thành công/lỗi tại nơi đang chỉnh |
| Đóng ô và hủy | Đóng dễ bị hiểu là bỏ thay đổi | Đóng chỉ thu gọn; Hủy sửa bỏ thay đổi chưa lưu của đúng sinh viên; hiển thị lời giải thích khi có thay đổi |
| Lưu nhiều sinh viên | Khó phân biệt dòng nào được lưu hoặc còn lỗi | Chỉ báo đang lưu cho đúng các dòng được gửi; dòng lỗi giữ nội dung; lưu một dòng giữ các dòng khác |
| Kế hoạch, Hướng dẫn GV, FAQ, Quy định Thực tập | Chỉ có nút lưu đầu trang; thông báo bằng hộp thoại; rời trang làm mất nội dung | Có Lưu/Hủy ở cuối trang, phản hồi nội tuyến, cảnh báo lưu/bỏ/ở lại khi rời trang |
| Lưu thành công nhưng tải lại lỗi | Có thể báo như lưu thất bại dù database đã nhận | Phân biệt lỗi ghi với lỗi tải lại; xác nhận đã lưu và hướng dẫn Tải lại |
| Sinh viên sửa đề tài | Biểu mẫu đóng ngay cả khi gửi bị lỗi | Chỉ đóng khi lưu thành công; lỗi giữ tên đề tài đang nhập |
| Cửa sổ thao tác | Nhãn đóng chung “hồ sơ”; thay đổi callback có thể dựng lại cửa sổ và mất focus | Nhãn theo chức năng; giữ cửa sổ/focus ổn định; chặn đóng khi đang ghi ở form thêm/xóa và hộp cảnh báo lưu |
| Chuyển chức năng | Nội dung màn cũ có thể còn tương tác khi màn mới đang tải | Tách trạng thái tải theo chức năng/vai trò; giữ thanh điều hướng và tìm kiếm |

## Quy ước thao tác

- Nút Lưu tại một ô lưu nguyên tử toàn bộ thay đổi của **dòng sinh viên đó**, như API hiện có. Không tự lưu khi rời ô.
- Hủy sửa ở dòng bỏ mọi thay đổi chưa lưu của dòng đó. Hủy thay đổi ở thanh công cụ bỏ toàn bộ các dòng đang sửa.
- Điểm lưu vẫn là điểm gửi về Khoa; không tạo điểm nháp trong database. Giữ hạn chấm, quyền GVHD/GVNX và kiểm tra revision/phiên bản.
- Nội dung biên tập được giữ trong RAM khi lưu lỗi. Bộ soạn thảo, import Word và khôi phục mặc định bị khóa khi lưu đang chạy hoặc nhóm chỉ xem.
- Không thay đổi điều kiện nộp bài, duyệt đề tài, phân công, quota, công thức điểm, cache PDF, database hoặc tệp R2.

## Nghiệm thu

Kiểm thử trên fixture local: lưu yêu cầu sửa qua API thật, lỗi ghi rồi thử lại, không sửa trong khi lưu, hủy đúng dòng, giữ dòng khác, chuyển màn có thay đổi chưa lưu, lưu cuối trang ở bốn bộ soạn nội dung và giữ tên đề tài sau lỗi. Hồi quy Thực tập, ba vai trò, PDF, import/export, tìm kiếm tiếng Việt và desktop/mobile bằng bộ kiểm thử giao diện hiện có.

Các bản ghi kiểm thử chỉ được tạo trên local. Phát hành giao diện qua pipeline hiện có, kiểm tra backend đang sẵn sàng và tài nguyên Pages đã cập nhật; không gửi email thử hay nhập điểm giả trên production.
