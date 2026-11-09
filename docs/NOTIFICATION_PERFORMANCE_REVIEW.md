# Rà soát hiệu năng thông báo — 09/11/2026

## Phạm vi và kết luận

Đọc mã tại `9dea53154f61d025e59ec336cf659e875b73f0b5`, cũng là SHA backend production trả về khi kiểm tra. Production đang dùng Turso, schema 4; health/readiness đều HTTP 200 tại thời điểm rà soát. Không chạy truy vấn inbox hoặc thao tác ghi thử trên production.

Đã xác định điểm nghẽn lớn: chỉ một thông báo học vụ trong kết quả cá nhân cũng kích hoạt snapshot toàn hệ thống, bao gồm dữ liệu Thực tập legacy. ETag hiện chỉ giảm payload HTTP, không tránh được công việc này. Không thể kết luận chính xác độ trễ mà người dùng gặp từ phép đo local; mạng, Render và kết nối Turso cần đo riêng khi nghiệm thu.

Đây là báo cáo và thử nghiệm SQL trên bản sao, **chưa phải bản vá đã phát hành**. Không đổi mã ứng dụng, database hoặc email production.

## Luồng hiện tại và căn cứ

1. `src/App.tsx`: mở chuông mới mount `MyNotifications`; đóng popup thì unmount. Header lấy số đếm chung thông báo/chat mỗi 180 giây khi tab hiển thị; khi quay lại tab kiểm tra ngưỡng 60 giây. Không có vòng tải nội dung thông báo liên tục.
2. `src/shared/components/MyNotifications.tsx:99`: mỗi lần mount đều chờ `GET /api/notifications/my`. Popup và trang đầy đủ gọi cùng API; popup chỉ `slice(0, 5)` sau khi đã nhận tối đa 100 thông báo.
3. `server/routes/common.routes.ts:145`: đọc tối đa 100 thông báo cá nhân, lọc quyền trong JavaScript, rồi mới đọc tối đa 100 thông báo hệ thống, sắp xếp và cắt lại 100. Các bước cá nhân → kiểm quyền → hệ thống nối tiếp nhau.
4. `server/academic/notificationAccess.ts:18`: nếu có `academic_class_id`, gọi `snapshot()`. `server/academic/store.ts` lấy toàn bộ lớp/lần học/giảng viên/quota; `hydrateLegacy()` tiếp tục đọc thiết lập, tài khoản, báo cáo, điểm, phân công, schema, nguyện vọng và nơi thực tập chính thức của nguồn legacy.
5. `server/services/httpCache.ts`: ETag được tính ở `res.json`, sau khi hoàn tất mọi truy vấn. `src/shared/utils/requestCache.ts` có cache RAM/gộp GET, nhưng luôn revalidate và chờ phản hồi trước khi trả cache. Vì vậy cache hiện có chưa tránh độ trễ SQL/backend.
6. Nút Đã đọc/Đã đọc tất cả gọi PUT rồi GET lại toàn bộ danh sách. Chưa kiểm tra `response.ok` trước khi tải lại; chưa khóa thao tác trùng; request không gắn AbortSignal của popup. Click mở thông báo có cập nhật giao diện trước nhưng chưa xử lý rollback khi ghi thất bại.
7. `server/services/unread.ts`: số đếm có cache server 20 giây, nhưng khoảng polling bình thường là 180 giây. Cache kiểm `academic_meta.revision`; các đường ghi thông báo/dấu đọc/legacy không đều thay revision này. Hàm `invalidateUnreadCountsCache` không có caller trong mã runtime ngoài chính module; frontend invalidation không thay thế việc này.
8. Truy vấn danh sách dùng `UNION` và điều kiện OR cho email; kế hoạch D1 local chọn `idx_notifications_user_id` ở cả hai nhánh và cần temporary B-tree để sắp xếp. Các chỉ mục người nhận/thời điểm đã tồn tại, nhưng hình dạng truy vấn chưa tận dụng được đầy đủ.

## Đo trên bản sao local

Nguồn là backup riêng ngày 01/11/2026, mở read-only: 1.157 tài khoản, 1.100 lần học, 4.774 thông báo, 6 thông báo hệ thống. Không dùng số này thay cho thống kê hiện tại của production.

Dùng workerd D1 local, mount router thật và middleware xác thực/ETag, mỗi vai trò chọn một tài khoản mẫu. Backup chưa có thông báo học vụ, nên thêm đúng một thông báo `course_announcement` cho mỗi tài khoản trên **bản sao tạm** để kích hoạt cùng nhánh kiểm quyền như thông báo học vụ trong ảnh. Các GET đều có `rows_written = 0`.

| Vai trò | Chưa có thông báo học vụ: query / rows read | Có một thông báo học vụ: query / rows read | GET lại cùng ETag |
| --- | ---: | ---: | ---: |
| Khoa | 3 / 145 | 10 / 25.354 | 304, vẫn 10 / 25.354 |
| Giảng viên | 3 / 78 | 10 / 25.286 | 304, vẫn 10 / 25.286 |
| Sinh viên | 3 / 96 | 10 / 25.305 | 304, vẫn 10 / 25.305 |

Các số trên **đã tính xác thực HTTP**. Mỗi lượt có thông báo học vụ chuyển khoảng **3,06–3,09 MB JSON từ DB về backend**, trong khi HTTP chỉ trả khoảng 5–27 KB; popup chỉ dùng 5 dòng. Phần hydrate legacy chiếm phần lớn dữ liệu trung gian.

Chuỗi phụ thuộc có sáu tầng DB: xác thực → thông báo cá nhân → snapshot → nhóm bốn truy vấn legacy chạy song song → nhóm hai truy vấn legacy tiếp theo → thông báo hệ thống. Tăng tốc CPU hoặc chỉ chạy hai truy vấn đầu/cuối song song không loại bỏ phần đọc thừa.

Số đếm header đo riêng, **chưa tính xác thực**:

| Vai trò | Cache lạnh: query / rows read | Cache nóng: query / rows read |
| --- | ---: | ---: |
| Khoa | 2 / 12.196 | 1 / 1 |
| Giảng viên | 2 / 2.398 | 1 / 1 |
| Sinh viên | 2 / 128 | 1 / 1 |

Header không dùng snapshot giống inbox, nhưng vẫn dựng read model học vụ và tính cả chat. Cần tối ưu riêng, nhất là Khoa; không tăng nhịp polling để bù tốc độ cập nhật.

### Thử nghiệm hướng truy vấn thay thế

Prototype chỉ chạy trong file riêng trên bản sao, chưa tích hợp vào ứng dụng:

- Truy vấn bắt đầu theo người nhận, kiểm quyền bằng `EXISTS` trên lớp/lần học/phân công cần thiết. Phân công legacy đọc từ nguồn live, không hydrate báo cáo/điểm/nguyện vọng.
- Tách nhánh `user_id`, email chính và email cá nhân đã khử trùng; dùng `UNION ALL` cho các nhánh không giao nhau.
- Giới hạn sau điều kiện quyền; lấy 100 thông báo hiển thị gần nhất để giữ ý nghĩa số chưa đọc hiện tại, nhưng chỉ trả 5 dòng cho popup.
- Gộp nguồn cá nhân và hệ thống trong một statement; bản thử trả cùng thứ tự ID và số chưa đọc với API hiện tại trên các fixture đã chọn.

| Vai trò | Hiện tại, gồm xác thực | Prototype, cộng cùng 2 dòng xác thực | Giảm rows read |
| --- | ---: | ---: | ---: |
| Khoa | 25.354 | 707 | 97,2% |
| Giảng viên | 25.286 | 360 | 98,6% |
| Sinh viên | 25.305 | 120 | 99,5% |

Prototype cần một statement dữ liệu thay cho chín statement sau xác thực. Payload 5 dòng khoảng 1,3–4,1 KB trên fixture. Đây là bằng chứng cho hướng thiết kế; chưa bao phủ đầy đủ phân quyền, chưa phải cam kết số đo Turso production.

Kiểm tra tăng lịch sử, prototype chưa tính xác thực:

| Vai trò | Mẫu ban đầu | +1.000 thông báo người khác | Thêm 1.000 thông báo cũ của chính mình | Tăng thành 2.000 thông báo cũ của chính mình |
| --- | ---: | ---: | ---: | ---: |
| Khoa | 705 | 705 | 1.157 | 1.157 |
| Giảng viên | 358 | 358 | 1.020 | 1.020 |
| Sinh viên | 118 | 118 | 731 | 731 |

Việc lấp đầy cửa sổ 100 thông báo cần thêm lượt đọc, nhưng không tăng tiếp khi lịch sử cũ tăng từ 1.000 lên 2.000. API hiện tại tăng lên khoảng 28.300 dòng đọc trong ca thêm 1.000 thông báo cũ, vẫn gọi snapshot.

Script và báo cáo tổng hợp được giữ riêng tại `.staging/notification-audit-20261109/`; không có token, email hoặc nội dung thông báo trong báo cáo JSON. Script tạo dữ liệu giả chỉ trên bản sao local và dọn database tạm.

## Phương án đề xuất theo thứ tự

### 1. Loại bỏ đọc toàn hệ thống — ưu tiên cao nhất

- Tạo read model thông báo chuyên biệt và một quy tắc visibility dùng chung cho danh sách, số đếm và thao tác đọc. Không kéo snapshot hoặc toàn bộ `records` của campaign vào luồng inbox.
- Kiểm người nhận, lớp/lần học còn tồn tại, trạng thái nhóm và phân công hiện hành trước giới hạn trang. Giữ thông báo của nhóm lưu trữ được phép xem; nhóm nháp và người mất quyền không được lộ nội dung.
- Bảo toàn hai học phần độc lập, đồng hướng dẫn/GVNX, audience nhiều lớp, email cá nhân và nguồn legacy. Không tự mở rộng quyền Khoa chỉ vì đang xem inbox của mình.
- Tận dụng chỉ mục sẵn có; xem kế hoạch thực thi trước khi thêm chỉ mục. Thêm khóa sắp xếp ổn định khi thời gian trùng nhau.
- Có thể thêm `limit=5` cho popup, `limit=20` và cursor cho trang Xem tất cả; lời gọi không tham số giữ hợp đồng cũ. Số chưa đọc không được suy ra từ riêng 5 dòng. Hiện cả hai API đếm chỉ xét 100 thông báo mới nhất; việc đổi sang tổng chưa đọc toàn lịch sử là thay đổi nghiệp vụ riêng.

### 2. Bỏ GET thừa sau thao tác và thống nhất state

- PUT đọc một/tất cả trả kết quả xác nhận đủ cập nhật dấu đọc và badge; cập nhật đúng cache popup/trang đầy đủ, không GET lại inbox chỉ để đổi một dấu đọc.
- Nếu cập nhật trước khi server xác nhận, rollback khi lỗi; khóa thao tác đang gửi và không trừ badge hai lần. Read-all phải xác định tập thông báo được đánh dấu tại thời điểm ghi; thông báo mới đến đồng thời vẫn chưa đọc.
- Tách tag cache `notifications` khỏi chat/catalog; đánh dấu đã đọc không vô hiệu hóa mọi danh mục/nhóm và request không liên quan.
- Dọn cache số đếm ngay ở các đường thêm/xóa/đọc thông báo và đổi quyền. Với nhiều process hoặc nguồn ghi ngoài process, cần dấu thay đổi từ database; invalidation RAM đơn lẻ không đủ.

### 3. Cache và giao diện, giữ kiểm quyền

- Dùng store RAM chung cho chuông và trang Xem tất cả; tách theo phiên/tài khoản/vai trò. Giữ gộp GET đang chạy và hủy khi không còn người dùng request; bỏ qua phản hồi cũ.
- Mở popup vẫn revalidate quyền bằng luồng đọc đã thu gọn. Không hiển thị lại nội dung nhạy cảm đã mất quyền chỉ vì TTL chưa hết. 401/403 phải xóa cache, lỗi mạng phải có thông báo và Thử lại thay vì hiển thị Chưa có thông báo.
- ETag sau truy vấn nhỏ vẫn hữu ích giảm payload; **304 không tự bảo đảm ít DB reads**. Chỉ thêm cache server khi có dấu thay đổi bao phủ cả thông báo/dấu đọc/thông báo hệ thống/phân công legacy và học vụ. Chỉ dựa vào `academic_meta.revision` sẽ bỏ sót nguồn ghi.
- Skeleton 3–5 dòng cho lượt đầu. Có thể giới hạn nội dung dài trong popup, đọc đầy đủ ở trang chi tiết. Đổi các nhãn type kỹ thuật như `ADVISOR_CHANGE_APPROVED`, `COURSE_ASSIGNMENT` thành tiếng Việt; kiểm lại liên kết tới đúng nhóm/lần học.

### 4. Giảm chi phí nền và mạng

- Giữ chu kỳ 180 giây và dừng khi tab ẩn. Không polling nội dung thông báo hoặc tải trước toàn bộ inbox. Có thể dùng bầu tab điều phối qua BroadcastChannel để giảm polling nhiều tab; không phát payload nghiệp vụ qua kênh.
- Giữ hợp đồng `{notifications,chats}` nếu cần tương thích, nhưng tối ưu hai bộ đếm riêng và không để tính chat kéo đọc roster toàn hệ thống cho inbox.
- OPTIONS production hiện không có `Access-Control-Max-Age`. Có thể cache preflight khoảng 600 giây với origin/header kiểm soát; giảm một lượt mạng khi điều kiện phù hợp, không phát sinh DB query và không thay thế kiểm quyền GET.
- Chưa cần thêm Redis/WebSocket/SSE ở bước đầu. Các cơ chế này không thay thế việc sửa SQL và vẫn cần giải quyết đồng bộ/thu hồi quyền.

## Nghiệm thu trước phát hành

- Đối chiếu ba vai trò, người không có thông báo, chỉ thông báo hệ thống, thông báo học vụ và legacy, email trùng/alias, nhiều lớp và nhóm khác kỳ.
- Rút/xóa lần học, đổi GVHD/đồng HD/GVNX, lưu trữ/nháp, đổi email/vai trò: thu hồi quyền đúng ở feed, số đếm, cache và API đánh dấu đọc.
- 200 → 304; hai popup/request cùng lúc; đóng nhanh/mở lại; chuyển tài khoản; hai tab; DB lỗi/401/403; PUT lỗi và retry; read-all cạnh thông báo mới.
- Kiểm thứ tự/cursor khi trùng timestamp, lịch sử >100, số chưa đọc không phụ thuộc limit của trang, không gọi thêm API khi chỉ mở menu.
- Gắn thời gian request/DB/serialize, query count, cache hit/miss và kích thước JSON. Không log danh tính/nội dung. Turso adapter hiện chưa gọi `recordDatabaseQuery`; không lấy log D1 hoặc số đo workerd thay số thực tế Turso.
- Đo p50/p95 trên server đã chạy, tách cold start và preflight; mục tiêu ban đầu giảm ít nhất 90% rows read ở ca học vụ, còn tối đa 2 statement cho GET thông thường gồm xác thực. Giới hạn đọc ổn định khi thêm lịch sử ngoài phạm vi.
- Kiểm riêng header lạnh/hot và vòng mở → đọc → mở lại. Không giảm thời gian popup bằng cách dồn thêm đọc vào nền.

## Tài liệu kỹ thuật đối chiếu

- [SQLite EXPLAIN QUERY PLAN](https://www.sqlite.org/eqp.html): đọc chỉ mục, scan và temporary B-tree; output phục vụ chẩn đoán, không dùng làm hợp đồng runtime.
- [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/): rows read là chi phí đọc, không đồng nhất số dòng trả về; chỉ mục có thể giảm lượng đọc.
- [Access-Control-Max-Age](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Access-Control-Max-Age): cache kết quả preflight, độc lập với cache JSON và kiểm quyền.
