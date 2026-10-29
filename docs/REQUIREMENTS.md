# Đặc tả yêu cầu quản lý Thực tập và Dự án theo học kỳ

Ngày cập nhật: **29/10/2026**. Trạng thái: **đã chốt nghiệp vụ; đã cài đặt quản lý học kỳ/nhóm môn và Dự án trên backend Express**. Phạm vi mã, kết quả kiểm thử và các bước đưa dữ liệu thật vào hệ thống nằm tại [hướng dẫn triển khai](IMPLEMENTATION_STATUS.md).

Tài liệu này là nguồn yêu cầu nghiệp vụ chính. [Thiết kế kiến trúc](ARCHITECTURE.md) phân biệt mô hình nghiệp vụ, thiết kế chuẩn hóa và cách lưu trữ thực tế; [README](../README.md) hướng dẫn chạy và vận hành. Chưa chuyển đổi hoặc import vào database đang vận hành.

**Điều chỉnh đã chốt:** quản lý chung theo học kỳ → nhóm môn cho cả ba vai trò. Lớp học phần là bộ lọc và đơn vị xuất danh sách; lần học vẫn giữ riêng. Nội dung/hạn/trạng thái thuộc nhóm; chat nhóm gộp theo GVHD/nhóm/kỳ, gồm cả Thực tập cũ. Chi tiết cài đặt và chuyển đổi tại [GROUP_MANAGEMENT.md](GROUP_MANAGEMENT.md).

## 1. Phạm vi và nguồn đối chiếu

### 1.1. Hiện trạng và đích mở rộng

| Phạm vi | Hiện trạng trong repository | Đích thiết kế |
| --- | --- | --- |
| Thực tập | Đã có đăng nhập, hồ sơ, nguyện vọng, xác nhận nơi thực tập, phân công, PDF, chấm điểm, chat và thông báo | Bảo toàn quy trình, chuyển dữ liệu nghiệp vụ sang từng lần học |
| Học kỳ/lớp học phần | Đã có bộ chọn học kỳ/nhóm môn, cấu hình chung và lần học; đợt Thực tập cũ có adapter trong cùng giao diện | Năm học → học kỳ → nhóm môn → lớp học phần → lần học |
| Dự án | Đã có import xem trước/xác nhận, GVHD/GVNX, đề tài, phiên bản bài và điểm 60/40 | Nghiệm thu dữ liệu/tích hợp thật trước vận hành |
| Quyền truy cập | API mới kiểm tra lớp, lần học, vai trò và phiên bản; siết nhận diện GV ở API cũ | Bảo đảm cùng hợp đồng trên mọi backend được bật |

“Hiện có” chỉ xác nhận sự tồn tại của luồng, không thay thế việc kiểm tra các ràng buộc backend khi mở rộng. Các yêu cầu dưới đây là hành vi phải nghiệm thu của hệ thống đích.

### 1.2. Nguồn nghiệp vụ

Các workbook dưới đây nằm tại thư mục gốc của workspace; tên hiển thị được chuẩn hóa Unicode để dễ đọc. Chúng là dữ liệu làm việc cục bộ, không phải điều kiện để clone repository hoặc chạy ứng dụng.

| Mã nguồn | Workbook / vùng đối chiếu | Vai trò |
| --- | --- | --- |
| SRC-01 | `Đánh giá Dự án Khoa học_Dự án Công nghệ (V1) .xlsx`, sheet `Triển khai`, đặc biệt hàng 12 và 15–20 | Báo cáo cá nhân, slide/video, GVHD 0.6 và GVNX 0.4 |
| SRC-02 | `Đánh giá Dự án Khoa học_Dự án Công nghệ (V2).xlsx`, bốn sheet INT3131/INT3132 | Đề tài, đồng hướng dẫn, liên kết, điểm, học lại và các ngoại lệ hành chính |
| SRC-03 | `HKI-26-27 GVHD DACN_DAKH_20261007.xlsx`, sheet `DACN` và `DAKH` | Mẫu import cho HKI 2026–2027, mã lớp trong cột `Mã LMH` |
| SRC-04 | Các quyết định đã xác nhận với chủ hệ thống ngày 29/10/2026 | Làm rõ lớp 1/2, tiếp nhận sinh viên, phân công GVNX, chấm điểm và chuyển đổi |

V1/V2 dùng để hiểu nghiệp vụ, **không dùng để chuyển điểm hoặc tài liệu cũ**. Quy trình nộp trên Canvas trong V1 được thay bằng bộ bài nộp trên hệ thống và liên kết Drive theo quyết định SRC-04. V2 bổ sung điểm, liên kết thư mục và cột “Xét TN”; vị trí cột khác giữa các sheet, có điểm dạng chuỗi dấu phẩy thập phân. Không lấy vị trí cột hoặc hình thức ghi chú của V1/V2 làm định dạng import cố định.

Kiểm tra SRC-03 ghi nhận:

- Hai sheet chính có các lớp `INT3132 1–4`, `INT3131 1–4`; hậu tố là số lớp, không phải học kỳ.
- DACN có 415 dòng MSSV hợp lệ, 314 MSSV duy nhất; thêm một dòng số 338 có trường “Mã SV” là `134`, phải đối soát. DAKH có 281 dòng hợp lệ, 221 MSSV duy nhất.
- Có 101 nhóm trùng MSSV/lớp ở DACN, 60 nhóm ở DAKH; nhiều dòng bổ sung GVHD cho thông tin còn trống. Không được đếm từng dòng thành một lần học.
- Có 3 MSSV hợp lệ xuất hiện ở cả hai học phần. Không áp dụng ràng buộc “mỗi tài khoản chỉ được học một trong DACN/DAKH”.
- Bảy sheet ẩn gồm các danh sách bổ sung, đã đăng ký, chưa hủy và thống kê; mặc định không nhập. Ngày sinh dùng cả giá trị ngày Excel. Một số email GVHD là email cá nhân, cần ánh xạ về danh mục chung.

Các con số trên mô tả file đã khảo sát, không phải tổng tuyển sinh chính thức hoặc giá trị cố định trong chương trình.

### 1.3. Chưa thuộc phiên bản này

- Diện “Không cần giảng viên hướng dẫn”, miễn/quy đổi học phần và “Xét TN”.
- Nhập điểm, PDF hoặc liên kết lịch sử từ V1/V2; đồng bộ điểm tự động với Cổng Đào tạo.
- Rubric chấm theo nhiều tiêu chí, nhận diện chuyên môn bằng AI, danh mục lĩnh vực nghiên cứu.
- Hội đồng bảo vệ, lịch thi, ký danh sách thi, chữ ký số hoặc tài khoản doanh nghiệp.

## 2. Thuật ngữ, vai trò và quy tắc chung

### 2.1. Mô hình học vụ

| Thuật ngữ | Ý nghĩa |
| --- | --- |
| Năm học | Ví dụ `2025–2026`, `2026–2027` |
| Học kỳ | HKI, HKII hoặc Hè thuộc một năm học |
| Học phần | Danh mục môn có mã và nhóm `internship` hoặc `project` |
| Lớp học phần | Một lần mở học phần trong học kỳ, ví dụ HKI 2026–2027 / `INT3132 1` |
| Lớp khóa học | Thông tin hồ sơ SV, ví dụ `QH-2023-I/CQ-I-CS1`; khác lớp học phần |
| Lần học (`Enrollment`) | Một sinh viên tham gia một lớp; đơn vị quản lý phân công, bài nộp và điểm |
| GVHD / đồng hướng dẫn | Giảng viên hướng dẫn chính / cùng hướng dẫn một lần học |
| GVNX | Giảng viên nhận xét độc lập cho một lần học Dự án |

| Nhóm môn | Học phần ban đầu | Công thức điểm |
| --- | --- | --- |
| Thực tập | INT4002 — Thực tập Doanh nghiệp; INT3508 — Thực tập Chuyên ngành; INT4003 — Thực tập Doanh nghiệp Nhật Bản | 20% tiến độ + 20% báo cáo + 60% doanh nghiệp/GV |
| Dự án | INT3132 — Dự án công nghệ | 60% GVHD + 40% GVNX |
| Dự án | INT3131 — Dự án khoa học | 60% GVHD + 40% GVNX |

Học lại ở lớp/kỳ khác tạo lần học mới, giữ lịch sử cũ. Danh mục người dùng, giảng viên, doanh nghiệp dùng chung; tư cách “GVNX” là phân công của lần học, không phải vai trò tài khoản toàn hệ thống.

<a id="22-ma-tran-quyen-du-an"></a>

### 2.2. Ma trận quyền Dự án

Tất cả quyền đều yêu cầu đăng nhập và đúng phạm vi dữ liệu. Quyền ghi còn phụ thuộc trạng thái nhóm môn, thời hạn và khóa nghiệp vụ.

| Thao tác | SV sở hữu lần học | GVHD chính | Đồng hướng dẫn | GVNX | Khoa/Admin |
| --- | --- | --- | --- | --- | --- |
| Xem thông tin, đề tài, bài nộp | Có | Được phân công | Được phân công | Được phân công | Có |
| Sửa tên đề tài, nộp/thay bộ bài | Trong hạn, chưa khóa | Không | Không | Không | Mở lại/điều chỉnh có lý do |
| Đổi GVHD/GVNX, tiếp nhận/rút SV | Không | Không | Không | Không | Có |
| Xem điểm hai vai trò/tổng kết | Không | Có | Không | Có | Có |
| Nhập/sửa điểm GVHD | Không | Có | Không | Không | Không nhập thay; quản lý khóa/mở |
| Nhập/sửa điểm GVNX | Không | Không | Không | Có | Không nhập thay; quản lý khóa/mở |
| Khóa/mở điểm, mở lại bài | Không | Không | Không | Không | Có, lưu lý do |
| Xuất bảng điểm | Không | Phần được quyền xem | Không | Phần được quyền xem | Theo lớp/học kỳ |

Admin đồng thời là giảng viên chỉ chấm dưới đúng phân công giảng viên của mình. Khoa xem được tiến độ và điểm để đối soát, khóa và xuất file.

### 2.3. Quy ước thời gian và dữ liệu

- Giao diện nhập/hiển thị thời gian theo `Asia/Ho_Chi_Minh` (UTC+07:00). Khoảng thao tác gồm thời điểm mở và đóng; đầu/cuối chưa cấu hình là không giới hạn phía đó. Nhóm nháp/lưu trữ chặn các thao tác vận hành; Khoa chuẩn bị danh sách/phân công trong nhóm nháp.
- Mã SV là chuỗi định danh 8 chữ số đối với các danh sách hiện tại; email sinh viên là `<MSSV>@vnu.edu.vn`. Hồ sơ tự sửa không cấp thêm quyền lớp hoặc thay đổi danh tính đăng nhập.
- Giảng viên đối chiếu bằng danh mục chung; tên hiển thị không thay thế định danh giảng viên. Bộ môn/đơn vị là căn cứ ưu tiên chuyên môn trong phiên bản này.
- “Không có điểm” khác điểm `0`. Điểm và trạng thái chấm không được suy ra chỉ từ trạng thái PDF.

<a id="3-danh-muc-yeu-cau-va-tieu-chi-nghiem-thu"></a>

## 3. Danh mục yêu cầu và tiêu chí nghiệm thu

Ký hiệu trạng thái: **HC** = có luồng hiện tại cần bảo toàn/kiểm chứng; **MR** = mở rộng mới; **CĐ** = chuyển đổi dữ liệu. Mỗi hàng gồm tác nhân, điều kiện, hành vi và kết quả nghiệm thu. Mã `TC-*` được chi tiết ở mục 4; các mục thiết kế/API tương ứng nằm trong [ma trận truy vết thiết kế](ARCHITECTURE.md#11-ma-tran-truy-vet).

### 3.1. Nền học vụ và truy cập

| Mã / trạng thái | Tác nhân và điều kiện | Yêu cầu | Nghiệm thu |
| --- | --- | --- | --- |
| REQ-CLS-01 / MR | Khoa quản lý học vụ | Tạo năm học, HKI/HKII/Hè, học phần và nhiều lớp mỗi học phần/kỳ; không trùng định danh lớp trong cùng kỳ | TC-01: mở tám lớp HKI 2026–2027; lớp cùng mã ở kỳ khác độc lập |
| REQ-CLS-02 / MR | Một SV có nhiều lần học | Mỗi lần học duy nhất theo SV/lớp; tách đề tài, nơi TT, phân công, PDF và điểm | TC-02: học lại, đồng thời học hai nhóm/hai học phần không ghi đè nhau |
| REQ-CLS-03 / MR | Khoa cấu hình nhóm môn/kỳ | Hạn đăng ký/xác nhận/GVHD của TT, khai đề tài Dự án, nộp/chấm, kế hoạch/hướng dẫn/FAQ dùng chung trong nhóm/kỳ | TC-03: chỉnh một lần áp dụng mọi lớp trong nhóm; nhóm khác và kỳ khác độc lập |
| REQ-CLS-04 / MR | Khoa đổi trạng thái nhóm/kỳ | Nhóm `draft` chỉ Khoa quản lý; `active` vận hành; `archived` chỉ đọc; Khoa mở lại cả nhóm có lý do/lịch sử | TC-04: mọi lớp trong nhóm cùng trạng thái, API ghi kể cả chat bị chặn khi lưu trữ |
| REQ-AUTH-01 / HC+MR | Người dùng Google OAuth | Dùng chung xác thực; giữ admin/GV theo danh mục; SV được đăng nhập nếu đủ điều kiện TT hoặc có lần học Dự án hợp lệ | TC-05: người chỉ có tên DS Dự án đăng nhập được dù ngoài khóa TT; người không đủ cả hai bị từ chối |
| REQ-AUTH-02 / MR | SV đăng nhập | Dự án chỉ truy cập lớp đã được Khoa tiếp nhận; TT giữ quy tắc khóa đang mở/ngoại lệ SV đã có trong danh sách hiện tại | TC-06: SV hợp lệ TT không tự có quyền Dự án; xóa/rút khỏi lớp thu hồi quyền ngay cả khi JWT còn hạn |
| REQ-AUTH-03 / MR | SV/GV/Admin chọn học kỳ/nhóm môn | Chỉ liệt kê nhóm/lớp được phép; kiểm tra vai trò tài khoản, tư cách tham gia/phân công và phạm vi trên mọi API | TC-07: đổi `classId`, `enrollmentId`, phiên bản hoặc URL tải không vượt được quyền |
| REQ-AUTH-04 / HC+MR | SV xem dashboard, bài nộp, thông báo | Không trả điểm thành phần/tổng kết qua UI, API, file xuất hoặc thông báo SV; tra cứu chính thức ở Cổng Đào tạo | TC-08: kiểm tra payload SV và nội dung email; không chỉ ẩn trường trên giao diện |

### 3.2. Bảo toàn nghiệp vụ Thực tập

| Mã / trạng thái | Tác nhân và điều kiện | Yêu cầu | Nghiệm thu |
| --- | --- | --- | --- |
| REQ-INT-01 / HC | SV trong hạn đăng ký | Tối đa 5 nguyện vọng/lần học; công ty chính thức, công ty tự liên hệ hoặc thực tập tại trường; có hủy/đăng ký lại theo hạn | TC-09: nguyện vọng chỉ thuộc lớp TT tương ứng, không xuất hiện trong lớp Dự án |
| REQ-INT-02 / HC | Khoa duyệt công ty/đăng ký | Công ty tự liên hệ có trong danh mục thẩm định nội bộ được duyệt tự động; trường hợp khác chờ duyệt; xuất/đánh dấu gửi DN, XLSX/ZIP/Sheets | TC-09: danh mục nội bộ không lộ cho SV; giữ bộ lọc và dữ liệu gửi DN |
| REQ-INT-03 / HC | SV trong hạn xác nhận | Xác nhận đúng một nơi đã được duyệt và cam kết được tiếp nhận; kết quả phỏng vấn ngoài hệ thống; Khoa xử lý school/partner | TC-10: không xác nhận công ty chưa duyệt, không có hai nơi chính thức/lần học |
| REQ-INT-04 / HC | Khoa hoặc SV đã được GV đồng ý | Nguồn phân công chính thức là bảng phân công; SV đề xuất GVHD khi đã được đồng ý; chưa tìm được GV thì Khoa phân công; CN chỉ đồng hướng dẫn | TC-11: đổi GV trong đăng ký tại trường đồng bộ phân công và lịch sử; tên không ánh xạ được phải xử lý rõ, không lưu hai nguồn mâu thuẫn |
| REQ-INT-05 / HC | Khoa quản lý quota/phân công TT | Mặc định GS/PGS 5, TS 8, ThS/khác 10, tính cả chính và đồng HD trên các lớp TT cùng học kỳ; quota riêng ghi đè; tự phân công không vượt quota, không đè đề xuất agreed đang chờ; không tính Dự án vào quota TT | TC-11: đề xuất đã được GV đồng ý vượt quota vẫn được ghi nhận theo luồng Khoa, chỉ cảnh báo UI, không phát email vượt quota |
| REQ-INT-06 / HC | SV nộp, GVHD chính chấm | PDF ≤10 MB; tiến độ 20%, báo cáo 20%, doanh nghiệp/GV 60%; báo cáo định kỳ trao đổi ngoài hệ thống; nộp điểm chính thức, sửa trước khóa | TC-12: đủ ba điểm 0–10, làm tròn 1 chữ số; chỉ GVHD chính ghi điểm; không có bước lưu nháp điểm |
| REQ-INT-07 / HC | GV xử lý SV bỏ môn hoặc yêu cầu sửa | Cho nhập ba điểm 0 kèm lý do dù chưa có PDF; không tạo trạng thái báo cáo đã chấp nhận giả; hỗ trợ yêu cầu sửa/hủy yêu cầu | TC-12: hoàn thiện điểm không đồng nghĩa SV đã nộp file; SV không xem điểm |
| REQ-INT-08 / HC | Khoa xóa nguyện vọng | Chặn xóa nơi TT đã khóa; xóa quan hệ final chưa khóa và gỡ nguồn đề xuất khi cần; giữ phân công chính thức độc lập | TC-10: không để tham chiếu mồ côi, không xóa ngầm lịch sử hoặc dữ liệu lớp khác |

### 3.3. Import, hướng dẫn và đề tài Dự án

| Mã / trạng thái | Tác nhân và điều kiện | Yêu cầu | Nghiệm thu |
| --- | --- | --- | --- |
| REQ-IMP-01 / MR | Khoa chọn file và học kỳ | Đọc sheet chính DACN/DAKH, nhận diện tiêu đề, lấy lớp từ Mã LMH, tách lớp khóa học; không tự nhập sheet ẩn | TC-13: tạo/ánh xạ tám lớp đúng HKI; sheet lạ không được nhập ngầm |
| REQ-IMP-02 / MR | Khoa xem trước danh sách | Gộp MSSV/lớp, bổ sung ô trống, hiển thị nguồn sheet/hàng; khác giá trị cùng trường phải đối soát; chuẩn hóa MSSV, Unicode, ngày Excel và ngày dạng chuỗi | TC-14: báo dòng MSSV 134; dòng trùng không tăng số lần học; ngày đúng lịch và không lệch ngày |
| REQ-IMP-03 / MR | File có tên/email GVHD | Đối chiếu danh mục chung bằng email và tên đã chuẩn hóa; thiếu/không khớp/chứa nhiều GV phải được ánh xạ rõ chính/đồng HD; không tự tạo GV bằng suy đoán | TC-15: email cá nhân, tên gần giống, CN làm chính hoặc thiếu email được báo để Khoa giải quyết |
| REQ-IMP-04 / MR | Khoa xác nhận preview hợp lệ | Xem trước → xử lý/loại lỗi → xác nhận; nhập lại không nhân bản; không xóa người vắng file; không ghi đè điểm/bài nộp; thay đổi GVHD/đề tài đã có phải được xác nhận | TC-16: gửi lại commit trả kết quả cũ; thay đổi dữ liệu kể từ preview yêu cầu xem lại |
| REQ-PRJ-01 / MR | SV thuộc DS, chưa có GVHD | Cho vào lớp, xem hướng dẫn và khai đề tài/nộp theo hạn; Khoa quản lý GVHD chính/đồng HD qua import hoặc thủ công | TC-17: thiếu GVHD không ngăn đăng nhập; chưa đủ điều kiện thì GVNX chờ phân công |
| REQ-PRJ-02 / MR | SV trong hạn khai đề tài | SV khai/sửa tên đề tài, không duyệt riêng; lưu lịch sử, tên đề tài bắt buộc khi hoàn tất bài; Khoa có thể điều chỉnh có lý do | TC-18: đề tài theo lần học; snapshot được chấm không đổi sau khi bắt đầu chấm |
| REQ-PRJ-03 / MR | Khoa phân công giảng viên | Tối đa một GVHD chính và một GVNX/lần học, có đồng HD; CN chỉ đồng HD; GVNX không trùng bất kỳ người hướng dẫn nào | TC-19: cùng kiểm tra cho import, gán tay và tự phân công |

### 3.4. Tự phân công GVNX

| Mã / trạng thái | Tác nhân và điều kiện | Yêu cầu | Nghiệm thu |
| --- | --- | --- | --- |
| REQ-REV-01 / MR | Khoa chạy cho lớp hoặc học kỳ | Ứng viên là GV đủ điều kiện đang hướng dẫn chính/đồng HD Dự án trong cùng học kỳ; loại CN và người hướng dẫn SV đích | TC-20: không dùng GV chỉ hướng dẫn TT/kỳ khác; vai trò nhận xét không tự làm phát sinh tư cách ứng viên |
| REQ-REV-02 / MR | Có GVHD chính và ứng viên | Ưu tiên cùng bộ môn GVHD chính, rồi ít bài nhận xét hơn tính gộp DACN/DAKH toàn kỳ; thiếu người thì khác bộ môn và đánh dấu | TC-21: kiểm tra cùng bộ môn, chuyển bộ môn, thiếu thông tin bộ môn và cân bằng tải |
| REQ-REV-03 / MR | Khoa cấu hình tải nhận xét | Trần GVNX theo GV/học kỳ, mặc định không đặt trần; tính phân công hiện có và dự kiến; không dùng quota HD Thực tập | TC-22: không vượt trần khi áp dụng hoặc chạy đồng thời; thiếu GVHD/hết ứng viên có lý do chưa phân công |
| REQ-REV-04 / MR | Khoa xem preview | Xem và sửa phương án trước áp dụng; chạy lại chỉ bổ sung chưa có GVNX; gán tay vẫn kiểm tra điều kiện; lưu lịch sử và người thực hiện | TC-23: không thay người đã gán; preview cũ bị từ chối nếu nguồn thay đổi; đổi sau khi có điểm phải qua mở lại bài |

### 3.5. Bài nộp và điểm Dự án

| Mã / trạng thái | Tác nhân và điều kiện | Yêu cầu | Nghiệm thu |
| --- | --- | --- | --- |
| REQ-SUB-01 / MR | SV hoàn tất nộp trong hạn | Bắt buộc tên đề tài, 1 PDF ≤10 MB, 1 link Drive slide và 1 link Drive video demo; mỗi SV nộp riêng kể cả làm chung | TC-24: thiếu một thành phần chưa hoàn tất; chặn PDF sai loại/quá dung lượng ở UI/API |
| REQ-SUB-02 / MR | SV/GV xem bài | Lưu PDF trong R2, lưu metadata/link; hướng dẫn cấp quyền xem Drive; GV được phân công xem PDF inline/tải file | TC-25: kiểm tra truy cập theo lớp, lần học và phiên bản; link hợp lệ không đồng nghĩa đã kiểm chứng quyền Drive |
| REQ-SUB-03 / MR | Chưa có điểm, còn hạn | Cho thay bộ bài, giữ phiên bản và lịch sử; GVHD/GVNX có thể yêu cầu sửa, không tự gia hạn hoặc mở khóa bài đã chấm | TC-26: không đè PDF đã lưu; cache lấy đúng phiên bản; quá hạn cần Khoa mở lại |
| REQ-SUB-04 / MR | Có điểm đầu tiên hoặc Khoa mở lại | Khóa bộ bài/snapshot đề tài; chỉ Khoa mở lại có lý do và hạn sửa; tạo phiên bản mới, cả hai phần điểm phải nộp lại; giữ phiên bản/điểm cũ | TC-27: không ghép điểm ở hai phiên bản; khóa điểm phải được mở trước khi mở lại bài |
| REQ-GRD-01 / MR | GVHD chính/GVNX trong hạn chấm | Mỗi vai trò nhập 1 điểm 0–10, có trường nhận xét, bắt buộc lý do khi điểm 0; chỉ sửa phần mình; lưu là đã nộp về Khoa; thấy điểm đã nộp của nhau ngay | TC-28: đồng HD/không được phân công bị từ chối; không có trạng thái điểm nháp hoặc hành động nộp của người khác |
| REQ-GRD-02 / MR | Cả hai phần đã nộp ở phiên bản hiện tại | Tổng kết `round(0.6 × GVHD + 0.4 × GVNX, 1)`; thiếu phần nào thì tổng kết rỗng; sửa điểm trước khóa cập nhật tổng | TC-29: 8.0 và 8.5 cho 8.2; điểm 0 hợp lệ, thiếu điểm không biến thành 0 |
| REQ-GRD-03 / MR | SV không nộp/bỏ môn | Mỗi GV chủ động nhập 0 kèm lý do, kể cả chưa có bộ bài hoàn chỉnh; không tự điền điểm vai trò còn lại hoặc giả trạng thái đã nộp | TC-30: có thể hoàn thành hai điểm 0 và tổng 0.0; dữ liệu vẫn ghi nhận chưa nộp bài |
| REQ-GRD-04 / HC+MR | Khoa chốt điểm | Khóa/mở khóa theo lần học hoặc hàng loạt theo bộ lọc trong nhóm/kỳ; chỉ chốt khi đủ phần hiện hành; sau mở khóa GV sửa trong hạn, Khoa không nhập thay | TC-31: khóa chặn mọi đường sửa; dashboard phân biệt chờ GVHD, chờ GVNX, đủ điểm, đã khóa |
| REQ-GRD-05 / MR | Khoa xuất dữ liệu | XLSX theo lớp/học kỳ có năm học, kỳ, lớp, MSSV, tên, đề tài, GVHD/GVNX, hai điểm, tổng, tình trạng nộp/khóa; điểm thiếu để trống | TC-32: xuất không lẫn kỳ, phiên bản cũ hoặc điểm TT; tổng hợp đủ điểm và danh sách thiếu riêng |

### 3.6. Trao đổi, vận hành và chuyển đổi

| Mã / trạng thái | Tác nhân và điều kiện | Yêu cầu | Nghiệm thu |
| --- | --- | --- | --- |
| REQ-COM-01 / HC+MR | SV/GV trao đổi | Chat riêng theo lần học/GVHD, nhóm theo nhóm môn/học kỳ/GVHD; phân công quyết định thành viên; giữ đính kèm và dấu đọc, không gộp các kỳ | TC-33: rút lớp/đổi GV thu hồi quyền; GVNX nhận xét qua panel, chưa bổ sung chat GVNX riêng |
| REQ-COM-02 / HC+MR | Khoa/sự kiện nghiệp vụ gửi thông báo | Nhắm toàn nhóm hoặc các lớp được chọn, sự kiện riêng theo lần học; xem trước người nhận và kiểm lại trước gửi; thông báo web độc lập email; quota dùng chung, FIFO, tự xử lý hàng đợi; giới hạn tần suất nhắc theo lớp/vai trò | TC-34: không gửi lẫn lớp hoặc quá quota; lỗi gửi không làm mất nghiệp vụ chính |
| REQ-COM-03 / HC+MR | Hoàn tất đánh giá | Tùy cấu hình nhóm/kỳ, SV nhận thông báo hoàn tất không chứa điểm; Dự án chỉ phát khi đủ hai phần hiện hành; không phát web/email từng lượt nộp điểm cho Admin | TC-34: một người nộp chưa thông báo hoàn tất; Admin theo dõi dashboard; nhắc GVHD/GVNX theo phần còn thiếu |
| REQ-COM-04 / HC+MR | Khoa quản lý hướng dẫn/FAQ | Giữ kế hoạch Markdown/import Word, hướng dẫn GV, FAQ theo vai trò và câu hỏi; nội dung hướng dẫn/FAQ chung có phạm vi nhóm môn/kỳ | TC-03: nhóm Dự án không nhận kế hoạch/nội dung mặc định Thực tập |
| REQ-MIG-01 / CĐ | Chuyển Thực tập hiện tại | Gắn vào Hè 2025–2026 theo mã học phần; giữ tài khoản, nguyện vọng, nơi TT, phân công, file, điểm, chat, thông báo, lịch sử | TC-35: đối soát số lượng/giá trị/quyền; mã không rõ đưa danh sách xử lý, không đoán hoặc bỏ mất |
| REQ-MIG-02 / CĐ | Tạo dữ liệu Dự án mới | HKI 2026–2027 có tám lớp; chỉ tiếp nhận qua preview SRC-03 đã đối soát; DS chưa có GVHD vẫn được nhận | TC-16: không nhập sheet ẩn/điểm V1/V2, không nhân bản người dùng khi SV đã có tài khoản TT |
| REQ-MIG-03 / CĐ | Triển khai schema/API mới | Migration có phiên bản, sao lưu DB/file và ánh xạ cũ→mới, có chạy lại và phương án rollback; API cũ chỉ trỏ lớp TT cũ xác định tường minh | TC-36: không chọn lớp đầu tiên khi nhiều lần học; chỉ áp dụng migration có sao lưu trên staging cục bộ trong đợt này |
| REQ-NFR-01 / MR | Tải file/cache/xuất danh sách | File và cache phân biệt lớp/lần học/phiên bản, xóa cache khi đổi nhóm/kỳ, đăng xuất/đổi quyền; phân trang có phạm vi; giữ lịch sử theo kỳ | TC-25/33: cùng SV ở hai lớp không dùng nhầm PDF/cache; trang cache không trả dữ liệu của tài khoản trước |
| REQ-DOC-01 / MR | Bàn giao tài liệu | Phân biệt HC/MR/CĐ; yêu cầu có mã, điều kiện, nghiệm thu, ánh xạ thiết kế/API; giữ README hướng dẫn vận hành và liên kết có thể kiểm tra | TC-37: đọc độc lập ba tài liệu không hiểu nhầm thiết kế đã triển khai; không còn đặc tả trùng mâu thuẫn trong README |

### 3.7. Vận hành chung theo nhóm môn

| Mã / trạng thái | Tác nhân và điều kiện | Yêu cầu | Nghiệm thu |
| --- | --- | --- | --- |
| REQ-CAM-01 / MR | Cả ba vai trò sau đăng nhập | Chọn học kỳ rồi mở Thực tập/Dự án; giữ nhóm/kỳ khi chuyển chức năng; SV chọn lần học cá nhân | TC-38: tám lớp Dự án trong một nhóm; SV có hai hồ sơ DACN/DAKH |
| REQ-CAM-02 / MR | Khoa/GV xem danh sách | Mặc định toàn nhóm; lọc học phần/lớp/GV/trạng thái; mỗi dòng rõ mã môn/lớp; thống kê số người khác số lần học | TC-39: API phân trang sau lọc quyền; lớp ngoài nhóm/kỳ bị từ chối |
| REQ-CAM-03 / MR | Khoa/GV xuất danh sách | XLSX SV/phân công/báo cáo/điểm, TT thêm đăng ký/nơi TT; lấy đủ dữ liệu theo bộ lọc được quyền | TC-40: xuất 31 dòng dù trang chỉ hiện 25; xuất riêng từng lớp không trộn hồ sơ |
| REQ-CAM-04 / HC+MR | Người dùng mở TT Hè 2025–2026 | Dùng adapter đọc/ghi nguồn cũ trong giao diện nhóm; giữ danh mục chung và các tác vụ TT; hồ sơ chưa rõ mã vẫn đối soát | TC-41: kiểm phân công/PDF/điểm/FAQ gốc và chặn mọi API ghi TT khi nhóm lưu trữ |
| REQ-CAM-05 / CĐ | Khoa chuyển các lớp cùng nhóm | Preview, backup, chọn cấu hình/trạng thái khi xung đột, áp dụng lặp; giữ ID lần học và toàn bộ dữ liệu nghiệp vụ | TC-42: không tự chọn lớp chuẩn; stale/conflict chặn áp dụng; chạy lại không nhân bản |
| REQ-CAM-06 / HC+MR | Gộp chat nhóm theo campaign/GVHD | Hợp nhất đúng kỳ/nhóm/GV, giữ tin nhắn/thời gian/file/dấu đọc; vượt quota lịch sử chỉ chặn file mới | TC-43: hai lớp đọc chung nhóm, chat riêng tách lần học; rút lớp/đổi GV thu hồi quyền |
| REQ-CAM-07 / MR | Khoa gửi thông báo toàn nhóm/lớp | Xem trước nội dung/danh sách nhận, loại trùng người học hai môn; sửa nội dung/bộ lọc cần preview lại; kiểm quyền trước gửi | TC-44: thay thành viên sau preview trả stale; xác nhận lặp không gửi trùng |
| REQ-CAM-08 / MR | Đổi context hoặc dùng URL cũ | URL lớp chuyển sang nhóm kèm lọc lớp; API sửa cấu hình lớp hướng dẫn dùng campaign; xóa cache PDF khi đổi nhóm/kỳ | TC-45: quay lại kiểm quyền/file lần nữa, không dùng blob của nhóm trước |

## 4. Kịch bản nghiệm thu

Đây là bộ nghiệm thu nghiệp vụ. Các kiểm thử tự động và diễn tập staging đã chạy được ghi tại [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md); OAuth/R2/email thật và dữ liệu Thực tập production cần nghiệm thu trên môi trường riêng.

| Mã | Thiết lập / thao tác | Kết quả cần có |
| --- | --- | --- |
| TC-01 | Tạo 4 lớp INT3132, 4 lớp INT3131 ở HKI 2026–2027; tạo cùng mã ở kỳ sau | 8 lớp kỳ đầu; không trùng trong kỳ; lớp kỳ sau độc lập |
| TC-02 | Một SV học TT Hè và Dự án HKI; thêm học lại kỳ sau và hai học phần Dự án đồng thời | Một user, nhiều enrollment; không ghi đè phân công/bài/điểm |
| TC-03 | Chỉnh hạn/nội dung nhóm môn; thử trước mở, đúng mở/đóng, sau đóng | Mọi lớp trong nhóm dùng chung; UI/API cùng kết quả, đúng giờ Việt Nam |
| TC-04 | Chuyển cả nhóm draft→active→archived, thử upload/điểm/chat/gán GV; Khoa mở lại | Chỉ active cho ghi theo quyền/hạn; archived chỉ đọc; mở lại có audit |
| TC-05 | OAuth SV thuộc DS Dự án nhưng ngoài khóa TT; SV chỉ hợp lệ TT; SV không đủ cả hai | Hai trường hợp đầu đăng nhập và thấy đúng quyền; trường hợp cuối bị từ chối |
| TC-06 | Tài khoản TT truy cập Dự án không trong DS; rút enrollment rồi tái dùng JWT | Không cấp quyền Dự án; phiên còn hạn không giữ quyền lớp đã rút |
| TC-07 | Đổi ID lần học, classId, revision và URL download; GV chưa phân công hoặc đã bị thay | Backend từ chối, không lộ nội dung/metadata được bảo vệ |
| TC-08 | Kiểm tra response SV, email, notification, dashboard và export | Không có điểm số; hướng dẫn tra Cổng Đào tạo |
| TC-09 | Đăng ký 5/6 nguyện vọng; công ty thẩm định/không thẩm định; xuất theo DN/lớp | Đúng giới hạn, trạng thái duyệt và dữ liệu xuất; không lộ danh mục nội bộ |
| TC-10 | Xác nhận hai nơi, công ty pending; xóa đăng ký final đã khóa/chưa khóa | Chặn sai điều kiện; quan hệ chưa khóa được xử lý an toàn trong đúng enrollment |
| TC-11 | CN làm chính; đề xuất agreed vượt quota; auto-assign; đổi GV trong đăng ký tại trường | CN bị chặn; ngoại lệ quota chỉ cảnh báo; auto giữ quota/đề xuất; nguồn chính thức và lịch sử đồng bộ |
| TC-12 | TT nhập thiếu/đủ ba điểm; đồng HD thử ghi; SV bỏ môn nhập 0,0,0 | Chỉ chính được ghi; điểm chính thức đúng 20/20/60; không có báo cáo accepted giả |
| TC-13 | Import file có hai sheet chính, bảy sheet ẩn, tiêu đề có Mã SV và Mã LMH | Đọc đúng hai sheet và cột; mã lớp không bị nhận nhầm làm MSSV |
| TC-14 | Số khoa học/chuỗi MSSV, dòng 134, Unicode, dòng trùng, ngày Excel và dd/mm/yyyy | MSSV hợp lệ giữ đủ 8 số; lỗi rõ sheet/hàng; gộp đúng; ngày sinh không đổi lịch |
| TC-15 | Email/tên GV khác nhau, email cá nhân, nhiều tên một ô, thiếu bộ môn | Không tự gán theo tên gần đúng; Khoa thấy và xác nhận ánh xạ/khắc phục |
| TC-16 | Xem trước, loại lỗi, commit hai lần; nhập lại; thay dữ liệu giữa preview/commit | Idempotent; không mất người vắng file; không đè bài/điểm; stale preview phải xem lại |
| TC-17 | SV nhập DS nhưng thiếu GVHD, khai đề tài/nộp trong hạn, chạy phân công NX | SV vào lớp được; NX chờ với lý do missing_primary |
| TC-18 | SV sửa đề tài đúng/sai lớp, trước/sau hạn và sau điểm đầu tiên | Chỉ đúng lần học/hạn; snapshot chấm đã khóa không thay đổi |
| TC-19 | Gán tay/import GVNX trùng primary/co hoặc CN; gán hai primary/reviewer | Tất cả đường ghi cùng chặn vi phạm |
| TC-20 | Pool có GV chỉ dạy TT, GV kỳ cũ, CN, GV đồng HD Dự án đủ điều kiện | Chỉ người đang HD Dự án kỳ đó và đủ điều kiện được xét |
| TC-21 | Có cùng bộ môn, hết người cùng bộ môn, thiếu bộ môn; nhiều bài cùng pool | Ưu tiên đúng bộ môn; fallback được đánh dấu; tải tính cả hai học phần trong kỳ |
| TC-22 | Trần rỗng/0/sắp đầy, hai preview đồng thời, toàn pool đầy | Không trần khi rỗng; 0 không nhận bài mới; commit không vượt trần; còn thiếu được báo |
| TC-23 | Chạy lại khi đã có GVNX; sửa preview; đổi GVHD sau preview; đổi GV sau có điểm | Chỉ bổ sung; revalidate khi stale; sau điểm dùng quy trình mở lại |
| TC-24 | Thiếu PDF/slide/demo/đề tài; PDF giả, 10 MB và lớn hơn 10 MB | Chỉ bundle đủ hợp lệ được submitted; giới hạn byte bằng nhau ở UI/API |
| TC-25 | Xem lại cùng phiên bản, chuyển SV/lớp, thay phiên bản, đăng xuất | PDF/cache đúng quyền và revision; không fetch lại vì sửa điểm, không dùng cache cũ cho phiên bản mới |
| TC-26 | Thay bài trước chấm, yêu cầu sửa trong/sau hạn | Lưu phiên bản; chỉ đúng hạn/quyền được sửa; yêu cầu sửa không tự vượt hạn |
| TC-27 | Nộp điểm đầu tiên rồi thay link/PDF; Khoa mở lại và chỉ một GV chấm lại | Chặn thay; phiên bản cũ/điểm cũ còn lịch sử; tổng mới rỗng đến khi đủ hai phần mới |
| TC-28 | GVHD/GVNX nộp/sửa điểm; xem phần nhau; đồng HD/giảng viên khác thử sửa | Đúng quyền từng vai trò; phần đã nộp hiển thị ngay cho người còn lại |
| TC-29 | GVHD 8.0 + GVNX 8.5; 0 + 10; chỉ có 8.0; sửa trước khóa | Tổng 8.2; 4.0; null; tính lại đúng và giữ lịch sử sửa |
| TC-30 | Chưa có bài, mỗi GV lần lượt nhập 0 kèm lý do | Không tự có điểm người còn lại; cuối cùng tổng 0.0; bài vẫn chưa nộp |
| TC-31 | Khóa đủ điểm/chưa đủ; sửa khi khóa/hết hạn; mở khóa rồi sửa | Chỉ chốt đủ phần; mở khóa không tự gia hạn; mọi thay đổi có audit |
| TC-32 | Xuất một lớp và cả kỳ, gồm thiếu điểm, học lại, có lịch sử chấm cũ | Một dòng/lần học, giá trị số đúng, thiếu để trống; tách danh sách hoàn thiện/chưa hoàn thiện |
| TC-33 | Chat SV/GVHD ở nhiều lớp cùng nhóm, đổi GV/rút lớp/lưu trữ nhóm | Nhóm chat gộp theo GVHD/nhóm/kỳ, chat riêng giữ từng lần học; không gộp kỳ khác |
| TC-34 | Quota email còn/đã hết, provider lỗi, cả hai GV nộp, nhắc phần còn thiếu | Web độc lập; phần vượt giữ queued; hoàn tất không lộ điểm hoặc spam Admin; nhắc đúng lớp/vai trò |
| TC-35 | Backfill bản sao dữ liệu TT vào Hè 2025–2026, gồm course_code trống/mơ hồ | Đếm/điểm/file/audit khớp; hồ sơ lỗi nằm danh sách đối soát, không bị gán đoán |
| TC-36 | Chạy lại migration, replay batch, rollback staging; gọi API cũ khi user có nhiều lớp | Không nhân bản/mất dữ liệu; ánh xạ legacy tường minh; không trả nhầm lớp |
| TC-37 | Rà ba tài liệu, ID yêu cầu/test/API, liên kết và sơ đồ | Mỗi yêu cầu có ánh xạ, không có link nội bộ hỏng hoặc thiết kế được mô tả như mã đã có |
| TC-38 | Cả ba vai trò chọn kỳ/nhóm, SV chọn DACN rồi DAKH | Giữ context qua chức năng, hai hồ sơ độc lập |
| TC-39 | Lọc tám lớp, GV, trạng thái; chọn lớp của kỳ/nhóm khác | Số người/lần học đúng, API từ chối bộ lọc ngoài phạm vi |
| TC-40 | Lớp có 31 hồ sơ, mở trang 1 rồi export từng loại | Đủ 31 hồ sơ được quyền theo bộ lọc, không chỉ trang 25 dòng |
| TC-41 | Mở nhóm TT legacy, cập nhật nghiệp vụ rồi lưu trữ | Giá trị nguồn cũ giữ/đọc đúng; API cũ và mới chặn ghi đến khi mở lại |
| TC-42 | Chuyển lớp cùng/khác cấu hình và trạng thái; chạy lại | Backup khôi phục được, xung đột cần quyết định rõ, bảo toàn ID và lịch sử |
| TC-43 | Hai lớp cùng GV, thêm kỳ/nhóm khác, lịch sử quá quota | Chỉ gộp trong campaign/GV; còn gửi chữ/đọc lịch sử, chặn file mới; thu hồi đúng quyền |
| TC-44 | Preview thông báo lớp/toàn nhóm, thay thành viên, xác nhận hai lần | Danh sách được kiểm lại, stale phải preview lại, không tạo bản gửi trùng |
| TC-45 | Mở URL lớp cũ, xem PDF, đổi nhóm/kỳ rồi quay lại | Đến đúng bộ lọc, cache cũ bị thu hồi và API kiểm quyền trước bytes/304 |

<a id="5-thu-tu-trien-khai-phan-mem-sau-khi-tai-lieu-duoc-ban-giao"></a>

## 5. Thứ tự cài đặt và nghiệm thu vận hành

1. Nền học vụ, kiểm tra phạm vi quyền và migration trên bản sao dữ liệu Thực tập.
2. Bộ chọn học kỳ/nhóm môn, cấu hình chung và API tương thích; nghiệm thu bảo toàn Thực tập.
3. Import Dự án, phân công GVHD, đề tài và tự phân công GVNX có preview.
4. Bài nộp theo phiên bản, hai phần đánh giá, khóa/mở lại, xuất bảng điểm.
5. Đồng bộ phạm vi chat, thông báo, cron, cache; nghiệm thu toàn bộ trước chuyển production.

Không bật luồng Dự án trên production trước khi các kiểm tra quyền lớp, file và điểm đạt nghiệm thu. Mốc thời gian cụ thể của HKI 2026–2027 do Khoa cấu hình; tên học kỳ không tự suy ra hạn nộp/chấm từ lịch cũ trong Excel.

Các tiêu chí TC ở trên là bộ nghiệm thu nghiệp vụ, không đồng nghĩa mọi tích hợp đã được kiểm thử trên tài khoản thật. Bản Express hiện giữ bảng Thực tập cũ làm nguồn ghi duy nhất cho đợt legacy, bổ sung dữ liệu lớp/lần học cho đợt mới; xem [phạm vi và giới hạn thực tế](IMPLEMENTATION_STATUS.md#ranh-gioi-cua-ban-cai-dat) trước khi lập biên bản nghiệm thu.
