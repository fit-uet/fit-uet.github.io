import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';
import React, { useState, useEffect } from 'react';
import { Bell, CircleHelp } from 'lucide-react';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import TurndownService from 'turndown';
import { Button } from './ui/Button';
import { PageHeader } from './ui/PageHeader';

export * from './ui';

export const GOOGLE_CLIENT_ID = (import.meta as any).env.VITE_GOOGLE_CLIENT_ID || '109463395923-mock.apps.googleusercontent.com';
export const GOOGLE_API_KEY = (import.meta as any).env.VITE_GOOGLE_API_KEY || '';
export const API_BASE = (import.meta as any).env.VITE_API_BASE_URL || 'https://internship-api-dplz.onrender.com';
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

export const normalizeRegistrationRulesMarkdown = (content: string) => {
  const text = String(content || '').trim();
  if (!text) return '';
  const hasMarkdownSyntax = /(^|\n)\s{0,3}(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s+|```|\|.+\|)/.test(text)
    || /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/.test(text);
  if (hasMarkdownSyntax) return text.replace(/^(\s*)•\s+/gm, '$1- ');
  return text
    .split(/\r?\n/)
    .map(line => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean)
    .map(line => `- ${line}`)
    .join('\n');
};

export const RegistrationRulesMarkdown = ({ content }: { content: string }) => (
  <div className="registration-rules-markdown text-xs text-slate-650">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ node, ...props }) => <h1 className="text-sm font-bold text-slate-800 mb-3" {...props} />,
        h2: ({ node, ...props }) => <h2 className="text-xs font-bold text-slate-800 mt-4 mb-2" {...props} />,
        h3: ({ node, ...props }) => <h3 className="text-xs font-semibold text-slate-800 mt-3 mb-2" {...props} />,
        p: ({ node, ...props }) => <p className="mb-3 leading-relaxed text-slate-650 font-medium" {...props} />,
        ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-3 space-y-2 marker:text-blue-500" {...props} />,
        ol: ({ node, ...props }) => <ol className="list-decimal pl-5 mb-3 space-y-2 marker:text-blue-500" {...props} />,
        li: ({ node, ...props }) => <li className="pl-1 leading-relaxed text-slate-650 font-medium" {...props} />,
        strong: ({ node, ...props }) => <strong className="font-bold text-slate-900" {...props} />,
        em: ({ node, ...props }) => <em className="text-slate-800 italic" {...props} />,
        a: ({ node, ...props }) => <a className="text-blue-600 underline hover:text-blue-700 font-semibold transition-colors" target="_blank" rel="noreferrer" {...props} />,
        code: ({ node, ...props }) => <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded font-mono text-[11px]" {...props} />,
        blockquote: ({ node, ...props }) => <blockquote className="border-l-4 border-slate-300 pl-3 italic text-slate-500 my-3" {...props} />,
        table: ({ node, ...props }) => <div className="overflow-x-auto my-3"><table className="min-w-full border border-slate-200 text-xs" {...props} /></div>,
        th: ({ node, ...props }) => <th className="border border-slate-200 px-2 py-1 text-left text-slate-800 bg-slate-50 font-semibold" {...props} />,
        td: ({ node, ...props }) => <td className="border border-slate-150 px-2 py-1 text-slate-650 font-medium" {...props} />,
      }}
    >
      {normalizeRegistrationRulesMarkdown(content)}
    </ReactMarkdown>
  </div>
);

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
Sinh viên nộp file PDF trên hệ thống. Giảng viên có thể tải báo cáo, đánh dấu đã chấp nhận hoặc yêu cầu nộp lại kèm ghi chú.

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
- Nếu tài khoản là quản trị viên đồng thời là giảng viên, trong menu avatar vẫn có lối vào **Trang giảng viên** và **Chấm điểm thực tập**.

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
- Tải báo cáo để đọc và đánh giá.
- Đánh dấu báo cáo đã chấp nhận hoặc yêu cầu sinh viên nộp lại nếu cần.
- Ghi nhận xét khi yêu cầu nộp lại để sinh viên biết nội dung cần sửa.

## 7. Chấm điểm thực tập

Chỉ **giảng viên hướng dẫn chính** có quyền nhập và nộp điểm cho sinh viên.

Trang **Chấm điểm thực tập** cho phép:

- Xem danh sách sinh viên mà giảng viên là hướng dẫn chính.
- Tải báo cáo nếu sinh viên đã nộp.
- Nhập điểm quá trình, điểm báo cáo và điểm đánh giá công ty hoặc giảng viên.
- Hệ thống tự tính điểm tổng kết theo công thức hiện tại: 20% quá trình, 20% báo cáo, 60% đánh giá công ty hoặc giảng viên.
- Lưu nháp trong quá trình chấm.
- Nộp điểm về Khoa khi đã hoàn tất.

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
- Lưu nháp điểm trước khi nộp chính thức về Khoa.`;

export const saveXlsx = (filename: string, headers: string[], rows: any[][], sheetName = 'Sheet1') => {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31) || 'Sheet1');
  XLSX.writeFile(workbook, filename);
};

export const xlsxArrayBuffer = (headers: string[], rows: any[][], sheetName = 'Sheet1') => {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31) || 'Sheet1');
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
};

export const xlsxBlob = (headers: string[], rows: any[][], sheetName = 'Sheet1') =>
  new Blob([xlsxArrayBuffer(headers, rows, sheetName)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

export const formatCourseCode = (code?: string): string => {
  if (!code) return '';
  const trimmed = String(code).trim();
  const parts = trimmed.split(/\s+/);
  return parts[parts.length - 1] || '';
};

export const cleanStudentName = (rawName?: string, studentId?: string, email?: string): string => {
  if (!rawName) return '';
  let name = String(rawName).trim();

  const stripIdAndEmail = (str: string) => {
    let s = str;
    if (studentId) {
      const sId = String(studentId).trim();
      if (sId) {
        if (s.toLowerCase().startsWith(sId.toLowerCase())) {
          s = s.slice(sId.length).trim().replace(/^[-_.:/\s]+/, '');
        }
        if (s.toLowerCase().endsWith(sId.toLowerCase())) {
          s = s.slice(0, -sId.length).trim().replace(/[-_.:/\s]+$/, '');
        }
      }
    }
    if (email) {
      const userPart = String(email).split('@')[0]?.trim();
      if (userPart && userPart.length >= 3) {
        if (s.toLowerCase().startsWith(userPart.toLowerCase())) {
          s = s.slice(userPart.length).trim().replace(/^[-_.:/\s]+/, '');
        }
        if (s.toLowerCase().endsWith(userPart.toLowerCase())) {
          s = s.slice(0, -userPart.length).trim().replace(/[-_.:/\s]+$/, '');
        }
      }
    }
    s = s.replace(/^(?:mssv|msv|sv)?\s*[:#-]?\s*\(?\d{6,12}\)?\s*[-_.:/\s]*/i, '').trim();
    s = s.replace(/\s*[-_.:/]?\s*\(?\d{6,12}\)?$/i, '').trim();
    return s;
  };

  name = stripIdAndEmail(name);

  // 1. Handle duplicate name with separator: e.g. "Khuất Tuấn Anh - Khuất Tuấn Anh" or "Khuất Tuấn Anh - Khuất Tuấn"
  const sepParts = name.split(/\s*[-–—/|,]\s*/);
  if (sepParts.length === 2) {
    const p1 = sepParts[0].trim();
    const p2 = sepParts[1].trim();
    if (p1.localeCompare(p2, undefined, { sensitivity: 'accent' }) === 0 ||
        (p2.length >= 2 && p1.toLowerCase().startsWith(p2.toLowerCase()))) {
      name = p1;
    }
  }

  // 2. Handle repeated name or truncated repeated name without separator
  // e.g. "Lê Tuấn Đạt Lê Tuấn Đạt" or "Phạm Đức Toàn Phạm Đức T"
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    for (let i = 1; i < words.length; i++) {
      const first = words.slice(0, i).join(' ');
      const rest = words.slice(i).join(' ');
      if (first.localeCompare(rest, undefined, { sensitivity: 'accent' }) === 0) {
        name = first;
        break;
      }
      if (i >= 2 && rest.length >= 2 && first.toLowerCase().startsWith(rest.toLowerCase())) {
        name = first;
        break;
      }
    }
  }

  // 3. Handle 3-times repetition: e.g. length % 3 === 0
  const words3 = name.split(/\s+/).filter(Boolean);
  if (words3.length >= 3 && words3.length % 3 === 0) {
    const third = words3.length / 3;
    const p1 = words3.slice(0, third).join(' ');
    const p2 = words3.slice(third, third * 2).join(' ');
    const p3 = words3.slice(third * 2).join(' ');
    if (p1.localeCompare(p2, undefined, { sensitivity: 'accent' }) === 0 &&
        p2.localeCompare(p3, undefined, { sensitivity: 'accent' }) === 0) {
      name = p1;
    }
  }

  name = stripIdAndEmail(name);
  name = name.replace(/\s+/g, ' ').trim();

  return name || String(rawName).trim();
};

export const companyDescriptionText = (value: any) => {
  const text = String(value || '').trim();
  return /^Tuyển\s+\d+\s+sinh viên thực tập\.?$/i.test(text) ? '' : text;
};
export const companyDisplayDescription = (value: any) => companyDescriptionText(value) || 'Chưa rõ';

export const convertDocxFileToMarkdown = async (file: File) => {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  td.addRule('strikethrough', {
    filter: ['del', 's'],
    replacement: (content: string) => `~~${content}~~`,
  });
  return td.turndown(result.value);
};

export const loadScriptOnce = (src: string) => new Promise<void>((resolve, reject) => {
  if (document.querySelector(`script[src="${src}"]`)) return resolve();
  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  script.onload = () => resolve();
  script.onerror = () => reject(new Error(`Không tải được script ${src}`));
  document.head.appendChild(script);
});

export const googleOAuthMessage = (error: any) => {
  const raw = typeof error === 'string' ? error : (error?.message || error?.error || '');
  if (String(raw).includes('access_denied')) {
    return 'Google từ chối cấp quyền Drive. Nếu OAuth app đang ở trạng thái Testing, hãy thêm tài khoản Google đang đăng nhập vào danh sách Test users trong Google Cloud Console, hoặc chuyển app sang Production sau khi cấu hình/xác minh phù hợp.';
  }
  if (String(raw).includes('popup')) {
    return 'Không mở được cửa sổ xác thực Google. Vui lòng cho phép popup với trang này rồi thử lại.';
  }
  return raw || 'Không lấy được quyền Google Drive.';
};

export const getDriveAccessToken = async () => {
  await loadScriptOnce('https://accounts.google.com/gsi/client');
  const google = (window as any).google;
  if (!google?.accounts?.oauth2) throw new Error('Không tải được Google Identity Services.');
  return await new Promise<string>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (response: any) => {
        if (response?.access_token) resolve(response.access_token);
        else reject(new Error(googleOAuthMessage(response)));
      },
      error_callback: (error: any) => reject(new Error(googleOAuthMessage(error))),
    });
    client.requestAccessToken({ prompt: 'consent' });
  });
};

export const pickDriveFolder = async (accessToken: string) => {
  if (!GOOGLE_API_KEY) throw new Error('Chưa cấu hình VITE_GOOGLE_API_KEY để dùng Google Drive Picker.');
  await loadScriptOnce('https://apis.google.com/js/api.js');
  const gapi = (window as any).gapi;
  const google = (window as any).google;
  await new Promise<void>((resolve) => gapi.load('picker', { callback: resolve }));
  return await new Promise<{ id: string; name: string }>((resolve, reject) => {
    const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setMimeTypes('application/vnd.google-apps.folder')
      .setSelectFolderEnabled(true);
    const picker = new google.picker.PickerBuilder()
      .setDeveloperKey(GOOGLE_API_KEY)
      .setOAuthToken(accessToken)
      .setOrigin(window.location.origin)
      .setTitle('Chọn thư mục Google Drive để lưu danh sách')
      .addView(view)
      .setCallback((data: any) => {
        if (data.action === google.picker.Action.PICKED) {
          const doc = data.docs?.[0];
          resolve({ id: doc.id, name: doc.name || 'Google Drive' });
        } else if (data.action === google.picker.Action.CANCEL) {
          reject(new Error('Bạn đã huỷ chọn thư mục Google Drive.'));
        }
      })
      .build();
    picker.setVisible(true);
  });
};

export const uploadXlsxToDrive = async (accessToken: string, folderId: string, filename: string, blob: Blob) => {
  const boundary = `fit_uet_${Date.now()}`;
  const metadata = {
    name: filename,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    parents: [folderId],
  };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ], { type: `multipart/related; boundary=${boundary}` });
  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const uploaded = await uploadRes.json();
  if (!uploadRes.ok) throw new Error(uploaded?.error?.message || 'Không upload được file lên Google Drive.');
  const permRes = await fetch(`https://www.googleapis.com/drive/v3/files/${uploaded.id}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });
  if (!permRes.ok) {
    const error = await permRes.json().catch(() => ({}));
    throw new Error(error?.error?.message || 'Không bật được quyền xem bằng link cho file Google Drive.');
  }
  return uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view?usp=sharing`;
};

export const csvCells = (line: string) => {
  const cells: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"' && quoted && next === '"') {
      value += '"';
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      cells.push(value.trim());
      value = '';
    } else {
      value += ch;
    }
  }
  cells.push(value.trim());
  return cells;
};

export const readSpreadsheetRows = async (file: File) => {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' }).map(row => row.map(cell => String(cell ?? '').trim()));
  }
  const text = await file.text();
  return text.replace(/^\uFEFF/, '').split(/\r?\n/).map(csvCells).filter(row => row.some(Boolean));
};

export const paginationBounds = (total: number, currentPage: number, pageSize: number) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(safePage * pageSize, total);
  return { totalPages, safePage, start, end };
};

export const isAuthExpiredResponse = (res: Response, data?: any) =>
  res.status === 401 || (res.status === 403 && /token|hết hạn|unauthorized/i.test(String(data?.error || '')));

export const jwtExpiresAtMs = (token: string | null | undefined) => {
  try {
    const base64Url = String(token || '').split('.')[1] || '';
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64Url.length / 4) * 4, '=');
    const payload = JSON.parse(atob(base64));
    const exp = Number(payload?.exp || 0);
    return exp > 0 ? exp * 1000 : null;
  } catch (e) {
    return null;
  }
};

export const JSON_CACHE_PREFIX = 'irs-cache:json:';
export const CACHE_TTL = {
  campaign: 5 * 60 * 1000,
  companies: 5 * 60 * 1000,
  lecturers: 30 * 60 * 1000,
  markdown: 30 * 60 * 1000,
  lecturerStudents: 60 * 1000,
};

export type JsonCacheEntry<T = any> = {
  data: T;
  savedAt: number;
  expiresAt: number;
};

export const jsonCacheStorageKey = (key: string) => `${JSON_CACHE_PREFIX}${key}`;

export const readJsonCache = <T,>(key: string, allowExpired = false): T | null => {
  try {
    const raw = localStorage.getItem(jsonCacheStorageKey(key));
    if (!raw) return null;
    const entry = JSON.parse(raw) as JsonCacheEntry<T>;
    if (!entry || typeof entry.expiresAt !== 'number') return null;
    if (!allowExpired && Date.now() > entry.expiresAt) return null;
    return entry.data;
  } catch (e) {
    return null;
  }
};

export const writeJsonCache = (key: string, data: any, ttlMs: number) => {
  try {
    const now = Date.now();
    const entry: JsonCacheEntry = { data, savedAt: now, expiresAt: now + ttlMs };
    localStorage.setItem(jsonCacheStorageKey(key), JSON.stringify(entry));
  } catch (e) { }
};

export const clearJsonCache = (prefix = '') => {
  try {
    const fullPrefix = `${JSON_CACHE_PREFIX}${prefix}`;
    Object.keys(localStorage)
      .filter(key => key.startsWith(fullPrefix))
      .forEach(key => localStorage.removeItem(key));
  } catch (e) { }
};

export const cachedJsonFetch = async <T,>(
  url: string,
  {
    cacheKey,
    ttlMs,
    headers,
    forceRefresh = false,
    onAuthExpired,
  }: {
    cacheKey: string;
    ttlMs: number;
    headers?: HeadersInit;
    forceRefresh?: boolean;
    onAuthExpired?: () => void;
  }
): Promise<T> => {
  if (!forceRefresh) {
    const cached = readJsonCache<T>(cacheKey);
    if (cached !== null) return cached;
  }
  const stale = readJsonCache<T>(cacheKey, true);
  try {
    const res = await fetch(url, { headers });
    const data = await res.json().catch(() => null);
    if (isAuthExpiredResponse(res, data)) {
      clearJsonCache();
      window.dispatchEvent(new CustomEvent('auth-expired'));
      onAuthExpired?.();
      throw new Error(data?.error || 'Phiên đăng nhập không hợp lệ.');
    }
    if (!res.ok) throw new Error(data?.error || `Không tải được dữ liệu (${res.status}).`);
    writeJsonCache(cacheKey, data, ttlMs);
    return data as T;
  } catch (e) {
    if (stale !== null) return stale;
    throw e;
  }
};

export function PaginationControls({
  total,
  currentPage,
  pageSize,
  onPageChange,
  label = 'bản ghi',
}: {
  total: number;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  label?: string;
}) {
  if (total === 0) return null;
  const { totalPages, safePage, start, end } = paginationBounds(total, currentPage, pageSize);
  return (
    <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-500 font-medium select-none">
      <div>
        Hiển thị <strong>{start}</strong>-<strong>{end}</strong> / <strong>{total}</strong> {label}
      </div>
      <div className="flex items-center gap-2.5">
        <Button
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage <= 1}
          size="sm"
        >
          Trước
        </Button>
        <span className="min-w-16 text-center text-xs font-semibold text-slate-600">Trang {safePage} / {totalPages}</span>
        <Button
          onClick={() => onPageChange(Math.min(totalPages, safePage + 1))}
          disabled={safePage >= totalPages}
          size="sm"
        >
          Sau
        </Button>
      </div>
    </div>
  );
}

export function MyNotifications({ token, compact = false, onChanged }: { token: string; compact?: boolean; onChanged?: (unread: number) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchRows = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/notifications/my`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) return;
      const nextRows = Array.isArray(data.rows) ? data.rows : [];
      const nextUnread = Number(data.unread || 0);
      setRows(nextRows);
      setUnread(nextUnread);
      onChanged?.(nextUnread);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRows(); }, [token]);

  const markRead = async (row: any) => {
    const path = row.source === 'system'
      ? `/api/notifications/my/system/${row.id}/read`
      : `/api/notifications/my/${row.id}/read`;
    await fetch(`${API_BASE}${path}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` }
    });
    fetchRows();
  };

  const markAllRead = async () => {
    await fetch(`${API_BASE}/api/notifications/my/read-all`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` }
    });
    fetchRows();
  };

  const visibleRows = compact ? rows.slice(0, 5) : rows;
  const typeLabel = (type: string) => {
    if (type === 'registration_status_changed') return 'Đăng ký';
    if (type === 'advisor_assigned') return 'GVHD';
    if (type === 'final_report_status_changed') return 'Báo cáo';
    if (type === 'grade_locked') return 'Bảng điểm';
    if (type === 'faq_answered') return 'FAQ';
    if (type === 'faq_question_created') return 'Câu hỏi FAQ';
    if (type === 'system_announcement') return 'Hệ thống';
    if (type === 'lecturer_students_mail_merge') return 'Mail GVHD';
    if (type === 'manual_student_notice' || type === 'manual_lecturer_notice') return 'Thông báo';
    return type || 'Thông báo';
  };

  if (loading) return <div className="p-4 text-sm text-slate-500">Đang tải thông báo...</div>;

  return (
    <div className={compact ? '' : 'max-w-4xl mx-auto space-y-6'}>
      {!compact && (
        <PageHeader
          title="Thông báo của tôi"
          description={`${unread} thông báo chưa đọc.`}
          icon={<Bell size={20} />}
          actions={<Button onClick={markAllRead} disabled={!unread} variant="primary" size="sm">Đánh dấu đã đọc tất cả</Button>}
        />
      )}
      {compact && rows.length > 0 && (
        <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500">{unread} chưa đọc</span>
          <button onClick={markAllRead} disabled={!unread} className="text-xs font-semibold text-blue-600 hover:underline disabled:text-slate-400 disabled:no-underline cursor-pointer">
            Đã đọc tất cả
          </button>
        </div>
      )}
      <div className={compact ? 'divide-y divide-slate-100' : 'bg-white border border-slate-200 rounded-2xl shadow-sm divide-y divide-slate-100 overflow-hidden'}>
        {visibleRows.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">Chưa có thông báo.</div>
        ) : visibleRows.map(row => (
          <div key={`${row.source || 'personal'}-${row.id}`} className={`p-4 ${row.read_at ? 'bg-white' : 'bg-amber-50/70'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">{typeLabel(row.type)}</span>
                  {!row.read_at && <span className="w-2 h-2 rounded-full bg-blue-600 animate-none" title="Chưa đọc"></span>}
                </div>
                <div className="font-semibold text-slate-900">{row.subject}</div>
                <div className="text-sm text-slate-600 whitespace-pre-wrap mt-1">{row.body}</div>
                <div className="text-xs text-slate-400 mt-2">{row.created_at ? new Date(row.created_at).toLocaleString('vi-VN') : '-'}</div>
              </div>
              {!row.read_at && (
                <Button onClick={() => markRead(row)} size="sm">
                  Đã đọc
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      {compact && rows.length > visibleRows.length && (
        <Link to="/notifications" className="block px-4 py-3 text-sm text-center font-semibold text-blue-600 hover:bg-blue-50">
          Xem tất cả thông báo
        </Link>
      )}
    </div>
  );
}

export function PageDescriptionTooltip({ description }: { description: React.ReactNode }) {
  return (
    <span className="relative group inline-flex items-center align-middle ml-2 select-none">
      <CircleHelp size={16} className="text-slate-400 hover:text-slate-600 transition-all cursor-help" />
      <span className="absolute left-1/2 -translate-x-1/2 top-full mt-2 hidden group-hover:block bg-slate-800 text-white text-[11px] font-medium rounded-xl p-2.5 shadow-md w-64 whitespace-normal z-50 text-center leading-relaxed font-normal normal-case tracking-normal">
        {description}
      </span>
    </span>
  );
}

// Backward-compatible alias used by the existing Google Drive actions.
export const getGoogleDriveAccessToken = getDriveAccessToken;
