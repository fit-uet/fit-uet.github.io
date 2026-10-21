export const cohortOptionsForYear = (yearValue: string | number) => {
  const year = Number(String(yearValue || '').match(/\d{4}/)?.[0] || 2026);
  const first = Math.max(1, year - 1960);
  return Array.from({ length: 5 }, (_, idx) => {
    const cohortNumber = first + idx;
    return {
      key: `K${cohortNumber}`,
      prefix: `${cohortNumber - 45}02`,
    };
  });
};

export const defaultAllowedCohortsForYear = (yearValue: string | number) =>
  cohortOptionsForYear(yearValue).slice(0, 3).map(item => item.key).join(',');

export const DEFAULT_REGISTRATION_RULES = [
  'Chỉ dành cho sinh viên nhận được thông báo.',
  'Mỗi sinh viên chọn tối đa 05 nơi thực tập.',
  'Sinh viên có thể lựa chọn các công ty không có trong Danh sách (các công ty đăng ký tiếp nhận thực tập sinh chính thức với Khoa). Nếu công ty đó có trong danh sách các công ty đã được Khoa thẩm định chất lượng thì sẽ được phê duyệt tự động. Ngược lại, công ty đó sẽ được Khoa xem xét và phê duyệt sau.',
  'Sinh viên có nhu cầu Thực tập tại trường có thể đăng ký Nơi thực tập là Trường Đại học Công nghệ, lưu ý phải tìm và được sự đồng ý hướng dẫn của Giảng viên Khoa CNTT.',
  'Sinh viên có thể thay đổi đăng ký bằng cách chọn "Huỷ tất cả đăng ký" và đăng ký lại từ đầu trong thời gian Khoa mở đăng ký.',
].join('\n');

export const DEFAULT_PLAN = `## KẾ HOẠCH TRIỂN KHAI HỌC PHẦN THỰC TẬP

Khoa Công nghệ Thông tin thông báo triển khai các học phần Thực tập dành cho sinh viên từ khóa **K68 trở về trước**, bao gồm các học phần:

1. **Thực tập Doanh nghiệp** (INT4002)
2. **Thực tập Chuyên ngành** (INT3508)
3. **Thực tập Doanh nghiệp Nhật Bản** (INT4003)

---

### 🔹 Thời hạn đăng ký
- **Thời gian:** Từ **18/05** đến **8h00, ngày 25/05/2026**
- 👉 **_Lưu ý quan trọng:_** Danh sách sinh viên đăng ký trên hệ thống sẽ được sử dụng làm danh sách chính thức để Khoa/Nhà trường thực hiện đăng ký học phần trên cổng đào tạo. Vì vậy, đề nghị sinh viên cân nhắc kỹ trước khi đăng ký và điền đầy đủ, chính xác thông tin theo yêu cầu.

---

### 📌 Mốc thời gian quan trọng

| STT | Mốc thời gian | Nội dung công việc |
| :---: | :--- | :--- |
| **1** | **25/05 – 31/05** | Khoa gửi danh sách sinh viên đăng ký đến các doanh nghiệp để tiến hành phỏng vấn (nếu có). |
| **2** | **25/05 – 31/05** | Khoa phân công giảng viên hướng dẫn thực tập cho sinh viên. |
| **3** | **10/06 – 17/06/2026** | Sinh viên chủ động liên hệ với Thầy/Cô hướng dẫn để trao đổi, nhận hướng dẫn về nội dung thực tập, kế hoạch thực hiện và các yêu cầu liên quan đến học phần. |
| **4** | **15/06 – 31/08** | **Sinh viên bắt đầu kỳ thực tập tại doanh nghiệp.**<br>_Lưu ý:_ Thời gian thực tập tại mỗi công ty có thể khác nhau, nhưng phải đảm bảo **tối thiểu 6 tuần làm việc full-time**. Sinh viên cần báo cáo định kỳ với giảng viên hướng dẫn. |
| **5** | **15/07 – 30/09** | Các sinh viên không tìm được cơ hội thực tập tại doanh nghiệp sẽ thực hiện **thực tập tại trường** cùng Thầy/Cô hướng dẫn hoặc với đối tác khác do Khoa sắp xếp. |
| **6** | **01/10 – 10/10** | **Sinh viên nộp báo cáo thực tập;** giảng viên hướng dẫn thực hiện đánh giá và chấm điểm. |
| **7** | **11/10 – 20/10** | Giảng viên nộp điểm về Khoa để tổng hợp và nhập hệ thống. |

---

### 📄 Mẫu báo cáo & Hướng dẫn hoàn thành học phần

Mỗi sinh viên cần viết **01 báo cáo thực tập** theo mẫu Khoa quy định:  
👉 **Tải biểu mẫu báo cáo của Khoa:** [TẠI ĐÂY (Google Drive)](https://drive.google.com/drive/folders/14Fm4yP-2Psj_qMpzI0pBARkcww1sblA3?usp=sharing)

#### 📝 Sinh viên cần nộp những gì để hoàn thành môn thực tập?

Để hoàn thành học phần Thực tập và được công nhận điểm, sinh viên cần thực hiện:

1. **Phiếu đánh giá kết quả thực tập (Có chữ ký & dấu công ty - 60%):**
   - Trong mẫu báo cáo thực tập của Khoa có sẵn **Trang nhận xét / Phiếu đánh giá kết quả thực tập**.
   - **Nếu thực tập tại Doanh nghiệp:** Sinh viên chỉ cần in riêng trang Phiếu đánh giá này để xin điểm số, nhận xét chi tiết và chữ ký của người hướng dẫn tại doanh nghiệp, kèm **dấu tròn xác nhận của công ty/doanh nghiệp**.
   - Sau đó, sinh viên scan (hoặc chụp rõ nét) trang Phiếu đánh giá này và **gộp (merge) trực tiếp vào trong bản mềm (file PDF)** của báo cáo thực tập.
   - **Nếu thực tập tại Trường:** Giảng viên hướng dẫn tại trường sẽ trực tiếp theo dõi, nhận xét và đánh giá cho điểm phần này.

2. **Nộp Báo cáo thực tập hoàn chỉnh (Bản mềm - 01 file PDF duy nhất):**
   - Sinh viên nộp bản báo cáo hoàn chỉnh (định dạng **PDF, tối đa 10 MB**, đã bao gồm trang Phiếu đánh giá có chữ ký và con dấu) trực tiếp trên hệ thống trong thời gian mở nộp (**01/10 – 10/10**).
   - Bản báo cáo này là cơ sở để Giảng viên hướng dẫn đánh giá và nhập đầy đủ cả 3 đầu điểm trên hệ thống: **Điểm tiến độ (20%)**, **Điểm báo cáo (20%)** và **Điểm đánh giá doanh nghiệp (60%)**. Sinh viên không cần nộp thêm phiếu giấy riêng.

---

### 📊 Cơ cấu điểm đánh giá học phần

- **20%:** Điểm báo cáo định kỳ / tiến độ (sinh viên chủ động liên hệ và báo cáo tiến độ với GVHD).
- **20%:** Điểm nội dung của bản báo cáo thực tập theo mẫu quy định (nộp bản mềm trên hệ thống).
- **60%:** Điểm đánh giá của phía doanh nghiệp (theo Phiếu đánh giá có chữ ký & dấu công ty được scan gộp trong file báo cáo) hoặc của Giảng viên hướng dẫn (nếu thực tập tại trường).`;

export const DEFAULT_STUDENT_FAQ = `## FAQ cho sinh viên

### 1. Em được đăng ký tối đa bao nhiêu nơi thực tập?
Mỗi sinh viên được đăng ký tối đa 05 nơi thực tập trong thời gian Khoa mở đăng ký.

### 2. Em có thể đăng ký công ty tự liên hệ không?
Có. Nếu công ty đã nằm trong danh sách thẩm định nội bộ của Khoa, đăng ký sẽ được duyệt tự động. Nếu chưa có, Khoa sẽ xem xét và duyệt thủ công.

### 3. Sau khi có kết quả phỏng vấn, em cần làm gì?
Em cần đăng nhập hệ thống và xác nhận đúng một nơi thực tập chính thức đã trúng tuyển trong thời hạn Khoa cho phép.

### 4. Nếu không trúng tuyển công ty nào thì sao?
Em có thể đăng ký thực tập tại trường. Nếu đã được giảng viên đồng ý, em chọn giảng viên đó; nếu chưa có GVHD, Khoa sẽ phân công sau.

### 5. Báo cáo nộp ở đâu và cần nộp những gì để hoàn thành học phần?
- **Phiếu đánh giá doanh nghiệp:** Sinh viên chỉ cần in riêng trang Phiếu đánh giá trong mẫu báo cáo của Khoa để xin điểm, nhận xét, chữ ký của người hướng dẫn và dấu của công ty. Sau đó scan và gộp trực tiếp vào file báo cáo PDF.
- **Nộp bản mềm trên hệ thống:** Nộp 01 file báo cáo PDF hoàn chỉnh (đã kèm trang Phiếu đánh giá) trực tiếp trên hệ thống để GVHD chấm cả 3 đầu điểm (20% tiến độ, 20% báo cáo, 60% doanh nghiệp). Không cần nộp phiếu giấy riêng.

### 6. Em thấy đăng ký bị từ chối thì xem lý do ở đâu?
Lý do hoặc nhận xét của Khoa được hiển thị trong hồ sơ đăng ký và trong mục Thông báo.`;

export const DEFAULT_LECTURER_FAQ = `## FAQ cho giảng viên

### 1. Giảng viên xem danh sách sinh viên được phân công ở đâu?
Giảng viên đăng nhập hệ thống bằng email VNU, trang chủ giảng viên sẽ hiển thị danh sách sinh viên được Khoa phân công hướng dẫn hoặc đồng hướng dẫn.

### 2. Giảng viên cần đánh giá những gì trên hệ thống?
Giảng viên nhập điểm quá trình, điểm báo cáo, điểm doanh nghiệp và nhận xét nếu có. Hệ thống tự tính điểm tổng kết theo cấu hình hiện tại.

### 3. Báo cáo của sinh viên được xử lý thế nào?
Sinh viên nộp file PDF trên hệ thống. Giảng viên xem trực tiếp báo cáo và chấm điểm (hệ thống tự động duyệt báo cáo khi nộp điểm) hoặc yêu cầu sinh viên nộp lại nếu cần chỉnh sửa.

### 4. Giảng viên có nhận thông báo trên website không?
Có. Các thông báo liên quan đến phân công hướng dẫn, báo cáo và thông báo chung từ Khoa được hiển thị ở biểu tượng chuông và trang Thông báo.

### 5. Giảng viên CN có được hướng dẫn chính không?
Theo nghiệp vụ hiện tại, giảng viên có tên chứa “CN” không được làm hướng dẫn chính, chỉ có thể là đồng hướng dẫn.

### 6. Khi cần điều chỉnh phân công hoặc điểm đã khóa thì làm gì?
Giảng viên liên hệ Khoa để được hỗ trợ mở khóa hoặc điều chỉnh theo quy trình quản lý của Khoa.`;

export const DEFAULT_LECTURER_GUIDE = `# Hướng dẫn sử dụng hệ thống cho giảng viên

Tài liệu này mô tả các chức năng chính dành cho giảng viên hướng dẫn thực tập trên hệ thống. Nội dung có thể được Khoa cập nhật theo từng đợt triển khai.

## 1. Đăng nhập và truy cập trang giảng viên

- Giảng viên đăng nhập bằng tài khoản email VNU đã có trong danh sách giảng viên của hệ thống.
- Sau khi đăng nhập, chọn **Trang giảng viên** từ avatar hoặc truy cập trang chủ dành cho giảng viên.
- Nếu tài khoản là quản trị viên đồng thời là giảng viên, hệ thống cung cấp nút chuyển đổi nhanh **Trang giảng viên** ngay trên thanh Header (cạnh avatar) và lối vào **Chấm điểm thực tập** trong menu avatar.

## 2. Xem danh sách sinh viên phụ trách

Tại trang giảng viên, khối **Sinh viên phụ trách** hiển thị các sinh viên đã được Khoa phân công cho giảng viên.

Các thông tin chính gồm:

- Mã sinh viên, họ tên, lớp khóa học và học phần.
- Vai trò hướng dẫn: **Hướng dẫn chính** hoặc **Đồng hướng dẫn**.
- Nơi thực tập chính thức nếu sinh viên đã xác nhận; riêng sinh viên thực tập tại trường sẽ hiển thị **Trường Đại học Công nghệ**.
- Thông tin liên hệ của sinh viên, gồm email VNU, email khác nếu có và số điện thoại.
- Trạng thái báo cáo.

## 3. Đánh dấu tình trạng sinh viên đã liên hệ

Mặc định sinh viên mới được phân công được xem là **chưa liên hệ** để giảng viên dễ theo dõi.

Giảng viên có thể:

- Tích **Đã liên hệ** khi sinh viên đã chủ động trao đổi hoặc giảng viên đã liên hệ được.
- Ghi chú nhanh tình trạng liên hệ, ví dụ: đã trao đổi đề tài, chưa phản hồi email, cần bổ sung thông tin công ty.
- Xuất danh sách XLSX để lưu hoặc xử lý ngoài hệ thống.

## 4. Trao đổi với sinh viên

Hệ thống hỗ trợ hai kiểu trao đổi:

### Chat riêng

- Mỗi sinh viên được phân công với giảng viên sẽ có một cuộc trò chuyện riêng.
- Dùng để trao đổi tiến độ, góp ý báo cáo, nhắc sinh viên bổ sung thông tin hoặc gửi file liên quan.

### Chat nhóm

- Mỗi giảng viên có một nhóm chat với toàn bộ sinh viên mình hướng dẫn.
- Dùng để gửi thông báo chung, hướng dẫn chung hoặc nhắc mốc thời gian cho cả nhóm.
- Sinh viên chỉ thấy nhóm của giảng viên đang hướng dẫn mình.

## 5. Gửi và quản lý file trong chat

Trong chat riêng và chat nhóm, người dùng có thể gửi file đính kèm.

Quy định mặc định:

- Hỗ trợ PDF, Word, Excel, PowerPoint, TXT, ZIP, JPG và PNG.
- Mỗi file tối đa 10 MB.
- Hệ thống có quota lưu trữ theo cuộc trò chuyện và quota upload theo ngày.
- Có thể xem trước file PDF/ảnh nếu trình duyệt hỗ trợ.
- Người gửi có thể **thu hồi** tin nhắn; nếu tin nhắn có file, file cũng được xóa khỏi kho lưu trữ.

## 6. Xem và xử lý báo cáo

Sinh viên nộp báo cáo PDF trên hệ thống trong thời gian Khoa mở nộp.

Giảng viên có thể:

- Xem trạng thái nộp báo cáo của từng sinh viên trong trang giảng viên.
- Báo cáo mặc định được xem là hợp lệ để chấm điểm. Khi giảng viên nộp điểm về Khoa, hệ thống tự động hoàn tất duyệt báo cáo.
- Yêu cầu sinh viên nộp lại nếu cần chỉnh sửa kèm ghi chú chi tiết (hoặc chủ động hủy yêu cầu nếu cần).

## 7. Chấm điểm thực tập

Chỉ **giảng viên hướng dẫn chính** có quyền nhập và nộp điểm cho sinh viên.

Trang **Chấm điểm thực tập** cho phép:

- Xem danh sách sinh viên mà giảng viên là hướng dẫn chính.
- Tải báo cáo nếu sinh viên đã nộp.
- Nhập điểm quá trình, điểm báo cáo và điểm đánh giá công ty hoặc giảng viên.
- Hệ thống tự tính điểm tổng kết theo công thức hiện tại: 20% quá trình, 20% báo cáo, 60% đánh giá công ty hoặc giảng viên.
- Nộp điểm trực tiếp về Khoa khi đã hoàn tất (có thể cập nhật lại điểm trước khi Khoa khóa bảng điểm).

Sau khi điểm đã khóa hoặc đã tổng hợp, nếu cần sửa điểm giảng viên liên hệ Khoa để được hỗ trợ theo quy trình.

## 8. Thông báo trên website

Giảng viên có thể xem thông báo từ biểu tượng chuông hoặc mục **Thông báo**.

Thông báo có thể bao gồm:

- Thông báo chung từ Khoa.
- Các thông báo liên quan đến báo cáo, điểm hoặc phân công.
- Câu trả lời cho câu hỏi FAQ nếu giảng viên gửi câu hỏi.

## 9. FAQ và gửi câu hỏi

Trang **FAQ** hiển thị nội dung câu hỏi thường gặp theo vai trò giảng viên.

Nếu chưa rõ quy trình hoặc gặp lỗi nghiệp vụ, giảng viên có thể gửi câu hỏi tại trang FAQ. Quản trị viên sẽ trả lời trên hệ thống; câu trả lời cũng được hiển thị trong mục thông báo.

## 10. Các lỗi thường gặp

| Tình huống | Cách xử lý |
| --- | --- |
| Không thấy sinh viên trong danh sách phụ trách | Kiểm tra lại phân công với Khoa; sinh viên có thể chưa được phân công GVHD trên hệ thống. |
| Không tải được báo cáo | Thử tải lại trang; nếu vẫn lỗi, liên hệ Khoa để kiểm tra file hoặc cấu hình lưu trữ. |
| Không nhập được điểm | Kiểm tra giảng viên có phải hướng dẫn chính hay không; đồng hướng dẫn không có quyền nhập điểm. |
| Không thấy nút chấm điểm | Tài khoản có thể chưa được nhận diện là giảng viên hoặc chưa có sinh viên hướng dẫn chính. |
| Cần sửa điểm đã nộp hoặc đã khóa | Liên hệ Khoa để mở khóa hoặc điều chỉnh theo quy trình. |

## 11. Khuyến nghị vận hành

- Kiểm tra danh sách sinh viên phụ trách ngay sau khi Khoa công bố phân công.
- Đánh dấu tình trạng liên hệ để tránh bỏ sót sinh viên.
- Dùng chat nhóm cho thông báo chung và chat riêng cho góp ý cá nhân.
- Tải và kiểm tra báo cáo trước hạn chấm điểm.
- Nộp điểm trực tiếp về Khoa khi đã hoàn tất đánh giá.`;
