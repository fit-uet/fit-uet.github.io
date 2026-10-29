# Bản cài đặt học kỳ, nhóm môn và Dự án

Ngày cập nhật: **29/10/2026**. Bản mở rộng dùng backend **Express** và frontend React. Đã chuyển dữ liệu vào Turso vận hành sau sao lưu và diễn tập; quy trình phát hành Render/Pages và xác nhận đúng phiên bản tại [PRODUCTION_RELEASE.md](PRODUCTION_RELEASE.md). Yêu cầu nghiệp vụ: [REQUIREMENTS.md](REQUIREMENTS.md); thiết kế và schema thực tế: [ARCHITECTURE.md](ARCHITECTURE.md#12-cai-dat-thuc-te-trong-repository).

**Dữ liệu production:** 535 lần học / 532 SV / 8 lớp Dự án, 408 GVNX và 127 hồ sơ thiếu GVHD. Danh mục có 98 GV, giữ ID/bản ghi cũ, thêm ba GV đã xác nhận và cập nhật ThS. Vũ Đức Hiếu. Đã ánh xạ 691 hồ sơ TT; 208 hồ sơ thiếu học phần giữ ở nguồn cũ với lối vào riêng cho SV, không suy đoán enrollment. Bảo toàn 675 điểm, 644 báo cáo và 664 tệp R2; chuyển dữ liệu không tạo email mới. Sao lưu private trong `.staging/production-release-20261029/`.

**Đã chuẩn bị staging cục bộ có lưu dữ liệu:** bản sao, báo cáo đối soát, tài khoản Khoa local; đã nhập 535 lần học / 532 SV / 8 lớp với danh mục 97 GV, không còn lỗi đối soát. Nhóm Dự án đã kích hoạt trên staging với lịch đã chốt, đã gán 408 GVNX; 127 hồ sơ còn thiếu GVHD. Khai đề tài 07/09–20/12, nộp 14–20/12, chấm 14–27/12/2026 (giờ Việt Nam). Hướng dẫn và giới hạn tại [LOCAL_STAGING.md](LOCAL_STAGING.md). Database local đầu vào hiện trống hồ sơ TT; chưa dùng kết quả này để nghiệm thu dữ liệu production.

**Mô hình quản lý đã đổi sang học kỳ → nhóm môn.** Cấu hình/trạng thái dùng chung, các danh sách lọc/xuất theo lớp; Thực tập cũ mở trong cùng giao diện. Đã có schema v2, migration có backup và kiểm thử riêng: [GROUP_MANAGEMENT.md](GROUP_MANAGEMENT.md).

**Giao diện dùng lại bố cục trước mở rộng (`726271c`):** Khoa có tổng quan/thẻ chức năng, các màn danh sách riêng; GV xem PDF và chấm trong cửa sổ, SV có thẻ hồ sơ và nộp bài. Vẫn giữ lựa chọn nhóm/kỳ, dữ liệu và API học vụ; xem [UI_RESTORATION.md](UI_RESTORATION.md).

## Chạy thử độc lập với dữ liệu đang vận hành

```bash
npm ci
npm run academic:preview
```

Mở [bản thử vai trò Khoa](http://127.0.0.1:4318/__academic_preview/login?role=admin). Đổi `role` thành `student`, `lecturer`, `reviewer` để xem các vai trò còn lại; nên dùng cửa sổ riêng cho từng vai trò. Bản thử dùng dữ liệu hư cấu trong database RAM, file tạm, email tắt và chỉ nghe trên loopback. Nó không dùng Google OAuth thật hoặc database ứng dụng, không lưu lại dữ liệu sau khi dừng. GVNX chỉ có phân công sau khi Khoa xem trước và áp dụng phân công trong bản thử.

Luồng kiểm tra: Khoa chọn học kỳ/nhóm, lọc lớp khi cần → phân công GVNX → SV gửi đề tài → GVHD chính duyệt → SV nộp PDF và hai link → GVHD/GVNX nhập điểm riêng → Khoa xuất, khóa/mở lại. Điểm mẫu 8.0 và 8.5 cho tổng 8.2; SV chỉ thấy tiến độ và phản hồi dành cho mình.

Để chạy ứng dụng thật ở local/staging, làm theo [README](../README.md#chạy-local), dùng **bản sao database** và `EMAIL_PROVIDER=none` khi thử. Trang chọn nhóm là `/#/classes`; trang quản lý là `/#/campaigns/:campaignId`, gồm cả Thực tập đợt cũ. Server khởi tạo schema bổ sung sau `initDb`, không tự ánh xạ hoặc import workbook.

## Tiếp nhận HKI 2026–2027

1. Đăng nhập Khoa, mở **Học kỳ và nhóm môn**, tạo năm bắt đầu `2026`, học kỳ I.
2. Chọn học kỳ vừa tạo, import `HKI-26-27 GVHD DACN_DAKH_20261007.xlsx`. Chỉ đọc hai sheet chính DACN/DAKH, bỏ qua sheet ẩn.
3. Kiểm tra bản xem trước. Sửa/loại dòng lỗi, ánh xạ GVHD sai tên/email, xác nhận trường khác dữ liệu hiện có, rồi **xem trước lại** trước khi nhập. Sửa một nhóm trùng phải xử lý các dòng nguồn tương ứng.
4. Xác nhận nhập khi không còn lỗi. Tám lớp `INT3132 1–4`, `INT3131 1–4` được tạo nếu chưa có và kế thừa cấu hình/trạng thái nhóm trong kỳ. Import lại không xóa người vắng danh sách hoặc ghi đè bài/điểm; thay GVHD/đề tài sau chấm cần mở lại riêng.
5. Thiết lập hạn khai đề tài/nộp/chấm, hướng dẫn và kích hoạt cả nhóm Dự án một lần. Lớp nháp chưa cấp quyền vào cho SV. Thời điểm trên UI dùng giờ Việt Nam; để trống đầu/cuối tương ứng là không giới hạn.
6. Sau khi các lớp và phân công GVHD đã sẵn sàng, đặt chỉ tiêu GVNX theo kỳ nếu cần, xem trước cả kỳ, kiểm tra các dòng chuyển bộ môn/chưa phân công, điều chỉnh và áp dụng. Chạy lại chỉ bổ sung hồ sơ chưa có GVNX.

Khảo sát file mẫu ghi nhận **697 dòng dữ liệu, 535 lần học có MSSV hợp lệ và một nhóm MSSV sai `134`** sau gộp. Khi đối chiếu danh mục GV có trong repository, 47 nhóm cần xác nhận tên/email GVHD. Những dòng này không được tự gán theo tên gần giống; số lỗi phụ thuộc danh mục GV thực tế. Đây là kết quả khảo sát nguồn ban đầu. Sau các quyết định của Khoa, bản đã đối soát được nhập trên staging cục bộ với 535 lần học / 532 SV, không có lỗi. Dữ liệu đã được tiếp nhận vào Turso vận hành sau một lượt diễn tập riêng trên backup production. V1/V2 chỉ là nguồn nghiệp vụ, không dùng chuyển điểm hoặc file cũ.

## Ánh xạ Thực tập cũ

Khoa có thao tác **xem trước ánh xạ Thực tập cũ → xác nhận** tại trang chọn học kỳ/nhóm môn. Cần sao lưu DB và file trước khi áp dụng trên môi trường vận hành. Ánh xạ hợp lệ đưa đợt cũ vào Hè 2025–2026, các hồ sơ thiếu/mơ hồ được liệt kê để đối soát và vẫn nằm ở nguồn cũ.

Công cụ CLI dành cho **bản sao SQLite local đã tồn tại**:

```bash
# Chỉ đọc và in thống kê; không tạo schema khi dry-run.
npm run academic:migrate -- --database=file:/absolute/path/staging-copy.db

# Tạo backup trước khi thêm schema và ánh xạ hồ sơ hợp lệ.
npm run academic:migrate -- --database=file:/absolute/path/staging-copy.db --apply
```

Script từ chối URL remote và database RAM, không lấy URL production từ môi trường. Backup `VACUUM INTO` là bản sao SQLite nhất quán, không nhất thiết giống từng byte do SQLite có thể thay metadata nội bộ. Kết quả có đường dẫn backup, số hồ sơ mới/cũ và danh sách blocked. Chạy lại không tạo trùng; mã học phần thay đổi sau ánh xạ bị đưa vào danh sách đối soát.

Mã không thay/xóa bảng nghiệp vụ hoặc file TT cũ. Các màn TT cũ là nguồn ghi duy nhất của đợt legacy; lớp mới dùng dữ liệu enrollment độc lập. Để rollback một môi trường đã có ghi mới, cần dừng ghi và đối soát delta/audit trước khi phục hồi backup, không xóa các bảng mới một cách tự động.

## Kiểm chứng đã thực hiện

| Lệnh | Phạm vi |
| --- | --- |
| `npm run lint` | TypeScript frontend, Express, Worker và scripts |
| `npm run test:academic` | 63 kiểm thử schema/campaign, học lại/nhiều lớp, import, quyền, GVNX, điểm/phiên bản, chat, FAQ, thông báo, HTTP PDF/XLSX và CLI backup |
| `npm run test:academic:ui` | 14 luồng Chromium và hai luồng nghiệm thu tùy chọn trên bản sao production: quản trị lớp/GVNX, SV nộp/hai GV chấm/ẩn điểm, khóa/mở lại, mobile, chat xuyên lớp/đính kèm, hai hồ sơ, export, xem trước thông báo, cache khi đổi nhóm và kiểm tra kết nối email |
| `npm run test:academic:d1` | Schema/command trigger trên D1 cục bộ của Wrangler: tiếp nhận, chặn revision cũ và rollback toàn bộ khi lỗi ràng buộc muộn |
| `npm run build` | Bundle frontend và server |
| `npm run test:staging` | 16 kiểm thử sao lưu/đối soát/WAL, readiness, cấu hình, cron, hộp thư staging, backup Turso, chờ đúng phiên bản phát hành và chẩn đoán email không gửi thư |

Các kiểm thử dùng database riêng và file tạm. Kiểm thử HTTP so sánh byte PDF tải về, kiểm tra quyền trước cả 304 và xác nhận SV không nhận payload điểm. Kiểm thử giao diện chặn truy cập các domain ngoài localhost. Ảnh/trace khi chạy lưu trong `scratch/academic-ui-results` (gitignore).

Kiểm thử trên D1 local không thay cho nghiệm thu D1 REST remote. Đã kiểm kê/tải sao lưu đủ 664 tệp R2 thật; người quản lý xác nhận Google OAuth thật đăng nhập được sau phát hành. Người quản lý đã xác nhận nhận email nghiệm thu từ production. Chưa nghiệm thu luồng upload R2 qua UI, quyền nội dung Drive hoặc hiệu năng trên dữ liệu production. Build còn cảnh báo bundle JavaScript lớn; đây chưa phải kết quả đo hiệu năng.

<a id="ranh-gioi-cua-ban-cai-dat"></a>

## Ranh giới của bản cài đặt

| Nội dung | Cách hoạt động hiện tại |
| --- | --- |
| Mô hình dữ liệu | Năm học/học phần là thực thể nghiệp vụ; năm nằm trong semester, học phần là danh mục có kiểu. Phân công/phiên bản/đánh giá lưu JSON có kiểu theo enrollment, chưa tách mọi bảng của ERD chuẩn hóa |
| Thực tập legacy | Đọc trực tiếp phân công/PDF/điểm từ bảng gốc. Nội dung/hạn, nguyện vọng, chat và các tác vụ cũ mở trong campaign TT qua adapter nguồn gốc. Lưu trữ/mở lại toàn bộ đợt legacy cùng lúc |
| Thực tập mới | Đăng ký tối đa 5 nguyện vọng, duyệt/xác nhận, đề xuất và tự phân công GVHD theo kỳ, PDF/điểm 20/20/60 theo enrollment. Chưa đưa toàn bộ export ZIP/Sheets và các tiện ích quản trị cũ sang lớp mới |
| Quota TT mới | Mặc định GS/PGS 5, TS 8, nhóm khác 10; API quota nhận ghi đè internshipMax riêng theo GV/kỳ. Chưa có màn sửa các mức mặc định theo học kỳ |
| Tiến độ chấm Dự án | Hồ sơ hiển thị riêng phần GVHD/GVNX và tổng khi đủ; XLSX có hai cột điểm, để trống phần thiếu. Chưa có biểu đồ thống kê riêng |
| Import/phân công | Preview 30 phút, ràng buộc người tạo, áp dụng lặp an toàn; revision chung có thể yêu cầu xem lại khi lớp khác thay đổi. Command quá 1.800.000 byte bị từ chối trước ghi và yêu cầu chia file |
| Phân trang | Backend lọc quyền trước trả dữ liệu lớp, UI phân trang 25 hồ sơ, import 20 dòng/trang; API campaign phân trang server, export lấy đủ bộ lọc; chưa tối ưu snapshot toàn DB bằng truy vấn phân trang trực tiếp |
| Link Drive | Kiểm tra HTTPS và hostname drive.google.com/docs.google.com; không xác minh quyền xem hoặc đóng băng nội dung Drive bên ngoài khi khóa link |
| Email | Sự kiện ghi bền vững cùng command, unique event chống tạo trùng, kiểm lại quyền trước gửi; dùng quota/queue hiện có. Chưa nghiệm thu giới hạn đồng thời của nhiều tiến trình gửi trên provider thật |
| Worker | Không chứa router academic mới; tiếp tục để workflow Worker tắt và dùng Express cho phần mở rộng |

Đã thêm lockfile, khai báo Google Auth/React types và cập nhật SheetJS lên bản 0.20.3 từ [nguồn phân phối chính thức](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/). Các bản sửa dependency tương thích đã được áp dụng; audit còn các cảnh báo mức moderate trong cây phụ thuộc, cần xử lý riêng khi nâng các tích hợp liên quan. Không dùng `npm audit fix --force` để nâng major hàng loạt trong lần này.

Đã diễn tập trên backup Turso thật và đối soát bảo toàn đủ 20 bảng nguồn trước/sau chuyển đổi. Sau phát hành, tiếp tục xử lý 208 hồ sơ TT thiếu học phần và 127 hồ sơ Dự án thiếu GVHD; nghiệm thu đăng nhập Google và các thao tác có quyền trên HTTPS theo [quy trình phát hành](PRODUCTION_RELEASE.md).

## Duyệt đề tài Dự án

Đã bổ sung Pending/duyệt theo lần học, quyền GVHD chính sửa và duyệt, hạn nộp riêng khi duyệt muộn và kiểm tra phiên bản đề tài khi chấm. Schema v3 công nhận tên có sẵn trước nâng cấp; không gán giả GV duyệt. Quy tắc, API và lệnh preview: [TOPIC_APPROVAL.md](TOPIC_APPROVAL.md).

## Tải dữ liệu theo chức năng và cache phiên

Luồng đọc học vụ dùng SQL theo campaign/enrollment, phân trang và projection; frontend nạp màn/chi tiết/PDF theo nhu cầu. API legacy có phân trang tùy chọn, export đủ bộ lọc. Cache RAM/ETag dùng chung với giới hạn 100 mục/20 MiB, kiểm lại quyền khi mở lại, vô hiệu hóa liên quan sau ghi và đồng bộ giữa tab. Thư viện XLSX, DOCX và ZIP nạp khi thao tác. Xem [PERFORMANCE.md](PERFORMANCE.md) cho API và nghiệm thu; không cần migration hoặc thay tệp R2.
