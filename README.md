# Hệ thống quản lý Thực tập và Dự án — FIT UET

Website: **https://fit-uet.github.io/** · Repository: [fit-uet/fit-uet.github.io](https://github.com/fit-uet/fit-uet.github.io).
Ứng dụng hỗ trợ Khoa CNTT quản lý đăng ký và triển khai học phần, sinh viên nộp báo cáo, giảng viên đánh giá và Khoa tổng hợp kết quả.

**Đã cài đặt quản lý học kỳ/nhóm môn và Dự án trên Express/React.** Có import xem trước, phân công GVNX, bài nộp phiên bản và điểm 60/40. Đã chuyển dữ liệu vào Turso vận hành sau sao lưu và diễn tập; luồng Thực tập cũ giữ dữ liệu gốc. Quy trình phát hành và kiểm tra phiên bản tại [PRODUCTION_RELEASE.md](docs/PRODUCTION_RELEASE.md).

## Tài liệu

| Tài liệu | Nội dung |
| --- | --- |
| [Đặc tả yêu cầu](docs/REQUIREMENTS.md) | Nghiệp vụ hiện có/mở rộng, phân quyền, nguồn Excel, mã yêu cầu và kịch bản nghiệm thu |
| [Thiết kế kiến trúc](docs/ARCHITECTURE.md) | Mô hình học vụ, dữ liệu, API, import, GVNX, phiên bản bài nộp và kế hoạch chuyển đổi |
| [Bản cài đặt và chạy thử](docs/IMPLEMENTATION_STATUS.md) | Phạm vi mã thực tế, bản thử độc lập, import tám lớp, chuyển dữ liệu cũ và kết quả kiểm thử |
| [Quản lý theo nhóm môn](docs/GROUP_MANAGEMENT.md) | Cách vận hành theo nhóm/kỳ, API, migration cấu hình và giao diện chung Thực tập cũ |
| [Staging cục bộ](docs/LOCAL_STAGING.md) | Database bản sao có lưu dữ liệu, đối soát, giao diện localhost và các bước nghiệm thu |
| [Danh sách sinh viên Dự án](docs/PROJECT_STUDENT_LIST.md) | Bảng tổng hợp, lưu nhiều dòng, xóa lần học và chuyển metadata schema 4 |
| [Phát hành production](docs/PRODUCTION_RELEASE.md) | Sao lưu Turso/R2, diễn tập, chờ backend đúng phiên bản trước phát hành Pages và khôi phục |
| [Thiết kế giao diện](docs/UI_DESIGN_SYSTEM.md) | UI primitives, tokens và quy chuẩn trình bày |
| [Hiệu năng và cache](docs/PERFORMANCE.md) | Tải theo chức năng, cache RAM/ETag, API đọc và cách nghiệm thu |
| [Bố cục giao diện cũ](docs/UI_RESTORATION.md) | Tổng quan theo vai trò, các màn riêng, bộ lọc nhóm/kỳ và nghiệm thu giao diện |

Hệ thống dùng Năm học → Học kỳ → Nhóm môn → Lớp học phần → Lần học. Dự án gồm INT3132/INT3131, tiếp nhận SV qua Excel, GVHD 60% và GVNX 40%. Quy tắc và giới hạn đầy đủ nằm trong đặc tả.

## Chức năng bản hiện tại

- Google OAuth, hồ sơ SV, danh mục giảng viên/doanh nghiệp/quản trị viên.
- Nguyện vọng Thực tập, duyệt đăng ký, xác nhận nơi TT và phân công GVHD.
- PDF cuối kỳ, xem PDF inline, chấm điểm, khóa/mở điểm và xuất XLSX.
- Chat riêng/nhóm với GVHD, đính kèm, thông báo web/email và nhắc hạn.
- Import/export danh mục, XLSX/ZIP, đồng bộ Google Sheets, kế hoạch Markdown/import Word và FAQ.

Trang `/#/classes` chọn học kỳ/nhóm môn; `/#/campaigns/:campaignId` quản lý chung và lọc lớp, import có đối soát, đề tài, GVHD/GVNX, bài nộp PDF/Drive, chấm theo vai trò, khóa/mở lại, chat/hỏi đáp chung theo nhóm, thông báo toàn nhóm hoặc theo lớp được chọn. Các màn Thực tập đợt cũ vẫn dùng dữ liệu gốc.

## Công nghệ và cấu trúc

Frontend: React 19, TypeScript, Vite 6, Tailwind CSS, React Router HashRouter, Google OAuth, XLSX/ZIP và Markdown.

Backend chính: Express trên Node.js, triển khai Render; cơ sở dữ liệu qua Cloudflare D1 REST hoặc Turso/libSQL. PDF và đính kèm lưu Cloudflare R2. Cloudflare Worker là backend phụ/thử nghiệm; workflow deploy Worker hiện tắt.

```text
src/app/          Route và guard giao diện
src/auth/         Chính sách vai trò frontend
src/features/     Màn hình student, lecturer, admin, shared
src/shared/       Cấu hình, tiện ích, UI dùng chung
server/routes/    API Express theo chức năng
server/services/  Nghiệp vụ, storage và tích hợp
server/db/        Khởi tạo schema hiện tại
scripts/          Build và công cụ bảo trì
.github/workflows/ Deploy, cron email và Sheets
```

## Chạy local

Dùng Node.js 20+ phù hợp workflow hiện tại và npm. Cài phụ thuộc, tạo file cấu hình:

```bash
npm install
cp .env.example .env
```

Với database local, sửa các giá trị trong `.env`:

```dotenv
DB_PROVIDER=turso
TURSO_DATABASE_URL=file:./internship-db.db
VITE_API_BASE_URL=
VITE_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
JWT_SECRET=your-local-development-secret
```

Đặt Google OAuth Client ID hợp lệ và cấu hình origin localhost tương ứng trong Google Cloud. Backend đọc `process.env`; nạp `.env` trước khi khởi động:

```bash
NODE_OPTIONS="--require dotenv/config" npm run dev
```

Mở `http://localhost:3000`. Express phục vụ Vite middleware và API cùng cổng khi phát triển. Có thể dùng `npm run dev` trực tiếp khi các biến backend đã được đưa vào môi trường tiến trình.

Các lệnh khác:

| Lệnh | Mục đích |
| --- | --- |
| `npm run lint` | Kiểm tra TypeScript, không sửa file |
| `npm run test:academic` | Kiểm thử nghiệp vụ, API và CLI migration với dữ liệu riêng |
| `npm run test:academic:ui` | Kiểm thử giao diện Chromium; cài browser bằng `npx playwright install chromium` lần đầu |
| `npm run test:academic:d1` | Kiểm chứng trigger/CAS/rollback trên D1 local riêng biệt |
| `npm run academic:preview` | Bản thử RAM, không dùng DB/OAuth/email thật; xem [hướng dẫn](docs/IMPLEMENTATION_STATUS.md#chạy-thử-độc-lập-với-dữ-liệu-đang-vận-hành) |
| `npm run academic:stage -- --source=file:/path/copy.db` | Tạo bản sao staging, diễn tập khởi tạo/ánh xạ, đối soát; yêu cầu Node 22.16+ |
| `npm run academic:stage:serve -- --directory=/path/staging-dir` | Mở bản sao đã đối soát trên localhost:4319, email/cron tắt |
| `npm run academic:campaign-migrate -- --database=file:/path/copy.db` | Xem trước chuyển cấu hình lớp thành nhóm; `--apply` sao lưu trước khi chuyển, chỉ nhận SQLite local |
| `npm run test:staging` | Kiểm thử sao lưu, WAL, đối soát và cấu hình staging |
| `npm run build` | Build frontend và bundle server |
| `npm start` | Chạy bundle server; cấu hình `NODE_ENV=production` và các biến backend trong môi trường |
| `npm run preview` | Xem build frontend, không thay thế API server |
| `npm run dev:worker` | Chạy backend Worker phụ bằng Wrangler |

Khởi động server gọi `initDb`, thêm schema academic rồi seed khi cần; không tự nhập workbook hoặc ánh xạ đợt cũ. `npm run db:migrate` vẫn là script bảo trì users cũ. Chuyển học vụ dùng xem trước/xác nhận trên UI hoặc `npm run academic:migrate -- --database=file:/path/copy.db` (dry-run mặc định, chỉ nhận bản sao SQLite local); xem [hướng dẫn chuyển dữ liệu](docs/IMPLEMENTATION_STATUS.md#ánh-xạ-thực-tập-cũ).

## Cấu hình môi trường

Các biến `VITE_*` được đóng gói vào frontend lúc build; thay đổi trên server sau build không tự cập nhật bundle. Chỉ đặt thông tin công khai trong các biến này.

| Nhóm | Biến / ý nghĩa |
| --- | --- |
| Frontend | `VITE_GOOGLE_CLIENT_ID`; `VITE_API_BASE_URL` trống nếu cùng origin; `VITE_GOOGLE_API_KEY` cho Drive Picker khi soạn email DN |
| Server | `NODE_ENV`, `PORT` mặc định 3000, `JWT_SECRET` bắt buộc production, `ADMIN_EMAIL`, `CORS_ORIGIN` gồm origin frontend được phép |
| D1 REST | `DB_PROVIDER=d1`, `CLOUDFLARE_API_TOKEN` hoặc `CLOUDFLARE_D1_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DATABASE_ID` hoặc `CLOUDFLARE_D1_DATABASE_ID` |
| Turso/libSQL | `DB_PROVIDER=turso`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` nếu dùng URL libsql remote |
| PDF/đính kèm | `R2_BUCKET` (hoặc `R2_BUCKET_NAME`), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID` hoặc `R2_ENDPOINT` |
| Chat | `CHAT_THREAD_STORAGE_MB` mặc định 200; `CHAT_DAILY_UPLOAD_MB` mặc định 50 |
| Sheets | `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`; chia sẻ bảng tính cho service account và chọn URL import/export trong Cài đặt |
| Email | `EMAIL_PROVIDER`, `BREVO_API_KEY` hoặc `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_DAILY_SEND_CAP`, `EMAIL_BATCH_SIZE`, `EMAIL_SEND_IMMEDIATE` |
| Cron | `CRON_SECRET`, giống giá trị dùng tại GitHub Actions |

Nếu không đặt DB_PROVIDER, backend chọn D1 khi có D1 token, còn lại Turso/libSQL. Nên đặt tường minh provider để vận hành nhất quán. Khi phát triển không cấu hình R2, file lưu dưới `.storage/final-reports` và `.storage/chat-attachments`; production yêu cầu R2, không dùng filesystem tạm của Render làm kho báo cáo.

Đặt `EMAIL_PROVIDER=none` để thử local không gửi email. Giữ secret trong môi trường triển khai hoặc file cấu hình đã được gitignore, không đưa vào bundle frontend.

## Triển khai

### Render

Tạo Web Service theo [render.yaml](render.yaml):

- Build: `npm ci && npm run build`; Node 24.
- Start: `npm start`, `NODE_ENV=production`.
- Đặt JWT, Google Client ID, provider DB/credentials, CORS và R2 theo bảng cấu hình. File render.yaml chưa khai báo mọi lựa chọn D1; thêm biến của provider thực tế trên dashboard.
- Thêm provider email, Sheets và CRON_SECRET nếu dùng các tích hợp đó.
- Cùng frontend/backend trên Render: VITE_API_BASE_URL trống khi build. Nếu frontend trên GitHub Pages, dùng URL API Render và origin Pages trong CORS_ORIGIN.

### GitHub Pages

[Workflow frontend](.github/workflows/deploy.yml) build khi push main hoặc chạy thủ công; chỉ publish sau khi API Render báo sẵn sàng với cùng SHA commit. Cấu hình repository Secrets/Variables cho VITE_API_BASE_URL, VITE_GOOGLE_CLIENT_ID và VITE_GOOGLE_API_KEY nếu cần Drive Picker. Chạy lại build khi thay biến VITE. HashRouter hỗ trợ đường dẫn ứng dụng trên Pages.

### Backend Worker phụ

[Workflow Worker](.github/workflows/deploy-worker.yml) hiện chỉ báo đã tắt. Cấu hình thử nghiệm nằm trong [wrangler.toml](wrangler.toml), biến local mẫu trong [.dev.vars.example](.dev.vars.example). Bản mở rộng học kỳ/Dự án phải đạt hợp đồng quyền/dữ liệu mới trước khi bật backend này; không trỏ hai backend ghi vào hai DB khác nhau cho cùng một lớp.

## Vận hành bản hiện tại

Khoa chọn học kỳ/nhóm môn, cấu hình hạn đăng ký, xác nhận nơi TT, đề xuất GVHD, nộp báo cáo và chấm điểm trong Thiết lập của nhóm; quản lý danh mục/import trước khi mở đợt. Theo dõi phân công, báo cáo và điểm trên các màn quản trị; xuất XLSX trước khi tổng hợp/chuyển kết quả sang hệ thống đào tạo.

Thông báo thủ công có hai chế độ: website kèm email theo quota hoặc chỉ website. Bản ghi web hiển thị độc lập việc gửi email; phần vượt quota nằm hàng đợi. Cấu hình triển khai mẫu dùng EMAIL_DAILY_SEND_CAP=250, EMAIL_BATCH_SIZE=25, EMAIL_SEND_IMMEDIATE=false; đây là cấu hình ứng dụng, cần đối chiếu hạn mức tài khoản email thực tế.

| Tác vụ | Lịch hiện có theo giờ Việt Nam | Điều kiện |
| --- | --- | --- |
| Quét nhắc hạn và xả email | [07:05 mỗi ngày](.github/workflows/process-queued-emails.yml) | GitHub Actions có VITE_API_BASE_URL và CRON_SECRET |
| Xuất đăng ký sang Sheets | [23:30 mỗi ngày](.github/workflows/export-registrations-to-sheet.yml) | Chỉ xuất trong hạn đăng ký đã cấu hình, service account có quyền bảng tính |
| Xả email từ Express | Sau khởi động 10 giây và mỗi 30 phút | Server đang chạy, có provider và quota còn lại |

Cron dùng `POST /api/cron/process-email-queue` và `POST /api/cron/export-to-sheet` với header X-Cron-Secret. Nút gửi hàng đợi là công cụ kích hoạt bổ sung. Theo dõi queued/failed, lỗi provider và workflow để xác định việc gửi thực tế; lịch trên không phải bảo đảm thời điểm thực thi tuyệt đối của dịch vụ bên ngoài.

Sao lưu database và manifest/file R2 trước tác vụ bảo trì dữ liệu, kiểm tra khả năng khôi phục. Đã ánh xạ 691 hồ sơ Thực tập hợp lệ vào Hè 2025–2026 và tiếp nhận 535 lần học Dự án HKI 2026–2027 vào Turso; 208 hồ sơ TT thiếu học phần được giữ để đối soát. Xem [quy trình phát hành](docs/PRODUCTION_RELEASE.md).

## Xử lý sự cố thường gặp

| Tình huống | Kiểm tra |
| --- | --- |
| Google OAuth không xác thực được | Client ID frontend/API có khớp, origin và bản build mới |
| API báo lỗi CORS | CORS_ORIGIN và VITE_API_BASE_URL đúng origin/domain đang dùng |
| DB không khởi động | DB_PROVIDER, credentials của đúng provider; URL libSQL remote cần auth token |
| PDF/đính kèm lỗi ở production | Đủ biến R2, quyền đọc/ghi bucket; production không fallback local |
| Drive Picker thiếu API key | Biến VITE_GOOGLE_API_KEY phải có lúc build frontend |
| Email giữ queued hoặc failed | Provider, sender, quota, cấu hình IP provider và lỗi trên lịch sử thông báo |
| Cron không chạy thành công | Secrets/Variables GitHub Actions, CRON_SECRET backend và URL API |
| Cần sửa phân công/điểm đã khóa | Khoa xử lý qua màn quản trị và quy trình được mô tả trong đặc tả |
