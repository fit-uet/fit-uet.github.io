# Hệ thống đăng ký thực tập FIT UET

Tài liệu này mô tả kiến trúc, quy trình nghiệp vụ và cách vận hành hệ thống đăng ký thực tập FIT UET.

## 1. Mục tiêu hệ thống

Hệ thống hiện tại hỗ trợ Khoa CNTT tổ chức đợt đăng ký thực tập cho sinh viên qua Website TTCN:

- Sinh viên đăng nhập bằng tài khoản Google `@vnu.edu.vn`.
- Sinh viên cập nhật hồ sơ cá nhân và đăng ký nơi thực tập.
- Khoa quản lý danh sách sinh viên, doanh nghiệp, giảng viên, quản trị viên.
- Khoa duyệt/từ chối đăng ký, xuất danh sách đăng ký ra XLSX/ZIP và đồng bộ Google Sheets.
- Khoa công bố kế hoạch triển khai dưới dạng Markdown hoặc import từ file Word `.docx`.

Phạm vi hiện tại tập trung chủ yếu vào giai đoạn trước và trong lúc đăng ký. Các bước sau đăng ký như gửi danh sách sang doanh nghiệp, sinh viên xác nhận nơi thực tập chính thức, Khoa phân công giảng viên hướng dẫn, sinh viên nộp báo cáo final và giảng viên chấm điểm chưa được quản lý đầy đủ trong hệ thống.

## 1.1. Quy tắc nghiệp vụ đã xác nhận

Các quy tắc sau được dùng làm cơ sở khi mở rộng hệ thống:

- Khoa chỉ duyệt thủ công khi doanh nghiệp sinh viên tự liên hệ không nằm trong danh sách công ty đã được Khoa thẩm định trong `data/seed/it-companies-list.csv`. Danh sách này không công khai cho sinh viên.
- Danh sách công ty đã thẩm định được quản lý riêng trong màn “Danh sách công ty thẩm định nội bộ” bên trong khu “Quản lý công ty”, có CRUD, import/export XLSX, tìm kiếm và sắp xếp.
- Kết quả phỏng vấn do công ty xác nhận trực tiếp với sinh viên; Khoa không cần nhập trạng thái `PASS/FAIL` cho từng sinh viên trên hệ thống.
- Sinh viên chịu trách nhiệm xác nhận 1 nơi thực tập chính thức mà mình đã trúng tuyển để thực tập, nộp báo cáo và tính điểm.
- Sau khi có kết quả phỏng vấn trong thời hạn Khoa cho phép, sinh viên đăng nhập hệ thống để xác nhận nơi thực tập chính thức và cam kết thông tin là đúng.
- Nếu sinh viên không trúng tuyển tất cả nơi đã đăng ký, hệ thống cho phép sinh viên đăng ký/xác nhận phương án thực tập tại trường.
- Sinh viên không được xác nhận nơi thực tập tại công ty chưa được Khoa duyệt.
- Với sinh viên thực tập tại công ty, Khoa tự phân công giảng viên hướng dẫn.
- Với sinh viên thực tập tại trường, nếu đã được giảng viên đồng ý thì sinh viên chọn giảng viên đó. Nếu chưa có giảng viên đồng ý, sinh viên không cần chọn; Khoa sẽ phân công sau.
- Giảng viên cử nhân, nhận diện theo tên có chữ `CN`, không được làm giảng viên hướng dẫn chính, chỉ được đồng hướng dẫn.
- Chỉ tiêu mặc định tính gộp cả hướng dẫn chính và đồng hướng dẫn: `GS`/`PGS` tối đa 5 sinh viên, `TS` tối đa 8 sinh viên, `ThS`/khác tối đa 10 sinh viên. Khoa có thể cấu hình quota riêng cho từng giảng viên.
- Nếu sinh viên đã được giảng viên đồng ý hướng dẫn nhưng vượt quota, hệ thống vẫn chấp nhận và ghi nhận phân công; sinh viên chỉ nhận cảnh báo trực tiếp trên giao diện.
- Sinh viên không tìm được cơ hội thực tập tại doanh nghiệp sau thời hạn sẽ được Khoa chủ động chuyển trạng thái và phân công phương án thực tập tại trường hoặc đối tác khác.
- Báo cáo định kỳ được nộp qua email cho giảng viên; hệ thống chỉ cần quản lý báo cáo final theo khoảng thời gian mở/đóng nộp của đợt.
- Báo cáo final nộp trên hệ thống ở định dạng PDF.
- Để có phương án miễn phí cho khoảng 900 sinh viên, ưu tiên lưu file PDF trên Cloudflare R2 và giới hạn dung lượng mỗi file tối đa 10 MB. Với giới hạn này, 900 báo cáo tương đương khoảng 9 GB, nằm trong mức free tier 10 GB-month của R2 tại thời điểm cập nhật tài liệu. Hệ thống từ chối file PDF lớn hơn 10 MB và yêu cầu sinh viên nén lại trước khi nộp.
- Điểm 60% đánh giá công ty/GVHD do giảng viên tự nhập dựa trên trao đổi và bản cứng sinh viên nộp.
- Hệ thống không cần lưu chữ ký/xác nhận của doanh nghiệp hoặc giảng viên.
- Bảng điểm cuối cùng cần xuất được XLSX để Khoa tổng hợp và nhập hệ thống.
- Cần có thông báo email tự động khi các trạng thái quan trọng thay đổi, ví dụ: đăng ký được duyệt/từ chối, mở hạn xác nhận nơi thực tập, sinh viên đã xác nhận nơi thực tập, phân công GVHD, nhắc hạn nộp báo cáo final và thông báo cho sinh viên khi GVHD nộp điểm.
- **Quy tắc về thông báo nộp điểm:** Khi GVHD nộp điểm thực tập, hệ thống chỉ gửi thông báo (trên web và qua email) cho chính sinh viên tương ứng để biết điểm tổng kết tạm tính. Hệ thống **tuyệt đối không gửi thông báo trên website và không gửi email cho Quản trị viên (Admin/Khoa)** để tránh làm tràn hộp thư (inbox spam) khi giảng viên nộp điểm hàng loạt, đồng thời bảo toàn hạn ngạch gửi email hàng ngày của hệ thống. Quản trị viên theo dõi tiến độ nộp điểm tập trung trên trang Quản lý điểm (`/admin/grades`) và xuất file tổng hợp XLSX.
- Khi admin soạn thông báo thủ công và chọn **“Hiển thị trên website và gửi email theo quota”**, thông báo phải hiển thị trên website ngay; hệ thống gửi email ngay cho số người nhận còn nằm trong quota ngày và tự động đưa phần vượt quota vào hàng đợi để gửi sau.
- **Quy tắc gửi email tự động theo hạn ngạch mỗi ngày:** Các email nằm trong hàng đợi (`queued`) sẽ được hệ thống **tự động gửi định kỳ mỗi ngày khi bước sang ngày mới và quota được làm mới**, tự động gửi tối đa cho đến khi hết hạn ngạch ngày (`EMAIL_DAILY_SEND_CAP`). Quản trị viên (Admin) **hoàn toàn không cần phải đăng nhập và bấm nút “Gửi theo quota” thủ công** mỗi ngày; nút này trên giao diện chỉ đóng vai trò kích hoạt tức thì bổ sung nếu Admin muốn ép gửi ngay.


## 2. Công nghệ và triển khai

Frontend:

- React 19, Vite 6, TypeScript.
- Tailwind CSS.
- React Router dạng `HashRouter`.
- Google OAuth bằng `@react-oauth/google`.
- Xuất dữ liệu XLSX/ZIP bằng `xlsx`, `file-saver` và `jszip`; import XLSX cho các danh sách quản trị.
- Import kế hoạch từ Word bằng `mammoth`, chuyển HTML sang Markdown bằng `turndown`.

Backend:

- Runtime chính khuyến nghị: Express server trên Render (`server.ts`).
- Cloudflare Worker entrypoint (`src/worker.ts`) được giữ như phương án phụ/thử nghiệm, không khuyến nghị cho migration dữ liệu lớn vì giới hạn subrequests theo mỗi invocation.
- Cơ sở dữ liệu chính khi deploy Render: Turso/libSQL.
- JWT tự ký bằng `JWT_SECRET`.
- Tích hợp Google Sheets bằng Service Account.
- Báo cáo final PDF và file đính kèm trong chat được lưu trên Cloudflare R2 qua S3-compatible API. Turso chỉ lưu metadata trong `final_reports`, `chat_messages` và `chat_group_messages`. Khi chạy local chưa cấu hình R2, backend có fallback lưu vào `scratch/final-reports` và `scratch/chat-attachments`; khi chạy production bắt buộc cấu hình R2.
- Chat hỗ trợ cả trao đổi 1-1 giữa sinh viên và giảng viên hướng dẫn, và nhóm chat theo từng giảng viên với toàn bộ sinh viên được phân công cho giảng viên đó. Trạng thái đọc của nhóm dùng bảng `chat_group_message_reads` để không nhân bản một tin nhắn cho từng sinh viên.
- Notification history ghi vào bảng `notifications`. Với thông báo thủ công, hệ thống gửi email ngay trong phần quota ngày còn lại và giữ phần vượt quota trong hàng đợi; hàng đợi tiếp tục được xử lý theo batch để phù hợp Brevo Free 300 email/ngày. Resend chỉ còn là provider dự phòng nếu cấu hình thủ công. Email gửi doanh nghiệp tạm thời được soạn sẵn qua Gmail/app Mail để Khoa gửi thủ công vì chưa xác thực được domain trường trên Brevo.

Các biến/secrets chính:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `JWT_SECRET`
- `VITE_GOOGLE_CLIENT_ID`
- `VITE_GOOGLE_API_KEY`, dùng cho Google Drive Picker khi soạn email gửi doanh nghiệp kèm link Drive.
- `ADMIN_EMAIL`
- `CORS_ORIGIN`, đặt bằng domain frontend/Render cần cho phép.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` để lưu báo cáo final PDF trên Cloudflare R2.
- `R2_ENDPOINT` nếu muốn khai báo endpoint thủ công; nếu bỏ trống hệ thống dùng `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`.
- `CHAT_THREAD_STORAGE_MB`, mặc định `200`, giới hạn tổng file chat trong một cuộc trò chuyện.
- `CHAT_DAILY_UPLOAD_MB`, mặc định `50`, giới hạn dung lượng file chat một tài khoản được gửi trong ngày.
- `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY` nếu muốn gửi email thật qua Brevo.
- `EMAIL_DAILY_SEND_CAP`, ví dụ `250`, để chừa quota phát sinh trong giới hạn Brevo Free 300 email/ngày.
- `EMAIL_BATCH_SIZE`, ví dụ `25`, số email tối đa gửi mỗi lần xử lý hàng đợi; không giới hạn số email gửi ngay của thao tác thủ công nếu vẫn còn quota ngày.
- `EMAIL_SEND_IMMEDIATE=false` để kiểm soát việc gửi ngay của các notification tự động phát sinh từ nghiệp vụ. Lựa chọn thủ công **“Hiển thị trên website và gửi email theo quota”** luôn thử gửi trong quota, không phụ thuộc biến này.
- `EMAIL_FROM`, ví dụ `FIT UET Internship <no-reply@domain.edu.vn>`, cần là sender/domain đã xác minh ở provider.
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` nếu dùng Google Sheets.

Gửi email thật:

- Mọi thông báo đều được ghi vào `notifications` để hiển thị trên website và theo dõi lịch sử gửi.
- Trong form soạn thông báo thủ công, phương thức mặc định là **“Hiển thị trên website và gửi email theo quota”**. Hệ thống tính quota còn lại bằng `EMAIL_DAILY_SEND_CAP - số email đã gửi thành công trong ngày`, gửi ngay tối đa phần quota còn lại và giữ các thông báo vượt quota ở trạng thái `queued`.
- Nếu quota còn lại bằng `0`, toàn bộ thông báo vẫn hiển thị trên website và được đưa vào hàng đợi; thao tác tạo thông báo không bị từ chối.
- **Tự động gửi mỗi ngày theo quota:** Hàng đợi email (`status = 'queued'`) được hệ thống **tự động quét và gửi định kỳ mỗi ngày qua tác vụ tự động (daily cron job)** theo đúng hạn ngạch còn lại của ngày mới (`EMAIL_DAILY_SEND_CAP - sent_today`), gửi tuần tự theo thời gian tạo (FIFO). Quản trị viên **không cần phải đăng nhập và bấm nút “Gửi theo quota” mỗi ngày**. Nút “Gửi theo quota” trên giao diện Quản trị chỉ là tùy chọn kích hoạt thủ công khi Admin muốn gửi bổ sung ngay tức khắc.
- Gửi thành công thì trạng thái chuyển `sent` và có `sent_at`; gửi lỗi thì trạng thái chuyển `failed` và lưu `error`. Nếu gặp giới hạn tốc độ tạm thời từ nhà mạng, bản ghi vẫn giữ `queued` để tự động xử lý tiếp ở lượt sau.
- Nếu chưa cấu hình provider, notification giữ trạng thái `queued` để admin theo dõi/đánh dấu thủ công; thông báo trên website vẫn được tạo bình thường.
- Nếu Brevo báo lỗi `unrecognised IP address`, vào Brevo > Security > Authorised IPs và thêm IP máy chủ trong thông báo lỗi. Với Render Free, outbound IP có thể thay đổi nên cần kiểm tra lại nếu lỗi xuất hiện lại; phương án ổn định hơn là dùng dịch vụ có static outbound IP hoặc tắt giới hạn Authorized IPs trên Brevo nếu chính sách cho phép.
Chạy local:

```bash
npm install
npm run dev
```

Deploy Render:

1. Tạo Web Service từ repo này trên Render.
2. Render đọc `render.yaml` để chạy:
   - Build: `npm install && npm run build`
   - Start: `npm start`
3. Thêm các environment variables/secrets trong Render:
   - `NODE_ENV=production`
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `JWT_SECRET`
   - `VITE_GOOGLE_CLIENT_ID`
   - `VITE_GOOGLE_API_KEY` nếu muốn dùng Google Drive Picker để tạo link danh sách gửi doanh nghiệp.
   - `ADMIN_EMAIL`
   - `CORS_ORIGIN`
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
   - `R2_ENDPOINT` nếu không muốn dùng endpoint mặc định theo account id.
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` nếu dùng Google Sheets.
   - `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY`, `EMAIL_FROM` nếu gửi email thật qua Brevo.
   - `EMAIL_DAILY_SEND_CAP=250`, `EMAIL_BATCH_SIZE=25`, `EMAIL_SEND_IMMEDIATE=false`.
4. Nếu frontend và backend phục vụ cùng Render service thì `VITE_API_BASE_URL` có thể để trống khi build. Nếu frontend vẫn ở GitHub Pages, đặt `VITE_API_BASE_URL` về URL Render backend và `CORS_ORIGIN` về URL GitHub Pages.

Deploy GitHub Pages:

- Frontend được build trong GitHub Actions, nên các biến `VITE_*` phải tồn tại ở GitHub repo `Settings` -> `Secrets and variables` -> `Actions`.
- Workflow `Deploy Frontend to GitHub Pages` đọc được cả `Secrets` và `Variables` cho `VITE_API_BASE_URL`, `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY`.
- Sau khi thêm/sửa `VITE_GOOGLE_API_KEY`, cần chạy lại workflow hoặc push commit mới để Vite đóng gói lại biến vào bundle frontend.

Lưu ý khi quay lại Render:

- Không cần migration Turso sang D1 nữa vì Render server đọc trực tiếp Turso hiện tại.
- Các endpoint Worker/D1 vẫn còn trong `src/worker.ts` để tham khảo hoặc thử nghiệm, nhưng không dùng cho deploy Render.
- Render Free có thể sleep; request đầu tiên sau thời gian idle sẽ chậm.
- Upload báo cáo final trên production cần Cloudflare R2. Nếu thiếu biến R2, endpoint upload/download PDF sẽ báo lỗi cấu hình thay vì lưu vào filesystem tạm của Render.

Nếu dùng tính năng xuất dữ liệu vào Google Sheets:

Thêm `GOOGLE_SERVICE_ACCOUNT_EMAIL` và `GOOGLE_PRIVATE_KEY` trong Render Environment.

## 3. Vai trò người dùng

### Sinh viên

Sinh viên là người dùng mặc định khi đăng nhập bằng email `@vnu.edu.vn` và email đó không nằm trong danh sách giảng viên hoặc admin.

Sinh viên có thể:

- Xem kế hoạch triển khai thực tập.
- Xem danh sách nơi thực tập.
- Tìm kiếm/sắp xếp danh sách doanh nghiệp.
- Xem chi tiết doanh nghiệp: mô tả, chỉ tiêu, liên hệ, địa chỉ, link tuyển dụng, yêu cầu.
- Cập nhật hồ sơ: họ tên, mã sinh viên, ngày sinh, lớp khóa học, học phần thực tập, số điện thoại, email cá nhân.
- Đăng ký tối đa 5 nơi thực tập.
- Đăng ký doanh nghiệp chính thức trong danh sách.
- Đăng ký “Công ty khác” với thông tin công ty tự liên hệ.
- Đăng ký “Trường Đại học Công nghệ” khi thực tập tại trường, kèm tên giảng viên hướng dẫn.
- Hủy toàn bộ đăng ký và đăng ký lại trong thời gian hệ thống mở.
- Xem trạng thái đăng ký: `Chờ duyệt`, `Đã duyệt`, `Từ chối`.

### Quản trị viên

Admin có thể:

- Xem toàn bộ danh sách đăng ký.
- Tìm kiếm, sắp xếp, lọc theo học phần.
- Duyệt/từ chối từng đăng ký.
- Duyệt tất cả đăng ký đang chờ.
- Sửa hoặc xóa nguyện vọng đăng ký thực tập của sinh viên.
- Xuất danh sách đang lọc ra XLSX.
- Xuất danh sách theo học phần hoặc theo công ty thành ZIP chứa XLSX.
- Lưu danh sách đăng ký vào Google Sheets.
- Quản lý sinh viên: import XLSX, xuất XLSX, xóa sinh viên.
- Quản lý giảng viên: thêm/sửa/xóa/import/export danh sách giảng viên.
- Quản lý doanh nghiệp: thêm/sửa/xóa/import/export danh sách doanh nghiệp.
- Đồng bộ danh sách doanh nghiệp từ Google Sheets.
- Quản lý admin khác.
- Đánh dấu admin đồng thời là giảng viên để sinh viên có thể chọn làm GVHD.
- Cấu hình năm học, thời gian mở/đóng đăng ký, danh sách lớp khóa học.
- Cập nhật nội dung kế hoạch triển khai.

### Giảng viên

Giảng viên được xác định khi email nằm trong bảng `lecturers`. Khi đăng nhập, tài khoản có vai trò `lecturer`.

Hiện tại giảng viên có thể:

- Xem trang hồ sơ giảng viên.
- Cập nhật tên hiển thị.
- Xem kế hoạch triển khai.
- Xem danh sách sinh viên được phân công.
- Tải và cập nhật trạng thái báo cáo final của sinh viên phụ trách.
- Nhập/lưu nháp/nộp điểm thực tập cho sinh viên mình là GVHD chính.

## 4. Mô hình dữ liệu hiện tại

### `users`

Lưu người dùng dùng chung cho sinh viên, giảng viên và admin.

Trường chính:

- `email`, `name`, `picture`
- `role`: `student`, `lecturer`, `admin`
- `is_lecturer`: admin đồng thời là giảng viên
- `student_id`, `dob`, `class_name`, `course_code`
- `phone`, `personal_email`

### `companies`

Lưu danh sách nơi thực tập.

Trường chính:

- `name`, `description`, `slots`
- `contact_email`, `contact_name`, `phone`
- `address`, `recruitment_link`
- `history`, `qualifications`

Hệ thống tự tạo 2 nơi đặc biệt:

- `Công ty khác`: dùng cho doanh nghiệp sinh viên tự liên hệ.
- `Trường Đại học Công nghệ`: dùng cho thực tập tại trường.

### `registrations`

Lưu nguyện vọng đăng ký của sinh viên.

Trường chính:

- `user_id`, `company_id`
- `note`
- `status`: `pending`, `approved`, `rejected`
- `created_at`
- `other_company_name`, `other_company_role`, `other_company_contact`

Với thực tập tại trường, tên giảng viên hướng dẫn khai báo trong giai đoạn đăng ký cũ có thể còn nằm trong `other_company_contact`. Đây chỉ là dữ liệu nguồn để đồng bộ một lần sang luồng GVHD, không phải nguồn dữ liệu chính thức.

**Quy tắc đồng bộ GVHD khi admin sửa đăng ký (áp dụng với đăng ký "Trường Đại học Công nghệ"):**

- Khi admin sửa trường GVHD (`other_company_contact`) hoặc GVHD đồng hướng dẫn (`other_company_role`) trong một đăng ký "Trường Đại học Công nghệ", backend phải đồng bộ ngay vào `advisor_assignments` cho sinh viên tương ứng.
- Nếu sinh viên đã có `final_internships`, đồng bộ cần upsert lại bản ghi `advisor_assignments` với GVHD mới (xóa phân công cũ cùng `role`, tạo phân công mới).
- Nếu sinh viên chưa có `final_internships`, chỉ cập nhật `registrations.other_company_contact` như hiện tại và tạo `final_internships` mới nếu hợp lệ; `advisor_assignments` sẽ được tạo sau khi `final_internships` tồn tại.
- Đồng bộ GVHD không được thực hiện nếu tên GVHD mới không tìm thấy trong bảng `lecturers`; trong trường hợp này API trả về lỗi rõ ràng.
- Khi đồng bộ, backend ghi lịch sử vào `advisor_assignment_history` với `action = 'replaced'` nếu đã có phân công cũ.
- Thông báo email `advisor_assigned` được tạo khi phân công GVHD thay đổi.

### `final_internships`

Lưu 1 nơi thực tập chính thức của sinh viên sau giai đoạn xác nhận.

Vai trò dữ liệu:

- Là nguồn chính thức cho nơi thực tập dùng để tính điểm.
- Không lưu thông tin GVHD chính thức.
- Nếu chưa có bản ghi trong bảng này, sinh viên vẫn có thể được Khoa phân công GVHD trong một số luồng bổ sung, nhưng nơi thực tập chính thức chỉ được xác định khi có `final_internships`.

### `advisor_assignments`

Lưu phân công giảng viên hướng dẫn chính thức.

Vai trò dữ liệu:

- Là nguồn chính thức duy nhất cho GVHD chính và đồng hướng dẫn.
- Trang giảng viên, trang điểm thực tập, xuất XLSX theo giảng viên và số lượng sinh viên hướng dẫn đều đọc từ bảng này.
- Có thể được tạo từ thao tác duyệt đề xuất GVHD, gán thủ công, import, hoặc tự phân công theo quota.
- **Phải được đồng bộ ngay khi admin sửa GVHD trong bảng `registrations`** (xem quy tắc đồng bộ tại mục `registrations` ở trên).

### `advisor_requests`

Lưu đăng ký/đề xuất GVHD từ sinh viên trước khi trở thành phân công chính thức.

Vai trò dữ liệu:

- Chỉ là bảng trung gian phục vụ xử lý đề xuất “đã được GV đồng ý hướng dẫn”.
- Khi Khoa duyệt, hệ thống ghi phân công chính thức vào `advisor_assignments`.
- Hệ thống không tự đồng bộ ngầm bảng này khi người dùng mở các trang đọc dữ liệu. Nếu cần xử lý dữ liệu cũ từ các đăng ký `Trường Đại học Công nghệ`, admin dùng nút `Đồng bộ dữ liệu cũ` trong site `Phân công giảng viên hướng dẫn`.

### `lecturers`

Danh sách giảng viên hướng dẫn:

- `name`
- `email`

### `settings`

Lưu cấu hình:

- Google Sheet import/export.
- Năm đợt thực tập.
- Thời gian mở/đóng đăng ký.
- Danh sách lớp khóa học.
- Nội dung kế hoạch triển khai Markdown.

## 5. Luồng nghiệp vụ hiện được hỗ trợ

### 5.1. Đăng nhập

1. Người dùng đăng nhập bằng Google.
2. Backend kiểm tra email `@vnu.edu.vn` hoặc `ADMIN_EMAIL`.
3. Nếu email nằm trong danh sách giảng viên, user được gán role `lecturer`.
4. Nếu email là admin, user được gán role `admin`.
5. Các trường hợp còn lại là `student`.
6. Backend trả về JWT để frontend gọi API.

### 5.2. Công bố kế hoạch thực tập

Admin cập nhật nội dung kế hoạch tại phần cài đặt hệ thống. Nội dung được lưu Markdown trong `settings.implementation_plan_md`.
Hướng dẫn sử dụng cho giảng viên được quản lý ở site riêng và lưu Markdown trong `settings.lecturer_guide_md`; nội dung này tách khỏi FAQ để Khoa có thể chỉnh quy trình sử dụng chi tiết theo từng đợt.

Sinh viên và giảng viên xem kế hoạch tại màn hình “Kế hoạch triển khai”.

### 5.3. Cấu hình đợt đăng ký

Admin cấu hình:

- Năm/đợt thực tập.
- Thời điểm mở đăng ký.
- Thời điểm đóng đăng ký.
- Thời điểm mở/đóng xác nhận nơi thực tập chính thức.
- Thời điểm mở/đóng nộp báo cáo final.
- Danh sách lớp khóa học được chọn trong form.

Sinh viên chỉ có thể đăng ký trong khoảng thời gian mở/đóng nếu các mốc này được cấu hình.

### 5.4. Quản lý danh sách doanh nghiệp

Admin có thể thêm/sửa/xóa/import/export doanh nghiệp chính thức.

Riêng trong màn “Quản lý Công ty”, hệ thống hiển thị danh sách vận hành gồm:

- Công ty chính thức trong bảng `companies`.
- Các công ty sinh viên tự liên hệ đã phát sinh đăng ký, lấy từ `registrations.other_company_name`, thay vì chỉ hiện một dòng chung “Công ty khác”.
- Nếu tên công ty tự liên hệ trùng với một công ty chính thức, đăng ký được gộp vào đúng dòng công ty chính thức để Khoa quản lý theo một đầu mối.

Mỗi dòng công ty trong màn admin hiển thị số ứng viên, số đăng ký đã duyệt, trạng thái đã gửi doanh nghiệp, nút xuất danh sách đăng ký theo công ty, nút soạn email và nút đánh dấu “Đã gửi DN”.

Hệ thống hiển thị cho sinh viên:

- Tên nơi thực tập.
- Địa chỉ.
- Chỉ tiêu.
- Số ứng viên đã đăng ký.
- Chi tiết tuyển dụng và liên hệ.

### 5.4.1. Quản lý danh sách công ty thẩm định nội bộ

Từ màn “Quản lý Công ty”, admin mở màn “Danh sách công ty thẩm định nội bộ”.

Màn này hỗ trợ:

- Thêm/sửa/xóa công ty thẩm định.
- Import XLSX danh sách công ty thẩm định nội bộ.
- Export XLSX danh sách đang xem.
- Tìm kiếm và sắp xếp theo tên, nguồn, ngày tạo.

Danh sách này không hiển thị cho sinh viên. Hệ thống chỉ dùng danh sách để tự động duyệt công ty tự liên hệ khi tên công ty sau chuẩn hóa trùng với một công ty đã thẩm định.

### 5.5. Sinh viên đăng ký nguyện vọng thực tập

Sinh viên chọn tối đa 5 nơi thực tập.

Khi đăng ký, sinh viên bắt buộc cung cấp:

- Mã sinh viên.
- Ngày sinh.
- Số điện thoại.
- Email cá nhân.
- Lớp khóa học.
- Học phần thực tập.

Các loại đăng ký:

- Doanh nghiệp có trong danh sách chính thức: tự động ghi nhận trạng thái `approved`.
- Công ty tự liên hệ: sinh viên nhập tên công ty, vị trí, người liên hệ, số điện thoại, email. Hệ thống đối chiếu với bảng công ty thẩm định nội bộ: nếu có trong danh sách thì tự động `approved`, nếu không thì `pending` để Khoa duyệt thủ công.
- Thực tập tại trường: sinh viên chọn `Trường Đại học Công nghệ` và nhập/chọn giảng viên hướng dẫn. Hệ thống yêu cầu có tên GVHD.

Quy tắc đặc biệt:

- Nếu chọn `Trường Đại học Công nghệ`, sinh viên không được chọn thêm công ty khác.
- Sinh viên có thể hủy toàn bộ đăng ký và đăng ký lại trong thời gian hệ thống mở.

### 5.6. Khoa duyệt danh sách đăng ký

Admin xem toàn bộ đăng ký và đổi trạng thái:

- `pending`: Chờ duyệt.
- `approved`: Đã duyệt.
- `rejected`: Từ chối.

Admin có thể duyệt tất cả các đăng ký đang chờ.

Theo nghiệp vụ đã xác nhận, việc duyệt thủ công chỉ cần áp dụng với công ty tự liên hệ chưa nằm trong danh sách thẩm định nội bộ. Các công ty đã nằm trong danh sách này được xem là đủ điều kiện để sinh viên xác nhận thực tập nếu sinh viên đã được công ty nhận. Hệ thống hiện dùng bảng `approved_company_names` để phục vụ đối chiếu này.

### 5.6.1. Xóa nguyện vọng đăng ký thực tập

Quản trị viên có thể xóa một đăng ký thực tập trực tiếp trong hộp thoại "Sửa đăng ký thực tập" (`AdminPanel.tsx`):
- Khi xóa, hệ thống hiển thị hộp thoại xác nhận chi tiết thông tin sinh viên và nơi thực tập.
- Ràng buộc an toàn: Nếu đăng ký đã được sinh viên xác nhận và Khoa đã khóa nơi thực tập chính thức (`final_internships.locked_at IS NOT NULL`), hệ thống từ chối xóa (HTTP 400).
- Dọn dẹp dữ liệu liên đới: Nếu có liên kết với `final_internships` chưa khóa (`locked_at IS NULL`), bản ghi này sẽ được dọn dẹp đồng thời; trường `source_registration_id` trong `advisor_requests` (nếu có) được cập nhật về `NULL`.

### 5.7. Xuất danh sách cho Khoa/doanh nghiệp

Admin có thể:

- Xuất danh sách đang lọc ra XLSX.
- Xuất theo học phần ra ZIP chứa XLSX.
- Xuất theo công ty ra ZIP chứa XLSX.
- Ghi toàn bộ dữ liệu đăng ký lên Google Sheets.
- Trong màn “Quản lý Công ty”, xuất danh sách đăng ký riêng cho từng công ty và đánh dấu danh sách đã gửi doanh nghiệp theo từng công ty.

Tính năng này hỗ trợ bước Khoa gửi danh sách sinh viên đăng ký đến doanh nghiệp để phỏng vấn. Hệ thống xuất XLSX theo từng công ty và soạn sẵn email gửi doanh nghiệp qua Gmail/app Mail với email nhận, chủ đề và nội dung. Nếu cấu hình `VITE_GOOGLE_API_KEY`, admin có thể chọn thư mục Google Drive bằng Picker; hệ thống tạo file XLSX theo công ty, bật quyền `anyone with the link can view`, rồi chèn link vào nội dung Gmail. Sau khi gửi thủ công, admin bấm “Đã gửi DN” để ghi nhận trạng thái đã gửi.

Lưu ý cấu hình Google OAuth/Drive:

- `VITE_GOOGLE_CLIENT_ID` là OAuth Client ID dùng để xin quyền Drive; `VITE_GOOGLE_API_KEY` là Browser API key dùng cho Google Picker.
- Nếu Google báo `403: access_denied` và thông báo app đang trong giai đoạn kiểm thử, vào Google Cloud Console -> Google Auth Platform/OAuth consent screen -> Audience/Test users và thêm đúng tài khoản Google đang dùng để chọn Drive.
- Với trạng thái Testing, chỉ các test users được phép cấp quyền OAuth. Nếu muốn dùng rộng hơn, cần chuyển app sang Production và hoàn tất các yêu cầu xác minh tương ứng của Google.
- Cảnh báo console `Cross-Origin-Opener-Policy policy would block the window.closed call` thường liên quan popup Google Identity Services. Trên GitHub Pages không cấu hình được response header này; nếu popup vẫn mở và Google chỉ báo `access_denied`, nguyên nhân chính vẫn là OAuth test user/verification.

## 6. Đối chiếu với quy trình trong kế hoạch thực tập

| Bước nghiệp vụ | Hiện trạng hệ thống | Mức đáp ứng |
| --- | --- | --- |
| Sinh viên đăng ký thông tin cá nhân trên Website TTCN | Có hồ sơ sinh viên và form đăng ký bắt buộc thông tin cá nhân | Đáp ứng tốt |
| Sinh viên theo dõi thông tin tuyển thực tập | Có danh sách doanh nghiệp và trang chi tiết | Đáp ứng cơ bản |
| Sinh viên đăng ký công ty trong danh sách | Có chọn tối đa 5 nơi thực tập | Đáp ứng tốt |
| Sinh viên đăng ký công ty tự liên hệ | Có `Công ty khác`, lưu tên/vị trí/liên hệ | Đáp ứng cơ bản |
| Khoa xét duyệt công ty ngoài danh sách thẩm định nội bộ | Có trạng thái `pending/approved/rejected`, đã có bảng và màn quản lý danh sách thẩm định nội bộ để tự động duyệt công ty tự liên hệ | Đáp ứng phần chính |
| Khoa gửi danh sách sinh viên đăng ký đến doanh nghiệp | Có export XLSX/ZIP/Google Sheets và quản lý trạng thái đã gửi theo công ty | Đáp ứng phần chính |
| Doanh nghiệp phỏng vấn và phản hồi kết quả | Kết quả phỏng vấn được công ty xác nhận trực tiếp với sinh viên, hệ thống không cần ghi nhận `PASS/FAIL` từ công ty | Ngoài phạm vi hệ thống |
| Sinh viên kiểm tra kết quả phỏng vấn | Sinh viên tự nhận kết quả từ công ty ngoài hệ thống | Ngoài phạm vi hệ thống |
| Sinh viên chọn 1 nơi thực tập chính thức để lấy điểm | Có luồng xác nhận nơi thực tập chính thức, chỉ cho chọn công ty đã duyệt hoặc thực tập tại trường | Đáp ứng tốt |
| Khoa phân công giảng viên hướng dẫn | Có phân công thủ công/import/tự phân công theo quota, có lịch sử tạo/xóa phân công | Đáp ứng phần chính |
| Sinh viên thực tập tại trường nếu chưa có công ty | Có lựa chọn thực tập tại trường; nếu đã có GV đồng ý thì chọn GV, nếu chưa thì Khoa phân công sau | Đáp ứng tốt |
| Sinh viên báo cáo định kỳ với giảng viên | Nghiệp vụ thực hiện qua email, không cần quản lý chi tiết trên hệ thống | Ngoài phạm vi hệ thống |
| Sinh viên nộp báo cáo thực tập | Có upload báo cáo final PDF theo khoảng thời gian mở/đóng nộp, giới hạn 10 MB | Đáp ứng phần chính |
| Giảng viên đánh giá và chấm điểm | Có nhập 3 đầu điểm và tự tính điểm tổng kết theo công thức 20/20/60 | Đáp ứng phần chính |
| Giảng viên nộp điểm cho Khoa | Có lưu nháp/nộp điểm, admin xem trạng thái | Đáp ứng phần chính |
| Khoa tổng hợp và nhập hệ thống đào tạo | Có trang bảng điểm và export XLSX cuối kỳ | Đáp ứng phần chính |
| Sinh viên đăng ký học phần trên daotao.vnu.edu.vn | Hệ thống chỉ lưu học phần sinh viên chọn, chưa đối soát với hệ thống đào tạo | Đáp ứng nhắc nhở, chưa kiểm chứng |

## 7. Chức năng còn thiếu nên bổ sung

### Ưu tiên 1: Hoàn thiện luồng sau đăng ký và xác nhận nơi thực tập

1. Thêm chức năng gửi/xuất danh sách đăng ký cho doanh nghiệp:
   - Xuất riêng từng công ty đã có.
   - Nên bổ sung trạng thái “đã gửi” và ngày gửi.
   - Có thể phát triển thêm gửi email tự động sau.

2. Thêm bước sinh viên xác nhận 1 nơi thực tập chính thức:
   - Kết quả phỏng vấn do công ty xác nhận trực tiếp với sinh viên ngoài hệ thống.
   - Sinh viên tự chịu trách nhiệm chỉ xác nhận nơi mình đã trúng tuyển.
   - Khi xác nhận, sinh viên phải tick cam kết đã được công ty tiếp nhận thực tập.
   - Chỉ cho chọn từ các đăng ký công ty đã được duyệt.
   - Không cho xác nhận công ty đang `pending` hoặc `rejected`, kể cả khi sinh viên đã có trao đổi bên ngoài.
   - Nếu không trúng tuyển tất cả nơi đã đăng ký, sinh viên được chọn/xác nhận thực tập tại trường.
   - Với thực tập tại trường, chỉ cho xác nhận khi đăng ký/phương án đã được Khoa ghi nhận hợp lệ.
   - Mỗi sinh viên chỉ có 1 `final_internship`.
   - Sau khi xác nhận, khóa lựa chọn; nếu đổi nơi cần Khoa mở khóa hoặc cập nhật thay.

3. Thêm quản lý danh sách công ty thẩm định nội bộ:
   - Dữ liệu gốc hiện là `data/seed/it-companies-list.csv`.
   - Danh sách này không công khai cho sinh viên.
   - Worker cần dùng danh sách này, hoặc một bảng database import từ danh sách này, để quyết định tự động duyệt công ty tự liên hệ.
   - Có thể bổ sung màn hình admin import/xem/sửa, nhưng đây là ưu tiên thấp hơn luồng xác nhận nơi thực tập.

### Ưu tiên 2: Phân công giảng viên hướng dẫn

Hiện hệ thống mới hỗ trợ sinh viên chọn GVHD khi đăng ký thực tập tại trường. Theo nghiệp vụ đã xác nhận, sinh viên thực tập tại công ty sẽ do Khoa tự phân công giảng viên hướng dẫn; sinh viên thực tập tại trường tự đăng ký giảng viên theo sự đồng ý trước.

Cần bổ sung:

- Bảng phân công GVHD cho sinh viên.
- Admin phân công thủ công hoặc import XLSX.
- Tự động gợi ý/phân công theo lớp, học phần, công ty, số lượng tối đa mỗi giảng viên.
- Cấu hình chỉ tiêu theo học hàm/học vị:
  - Giảng viên có tên chứa `CN` không được làm hướng dẫn chính, chỉ được đồng hướng dẫn.
  - `GS`/`PGS` mặc định không quá 5 sinh viên, tính gộp cả hướng dẫn chính và đồng hướng dẫn.
  - `TS` mặc định không quá 8 sinh viên, tính gộp cả hướng dẫn chính và đồng hướng dẫn.
  - `ThS`/khác mặc định không quá 10 sinh viên, tính gộp cả hướng dẫn chính và đồng hướng dẫn.
  - Quota riêng từng giảng viên được cấu hình trong trang phân công và ghi đè quota mặc định.
- Màn hình giảng viên xem danh sách sinh viên mình phụ trách.
- Màn hình sinh viên xem GVHD được phân công.
- Lịch sử thay đổi phân công.
- Luồng Khoa chủ động chuyển sinh viên chưa có nơi thực tập sang thực tập tại trường hoặc đối tác khác sau thời hạn.

Gợi ý model:

- `advisor_assignments(id, user_id, lecturer_id, role, assigned_by, assigned_at, note)`
- `lecturer_quotas(id, lecturer_id, max_total_students, note)`

### Ưu tiên 3: Nộp báo cáo final và chấm điểm

Theo nghiệp vụ đã xác nhận, báo cáo định kỳ được sinh viên gửi qua email cho giảng viên. Hệ thống chỉ cần quản lý việc nộp báo cáo final theo khoảng thời gian mở/đóng của đợt.

Cần bổ sung:

- Admin cấu hình thời điểm mở và đóng nộp báo cáo final.
- Sinh viên upload báo cáo final định dạng PDF.
- File PDF được lưu trên Cloudflare R2, giới hạn mặc định 10 MB/file để khoảng 900 sinh viên vẫn nằm trong mức miễn phí 10 GB-month. Hệ thống cần kiểm tra MIME type, phần mở rộng `.pdf`, kích thước file và đặt tên object theo đợt/sinh viên để tránh trùng. File lớn hơn 10 MB bị từ chối, sinh viên phải nén lại và nộp lại.
- Trạng thái báo cáo: chưa nộp, đã nộp, cần nộp lại, đã chấp nhận. Hệ thống chặn nộp ngoài khoảng thời gian mở/đóng của đợt.
- Giảng viên xem/tải báo cáo PDF của sinh viên phụ trách.
- Giảng viên nhập điểm thành phần:
  - 20% báo cáo định kỳ, do giảng viên tự tổng hợp từ email/trao đổi.
  - 20% báo cáo final.
  - 60% đánh giá công ty hoặc GVHD nếu thực tập tại trường, do giảng viên tự nhập dựa trên trao đổi và bản cứng sinh viên nộp.
- Tự động tính điểm tổng kết.
- Giảng viên xác nhận/nộp điểm về Khoa.
- Admin khóa điểm và export bảng điểm cuối kỳ ra XLSX.
- Tự động gửi email nhắc hạn nộp báo cáo final cho sinh viên và email nhắc chấm/nộp điểm cho giảng viên.

Gợi ý model:

- `final_reports(id, user_id, object_key, original_filename, file_size, mime_type, status, submitted_at, lecturer_comment)`
- `grades(id, user_id, lecturer_id, progress_score, report_score, company_score, final_score, comment, submitted_at, locked_at)`

### Ưu tiên 4: Đối soát học phần với hệ thống đào tạo

Quy trình yêu cầu sinh viên đăng ký học phần trên `http://daotao.vnu.edu.vn` để được công nhận điểm.

Hệ thống hiện chỉ cho sinh viên chọn học phần trong form, chưa biết sinh viên đã đăng ký trên hệ thống đào tạo hay chưa.

Cần bổ sung một trong các cách:

- Admin import danh sách sinh viên đã đăng ký học phần từ Phòng Đào tạo.
- Hệ thống tự đánh dấu `course_enrollment_verified`.
- Cảnh báo sinh viên chưa có trong danh sách đăng ký học phần.
- Khi xuất điểm, chỉ xuất sinh viên đã đối soát hợp lệ hoặc đánh dấu rõ trạng thái.

### Ưu tiên 5: Cổng doanh nghiệp hoặc luồng phản hồi từ doanh nghiệp

Hiện doanh nghiệp không có tài khoản/cổng riêng. Theo nghiệp vụ đang chốt, Khoa có thể nhận kết quả ngoài hệ thống rồi nhập/import lại; vì vậy cổng doanh nghiệp là tùy chọn mở rộng, không phải yêu cầu bắt buộc.

Có thể bổ sung trong tương lai nếu Khoa muốn doanh nghiệp phản hồi trực tiếp trên hệ thống:

- Link phản hồi bảo mật theo từng doanh nghiệp.
- Doanh nghiệp xem danh sách ứng viên của mình.
- Doanh nghiệp cập nhật kết quả phỏng vấn.
- Doanh nghiệp nhập thông tin mentor/supervisor.
- Doanh nghiệp upload/nhập đánh giá cuối kỳ.

Theo nghiệp vụ hiện tại, không triển khai cổng doanh nghiệp ở giai đoạn chính vì công ty xác nhận kết quả trực tiếp với sinh viên.

### Ưu tiên 6: Thông báo email tự động

Cần bổ sung thông báo email cho các mốc quan trọng:

- Sinh viên đăng ký thành công.
- Công ty tự liên hệ được duyệt/từ chối.
- Khoa đã gửi danh sách sang doanh nghiệp.
- Mở/đóng thời hạn xác nhận nơi thực tập chính thức.
- Sinh viên xác nhận nơi thực tập thành công.
- Khoa phân công hoặc thay đổi GVHD.
- Nhắc hạn nộp báo cáo final.
- Báo cáo final được ghi nhận hoặc cần nộp lại.
- Giảng viên nộp điểm (chỉ gửi cho sinh viên nhận điểm, không gửi thông báo trên web và không gửi email cho Admin) và Khoa khóa/tổng hợp điểm.

Về triển khai, có thể dùng một dịch vụ email transaction miễn phí hoặc quota thấp trước; nếu không muốn phụ thuộc dịch vụ ngoài, hệ thống vẫn nên lưu bảng `notifications` để theo dõi lịch sử thông báo và trạng thái gửi.

## 8. Đề xuất lộ trình triển khai

### Giai đoạn A: Đủ dùng cho đợt đăng ký và gửi doanh nghiệp

- Chuẩn hóa README/tài liệu vận hành.
- Bổ sung trạng thái gửi doanh nghiệp.
- Xuất danh sách theo từng doanh nghiệp kèm định dạng chuẩn.
- Sinh viên xác nhận 1 nơi thực tập chính thức trong thời hạn Khoa cho phép và cam kết đã trúng tuyển.
- Chặn xác nhận nếu công ty chưa được duyệt.
- Cho phép sinh viên không trúng tuyển nơi nào đăng ký thực tập tại trường.

### Giai đoạn B: Đủ dùng cho Khoa quản lý thực tập

- Khoa phân công GVHD cho sinh viên thực tập tại công ty.
- Giữ luồng sinh viên tự đăng ký GVHD khi thực tập tại trường.
- Áp dụng chỉ tiêu hướng dẫn theo học hàm/học vị và quy tắc `CN` chỉ đồng hướng dẫn.
- Giảng viên xem danh sách sinh viên phụ trách.
- Sinh viên xem GVHD và nơi thực tập chính thức.
- Admin xử lý sinh viên chưa tìm được doanh nghiệp và chuyển sang thực tập tại trường/đối tác.

### Giai đoạn C: Đủ dùng đến cuối học phần

- Nộp báo cáo final PDF theo khoảng thời gian mở/đóng nộp.
- Lưu báo cáo final trên Cloudflare R2 với giới hạn 10 MB/file.
- Giảng viên nhập điểm theo rubric 20/20/60.
- Giảng viên nộp điểm.
- Khoa tổng hợp/xuất bảng điểm XLSX.
- Đối soát đăng ký học phần với Phòng Đào tạo.
- Gửi email nhắc hạn/nộp điểm cho sinh viên và giảng viên.

## 9. Kế hoạch ưu tiên và thiết kế triển khai chi tiết

Phần này chuyển các yêu cầu nghiệp vụ đã chốt thành kế hoạch triển khai theo thứ tự ưu tiên. Mục tiêu là làm trước các phần mở khóa luồng nghiệp vụ chính, tránh xây các chức năng cuối kỳ khi hệ thống chưa có “nơi thực tập chính thức” và “phân công GVHD”.

### 9.1. Nguyên tắc triển khai

- Giữ nguyên luồng đăng ký hiện tại, chỉ mở rộng dữ liệu và trạng thái sau đăng ký.
- Mọi sinh viên chỉ có 1 hồ sơ thực tập chính thức trong một đợt.
- Không cho xác nhận công ty chưa được duyệt.
- Khoa là nguồn quyết định phân công GVHD cho sinh viên thực tập tại công ty.
- Sinh viên thực tập tại trường được chọn GVHD, nhưng vẫn cần được Khoa ghi nhận trong hồ sơ chính thức.
- Báo cáo định kỳ nằm ngoài hệ thống, giảng viên tự tổng hợp điểm phần này.
- Báo cáo final PDF phải nhỏ hơn hoặc bằng 10 MB.
- Dữ liệu điểm cuối kỳ phải xuất được XLSX.

### 9.2. P0 - Củng cố nền dữ liệu và trạng thái

Mục tiêu: sửa các điểm lệch nghiệp vụ hiện tại trước khi thêm màn hình mới.

Phạm vi:

- Dùng danh sách công ty thẩm định nội bộ để tự động duyệt công ty tự liên hệ.
- Bổ sung cấu hình thời hạn xác nhận nơi thực tập và khoảng thời gian nộp báo cáo final.
- Bổ sung trạng thái/ngày gửi danh sách sang doanh nghiệp theo từng công ty.
- Màn “Quản lý Công ty” bao gồm cả công ty tự liên hệ đã phát sinh đăng ký, hỗ trợ xuất danh sách và đánh dấu “Đã gửi DN” theo công ty.
- Tách màn quản lý danh sách thẩm định nội bộ khỏi Cài đặt hệ thống, đặt trong khu “Quản lý công ty”.

Thiết kế dữ liệu:

```sql
CREATE TABLE IF NOT EXISTS approved_company_names (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  normalized_name TEXT UNIQUE NOT NULL,
  source TEXT DEFAULT 'csv',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE registrations ADD COLUMN sent_to_company_at DATETIME;
ALTER TABLE registrations ADD COLUMN sent_to_company_note TEXT;
```

Hệ thống không lưu `PASS/FAIL` phỏng vấn do doanh nghiệp phản hồi. Công ty xác nhận kết quả trực tiếp với sinh viên; sinh viên tự chịu trách nhiệm khi xác nhận nơi thực tập chính thức.

Thiết kế API:

- `POST /api/admin/approved-companies/import`: import danh sách thẩm định từ XLSX/CSV qua UI.
- `GET /api/admin/approved-companies`: xem/tìm kiếm danh sách thẩm định.
- `POST /api/admin/approved-companies`: thêm công ty thẩm định.
- `PUT /api/admin/approved-companies/:id`: sửa công ty thẩm định.
- `DELETE /api/admin/approved-companies/:id`: xóa công ty thẩm định.
- `PUT /api/admin/registrations/mark-sent`: đánh dấu đã gửi danh sách sang doanh nghiệp theo công ty hoặc theo đăng ký.
- `GET /api/admin/companies`: danh sách công ty vận hành cho admin, gồm công ty chính thức và công ty tự liên hệ đã phát sinh đăng ký.
- `PUT /api/settings/campaign`: bổ sung `confirmation_open_at`, `confirmation_close_at`, `final_report_open_at`, `final_report_close_at`, `advisor_request_open_at`, `advisor_request_close_at`.

Tiêu chí nghiệm thu:

- Công ty tự liên hệ có trong danh sách thẩm định được tự động `approved`.
- Công ty tự liên hệ không có trong danh sách thẩm định là `pending`.
- Admin xuất/đánh dấu được danh sách đã gửi sang doanh nghiệp.
- Admin không phải quản lý các đăng ký tự liên hệ dưới một dòng “Công ty khác”; mỗi công ty tự liên hệ có dòng riêng trong màn “Quản lý Công ty”.
- Không phá luồng đăng ký hiện tại.

### 9.3. P1 - Xác nhận nơi thực tập chính thức

Mục tiêu: sinh viên chọn đúng 1 nơi thực tập để tính điểm sau khi được doanh nghiệp xác nhận trúng tuyển ngoài hệ thống.

Thiết kế dữ liệu:

```sql
CREATE TABLE IF NOT EXISTS final_internships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  registration_id INTEGER,
  company_id INTEGER,
  internship_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed',
  student_attested INTEGER NOT NULL DEFAULT 0,
  attestation_text TEXT,
  school_lecturer TEXT,
  school_assignment_request INTEGER NOT NULL DEFAULT 0,
  confirmed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  confirmed_by INTEGER,
  locked_at DATETIME,
  note TEXT
);
```

Giá trị `internship_type`:

- `company`: thực tập tại doanh nghiệp.
- `school`: thực tập tại trường.
- `partner`: đối tác khác do Khoa sắp xếp.

Quy tắc xác nhận:

- Sinh viên chỉ xác nhận trong khoảng `confirmation_open_at` đến `confirmation_close_at`.
- Chỉ xác nhận đăng ký có `status = approved`.
- Nếu là công ty, sinh viên phải tick cam kết đã được công ty nhận thực tập.
- Hệ thống không kiểm tra `PASS/FAIL`; trách nhiệm xác nhận đúng thuộc về sinh viên.
- Nếu không trúng tuyển tất cả nơi đã đăng ký, sinh viên có thể chọn phương án thực tập tại trường nếu Khoa mở lựa chọn này.
- Khi thực tập tại trường, sinh viên chọn giảng viên đã đồng ý. Nếu chưa có GVHD, Khoa phân công sau; dữ liệu cũ có `school_assignment_request = 1` vẫn được đọc để Khoa xử lý.
- Với thực tập tại trường hoặc đối tác khác, Khoa có thể tạo/cập nhật hồ sơ thay sinh viên.
- Mỗi sinh viên chỉ có 1 bản ghi `final_internships`.
- Sau khi khóa, chỉ admin được thay đổi.

Thiết kế API:

- `GET /api/internships/final/my`: sinh viên xem nơi thực tập chính thức.
- `POST /api/internships/final/confirm`: sinh viên xác nhận.
- `GET /api/admin/final-internships`: admin xem toàn bộ.
- `GET /api/admin/unconfirmed-internships`: admin xem danh sách sinh viên đã đăng ký nhưng chưa xác nhận nơi thực tập chính thức.
- `PUT /api/admin/final-internships/:userId`: admin tạo/sửa/chuyển trạng thái.
- `PUT /api/admin/final-internships/:userId/lock`: khóa hồ sơ.

Thiết kế UI:

- Sinh viên:
  - Thêm thẻ “Xác nhận nơi thực tập” trên Dashboard.
  - Hiển thị các công ty đủ điều kiện xác nhận.
  - Hiển thị checkbox cam kết: “Tôi xác nhận đã được đơn vị này tiếp nhận thực tập và chịu trách nhiệm về thông tin khai báo.”
  - Hiển thị lựa chọn thực tập tại trường khi sinh viên không trúng tuyển nơi nào.
  - Hiển thị lý do không đủ điều kiện: công ty chưa duyệt, ngoài thời hạn.
- Admin:
  - Tab “Nơi thực tập chính thức”.
  - Bộ lọc: chưa xác nhận, đã xác nhận, công ty pending, thực tập tại trường.
  - Hành động: tạo/chỉnh nơi thực tập, khóa/mở khóa.

Tiêu chí nghiệm thu:

- Sinh viên không thể xác nhận công ty `pending` hoặc `rejected`.
- Sinh viên phải tick cam kết đã trúng tuyển trước khi xác nhận công ty.
- Một sinh viên không thể có 2 nơi thực tập chính thức.
- Admin xử lý được sinh viên không tìm được doanh nghiệp bằng cách chuyển sang `school` hoặc `partner`.

### 9.4. P2 - Phân công giảng viên hướng dẫn

Mục tiêu: Khoa phân công GVHD cho sinh viên thực tập tại công ty, đồng thời quản lý chỉ tiêu. Phần lõi đã được triển khai ở backend và UI admin/giảng viên/sinh viên.

Thiết kế dữ liệu:

```sql
CREATE TABLE IF NOT EXISTS advisor_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  lecturer_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'primary',
  assigned_by INTEGER,
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  note TEXT,
  UNIQUE(user_id, lecturer_id, role)
);

CREATE TABLE IF NOT EXISTS lecturer_quotas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lecturer_id INTEGER UNIQUE NOT NULL,
  max_total_students INTEGER,
  note TEXT
);

CREATE TABLE IF NOT EXISTS advisor_assignment_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER,
  user_id INTEGER NOT NULL,
  lecturer_id INTEGER,
  role TEXT,
  action TEXT NOT NULL,
  actor_id INTEGER,
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Giá trị `role`:

- `primary`: hướng dẫn chính.
- `co`: đồng hướng dẫn.

Quy tắc chỉ tiêu:

- Tên chứa `CN`: không được `primary`, chỉ được `co`.
- `GS`/`PGS`: mặc định tối đa 5 sinh viên, tính gộp `primary` và `co`.
- `TS`: mặc định tối đa 8 sinh viên, tính gộp `primary` và `co`.
- `ThS`/khác: mặc định tối đa 10 sinh viên, tính gộp `primary` và `co`.
- Quota riêng theo từng giảng viên trong `lecturer_quotas` ghi đè quota mặc định.

Thiết kế API:

- `GET /api/admin/advisor-assignments`: danh sách phân công.
- `POST /api/admin/advisor-assignments`: phân công 1 sinh viên.
- `POST /api/admin/advisor-assignments/bulk`: import phân công từ XLSX/CSV qua UI.
- `POST /api/admin/advisor-assignments/auto-primary`: tự phân công GVHD chính cho sinh viên chưa có GVHD theo quota.
- `POST /api/admin/advisor-requests/sync-legacy`: đồng bộ thủ công dữ liệu GVHD cũ từ đăng ký thực tập tại trường và các đề xuất đã được GV đồng ý.
- `DELETE /api/admin/advisor-assignments/:id`: xóa phân công.
- `PUT /api/admin/lecturer-quotas/:id`: cập nhật chỉ tiêu tổng cho giảng viên.
- `GET /api/lecturer/students`: giảng viên xem sinh viên phụ trách.
- `GET /api/advisor/my`: sinh viên xem GVHD.

Thiết kế UI:

- Admin:
  - Bảng phân công theo sinh viên.
  - Tìm kiếm theo sinh viên, lớp, học phần, nơi thực tập.
  - Chặn khi chọn giảng viên vượt chỉ tiêu.
  - Chặn khi chọn `CN` làm hướng dẫn chính.
  - Import XLSX: `student_id, lecturer_email_or_name, role, note`.
  - Tự phân công GVHD chính cho sinh viên đã có nguyện vọng đăng ký thực tập nhưng chưa đăng ký/chưa có GVHD theo quota còn trống.
  - Cập nhật chỉ tiêu giảng viên ngay trên màn phân công.
  - Ghi lịch sử tạo/xóa phân công ở backend để truy vết.
- Giảng viên:
  - Trang “Sinh viên phụ trách”.
  - Hiển thị nơi thực tập, email, số điện thoại, học phần.
- Sinh viên:
  - Hiển thị GVHD trong hồ sơ thực tập chính thức.
  - Nếu sinh viên xác nhận thực tập tại trường với một giảng viên đã đồng ý, hệ thống tự tạo phân công hướng dẫn chính và vẫn kiểm tra quy tắc `CN`/quota.

Tiêu chí nghiệm thu:

- Không phân công `CN` làm hướng dẫn chính.
- Không vượt chỉ tiêu mặc định.
- Giảng viên đăng nhập xem đúng danh sách sinh viên được phân công.

### 9.5. P3 - Nộp báo cáo final PDF bằng R2

Mục tiêu: sinh viên nộp báo cáo final PDF, giảng viên/admin xem được và hệ thống giữ chi phí trong free tier. Phần lõi đã được triển khai ở backend và UI sinh viên/giảng viên/admin.

Thiết kế dữ liệu:

```sql
CREATE TABLE IF NOT EXISTS final_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  object_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME,
  lecturer_comment TEXT
);
```

Quy tắc upload:

- Chỉ nhận `.pdf`.
- MIME type phải là `application/pdf`.
- Dung lượng tối đa 10 MB.
- File lớn hơn 10 MB bị từ chối, sinh viên phải nén lại.
- Object key gợi ý: `reports/{campaign_year}/{student_id}/final.pdf`.
- Khi nộp lại, ghi đè object hoặc tạo version tùy quyết định triển khai; ưu tiên đơn giản là ghi đè và cập nhật `updated_at`.

Lưu trữ khi deploy Render:

Server production lưu file lên Cloudflare R2 bằng S3-compatible API. Turso chỉ lưu `object_key` và metadata trong `final_reports`. Khi chạy local mà chưa cấu hình R2, server fallback về `scratch/final-reports` để tiện thử nghiệm; fallback này không dùng cho Render production.

Thiết kế API:

- `POST /api/reports/final`: sinh viên upload PDF.
- `GET /api/reports/final/my`: sinh viên xem trạng thái file đã nộp.
- `GET /api/reports/final/:userId/download`: sinh viên sở hữu báo cáo, giảng viên được phân công hoặc admin tải file nếu có quyền.
- `PUT /api/reports/final/:userId/status`: giảng viên/admin cập nhật `accepted` hoặc `needs_revision`.
- `GET /api/admin/reports/final`: admin xem bảng tổng hợp trạng thái nộp.

Thiết kế UI:

- Sinh viên:
  - Widget nộp báo cáo final.
  - Hiển thị thời gian mở/đóng nộp, trạng thái, tên file, dung lượng, thời điểm nộp.
  - Tải lại PDF đã nộp.
  - Nếu file > 10 MB, báo rõ “Vui lòng nén PDF xuống tối đa 10 MB”.
- Giảng viên:
  - Cột trạng thái báo cáo trong danh sách sinh viên phụ trách và bảng nhập điểm:
    - Nếu sinh viên đã nộp báo cáo nhưng chưa có điểm chính thức: hiển thị nhãn **“Chưa chấm điểm”** (Badge xanh dương `#034ea1` / soft tint) để giảng viên nhận biết rõ bài cần chấm, thay vì nhãn chung chung “Đã nộp”.
    - Sau khi giảng viên đã chấm và nộp điểm về Khoa: tự động chuyển thành **“Đã chấm điểm”** / **“Đã chấp nhận”** (Badge xanh lá cây).
    - Nếu giảng viên yêu cầu nộp lại: nhãn **“Cần nộp lại”** (Badge màu cam).
    - Nếu chưa có báo cáo: nhãn **“Chưa nộp”** (Badge màu xám).
  - **Xem PDF inline trực tiếp trên hệ thống** (xem mục 9.5.1 — Inline PDF Viewer).
  - Nút tải PDF về máy vẫn giữ nguyên như tuỳ chọn phụ.
  - Ghi chú “cần nộp lại” từ panel chấm điểm tích hợp.
- Admin:
  - Bảng tổng hợp trạng thái nộp báo cáo.
  - Bộ lọc chưa nộp / chưa chấm điểm / đã chấm điểm / cần nộp lại / đã chấp nhận.
  - Xuất XLSX và tải PDF từng sinh viên.
  - Admin cũng có thể mở inline viewer để xem báo cáo.

Tiêu chí nghiệm thu:

- File > 10 MB bị từ chối ở cả frontend và backend.
- Sinh viên không xem/tải được báo cáo của sinh viên khác.
- Giảng viên chỉ xem/tải được báo cáo của sinh viên mình phụ trách.
- Admin xem/tải được tất cả.
- Giảng viên có thể xem PDF và chấm điểm cùng lúc mà không cần rời trang.
- **Không tải lại file PDF khi chấm điểm hoặc khi bấm lại vào bài đã nộp**: Toàn bộ thao tác lưu điểm, chuyển đổi sinh viên và mở lại báo cáo đã nộp được tối ưu qua bộ nhớ đệm (Client-side Blob Cache & Backend ETag), đạt thời gian phản hồi tức thì 0ms.

### 9.5.1. Inline PDF Viewer — Xem và chấm báo cáo cùng lúc

**Bối cảnh và vấn đề:**

Hiện tại, giảng viên phải nhấn “Tải” để tải file PDF về máy, mở bằng ứng dụng ngoài, xem nội dung, rồi quay lại hệ thống để nhập điểm. Quy trình này gây gián đoạn và tốn thời gian, đặc biệt khi phụ trách nhiều sinh viên. Đồng thời, nếu không có cơ chế lưu đệm, mỗi lần mở bài hoặc sau khi bấm nộp điểm, hệ thống lại phải tải lại toàn bộ file PDF 5–10 MB qua mạng, gây trễ và tốn băng thông.

**Yêu cầu:**

- Giảng viên nhấn vào tên báo cáo hoặc nút “Xem & Chấm” của một sinh viên → mở **review panel** (full-screen overlay).
- Panel chia đôi màn hình theo chiều ngang:
  - **Bên trái (60–65%)**: iframe nhúng PDF qua blob URL, scroll được, hỗ trợ zoom của trình duyệt.
  - **Bên phải (35–40%)**: thông tin sinh viên (read-only) + form chấm điểm.
- Hai bên độc lập nhau về scroll; giảng viên có thể scroll báo cáo trong khi form điểm luôn hiển thị cố định.
- Trên màn nhỏ (< 768px): chuyển sang tab-toggle giữa “Báo cáo” và “Chấm điểm” thay vì split.
- Có nút đóng (×) rõ ràng để quay lại danh sách.

**Thiết kế UI chi tiết — Review Panel (Chuẩn Apple HIG Floating Sheet):**

Header (mỏng, đơn dòng ~48px, cố định trên đỉnh):
- Tên sinh viên (Bold 14px) · MSSV (Badge xám bo góc) · Lớp sinh viên · Badge trạng thái báo cáo (**Chưa chấm điểm** khi chưa có điểm, **Đã chấm điểm** / **Đã duyệt** sau khi hoàn thành, hoặc **Cần nộp lại**).
- Phía bên phải: Nút "Mở tab mới" (ExternalLink), nút "Tải PDF", nút "Đóng (×)".
- Tuyệt đối không lặp lại tên trường/khoa hay lồng biểu tượng cồng kềnh.

Bên trái — PDF Viewer (Tràn viền, tối đa diện tích hiển thị):
- Chiếm 62–65% chiều rộng màn hình.
- Fetch PDF qua `/api/reports/final/:userId/view` với Authorization header → `URL.createObjectURL(blob)` → gán vào `<iframe>`.
- Nền xám sáng nhã nhặn (`bg-slate-100`), tài liệu PDF hiển thị tràn viền (Edge-to-Edge).
- **Không đặt thanh công cụ phụ đè lên PDF** (tránh lặp lại tên file/dung lượng vốn đã có trong trình đọc PDF gốc của trình duyệt).
- Fallback: Nếu trình duyệt không render được iframe, hiển thị nút “Tải file PDF về máy”.

Bên phải — Grading Panel (35–38% chiều rộng, chuẩn Apple Inset Group):
- **Duyệt báo cáo**:
  - Nếu đã duyệt: Hiển thị 1 dòng trạng thái tinh gọn kèm nút "Yêu cầu sửa" (chỉ khi GVHD chính cần đổi ý).
  - Nếu chờ duyệt: Hiển thị 2 nút bấm chuẩn Apple: **Chấp nhận báo cáo** (xanh lá) và **Yêu cầu nộp lại** (cam).
- **Form điểm thực tập** (GVHD chính nhập điểm):
  - Lưới 3 cột ngang nhỏ gọn: Định kỳ (20%), Báo cáo (20%), Đơn vị/GV (60%).
  - Điểm tổng kết: Hiển thị 1 dòng sạch sẽ, điểm số nổi bật tính tự động realtime.
  - Ghi chú/Nhận xét: Textarea tối giản, không chiếm diện tích cuộn.
  - Cụm nút bấm chuẩn Apple: **Lưu nháp** (Secondary) và **Nộp điểm cho Khoa** (Primary SF Blue).
- Toàn bộ nội dung cột phải vừa vặn trong 1 màn hình chuẩn, không cần cuộn trang.

**Cơ chế Tối ưu Hiệu năng & Cache PDF (Tránh tải lại file qua mạng):**

1. **Client-side In-memory Blob Cache (Singleton Map)**:
   - Hệ thống duy trì một bộ nhớ đệm `pdfBlobCache = Map<userId, { blob, url, filename, timestamp }>` ở cấp module.
   - Khi giảng viên ấn xem báo cáo lần đầu, file PDF được tải và tạo `Blob URL` lưu vào cache.
   - Khi giảng viên đóng panel và **ấn lại vào bài đã nộp của sinh viên đó** (hoặc chuyển qua lại giữa các sinh viên bằng phím tắt `[` / `]`), panel lấy ngay `Blob URL` từ bộ nhớ đệm: **hiển thị tức thì 0ms, không tốn thêm băng thông mạng và không có màn hình chờ xoay loading**.
2. **Tách biệt vòng đời Form Chấm điểm và PDF Viewer**:
   - Thao tác chấm bài, lưu nháp hay nộp điểm chỉ cập nhật trạng thái dữ liệu điểm và nhãn báo cáo (`localReportStatus`).
   - Tuyệt đối không gắn trạng thái chấm điểm vào dependency của PDF loader. Do đó, sau khi chấm xong, file PDF vẫn giữ nguyên trên màn hình, không bị giật hay kích hoạt tải lại.
3. **Backend HTTP Caching & ETag Validation**:
   - Endpoint `GET /api/reports/final/:userId/view` trả kèm `ETag: "<id>-<file_size>-<timestamp>"` và `Cache-Control: private, max-age=3600, must-revalidate`.
   - Nếu trình duyệt gửi lại request với header `If-None-Match`, máy chủ phản hồi ngay `304 Not Modified` chỉ trong vài mili-giây mà không phải đọc hay truyền lại dữ liệu file nhị phân.

**Thiết kế API bổ sung:**

- `GET /api/reports/final/:userId/view`: trả về file PDF với header `Content-Disposition: inline; filename="..."` thay vì `attachment` như endpoint `/download`, để trình duyệt render trực tiếp trong iframe mà không download. Quyền truy cập giữ nguyên (sinh viên chủ sở hữu, giảng viên phụ trách, admin).

**Lưu ý kỹ thuật:**

- Blob URL approach: `fetch` với `Authorization` header → `URL.createObjectURL(blob)` → gán src cho `<iframe>`. Cách này vượt qua giới hạn của iframe không gửi được header xác thực.
- Bắt buộc `URL.revokeObjectURL()` khi đóng panel để tránh memory leak.
- PDF.js (Mozilla) là lựa chọn mạnh hơn nếu cần kiểm soát trang, zoom, annotation; tuy nhiên bundle nặng hơn (~1.5 MB). Ưu tiên dùng iframe/blob URL trước, bổ sung PDF.js sau nếu cần.
- Render Free tier có thể có latency khi tải file lớn; hiển thị spinner phải đủ thông tin.
- Trên Safari iOS, PDF trong iframe có thể bị chặn; fallback “Mở trong tab mới” bắt buộc phải có.

### 9.6. P4 - Chấm điểm và xuất bảng điểm

Mục tiêu: giảng viên nhập điểm, nộp điểm về Khoa, admin tổng hợp XLSX. Phần lõi đã được triển khai ở backend và UI giảng viên/admin; UI admin hiện xuất XLSX.

Thiết kế dữ liệu:

```sql
CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  lecturer_id INTEGER NOT NULL,
  progress_score REAL,
  report_score REAL,
  company_score REAL,
  final_score REAL,
  status TEXT NOT NULL DEFAULT 'draft',
  comment TEXT,
  submitted_at DATETIME,
  locked_at DATETIME,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Quy tắc điểm:

- `progress_score`: 20%, giảng viên tự tổng hợp từ báo cáo định kỳ qua email.
- `report_score`: 20%, điểm báo cáo final.
- `company_score`: 60%, giảng viên nhập dựa trên trao đổi/bản cứng.
- `final_score = Math.round((progress_score * 0.2 + report_score * 0.2 + company_score * 0.6) * 10) / 10` (chỉ làm tròn đến một chữ số sau phần thập phân theo quy chế đào tạo).
- Điểm hợp lệ từ 0 đến 10.
- Giảng viên có thể lưu nháp.
- Khi `submitted`, admin nhìn thấy để tổng hợp.
- Khi `locked`, chỉ admin mở khóa mới sửa được.

Thiết kế API:

- `GET /api/lecturer/grades`: giảng viên xem danh sách điểm.
- `PUT /api/lecturer/grades/:userId`: lưu điểm nháp.
- `POST /api/lecturer/grades/:userId/submit`: nộp điểm.
- `GET /api/admin/grades`: admin xem toàn bộ điểm.
- `PUT /api/admin/grades/:userId/lock`: khóa/mở khóa điểm từng sinh viên.
- `PUT /api/admin/grades/lock-all`: khóa tất cả điểm đã nộp hoặc mở khóa toàn bộ bảng điểm (`{ locked: boolean, onlySubmitted?: boolean }`).
- `GET /api/admin/grades`: UI dùng dữ liệu này để xuất XLSX.
- `GET /api/admin/grades/export.csv`: endpoint tương thích cũ nếu cần tải CSV trực tiếp.

Thiết kế UI:

- Giảng viên:
  - Bảng “Chấm điểm thực tập” trong trang giảng viên.
  - Tự động kiểm tra thời hạn chấm điểm từ Cài đặt hệ thống (`grading_open_at` đến `grading_close_at`). Khi hết hạn, hiển thị banner cảnh báo và form chuyển sang read-only.
  - Chỉ GVHD chính nhập/sửa/nộp điểm.
  - **Nhấn vào tên sinh viên hoặc nút “Xem & Chấm” → mở inline review panel** (xem 9.5.1) tích hợp xem PDF và nhập điểm cùng màn hình. Luồng chấm điểm và duyệt báo cáo gộp vào một nơi.
  - Chặn sửa khi điểm đã bị admin khoá hoặc khi hết thời hạn chấm điểm (panel vẫn mở được để xem báo cáo, form chuyển read-only).
  - Tự tính điểm tổng kết realtime khi nhập.
  - Cảnh báo thiếu báo cáo final hoặc chưa xác nhận nơi thực tập ngay trong panel.
  - Nút “Nộp điểm cho Khoa” nằm trong panel.
- Admin:
  - Cài đặt hệ thống: cấu hình mốc “Mở chấm điểm lúc” (`grading_open_at`) và “Đóng chấm điểm lúc” (`grading_close_at`).
  - Site “Bảng điểm”.
  - Nút “Khóa tất cả đã nộp” và “Mở khóa tất cả” để niêm phong nhanh bảng điểm trước khi nộp Phòng Đào tạo.
  - Lọc theo chưa có/nháp/đã nộp.
  - Dashboard tổng hợp: chưa có điểm, nháp, đã nộp, đã khoá.
  - Khoá/mở khoá điểm từng sinh viên.
  - Admin cũng mở được inline review panel để xem báo cáo (form điểm ở chế độ read-only với admin).
  - Xuất XLSX để tổng hợp và nhập hệ thống.

Tiêu chí nghiệm thu:

- Không nhập điểm ngoài khoảng 0-10.
- Công thức 20/20/60 tính đúng.
- Giảng viên chỉ nhập điểm sinh viên mình phụ trách.
- Admin xuất được bảng điểm cuối kỳ.
- Giảng viên có thể scroll báo cáo PDF trong khi form điểm luôn hiển thị cố định.
- Trên màn hình nhỏ (< 768px), panel chuyển sang tab-toggle, không bị vỡ layout.
- Nút đóng panel hoạt động và trả về đúng vị trí danh sách.
- Khi điểm bị khoá, form chuyển read-only nhưng vẫn mở được panel xem báo cáo.

### 9.7. P5 - Email tự động và lịch sử thông báo

Mục tiêu: giảm thao tác thủ công và giúp các bên không bỏ lỡ hạn. Hệ thống ghi notification history khi có sự kiện quan trọng, có trang admin để xem/lọc/xuất XLSX/đánh dấu trạng thái, gửi ngay trong quota ngày và dùng hàng đợi cho phần vượt quota khi đã cấu hình provider.

Yêu cầu đối với thông báo thủ công:

- Form có hai phương thức phát hành: **“Hiển thị trên website và gửi email theo quota”** (mặc định) và **“Chỉ hiển thị trên website”**.
- Với phương thức mặc định, bản ghi hiển thị trên website phải được tạo cho tất cả người nhận hợp lệ trước khi xử lý email.
- Hệ thống gửi email ngay theo thứ tự tạo thông báo cho đến khi dùng hết quota còn lại trong ngày. Các bản ghi còn lại giữ trạng thái `queued`; không được bỏ qua, xóa hoặc chuyển sang `failed` chỉ vì hết quota.
- Nếu provider trả về giới hạn tốc độ/quota trong lúc gửi, thông báo chưa gửi phải tiếp tục ở trạng thái `queued` để thử lại sau.
- Với phương thức **“Chỉ hiển thị trên website”**, hệ thống không gọi email provider và lưu trạng thái `website_only`.
- Kết quả thao tác phải cho admin biết tổng số thông báo đã tạo, số email gửi thành công, số đang chờ và số gửi lỗi.

Thiết kế dữ liệu:

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  recipient_email TEXT NOT NULL,
  type TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME,
  provider TEXT,
  provider_message_id TEXT,
  attempt_count INTEGER DEFAULT 0,
  last_attempt_at DATETIME
);
```

Các loại email ưu tiên:

- `registration_status_changed`
- `final_confirmation_open`
- `final_internship_confirmed`
- `advisor_assigned`
- `final_report_due_reminder`
- `final_report_status_changed`
- `grade_submitted` (chỉ gửi riêng cho sinh viên nhận điểm; tuyệt đối không tạo notification web và không gửi email cho Admin)

Thiết kế API/worker:

- Khi sự kiện tự động xảy ra, ghi bản ghi `notifications` với trạng thái `queued`; việc gửi ngay của nhóm này tiếp tục theo cấu hình `EMAIL_SEND_IMMEDIATE`.
- `POST /api/admin/notifications/manual` nhận `delivery_mode = website_and_email | website_only`. Với `website_and_email`, endpoint tạo đủ bản ghi rồi gửi ngay trong quota còn lại; phần vượt quota giữ `queued` và trả về các bộ đếm `created`, `sent`, `queued`, `failed`.
- Nếu chưa chọn provider, vẫn lưu lịch sử thông báo để sau này gửi lại hoặc đánh dấu thủ công.
- Với Brevo Free, đặt `EMAIL_DAILY_SEND_CAP=250` và `EMAIL_BATCH_SIZE=25`; khoảng 900 sinh viên sẽ được gửi trong 4 ngày để không vượt mức 300 email/ngày.
- **Tác vụ tự động quét hàng đợi hàng ngày:** Hệ thống cấu hình cron job tự động kích hoạt mỗi ngày (ví dụ 07:00 ICT) gọi endpoint `POST /api/cron/process-email-queue` (xác thực qua `CRON_SECRET`). Tác vụ này tự tính toán quota còn lại trong ngày (`EMAIL_DAILY_SEND_CAP - sent_today`) và tự động gửi các email đang ở trạng thái `queued` theo thứ tự tạo (FIFO) cho đến khi cạn quota ngày mới mà **hoàn toàn không cần Admin phải trực tiếp đăng nhập và ấn nút “Gửi theo quota”**.
- `POST /api/cron/process-email-queue`: endpoint tự động chạy mỗi ngày bảo vệ bằng `CRON_SECRET`, tự động xả hàng đợi email trong hạn ngạch còn lại của ngày.
- `GET /api/admin/notifications`: admin xem lịch sử thông báo.
- `GET /api/admin/notifications/stats`: admin xem provider, số đã gửi hôm nay, quota còn lại và số queued.
- `POST /api/admin/notifications/send-queued`: endpoint kích hoạt thủ công (nút "Gửi theo quota" / "Gửi hàng đợi" trên UI) cho phép Admin ép gửi tức thì theo batch hoặc theo quota nếu muốn xả sớm mà không chờ cron tự động.
- `PUT /api/admin/notifications/:id/status`: admin cập nhật `queued/sent/failed/website_only`.
- `POST /api/admin/notifications/final-confirmation-open`: tạo thông báo mở xác nhận nơi thực tập cho sinh viên chưa xác nhận.
- `POST /api/admin/notifications/final-report-reminders`: tạo thông báo nhắc nộp báo cáo final cho sinh viên chưa nộp hoặc cần nộp lại.
- Tự động chạy lịch trình hàng ngày qua GitHub Actions workflow hoặc Cloudflare Worker scheduled triggers.

Sự kiện đã ghi notification:

- Admin đổi trạng thái đăng ký hoặc duyệt tất cả.
- Sinh viên xác nhận nơi thực tập chính thức.
- Khoa phân công GVHD thủ công/import/tự phân công.
- Giảng viên/admin đổi trạng thái báo cáo final.
- GVHD chính nộp điểm (chỉ tạo notification trên web và gửi email cho sinh viên nhận điểm; không gửi web/email cho Admin).

Tiêu chí nghiệm thu:

- Mỗi sự kiện quan trọng tạo được notification.
- Admin xem được lịch sử gửi và lỗi gửi.
- Hệ thống không chặn nghiệp vụ chính nếu gửi email lỗi.
- Phương thức mặc định trên form hiển thị đúng nhãn **“Hiển thị trên website và gửi email theo quota”**; nhãn cũ không còn xuất hiện.
- Nếu quota còn đủ, email của thông báo thủ công được gửi ngay và trạng thái chuyển `sent`.
- Nếu số người nhận lớn hơn quota còn lại, đúng phần vượt quota giữ trạng thái `queued` và toàn bộ người nhận vẫn xem được thông báo trên website.
- **Tự động gửi email hàng đợi mỗi ngày:** Khi bước sang ngày mới, hệ thống tự động kiểm tra quota ngày mới và tự động gửi tiếp các email `queued` còn tồn đọng mà **không đòi hỏi Quản trị viên phải ấn nút “Gửi theo quota”**.
- Nút **“Gửi theo quota”** trên giao diện Admin hoạt động như một công cụ kích hoạt bổ sung tức thì theo ý muốn của Admin, không phải là điều kiện bắt buộc để hàng đợi được gửi đi.
- Nếu quota đã hết hoặc provider chưa được cấu hình, thao tác vẫn tạo thông báo thành công và đưa email vào hàng đợi.
- Không gửi vượt `EMAIL_DAILY_SEND_CAP`, kể cả khi nhiều thao tác gửi được thực hiện liên tiếp.

### 9.8. Thứ tự triển khai khuyến nghị

1. P0: Migration dữ liệu, danh sách thẩm định nội bộ, trạng thái gửi danh sách sang doanh nghiệp.
2. P1: Xác nhận nơi thực tập chính thức.
3. P2: Phân công GVHD và trang giảng viên.
4. P3: Upload báo cáo final PDF lên R2.
5. P4: Nhập điểm, nộp điểm, export bảng điểm.
6. P5: Email tự động và notification history.
7. P6: Đối soát đăng ký học phần với Phòng Đào tạo.
8. P7: Cổng doanh nghiệp, chỉ khi Khoa muốn doanh nghiệp tự phản hồi trên hệ thống trong tương lai.

### 9.9. Rủi ro và lưu ý kỹ thuật

- Cloudflare Worker hiện nhận JSON; upload PDF cần dùng `multipart/form-data` hoặc upload bằng signed URL. Với R2, hướng đơn giản là Worker nhận file, kiểm tra và ghi vào bucket.
- Cần đồng bộ logic giữa `server.ts` và `src/worker.ts` nếu vẫn duy trì cả hai runtime.
- Các migration hiện nằm trong code khởi tạo DB; khi schema phức tạp hơn nên tách thành migration có phiên bản.
- Danh sách giảng viên đang dựa vào tên để nhận diện `CN`, `GS`, `PGS`, `TS`, `ThS`; nên chuẩn hóa thêm trường học hàm/học vị nếu muốn chắc chắn.
- UI import đã ưu tiên XLSX; CSV vẫn được giữ như đường tương thích cho file cũ/seed. Nếu tiếp tục dùng CSV, cần parser chuẩn để tránh lỗi dấu phẩy trong tên/cột.
- Quyền tải báo cáo PDF phải kiểm tra chặt: sinh viên chỉ xem file của mình, giảng viên chỉ xem sinh viên được phân công, admin xem tất cả.
- Nếu số lượng file hoặc dung lượng vượt free tier R2, cần chính sách dọn dữ liệu sau khi kết thúc đợt hoặc chuyển lưu trữ dài hạn.

### 9.10. Đăng ký giảng viên hướng dẫn từ phía sinh viên

Mục tiêu: sinh viên đã có tên trong hệ thống chỉ đăng ký GVHD khi đã liên hệ và được giảng viên đồng ý hướng dẫn. Nếu chưa có GVHD, sinh viên không cần thao tác; Khoa sẽ phân công chính thức sau.

Quy tắc nghiệp vụ đã chốt:

- Sinh viên chỉ chọn GVHD trong trường hợp `Tôi đã được GV đồng ý hướng dẫn`.
- Nếu sinh viên chưa có GVHD đồng ý hướng dẫn, sinh viên để trống phần đăng ký GVHD; Khoa sẽ phân công sau theo quota còn lại.
- Với các sinh viên trước đó đã đăng ký nơi thực tập là `Trường Đại học Công nghệ` và đã điền tên GVHD khi đăng ký, hệ thống tự hiểu đây là trạng thái `Tôi đã được GV đồng ý hướng dẫn`. Sinh viên không cần nhập lại.
- Nếu sinh viên đã khai báo GVHD trong đăng ký cũ, hệ thống cần hiển thị lại GVHD đó trong phần đăng ký GVHD và chuyển thành yêu cầu chờ Khoa xác nhận nếu chưa có phân công chính thức.
- Nếu GV đã đủ hoặc vượt quota, hệ thống vẫn ghi nhận đăng ký/phân công GVHD đã được GV đồng ý, đánh dấu `over_quota` và chỉ hiển thị cảnh báo trực tiếp cho sinh viên; không tạo thông báo hoặc email.
- Giảng viên có tên chứa `CN` không được làm GVHD chính, nhưng có thể là đồng hướng dẫn nếu Khoa cho phép trong luồng phân công.
- Khoa/Admin có quyền duyệt, từ chối, hoặc đổi sang giảng viên khác khi xử lý đăng ký GVHD.
- Khi Khoa duyệt đăng ký GVHD, hệ thống mới ghi phân công chính thức vào `advisor_assignments`.
- Có campaign riêng `Đăng ký Giảng viên hướng dẫn` với thời gian bắt đầu/kết thúc trong `Cài đặt hệ thống`.
- Sau khi campaign này kết thúc, nếu sinh viên chưa đăng ký GVHD đã được đồng ý thì hệ thống tự phân công GVHD theo quota còn lại. Các yêu cầu `agreed` đang chờ xử lý không bị auto-assign đè lên.

Quota mặc định đưa vào `Cài đặt hệ thống`:

- `PGS/GS`: mặc định `5`.
- `TS`: mặc định `8`.
- `ThS`: mặc định `10`.
- Các quota riêng theo từng giảng viên trong trang `Phân công GVHD` vẫn được xem là cấu hình ghi đè nếu có.
- Quota tính tổng cả hướng dẫn chính và đồng hướng dẫn.

Thiết kế dữ liệu bổ sung:

```sql
CREATE TABLE IF NOT EXISTS advisor_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  lecturer_id INTEGER,
  co_lecturer_id INTEGER,
  lecturer_name_text TEXT,
  co_lecturer_name_text TEXT,
  request_type TEXT NOT NULL DEFAULT 'agreed',
  status TEXT NOT NULL DEFAULT 'pending',
  quota_status TEXT NOT NULL DEFAULT 'unknown',
  student_note TEXT,
  admin_note TEXT,
  source_registration_id INTEGER,
  reviewed_by INTEGER,
  reviewed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Các trạng thái chính:

- `request_type`:
  - `agreed`: sinh viên xác nhận đã được GV đồng ý.
  - `faculty_assign`: Khoa/hệ thống phân công khi sinh viên chưa có GVHD đồng ý hướng dẫn.
- `status`:
  - `pending`: chờ Khoa xử lý.
  - `approved`: Khoa đã duyệt và đã ghi phân công chính thức.
  - `rejected`: Khoa từ chối, kèm nhận xét.
  - `assigned_by_faculty`: Khoa chọn giảng viên khác để phân công.
- `quota_status`:
  - `within_quota`: GV còn quota tại thời điểm gửi.
  - `over_quota`: GV đã đủ/vượt quota, hệ thống vẫn ghi nhận phân công và chỉ cảnh báo trực tiếp cho sinh viên; không tạo thông báo hoặc email.
  - `unknown`: chưa xác định được GV.

Thiết kế UI sinh viên:

- Trong khu vực `Nơi thực tập chính thức/GVHD`, hiển thị trạng thái phân công hiện tại nếu đã có.
- Nếu chưa có phân công chính thức, hiển thị form `Đăng ký GVHD`.
- Nếu hệ thống phát hiện đăng ký cũ `Trường Đại học Công nghệ` có tên GVHD, tự điền GVHD và hiển thị nguồn `Từ đăng ký thực tập tại trường`.
- Sinh viên chỉ gửi/sửa đăng ký GVHD khi đã được giảng viên đồng ý hướng dẫn. Nếu chưa có GVHD, sinh viên không cần thao tác; Khoa sẽ phân công.
- Nếu GV đã đủ quota, UI cảnh báo nhưng vẫn cho gửi.

Thiết kế UI admin:

- Trong site `Phân công GVHD`, thêm khu vực/tab `Đề xuất từ sinh viên`.
- Mỗi đăng ký GVHD hiển thị: MSSV, họ tên, nơi thực tập, nguồn đăng ký, GVHD đăng ký, GV đồng hướng dẫn nếu có, trạng thái quota, ghi chú sinh viên.
- Admin có thể:
  - Duyệt đăng ký.
  - Từ chối kèm nhận xét.
  - Chọn GV khác và phân công.
- Khi đăng ký/phân công vượt quota, UI sinh viên chỉ hiển thị cảnh báo; không tạo notification, không đưa email vào hàng đợi và không yêu cầu quản trị viên duyệt thủ công riêng.

## 10. Các điểm đã chốt thêm

- Không có ngoại lệ dung lượng báo cáo final trong giai đoạn hiện tại. File PDF lớn hơn 10 MB bị từ chối và sinh viên phải nén lại.
- Chỉ tiêu mặc định GVHD được cấu hình trong `Cài đặt hệ thống`: `GS/PGS` mặc định 5, `TS` mặc định 8, `ThS/khác` mặc định 10. Quota riêng từng giảng viên nếu có sẽ ghi đè mặc định này. Hệ thống vẫn ghi nhận đăng ký GVHD đã được đồng ý khi vượt quota và chỉ cảnh báo trực tiếp cho sinh viên, không tạo thông báo hoặc email.

### 10.1. Bug: Admin sửa GVHD trong đăng ký không cập nhật trang sinh viên

**Mô tả vấn đề:**

Khi admin sửa trường GVHD (`other_company_contact`) trong một đăng ký "Trường Đại học Công nghệ" qua API `PUT /api/admin/registrations/:id`, thay đổi chỉ ghi vào bảng `registrations`. Trang điểm thực tập của sinh viên (`/api/grades/my`) đọc GVHD từ bảng `advisor_assignments`, không đọc từ `registrations`. Do đó sinh viên vẫn thấy GVHD cũ.

**Nguyên nhân kỹ thuật:**

- Hàm `ensureSchoolFinalInternshipFromRegistration` dùng `ON CONFLICT(user_id) DO NOTHING` nên không cập nhật khi `final_internships` đã tồn tại.
- API `PUT /api/admin/registrations/:id` không gọi logic nào để đồng bộ `advisor_assignments` sau khi cập nhật GVHD.
- Màn hình sinh viên (`StudentGradeView`) đọc `primary_advisors` từ `advisor_assignments` qua `GROUP_CONCAT`, hoàn toàn độc lập với `registrations.other_company_contact`.

**Thiết kế fix:**

Sau khi `UPDATE registrations` thành công trong `PUT /api/admin/registrations/:id`, nếu đây là đăng ký "Trường Đại học Công nghệ" và sinh viên đã có `final_internships`, thực hiện đồng bộ `advisor_assignments`:

1. Tra cứu `lecturer_id` từ `lecturers.name` theo `other_company_contact` (GVHD chính mới).
2. Nếu tìm thấy:
   - Xóa phân công `primary` hiện tại của sinh viên trong `advisor_assignments` (nếu có).
   - Ghi lịch sử xóa vào `advisor_assignment_history` với `action = 'replaced'`.
   - Insert phân công mới vào `advisor_assignments`.
   - Ghi lịch sử tạo vào `advisor_assignment_history` với `action = 'created'`.
   - Tạo notification `advisor_assigned` cho sinh viên.
3. Nếu `other_company_contact` bị xóa (chuỗi rỗng): xóa phân công `primary` hiện tại.
4. Tương tự với GVHD đồng hướng dẫn (`other_company_role`) và `role = 'co'`.
5. Nếu `other_company_contact` có giá trị nhưng không tìm thấy trong `lecturers`, **không block API**, chỉ bỏ qua bước đồng bộ và ghi log cảnh báo. Lý do: admin có thể đang nhập tên không khớp chính xác, không nên làm hỏng luồng cập nhật đăng ký.

**Phạm vi ảnh hưởng:**

- `server.ts`: Hàm xử lý `PUT /api/admin/registrations/:id` (dòng ~4694).
- Không thay đổi schema database.
- Không thay đổi frontend.

**Tiêu chí nghiệm thu:**

1. Admin sửa GVHD trong đăng ký → sinh viên thấy GVHD mới ngay trên trang Điểm thực tập.
2. Admin xóa GVHD (để trống) → sinh viên thấy "Chưa phân công".
3. Admin đổi GVHD từ A sang B → `advisor_assignments` của sinh viên chỉ còn B (không còn A).
4. Lịch sử `advisor_assignment_history` ghi đúng `action = 'replaced'` khi đổi GVHD.
5. Sinh viên nhận notification `advisor_assigned` khi GVHD thay đổi.
6. Đăng ký "Công ty khác" hoặc công ty chính thức không bị ảnh hưởng.
7. Sinh viên chưa có `final_internships` không bị tạo `advisor_assignments` ngay lập tức.

### 10.2. Đặc tả yêu cầu & Thiết kế kỹ thuật: Quản trị viên xóa nguyện vọng đăng ký thực tập (Admin Delete Registration)

**1. Bối cảnh & Yêu cầu nghiệp vụ:**
- Trong quá trình vận hành, quản trị viên thường xuyên phải xử lý các tình huống: sinh viên khai báo nhầm nguyện vọng, đăng ký thừa/trùng lặp, hoặc Khoa cần hủy nguyện vọng theo đề nghị chính thức của sinh viên hoặc doanh nghiệp.
- Trước đây, quản trị viên chỉ có thể chỉnh sửa (`PUT /api/admin/registrations/:id`) mà không có nút hủy/xóa trực tiếp trên giao diện modal "Sửa đăng ký thực tập".
- **Yêu cầu:** Bổ sung nút **"Xoá đăng ký"** trực tiếp trong hộp thoại "Sửa đăng ký thực tập" (`AdminPanel.tsx`), thiết kế theo phong cách Apple HIG (Destructive Action), hiển thị hộp thoại xác nhận chi tiết trước khi xóa, và kiểm tra toàn vẹn dữ liệu nghiêm ngặt.

**2. Ràng buộc an toàn & Toàn vẹn dữ liệu (Data Integrity Constraints):**
- **Kiểm tra trạng thái khóa nơi thực tập chính thức:**
  - Tra cứu trong bảng `final_internships` theo `registration_id = ?`.
  - Nếu bản ghi tồn tại và đã bị khóa (`locked_at IS NOT NULL`): **Tuyệt đối từ chối xóa** (HTTP 400: *"Không thể xóa đăng ký đã được chốt và khóa nơi thực tập chính thức."*).
- **Dọn dẹp bản ghi liên đới chưa khóa:**
  - Nếu có bản ghi trong `final_internships` gắn với `registration_id = ?` nhưng chưa khóa (`locked_at IS NULL`): Xóa bản ghi này khỏi `final_internships` để tránh dữ liệu mồ côi (orphaned).
  - Nếu có bản ghi đề xuất GVHD trong `advisor_requests` gắn với `source_registration_id = ?`: Cập nhật `source_registration_id = NULL` để bảo toàn tính toàn vẹn tham chiếu.
- **Xóa bản ghi đăng ký:**
  - Thực thi lệnh `DELETE FROM registrations WHERE id = ?`.
  - Các câu lệnh thao tác dữ liệu được thực thi an toàn trong batch.

**3. Đặc tả API Backend:**
- **Endpoint:** `DELETE /api/admin/registrations/:id(\d+)`
- **Xác thực:** Bắt buộc Bearer JWT token của Quản trị viên (`requireAuth`, `requireAdmin`).
- **Tham số:** `id` (INTEGER, ID của bản ghi đăng ký trong `registrations`).
- **Phản hồi:**
  - `200 OK`: `{ success: true, message: "Đã xóa đăng ký thành công." }`
  - `400 Bad Request`: `id` không hợp lệ, hoặc đăng ký đã được chốt và khóa nơi thực tập chính thức (`locked_at IS NOT NULL`).
  - `401 Unauthorized` / `403 Forbidden`: Chưa xác thực hoặc không có quyền quản trị viên.
  - `404 Not Found`: Không tìm thấy bản ghi đăng ký tương ứng.
  - `500 Internal Server Error`: Lỗi máy chủ hoặc truy vấn cơ sở dữ liệu.
- **Tính đồng bộ:** Triển khai đồng thời trên Express server chính (`server.ts`) và Cloudflare Worker (`src/worker.ts`).

**4. Thiết kế Giao diện Người dùng (UI/UX - Apple HIG):**
- **Bố cục Modal Footer (`AdminPanel.tsx`):**
  - Chuyển `flex items-center justify-end` thành `flex items-center justify-between`.
  - **Bên trái (Destructive Action):** Nút **"Xoá đăng ký"** màu đỏ nổi bật:
    - Trạng thái bình thường: Nền đỏ pastel nhẹ (`bg-red-50/50`), viền hairline (`border-red-200`), chữ đỏ đậm (`text-red-600`), icon `Trash2` (16px), hover nền đậm hơn (`hover:bg-red-100/80 hover:border-red-300`), active co nhẹ (`active:scale-[0.98]`).
    - Trạng thái đang xóa (`deletingRegistration = true`): Hiển thị icon `RefreshCw` xoay vòng và chữ "Đang xoá...", vô hiệu hóa nút (`disabled`).
  - **Bên phải:** Cụm nút "Huỷ" và "Lưu thay đổi" (Primary Action).
- **Hộp thoại xác nhận an toàn:**
  - Kích hoạt `window.confirm` với nội dung chi tiết:
    *"Bạn có chắc chắn muốn xóa đăng ký thực tập này không?\n\n- Sinh viên: [Tên SV] (MSSV: [MSSV])\n- Nơi thực tập: [Tên Công ty/Nơi thực tập]\n- Thứ tự NV: [NV]\n\nHành động này không thể hoàn tác!"*
- **Trải nghiệm sau thao tác:**
  - Đóng modal ngay khi xóa thành công (`setEditingRegistration(null)`).
  - Tải lại dữ liệu danh sách (`await fetchRegistrations()`).
  - Xử lý và hiển thị thông báo lỗi rõ ràng nếu xóa thất bại.

## 11. Tiêu chuẩn thiết kế giao diện (Apple HIG UI Design System)

Hệ thống được thiết kế và chuẩn hóa toàn diện theo **Triết lý Thiết kế Apple Human Interface Guidelines (HIG)**, áp dụng đồng bộ cho tất cả các màn hình và tất cả các vai trò (Sinh viên, Giảng viên, Quản trị viên), đồng thời bảo lưu thanh Header màu xanh đặc trưng của FIT UET.

> 📘 **Tài liệu chi tiết:** Xem đặc tả thiết kế đầy đủ tại [`docs/UI_DESIGN_SYSTEM.md`](docs/UI_DESIGN_SYSTEM.md).

### 10.1. Ba nguyên lý cốt lõi
1. **Clarity (Sự rõ ràng & Zero Redundancy):**
   - Loại bỏ triệt để các thông tin dư thừa lặp lại trên cùng màn hình.
   - Phân cấp thị giác tự nhiên bằng kích cỡ chữ (Typography scale), độ đậm font và khoảng trắng (negative space) thay vì lạm dụng viền hộp lồng hộp.
2. **Deference (Tôn trọng nội dung):**
   - Giao diện làm nền tảng tôn vinh dữ liệu (bảng điểm, danh sách thực tập, tài liệu PDF).
   - Giữ nguyên Header xanh nhận diện thương hiệu (`linear-gradient(110deg, #064889 0%, #075fc7 62%, #1473e6 100%)`).
   - Nền canvas xám nhẹ Apple System Gray 6 (`#F5F5F7`), thẻ nội dung màu trắng thuần khiết (`#FFFFFF`).
3. **Depth (Chiều sâu & Phân lớp vật liệu):**
   - Bo góc mềm mại kiểu Apple Squircle (`10px` cho nút, `12px` cho input, `16px - 20px` cho card và table, `24px` cho modal sheet).
   - Bóng đổ Ambient đa tầng siêu mịn, không dùng bóng đen gắt.
   - Phủ mờ (Backdrop blur) trên modal và menu trôi nổi.

### 10.2. Quy chuẩn thành phần chính
- **Nút bấm (Buttons):** 
  - Nút chính (Primary): Màu xanh SF Blue (`#0071E3`), bo góc `10px - 12px`, hiệu ứng nhấn lún `active:scale-[0.98]`.
  - Nút phụ (Secondary/Tinted): Nền trắng viền hairline hoặc nền màu pastel mềm (`bg-blue-50`, `bg-emerald-50`).
- **Bảng dữ liệu (Tables):** Kiểu dáng macOS Inset Table với header xám nhạt tối giản, đường phân cách ngang siêu mảnh (`#E5E5EA`), không dùng viền dọc rối mắt.
- **Cửa sổ xem & chấm báo cáo (Review Sheet):** Header mỏng 1 dòng, PDF xem tràn viền không bị thanh công cụ phụ che khuất, bảng điểm 3 cột nhỏ gọn tính tự động realtime.

### 10.3. Áp dụng theo từng Roles
- **Sinh viên:** Thẻ trạng thái tổng quan trực quan, quy trình nộp báo cáo và đăng ký đơn giản, rõ ràng, dễ dùng trên cả mobile và desktop.
- **Giảng viên:** Danh sách sinh viên phụ trách tinh gọn; nút "Xem & Chấm" mở trực tiếp modal sheet chia đôi màn hình; nhập điểm nhanh chóng, chính xác.
- **Admin:** Thanh tìm kiếm phong cách macOS Spotlight, bộ lọc danh mục trực quan, các bảng quản trị lớn hiển thị thoáng đãng và xuất/nhập XLSX tiện lợi.

## 12. Mẫu thiết kế GoF Proxy Pattern: Phân trang danh sách lớn (Virtual Proxy & Cache Proxy)

Hệ thống triển khai chuẩn hóa mẫu thiết kế hướng đối tượng **GoF Proxy Pattern** (kết hợp Virtual Proxy và Cache Proxy) cho các bảng quản trị danh sách lớn (điển hình là Quản trị Thông báo & Email `NotificationAdmin`):

- **Virtual Proxy (Proxy ảo / Trì hoãn nạp)**: Trì hoãn nạp dữ liệu đến khi thực sự cần. Màn hình chỉ nạp trang đầu tiên (`pageSize = 25`) thay vì kéo toàn bộ 500 bản ghi về một lúc, giảm **~95% lưu lượng mạng ban đầu** (từ ~450 KB xuống ~22 KB) và tăng tốc First Contentful Paint.
- **Cache Proxy (Proxy bộ đệm)**: Lưu trữ các trang đã nạp vào bộ nhớ in-memory với TTL (Time To Live). Khi người dùng duyệt lại các trang đã xem, dữ liệu được hiển thị ngay lập tức với **0ms latency**, hoàn toàn không tạo thêm request mạng.
- **Request Deduplication & Autonomous Prefetching**: Proxy tự động triệt tiêu các yêu cầu trùng lặp và kích hoạt tải trước trang kế tiếp (`page + 1`) ở chế độ chạy nền qua `requestIdleCallback`, mang lại trải nghiệm bấm "Trang Sau" tức thì.
- **100% Backward Compatibility**: Backend endpoint `GET /api/admin/notifications` tương thích ngược hoàn toàn; tự động chuyển đổi giữa chế độ phân trang SQL (`LIMIT ? OFFSET ?` kèm `COUNT(*)`) và chế độ mảng cũ nếu không có tham số phân trang.

> 📘 **Tài liệu kiến trúc chi tiết:** Xem sơ đồ lớp UML (Class Diagram) và sơ đồ tuần tự (Sequence Diagram) tại [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## 13. Nhận xét tổng quan

Hệ thống hiện tại phù hợp để dùng như cổng đăng ký và tổng hợp danh sách ban đầu cho Khoa. Nếu mục tiêu là xử lý càng nhiều nghiệp vụ sau đăng ký càng tốt, cần mở rộng mô hình dữ liệu từ “nguyện vọng đăng ký” sang “hồ sơ thực tập” với các phần riêng: nơi thực tập chính thức, phân công GVHD, báo cáo final, đánh giá và điểm.

Thay đổi quan trọng nhất nên làm tiếp theo là thêm thực thể “nơi thực tập chính thức” cho mỗi sinh viên. Đây là điểm nối giữa giai đoạn đăng ký/xác nhận nơi thực tập và toàn bộ giai đoạn quản lý thực tập, phân công giảng viên, nộp báo cáo final và chấm điểm về sau.
