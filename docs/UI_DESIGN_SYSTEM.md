# TÀI LIỆU THIẾT KẾ GIAO DIỆN HỆ THỐNG (UET INSTITUTIONAL UI DESIGN SYSTEM)
## HỆ THỐNG ĐĂNG KÝ VÀ QUẢN LÝ THỰC TẬP — FIT UET

---

## 1. TỔNG QUAN VÀ TRIẾT LÝ THIẾT KẾ

Tài liệu này xác lập tiêu chuẩn thiết kế giao diện người dùng (UI/UX Design System) cho toàn bộ Hệ thống Đăng ký và Quản lý Thực tập FIT UET. 

Hệ thống được chuẩn hóa toàn diện theo **Hệ thống Nhận diện Thể chế & Bộ Quy chuẩn ICD Design Tokens chính thức của Trường Đại học Công nghệ — ĐHQGHN** (như tại cổng thông tin [https://uet.edu.vn/](https://uet.edu.vn/)), đồng thời **giữ nguyên vẹn thiết kế thanh Header màu xanh đặc trưng hiện tại** theo chỉ định của Nhà trường.

Tiêu chuẩn này áp dụng nhất quán trên **tất cả các màn hình** và cho **tất cả các phân hệ / vai trò (Roles)**:
- **Sinh viên (Student)**
- **Giảng viên (Lecturer)**
- **Quản trị viên (Admin / Khoa)**

---

### 1.1. Ba Trụ Cột Triết Lý Thiết Kế UET Institutional

```
┌────────────────────────────────────────────────────────────────────────┐
│                   TRIẾT LÝ THIẾT KẾ THỂ CHẾ UET (ICD)                  │
├───────────────────┬────────────────────────────┬───────────────────────┤
│ 1. INSTITUTIONAL  │     2. BORDER-FIRST        │  3. HIGH-DENSITY      │
│     AUTHORITY     │    (VIỀN LÀM CHỦ ĐẠO)      │     ACADEMIC CLARITY  │
├───────────────────┼────────────────────────────┼───────────────────────┤
│ • Xanh UET #034EA1│ • Viền Slate #E2E8F0 mảnh  │ • Bảng biểu sắc nét   │
│ • Slate-900 chữ rõ│ • Bóng đổ nhẹ (1px - 2px)  │ • Typography Inter    │
│ • Giữ Header hiện │ • Bo góc kỷ luật 6px/10px  │ • Badge trạng thái rõ │
│   tại của Khoa    │ • Không đổ bóng đen nặng   │ • Dễ tra cứu điểm/hồ sơ
└───────────────────┴────────────────────────────┴───────────────────────┘
```

1. **Institutional Authority (Bản sắc Thể chế Đại học & Công nghệ)**:
   - Màu sắc chủ đạo phản ánh sắc xanh trường ĐH Công nghệ (`#034ea1`), mang lại cảm giác trang trọng, tin cậy, khoa học và nhất quán với hệ sinh thái `uet.edu.vn`.
   - Giữ nguyên vẹn thanh Header xanh hiện tại (`#064889` → `#075fc7` → `#1473e6`) để duy trì nhận diện thân thuộc của Khoa CNTT.

2. **Border-First Design (Triết lý Viền làm Chủ đạo)**:
   - Ưu tiên sử dụng hệ đường viền mỏng tinh tế (`#e2e8f0` và `#cbd5e1`) để định hình các khối dữ liệu, thay vì lạm dụng bóng đổ quá dày.
   - Bóng đổ chỉ đóng vai trò hỗ trợ nhẹ (`0 1px 2px rgba(15, 23, 42, 0.04)`), giúp màn hình luôn phẳng, sạch sẽ và chuyên nghiệp.

3. **High-Density Academic Clarity (Minh bạch Dữ liệu Học thuật)**:
   - Các bảng điểm, danh sách nguyện vọng, phân công giảng viên và tài liệu PDF được trình bày với mật độ thông tin hợp lý, độ tương phản cao đạt chuẩn WCAG AA.
   - Loại bỏ hoàn toàn sự trang trí rườm rà; mọi thành phần UI đều phục vụ trực tiếp cho tác vụ đăng ký, phê duyệt và đánh giá thực tập.

---

## 2. HỆ THỐNG QUY CHUẨN DESIGN TOKENS (UET ICD TOKENS)

### 2.1. Bảng Màu Hệ Thống (Color Palette)

#### A. Màu Nhận Diện Thương Hiệu (Brand & Accents)
| Token Name | Giá trị Hex / CSS | Mô tả & Ứng dụng |
| :--- | :--- | :--- |
| `--ui-brand` | `#034ea1` (RGB: `3, 78, 161`) | **Xanh thương hiệu UET chính thức**. Nút chính, chỉ báo active, icon điểm nhấn. |
| `--ui-brand-hover` | `#023a7a` | Trạng thái hover của nút chính, liên kết. |
| `--ui-brand-soft` | `#e8f1fb` | Nền mềm cho Badge thông tin, Icon Box, Button Tinted. |
| `--ui-brand-soft-hover` | `#d4e5f7` | Trạng thái hover của Button Tinted và thẻ đếm. |
| `--fit-header-gradient` | `linear-gradient(110deg, #064889 0%, #075fc7 62%, #1473e6 100%)` | **Thanh Header FIT UET hiện tại** (được giữ nguyên theo yêu cầu). |

#### B. Màu Nền và Bề Mặt (Surfaces & Neutral Palette)
| Token Name | Giá trị Hex / CSS | Mô tả & Ứng dụng |
| :--- | :--- | :--- |
| `--ui-canvas` | `#f8fafc` (Slate 50) | Nền canvas toàn trang (chuẩn UET surface-muted), dịu mắt và sáng rõ. |
| `--ui-surface` | `#ffffff` | Nền thẻ (Cards), bảng dữ liệu, ô nhập liệu, modal sheet. |
| `--ui-surface-subtle` | `#f1f5f9` (Slate 100) | Nền header bảng (`thead`), nền khối callout, vùng phụ trợ. |
| `--ui-border` | `#e2e8f0` (Slate 200) | Viền thẻ, viền bảng, đường kẻ phân cách giữa các hàng dữ liệu. |
| `--ui-border-strong` | `#cbd5e1` (Slate 300) | Viền ô input, viền nút phụ khi tương tác. |

#### C. Màu Chữ & Văn Bản (Typography Colors)
| Token Name | Giá trị Hex | Ứng dụng |
| :--- | :--- | :--- |
| `--ui-text` | `#0f172a` (Slate 900) | Chữ chính: Tiêu đề trang, nhãn trường, nội dung bảng, điểm số (độ tương phản cao). |
| `--ui-text-muted` | `#334155` (Slate 700) | Chữ phụ: Mô tả ngắn, văn bản thân, metadata cột. |
| `--ui-text-subtle` | `#64748b` (Slate 500) | Chữ mờ: Metadata ngày tháng, thông số phụ. |
| `--ui-text-disabled` | `#94a3b8` (Slate 400) | Placeholder, icon vô hiệu hóa. |

#### D. Màu Trạng Thái Ngữ Nghĩa (Semantic Feedback)
| Ngữ nghĩa | Màu chính | Nền mềm (Soft Tint) | Viền mềm (Soft Border) | Ứng dụng thực tế |
| :--- | :--- | :--- | :--- | :--- |
| **Thông tin / Cần xử lý** | `#034ea1` | `#e8f1fb` | `#d4e5f7` | **Chưa chấm điểm** (báo cáo đã nộp chờ giảng viên chấm). |
| **Thành công (Success)** | `#15803d` | `#dcfce7` | `#bbf7d0` | Đã duyệt đề cương, Nộp báo cáo thành công, Điểm đạt, Đã nộp điểm. |
| **Cảnh báo (Warning)** | `#c2410c` | `#ffedd5` | `#fed7aa` | Cần nộp lại báo cáo, Chờ GV duyệt, Sắp hết hạn nộp đề cương/báo cáo. |
| **Nguy hiểm (Danger)** | `#b91c1c` | `#fee2e2` | `#fecaca` | Bị từ chối, Quá hạn nộp bài, Xóa phân công. |
| **Trung tính (Neutral)** | `#64748b` | `#f1f5f9` | `#e2e8f0` | Chưa nộp báo cáo, Chưa phân công, Tài liệu đính kèm. |

---

### 2.2. Hệ Thống Kiểu Chữ (Inter Tight / Inter Scale)

Hệ thống sử dụng bộ font chính thức của UET: `"Inter Tight", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif`.

| Cấp bậc (Hierarchy) | Kích thước | Line Height | Weight | Tracking | Ứng dụng |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Page Title** | `22px - 24px` | `1.25` | Bold (700) | `-0.02em` | Tiêu đề đầu trang (Dashboard, PlanView) |
| **Section Title (h2)** | `18px - 20px` | `1.3` | Bold (700) | `-0.015em`| Tiêu đề khối lớn, nhóm chức năng chính |
| **Card / Modal Title (h3)**| `15px - 16px` | `1.35` | Semibold (600) | `-0.01em` | Tiêu đề thẻ Card, tên bảng, modal header |
| **Headline** | `13px - 14px` | `1.4` | Semibold (600) | `-0.005em`| Tên sinh viên, tên công ty, nhãn trường |
| **Body text** | `13px - 14px` | `1.5` | Regular (400) | `0em` | Văn bản nội dung, đoạn mô tả |
| **Small / Badges** | `11px - 12px` | `1.35` | Semibold (600) | `+0.01em` | Badge trạng thái, metadata phụ |
| **Table Head** | `11px` | `1.3` | Bold (700) | `+0.025em`| Nhãn cột dữ liệu in hoa (`uppercase`) |

---

### 2.3. Quy Chuẩn Bo Góc & Bóng Đổ (Radii & Elevation)

#### A. Bo góc chuẩn UET ICD:
- `--ui-radius-control` (`0.375rem` / `6px`): Nút bấm (Buttons), ô nhập liệu (Inputs, Selects, Textareas), Segmented control.
- `--ui-radius-card` (`0.625rem` / `10px`): Khung thẻ Card, container khối dữ liệu, callout banner.
- `--ui-radius-lg` (`1rem` / `16px`): Khung cửa sổ Modal Dialog, Review Sheet lớn.
- `--ui-radius-pill` (`999px`): Badge trạng thái dạng viên con nhộng, avatar tròn.

#### B. Bóng đổ & Focus Ring:
- **Card Shadow**: `0 1px 2px rgba(15, 23, 42, 0.04)` kết hợp viền `1px solid #e2e8f0`.
- **Floating Shadow (Modal / Dropdown)**: `0 8px 24px rgba(15, 23, 42, 0.10)`.
- **Focus Ring**: `0 0 0 3px rgba(3, 78, 161, 0.20)` (hiển thị khi nhấn phím tab hoặc focus ô nhập liệu).

---

## 3. TIÊU CHUẨN THIẾT KẾ LINH KIỆN (COMPONENT STANDARDS)

### 3.1. Nút Bấm (`.ui-button`)
- Chiều cao chuẩn: `34px - 38px`, bo góc `6px`, font chữ `12px - 13px font-semibold`.
- **Nút Chính (Primary)**: Nền xanh UET `#034ea1`, chữ trắng, hover `#023a7a`.
- **Nút Phụ (Secondary)**: Nền trắng `#ffffff`, viền `#e2e8f0`, chữ `#0f172a`, hover nền `#f1f5f9`.
- **Nút Tinted UET**: Nền `#e8f1fb`, chữ `#034ea1`, hover `#d4e5f7`.
- **Nút Tinted Success**: Nền `#dcfce7`, chữ `#15803d`, hover `#bbf7d0`.
- **Nút Tinted Danger**: Nền `#fee2e2`, chữ `#b91c1c`, hover `#fecaca`.

### 3.2. Bảng Dữ Liệu Học Thuật (Data Tables)
- Bao bọc bởi khung bo góc `10px`, viền `1px solid #e2e8f0`, `overflow-hidden`.
- Hàng tiêu đề `thead th`: Nền `#f1f5f9`, chữ in hoa màu `#334155`, font `11px font-bold`, viền đáy `1px solid #e2e8f0`.
- Hàng nội dung `tbody td`: Viền đáy `1px solid #e2e8f0`.
- Hiệu ứng Hover: Nền chuyển nhẹ sang `#f8fafc`.

### 3.3. Thanh Phân Đoạn (Segmented Control - `.ui-segmented-control`)
- Khung nền xám nhạt `#f1f5f9`, viền `1px solid #e2e8f0`, bo góc `6px`, padding `3px`.
- Item active: Nền trắng `#ffffff`, chữ `#034ea1 font-semibold`, bóng mờ nhẹ `0 1px 2px rgba(15, 23, 42, 0.06)`.
- Item inactive: Không nền, chữ `#334155`, hover chữ `#0f172a`.

### 3.4. Thẻ Trạng Thái & Callout (Status Cards & Callouts)
- Bo góc `6px` hoặc `10px`, viền mảnh màu pastel tương ứng.
- Phân định rõ các trạng thái: Info / Action-required (xanh dương UET), Success (xanh lá), Warning (cam), Danger (đỏ), Neutral (xám Slate).

### 3.5. Nhãn Trạng Thái Báo Cáo & Chấm Điểm Thực Tập (Report Assessment Badges)
Quy chuẩn hóa nhãn trạng thái từ góc nhìn của Giảng viên đánh giá:
- **Chưa nộp**: Nền `#fff1f2` (`rose-50`), viền `#fecdd3` (`rose-200`), chữ `#be123c` (`rose-700`) (Cảnh báo đỏ). Hiển thị khi sinh viên chưa nộp báo cáo thực tập cuối kỳ.
- **Chưa chấm điểm**: Nền `#fff1f2` (`rose-50`), viền `#fecdd3` (`rose-200`), chữ `#be123c` (`rose-700`) (Cảnh báo đỏ). Kích hoạt sự chú ý đặc biệt của giảng viên cần chấm và hoàn thiện điểm cho bài nộp.
- **Đã nộp điểm**: Nền `#dcfce7`, viền `#bbf7d0`, chữ `#15803d` (Success). Hiển thị ngay sau khi giảng viên hoàn tất nộp điểm cho Khoa.
- **Cần nộp lại**: Nền `#ffedd5`, viền `#fed7aa`, chữ `#c2410c` (Warning). Hiển thị khi giảng viên yêu cầu sinh viên nộp lại báo cáo.

---

## 4. BẢO TỒN THIẾT KẾ HEADER & HOÀN THIỆN TOÀN HỆ THỐNG

1. **Thanh Header Hiện Tại**:
   - Vẫn duy trì thanh Header xanh chuyển sắc đặc trưng (`#064889` → `#075fc7` → `#1473e6`).
   - Cung cấp đầy đủ icon Chat trao đổi GVHD-SV, chuông thông báo, menu tài khoản, và nhận diện Khoa CNTT.
   - **Nút Chuyển Đổi Nhanh Vai Trò (Contextual Role Switcher Pill)**:
     - Dành riêng cho tài khoản Quản trị viên đồng thời là Giảng viên (`user.role === 'admin' && user.is_lecturer`).
     - Đặt ngay trên Header bên trái Avatar: khi ở trang Quản trị hiển thị `[ 🎓 Trang Giảng viên ]`, khi ở trang Giảng viên tự động đổi thành `[ 🛡️ Trang Quản trị ]`, cho phép chuyển đổi 1-click tức thì.
2. **Khu Vực Thân Trang & Footer**:
   - Nền toàn trang chuyển sang Slate Canvas `#f8fafc`.
   - Bảng biểu, nút bấm, ô input, modal chấm điểm và các khối chức năng đều đồng bộ 100% theo các biến UET ICD Design Tokens.
   - Toàn bộ worker (`src/worker.ts`), logic D1, xác thực Google OAuth và websocket được giữ nguyên vẹn không đổi.
