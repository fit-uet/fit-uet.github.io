# Gián đoạn database và hạn mức D1

Ngày 30/10/2026, D1 `bd58a106-1b64-473a-8211-896e84f6072e` trả mã Cloudflare `7500`, thông báo đã vượt `free tier daily row read limit`. `/api/health` vẫn 200 vì tiến trình còn chạy; `/api/ready` và các nghiệp vụ cần database bị 503. Đây là lỗi dịch vụ dữ liệu, không phải bằng chứng JWT hoặc tài khoản Google không hợp lệ.

## Quy tắc xử lý lỗi

- JWT sai/hết hạn hoặc không còn tài khoản: 401. JWT hợp lệ nhưng không đọc được database: 503, không trả `Invalid token`.
- Quota D1/Turso: `DB_QUOTA_EXCEEDED`, `database=quota_blocked`, kèm `databaseProvider`. Chỉ hạn mức D1 hằng ngày có `retryAt` là 00:00 UTC ngày tiếp theo; không suy đoán ngày đặt lại quota Turso.
- Kết nối lỗi: `DB_CONNECTION_ERROR`; không đưa credential hoặc phản hồi thô từ provider vào JSON công khai. Google OAuth có lỗi riêng; lỗi API token của database không được coi là lỗi Google.
- Frontend hiển thị cảnh báo dịch vụ và nút kiểm tra lại kết nối. Không tự đăng xuất khi API trả 503. Với backend cũ trả nhầm 401, kiểm tra readiness trước khi xóa phiên; gộp các kiểm tra đồng thời. JWT thực sự hết hạn và thao tác đăng xuất vẫn xóa phiên.

## Giảm lượng đọc học vụ

CTE lọc theo sinh viên/phân công trước khi hydrate JSON và tra mã giảng viên một lần. Base/content/management không có danh sách dùng mô hình quyền truy cập nhẹ; catalog và số chưa đọc không nối bảng báo cáo/điểm hoặc dựng lịch sử nộp bài. Tổng quan, danh sách chi tiết và export vẫn giữ nghiệp vụ đầy đủ.

Trang Dự án có cache RAM phía server, giới hạn 25 mục/10 MB, tối đa 30 giây và hết hiệu lực ở mốc thời hạn gần nhất. Khi nhận `If-None-Match`, server kiểm revision và danh tính giảng viên hiện hành trước khi tái dùng trang; thay đổi phân công/xóa lần học làm cache cũ không còn hợp lệ. Không có ETag hoặc có `Cache-Control: no-cache/no-store` thì đọc lại đầy đủ. Lỗi database không trả dữ liệu cũ làm fallback. Export và nguồn legacy không dùng cache trang này. Cache trình duyệt và hợp đồng dữ liệu nghiệp vụ được giữ nguyên; không migration dữ liệu trong hotfix.

## Phát hành khi provider còn chặn

Giữ gói miễn phí theo lựa chọn của chủ hệ thống. Không tạo database khác để lách hạn mức, không tự đổi nguồn hoặc khôi phục đè backup. Dừng probe/backup lặp khi đã biết quota bị chặn.

Có thể phát hành frontend tương thích qua workflow `frontend_only=true` để sửa cảnh báo/giữ phiên với backend đang có. Backend không thể khởi động bản mới vì startup cần đọc database: giữ bản đang chạy, không bỏ qua schema init hoặc giả readiness 200. Trước khi deploy backend đã tối ưu, chờ provider mở lại; kiểm nguồn, schema 4, 408 hồ sơ Dự án/405 SV và dữ liệu bảo toàn, rồi chờ đúng SHA/readiness trước khi phát hành thông thường. Mốc thử lại của sự cố này là **07:00 ngày 31/10/2026, giờ Việt Nam**; thay đổi gói hoặc trạng thái tài khoản provider có thể cần xử lý riêng.
