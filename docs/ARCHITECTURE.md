# Frontend architecture

The frontend uses a feature-based architecture. Route access is centralized, while each screen lives in the feature that owns its business role.

```text
src/
├── app/
│   └── AppRoutes.tsx          # Route table and route guards
├── auth/
│   └── access.ts              # Role predicates and access policy
├── features/
│   ├── student/pages/         # Student-only screens
│   ├── lecturer/pages/        # Lecturer-only screens
│   ├── admin/pages/           # Administration screens
│   └── shared/pages/          # Screens shared by multiple roles
├── shared/
│   └── index.tsx              # Reusable configuration, utilities and UI helpers
├── App.tsx                    # Authentication and application shell
└── main.tsx                   # Browser entry point
```

## Dependency rules

1. `App.tsx` owns authentication state and the global shell only.
2. `app/AppRoutes.tsx` is the only place that maps URLs to screens and role policies.
3. A role feature may import from `shared`, but it must not import a page from another role.
4. Shared multi-role screens belong in `features/shared`.
5. New screens should be added as one file under the appropriate `pages` directory and exported from that feature's `index.ts`.
6. Authorization must still be enforced by the API. Frontend route guards only control navigation and presentation.

## UI design system (Apple HIG Standard)

The entire application adheres to the **Apple Human Interface Guidelines (HIG)** design philosophy while preserving the signature FIT UET blue header gradient:

- **Comprehensive Design Specification**: Detailed guidelines live in [`UI_DESIGN_SYSTEM.md`](UI_DESIGN_SYSTEM.md).
- **Global Tokens**: Defined in `src/index.css` following Apple System Palette:
  - Canvas: Apple System Gray 6 (`#F5F5F7`).
  - Cards / Surfaces: Pure White (`#FFFFFF`) with 16 px squircle radius (`rounded-2xl`), hairline border (`rgba(0,0,0,0.08)` or `#E5E5EA`), and soft multi-layered ambient shadows.
  - Header: Preserved FIT UET gradient (`linear-gradient(110deg, #064889 0%, #075fc7 62%, #1473e6 100%)`).
  - Typography: San Francisco scale (`-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", sans-serif`) with strict hierarchy from Large Title down to Caption.
- **Zero Redundancy**: Avoid repeating headers, duplicate badges, or redundant sub-toolbars on the same view.
- **Controls & Components**:
  - Buttons use 36-40 px height, 10-12 px squircle radius, and subtle active scale feedback (`active:scale-[0.98]`).
  - Tables use macOS Inset Table styling (subtle header, hairline horizontal dividers, smooth 120ms hover highlight).
  - Floating sheets and modal reviews use single-line headers, blurred backdrops (`backdrop-blur-md`), and edge-to-edge content viewers.
- **Reusable UI primitives**: Live in `src/shared/ui` and are exported through `src/shared/index.tsx`.

The backend remains compatible with both the Node server and Cloudflare Worker entry points; this refactor intentionally does not change API contracts or business behavior.

## Notification delivery flow

The manual notification composer supports two delivery modes:

- `website_and_email` — shown in the UI as **“Hiển thị trên website và gửi email theo quota”** and selected by default.
- `website_only` — shown in the UI as **“Chỉ hiển thị trên website”**.

For `website_and_email`, the backend first persists one notification for every valid recipient so website delivery does not depend on the email provider. It then calculates the remaining daily capacity as `EMAIL_DAILY_SEND_CAP - sent_today` and attempts immediate email delivery in creation order while capacity remains. Notifications beyond that capacity stay `queued` and are eligible for the existing queue processor on a later run or day.

Quota exhaustion is not an error: it must not reject the request or mark overflow notifications as `failed`. A provider rate-limit response also keeps an unsent notification in `queued`; other provider errors use `failed` with diagnostic details. The manual endpoint returns separate `created`, `sent`, `queued`, and `failed` counts so the admin UI can report the outcome accurately.

`EMAIL_BATCH_SIZE` only caps an explicit queue-processing run. `EMAIL_SEND_IMMEDIATE` continues to control automatic business-event notifications and does not disable quota-aware immediate delivery explicitly selected in the manual composer. The Node server and Cloudflare Worker must implement the same state transitions and quota rules.

### Automated Daily Queue Processing Architecture

To eliminate reliance on manual administrator intervention, the notification subsystem incorporates an **autonomous daily queue draining architecture**. Queued emails are automatically dispatched every day as soon as new quota becomes available, without requiring an Admin to log in and press the "Gửi theo quota" button.

#### 1. Core Architectural Shift: From Manual Trigger to Autonomous Scheduler

- **Previous Model (Manual Dependency):**
  When a batch notification exceeded the remaining quota for the day, excess notifications were held in `status = 'queued'`. To send these remaining emails on subsequent days, an administrator was required to remember to visit `/admin/notifications` and manually click **“Gửi theo quota”** or **“Gửi hàng đợi”**.
- **Autonomous Architecture (Zero-touch Daily Drain):**
  The system automates queue processing on a daily schedule. Each morning (at reset of the provider's daily counter), an automated scheduler triggers queue processing to drain up to the maximum remaining capacity for that day (`EMAIL_DAILY_SEND_CAP - sent_today`).

#### 2. Triggering & Scheduling Mechanisms

1. **Scheduled Daily Cron Runner:**
   - A scheduled GitHub Actions workflow (`.github/workflows/process-queued-emails.yml`) or Cloudflare Worker scheduled trigger executes daily at **00:05 UTC (07:05 AM ICT)**.
   - It issues an authenticated HTTP `POST` request to `/api/cron/process-email-queue` with the secret header `X-Cron-Secret: <CRON_SECRET>`.
2. **Server / Worker Cron Handler (`POST /api/cron/process-email-queue`):**
   - Validates `CRON_SECRET` to prevent unauthorized execution.
   - Invokes the shared queue draining routine (`sendQueuedNotificationBatch({ ignoreBatchSize: true })`) to consume up to the full remaining daily quota.
3. **Role of the Admin UI Button (“Gửi theo quota”):**
   - The manual button in the Admin dashboard remains active, but its role changes from a **mandatory operational requirement** to an **on-demand manual override**. Administrators may still trigger immediate batch sending if they want to force delivery ahead of the scheduled run.

#### 3. Execution Lifecycle & Invariants

```mermaid
flowchart TD
    A["Daily Cron Schedule (07:05 ICT)"] --> B["POST /api/cron/process-email-queue"]
    C["Admin Click 'Gửi theo quota' (Manual Override)"] --> D["POST /api/admin/notifications/send-queued"]
  
    B --> E["Verify Authentication (CRON_SECRET / Admin Session)"]
    D --> E
  
    E --> F["Compute remaining_quota = max(0, EMAIL_DAILY_SEND_CAP - sent_today)"]
    F --> G{"remaining_quota > 0 and queued_count > 0?"}
  
    G -- "No" --> H["Finish gracefully (logged: skipped / quota exhausted)"]
    G -- "Yes" --> I["Fetch queued rows (ORDER BY created_at ASC, id ASC LIMIT remaining_quota)"]
  
    I --> J["Dispatch emails via Provider (Brevo / Resend) in batches"]
    J --> K{"Provider response"}
  
    K -- "Success (2xx)" --> L["Update status = 'sent', sent_at = NOW()"]
    K -- "Rate limit / Quota reached (429)" --> M["Stop dispatching; keep status = 'queued' for next day"]
    K -- "Permanent error (4xx/5xx)" --> N["Update status = 'failed', record error details"]
  
    L --> O["Return summary counters (sent, failed, remaining_today)"]
    M --> O
    N --> O
```

#### 4. Design Invariants & Guarantees

- **No Over-Quota Sending:** The scheduler strictly respects `EMAIL_DAILY_SEND_CAP` (e.g. 250 for Brevo Free tier), ensuring external email provider daily limits (300/day) are never breached.
- **Strict FIFO Preservation:** Older queued notifications (`created_at ASC, id ASC`) are always prioritized and sent first.
- **Resilience to Restarts:** Queue state is persisted in the database (`status = 'queued'`); server restarts or deployment cycles never lose pending notifications.
- **Web Notification Independence:** All recipients always see the notification on the website immediately upon creation, irrespective of whether email delivery occurs immediately or across several days via the daily queue processor.

### Event Notification Recipient & Admin Exclusion Architecture

To protect both system resources and administrative workflows, the system enforces a strict separation between **push-based notifications** (individual transactional receipts sent to end users) and **pull-based monitoring** (centralized administration dashboards).

#### Recipient Routing Matrix

| Event Type                      | Intended Recipient     | Admin Web Notification |     Admin Email     | Rationale / Delivery Mode                                                                                             |
| :------------------------------ | :--------------------- | :--------------------: | :------------------: | :-------------------------------------------------------------------------------------------------------------------- |
| `registration_status_changed` | Student                |         ❌ No         |        ❌ No        | Push to student regarding registration result                                                                         |
| `final_confirmation_open`     | Student                |         ❌ No         |        ❌ No        | Push broadcast/targeted reminder to students                                                                          |
| `final_internship_confirmed`  | Student                |         ❌ No         |        ❌ No        | Confirmation receipt for student                                                                                      |
| `advisor_assigned`            | Student                |         ❌ No         |        ❌ No        | Push assignment details to student                                                                                    |
| `final_report_due_reminder`   | Student                |         ❌ No         |        ❌ No        | Deadline reminder targeted to students                                                                                |
| `final_report_status_changed` | Student                |         ❌ No         |        ❌ No        | Review feedback pushed to student                                                                                     |
| **`grade_submitted`**   | **Student Only** |  ❌**Excluded**  | ❌**Excluded** | **Push receipt strictly to the graded student. Admin excluded to prevent inbox flooding and quota exhaustion.** |

#### Design Rationale for Admin Exclusion on Grade Submission (`grade_submitted`)

1. **Inbox Spam Prevention (Tránh tràn hộp thư Quản trị):**
   - Each course run includes 600–900 students. When dozens of advisors evaluate students and submit grades across several grading days, pushing transactional notifications to `ADMIN_EMAIL` floods the admin inbox with hundreds of repetitive alert emails (e.g., `GVHD đã nộp điểm thực tập: <Mã SV> <Họ tên>`), drowning out critical operational correspondence.
2. **Quota Preservation (Bảo toàn hạn ngạch email nhà mạng):**
   - Transactional email providers often operate on tiered quotas (e.g., Brevo Free tier caps sending at 300 emails/day, with `EMAIL_DAILY_SEND_CAP=250`). Multiplying grade notifications by sending duplicate copies to Admin doubles email consumption and causes immediate quota exhaustion, preventing other students from receiving crucial notices.
3. **Pull-based Operational Paradigm (Quản lý tập trung qua Dashboard):**
   - Faculty and Admin manage and audit grade submissions via the dedicated Grade Management Dashboard (`/admin/grades`) and bulk Excel export (`/api/admin/grades/export`), equipped with real-time filters (by class, department, advisor, submission status). Push notifications for each single student grade submission provide no actionable value to Admin and violate clean notification domain boundaries.
4. **Backend Implementation Invariant:**
   - Both Express (`server.ts`) and Cloudflare Worker (`src/worker.ts`) handling of `POST /api/lecturer/grades/:userId/submit` must only dispatch `createNotification`/`notify` targeted to `recipient_email: student.email` and `recipient_user_id: student.id`. No notification record with `recipient_email = ADMIN_EMAIL` or Admin role shall ever be generated for `grade_submitted`.

## Unconfirmed Internship Students Export Architecture

### Business Purpose & Operational Context

During the internship campaign lifecycle, students submit up to 5 preferences for internship companies. After interviews are conducted, the Faculty opens the confirmation phase (`final_internships`) where each admitted student must attest and confirm one official location.

Administrators need to rapidly audit and extract the exact cohort of students who have registered on the system but **have not yet confirmed their official internship location**. This list enables the Faculty to:

1. Contact unconfirmed students via email/phone before deadlines expire.
2. Identify students who failed company interviews to transition them into school-based internships (`Trường Đại học Công nghệ`) with assigned faculty advisors.
3. Prepare final allocation reports for academic boards.

### UI Integration

- Located inside the **"Xuất dữ liệu"** dropdown on the primary Registration Admin screen (`/admin/registrations` / `AdminPanel.tsx`).
- Styled with an amber `UserX` icon and dual-line label:
  - Primary text: **Xuất DS chưa xác nhận (XLSX)**
  - Secondary helper text: **Sinh viên chưa xác nhận nơi thực tập**
- Features a loading spinner state (`RefreshCw`) during generation to prevent duplicate requests.

### Data Contract & Fields

The exported XLSX file (`danh_sach_sinh_vien_chua_xac_nhan_thuc_tap.xlsx`) includes:

- **STT**: Sequential number
- **Mã SV**: Student identification number
- **Họ và tên**: Full student name
- **Ngày sinh**: Date of birth
- **Lớp khóa học**: Academic cohort / class name
- **Mã học phần**: Internship course code
- **Số điện thoại**: Contact phone number
- **Email VNU**: Institutional email
- **Email cá nhân**: Alternate personal email
- **Số NV đã đăng ký**: Number of preferences registered
- **Các nơi đã đăng ký**: Concise summary of all registered companies with preference orders and approval statuses (e.g. `NV1: FPT Software (Đã duyệt); NV2: Viettel (Chờ duyệt)`)
- **Trạng thái xác nhận**: Fixed value `Chưa xác nhận`
- **Ghi chú**: Relevant registration notes

### Hybrid Execution & Resilience

1. **Primary Route**: Requests `GET /api/admin/unconfirmed-internships` (available in both Express `server.ts` and Cloudflare Worker `src/worker.ts`).
2. **Client-side Fallback**: If the server endpoint is momentarily unreachable (e.g. during a deployment restart), the client-side component automatically correlates the in-memory `registrations` state with `GET /api/admin/final-internships` to build and download the complete XLSX file seamlessly.

---

## PDF Review Caching & Report Assessment State Architecture

### 1. Problem Statement & Performance Bottleneck

During the final internship grading phase, faculty advisors review 10–30 student reports in succession. Under the naive implementation:
1. **Redundant Egress & Latency**: Each PDF file ranges from 2 MB to 10 MB. Every time an advisor opened a student's submission, closed the panel, or revisited an already-graded student, the system initiated a full network `fetch` for the binary blob. This caused 1–3s latency per review and wasted network bandwidth.
2. **State Thrashing on Grade Submission**: Tying the PDF loading hook (`useEffect`) to the report status (`localReportStatus`) caused the PDF viewer to tear down, re-fetch over the network, and re-mount whenever the advisor pressed **“Nộp điểm cho Khoa”** or **“Lưu nháp”**.
3. **Ambiguous Status Taxonomy**: Displaying a generic `Đã nộp` badge for all submitted reports failed to distinguish between reports awaiting evaluation and those already completed.

### 2. Status Taxonomy: "Chưa chấm điểm" Paradigm

To provide clear operational cues for faculty advisors, report assessment badges are decoupled from raw database status codes and presented through an action-oriented taxonomy:

| Raw DB Status (`report_status`) | Grade Status (`grade_status`) | Hiển thị Giảng viên (UI Badge) | Màu sắc & Kiểu dáng | Ý nghĩa nghiệp vụ |
| :--- | :--- | :--- | :--- | :--- |
| `NULL` / Chưa có | `missing` / Chưa có | **Chưa nộp** | `bg-rose-50 text-rose-700 border-rose-200` (Cảnh báo đỏ) | Sinh viên chưa nộp báo cáo. |
| **`submitted`** | `draft` hoặc `missing` | **Chưa chấm điểm** | **`bg-rose-50 text-rose-700 border-rose-200` (Cảnh báo đỏ)** | **Sinh viên đã nộp báo cáo, đang chờ GVHD chấm điểm.** |
| **`submitted`** hoặc **`accepted`** | **`submitted`** (hoặc đã có điểm) | **Đã nộp điểm** | `bg-emerald-50 text-emerald-700 border-emerald-200` | GVHD đã hoàn tất nhập và nộp điểm về Khoa. |
| **`needs_revision`** | Bất kỳ | **Cần nộp lại** | `bg-orange-50 text-orange-700 border-orange-200` | GVHD yêu cầu sinh viên chỉnh sửa, bổ sung báo cáo. |

### 3. Multi-Tier Caching Architecture

```mermaid
sequenceDiagram
    autonumber
    participant Advisor as Lecturer UI (ReportReviewPanel)
    participant Cache as Module-level Cache (pdfBlobCache)
    participant API as Backend Server (/api/reports/final/:userId/view)
    participant Storage as Cloud Storage / S3 / Local

    Advisor->>Cache: Request PDF for student userId
    alt Cache Hit (Blob & Object URL already in memory)
        Cache-->>Advisor: Return Object URL immediately (0ms, Instant Render)
    else Cache Miss (First review in session)
        Advisor->>API: GET /view (with Auth & If-None-Match)
        alt 304 Not Modified
            API-->>Advisor: HTTP 304 (Reuse local buffer)
        else 200 OK
            API->>Storage: Stream file bytes with ETag & Cache-Control
            Storage-->>API: Binary stream
            API-->>Advisor: HTTP 200 + Binary Blob
            Advisor->>Advisor: Create Object URL via URL.createObjectURL(blob)
            Advisor->>Cache: Save into pdfBlobCache.set(userId, { blob, url })
        end
    end
    Note over Advisor: Advisor grades & submits -> Form state updates without re-fetching PDF!
```

### 4. Technical Invariants & Guarantees

1. **Singleton Client Memory Cache**:
   - `pdfBlobCache = Map<number, { blob: Blob, url: string, filename?: string, timestamp: number }>` persists throughout the active browser tab session.
   - When closing and re-opening a student's review panel, or toggling between students with keyboard shortcuts (`[` / `]`), rendering is instantaneous (0 ms), without visual flicker or network traffic.
2. **Decoupled Form & Viewer Lifecycles**:
   - The PDF fetch hook strictly depends on `[uid, target.report_filename, token]`.
   - Modifying grading inputs (`progress_score`, `report_score`, `company_score`, `comment`) or changing report status (`accepted`, `needs_revision`) updates form state only and NEVER revokes or re-fetches the PDF.
3. **Backend HTTP Validation (ETag + Cache-Control)**:
   - Endpoint `GET /api/reports/final/:userId/view` includes:
     - `ETag: "<id>-<file_size>-<timestamp>"`
     - `Cache-Control: private, max-age=3600, must-revalidate`
   - Responds with `304 Not Modified` on subsequent browser validations when content has not changed.

### 5. Policy Enforcement: Hoàn thiện 100% điểm & Xử lý Sinh viên Bỏ môn (0 Điểm)

Theo quy chế đào tạo của Khoa CNTT - Trường Đại học Công nghệ (UET), Giảng viên hướng dẫn (GVHD) bắt buộc phải hoàn thiện bảng điểm cho **100% sinh viên được phân công** để Khoa tổng hợp và gửi Phòng Đào tạo chốt học phần.

#### a. Kịch bản sinh viên không nộp báo cáo / bỏ môn
- Khi sinh viên không liên hệ, không nộp báo cáo thực tập: Giảng viên **chủ động cho 0 điểm** (Tiến độ: `0`, Báo cáo: `0`, Doanh nghiệp: `0` $\rightarrow$ Điểm tổng kết: `0.0`) kèm ghi chú rõ lý do (ví dụ: *"Sinh viên không nộp báo cáo thực tập (Bỏ môn)."*).
- Điểm tổng kết luôn được làm tròn chuẩn mực đến 1 chữ số sau phần thập phân (`toFixed(1)`).

#### b. Trải nghiệm người dùng đồng bộ & tôn trọng quyền tự chủ của GVHD (UX Consistency)
1. **Đồng bộ nhãn nút "Xem & Chấm" trên toàn hệ thống**:
   - Cả trên danh sách sinh viên phụ trách (`LecturerHome`) và bảng điểm tổng thể (`LecturerGradeView`), mọi dòng sinh viên (dù đã nộp hay chưa nộp báo cáo) đều hiển thị nhất quán nút **"Xem & Chấm"**.
   - Tránh việc đặt các nhãn rườm rà như *"Chấm điểm (0đ nếu bỏ môn)"* hay các nút *"Gán 0đ"*, giữ giao diện trang nhã, đồng nhất chuẩn Apple / UET ICD.
2. **Quy trình cho điểm tự chủ của GVHD**:
   - GVHD tự quyết định và nhập điểm vào 3 ô điểm (Tiến độ 20%, Báo cáo 20%, Doanh nghiệp 60%) và ghi chú. Khi sinh viên bỏ môn, GVHD chủ động nhập `0` vào các ô điểm và ghi rõ lý do.
   - Không áp đặt các nút "Điền nhanh 0 điểm" gượng ép trên giao diện modal hay bảng tổng thể.

#### c. Tính toàn vẹn dữ liệu Backend (`Data Integrity Invariants`)
- Khi GVHD nộp điểm chính thức cho sinh viên chưa nộp bài:
  - Bảng `grades` ghi nhận đầy đủ điểm 0 và `status = 'submitted'`, đưa tiến độ hoàn thiện của GVHD lên 100%.
  - Bảng `final_reports`: Câu lệnh `UPDATE final_reports SET status = 'accepted'` chỉ thực thi khi sinh viên **thực sự đã nộp file** (`AND object_key IS NOT NULL`). Sinh viên chưa nộp bài sẽ **không bị gán nhầm thành đã chấp nhận**, bảo toàn trung thực lịch sử nộp bài của sinh viên.

---

## GoF Proxy Pattern Architecture: Virtual Proxy & Cache Proxy for Paginated Data

### 1. Problem Statement & Motivation

Đối với các màn hình quản trị dữ liệu quy mô lớn (như Lịch sử thông báo & email `NotificationAdmin` với hàng trăm đến hàng nghìn bản ghi):
1. **Payload Bloat & Initial Latency**: Cách tiếp cận cũ nạp toàn bộ danh sách 500 bản ghi ngay khi mở trang, gây lãng phí băng thông mạng (~500 KB - 1 MB JSON payload) và làm chậm thời gian hiển thị giao diện ban đầu (First Contentful Paint).
2. **Redundant Network Round-trips**: Khi người dùng duyệt trang qua lại giữa trang 1, trang 2 rồi quay lại trang 1, hệ thống không tận dụng được dữ liệu đã nạp, hoặc phải duy trì state cồng kềnh thiếu kiểm soát.
3. **Chuyển trang có độ trễ**: Mỗi lần sang trang mới, người dùng phải chờ đợi mạng phản hồi và nhìn thấy loading spinner.

### 2. Design Pattern Specification (GoF Proxy Pattern)

Hệ thống áp dụng chuẩn mực mẫu thiết kế **GoF Proxy Pattern** kết hợp giữa **Virtual Proxy** (Proxy ảo) và **Cache Proxy** (Proxy bộ đệm):

```mermaid
classDiagram
    class IPaginatedSource~T~ {
        <<interface>>
        +fetchPage(query: PaginatedQuery, forceRefresh?: boolean): Promise~PaginatedResult~T~~
    }

    class RealPaginatedSource~T~ {
        -fetcher: PageFetcher~T~
        +fetchPage(query: PaginatedQuery): Promise~PaginatedResult~T~~
    }

    class PaginatedVirtualProxy~T~ {
        -realSource: IPaginatedSource~T~
        -cache: Map~string, ProxyCacheEntry~T~~
        -pendingRequests: Map~string, Promise~PaginatedResult~T~~~
        -ttlMs: number
        -maxCacheEntries: number
        +buildKey(query: PaginatedQuery): string
        +hasCached(query: PaginatedQuery): boolean
        +getCached(query: PaginatedQuery): PaginatedResult~T~ | null
        +fetchPage(query: PaginatedQuery, forceRefresh?: boolean): Promise~PaginatedResult~T~~
        +prefetch(query: PaginatedQuery): Promise~void~
        +invalidate(): void
        +invalidateMatching(predicate): void
        +getStats(): Object
    }

    class usePaginatedProxy {
        <<React Hook>>
        +items: T[]
        +total: number
        +page: number
        +limit: number
        +totalPages: number
        +loading: boolean
        +setPage(newPage): void
        +refresh(): Promise~void~
        +prefetchPage(page): Promise~void~
    }

    IPaginatedSource <|.. RealPaginatedSource : implements
    IPaginatedSource <|.. PaginatedVirtualProxy : implements
    PaginatedVirtualProxy o--> IPaginatedSource : delegates to (RealSubject)
    usePaginatedProxy --> PaginatedVirtualProxy : manages reactive state
```

### 3. Interaction & Prefetching Flow

```mermaid
sequenceDiagram
    autonumber
    participant UI as Admin UI (NotificationAdmin)
    participant Hook as usePaginatedProxy Hook
    participant Proxy as PaginatedVirtualProxy (Virtual & Cache)
    participant Real as RealPaginatedSource (RealSubject)
    participant Server as Backend API (/api/admin/notifications)

    Note over UI,Server: Giai đoạn 1: Khởi tạo Virtual Proxy (Chỉ tải trang 1)
    UI->>Hook: Mount với initialPage = 1, pageSize = 25
    Hook->>Proxy: fetchPage({ page: 1, limit: 25 })
    Proxy->>Real: Cache Miss -> Gọi RealSubject
    Real->>Server: GET /api/admin/notifications?page=1&limit=25
    Server-->>Real: { items: [25 rows], total: 320, page: 1, limit: 25, totalPages: 13 }
    Real-->>Proxy: PaginatedResult
    Proxy->>Proxy: Lưu vào pageCache("p:1_l:25_...")
    Proxy-->>Hook: Trả về kết quả
    Hook-->>UI: Cập nhật state (Hiển thị ngay lập tức)

    Note over Proxy,Server: Giai đoạn 2: Tải trước thông minh (Background Prefetching)
    Hook->>Proxy: prefetch({ page: 2, limit: 25 }) via requestIdleCallback
    Proxy->>Real: Tải ngầm trang 2 (không chặn UI)
    Real->>Server: GET /api/admin/notifications?page=2&limit=25
    Server-->>Real: { items: [25 rows], total: 320, page: 2, ... }
    Real-->>Proxy: Lưu trước vào pageCache("p:2_l:25_...")

    Note over UI,Proxy: Giai đoạn 3: Người dùng bấm "Trang Sau" -> 0ms Latency!
    UI->>Hook: setPage(2)
    Hook->>Proxy: fetchPage({ page: 2, limit: 25 })
    Proxy-->>Hook: Cache Hit! Trả về dữ liệu ngay lập tức (0ms, không nhấp nháy spinner)
    Hook-->>UI: Render trang 2 mượt mà
    Hook->>Proxy: Kích hoạt tiếp prefetch({ page: 3 }) ngầm
```

### 4. Technical Guarantees & Invariants

1. **Virtual Deferred Loading**:
   - Khi vào trang, client chỉ nạp đúng `pageSize = 25` bản ghi đầu tiên thay vì toàn bộ 500 bản ghi.
   - Giảm tải đến **95% kích thước payload ban đầu** (từ ~450 KB xuống còn ~22 KB).
2. **In-Memory Cache Proxy**:
   - Các trang đã duyệt qua được cache trong `Map<string, ProxyCacheEntry<T>>` với TTL (mặc định 3 phút) và LRU eviction.
   - Duyệt lui tới giữa các trang trước/sau phản hồi tức thì với 0ms network latency.
3. **Request Deduplication**:
   - Nếu có nhiều lời gọi trùng query đồng thời (ví dụ người dùng click nhanh hoặc trigger tự động), Proxy tái sử dụng cùng một Promise in-flight, triệt tiêu race conditions.
4. **Autonomous Background Prefetching**:
   - Sử dụng `window.requestIdleCallback` (hoặc microtask timer) để tải trước trang `page + 1` trong thời gian nhàn rỗi của trình duyệt, không gây giật khung hình giao diện.
5. **Safe Cache Invalidation**:
   - Khi thực hiện các tác vụ thay đổi trạng thái (Gửi email hàng đợi, Đổi trạng thái, Xóa thông báo, Tạo thông báo thủ công), Proxy kích hoạt `invalidate()` xoá sạch cache để đảm bảo tính nhất quán dữ liệu 100%.
6. **100% Backward Compatibility**:
   - Endpoint `GET /api/admin/notifications` trên backend hỗ trợ cả 2 chế độ:
     - Nếu có query `page`/`limit`: Trả về chuẩn phân trang `{ items, total, page, limit, totalPages }`.
     - Nếu không có query `page`/`limit`: Trả về mảng truyền thống `rows` (tối đa 500 bản ghi) để đảm bảo không làm gãy các caller cũ hoặc script xuất dữ liệu.

