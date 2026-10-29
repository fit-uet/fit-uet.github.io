import { apiFetch as fetch } from '../../../shared/utils/requestCache';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
import { Upload, CheckCircle2, Download, Search, Building2, RefreshCw, Save, Plus, Trash2, X, ChevronDown, FileText, Edit2, Shield, Send } from 'lucide-react';
import { saveAs } from 'file-saver';
import { GOOGLE_API_KEY, API_BASE, saveXlsx, xlsxArrayBuffer, xlsxBlob, getDriveAccessToken, pickDriveFolder, uploadXlsxToDrive, readSpreadsheetRows, clearJsonCache, PaginationControls, PageDescriptionTooltip, formatCourseCode, cleanStudentName } from '../../../shared';

export function CompanyRegistry({ token }: { token: string }) {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState<any[]>([]);
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [markingSentKey, setMarkingSentKey] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState('');
  const [override, setOverride] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedCompanyKeys, setSelectedCompanyKeys] = useState<string[]>([]);
  const [mailMergeOpen, setMailMergeOpen] = useState(false);
  const [mailMergeScope, setMailMergeScope] = useState<'filtered' | 'page' | 'selected' | 'unsent'>('filtered');
  const [mailMergeSending, setMailMergeSending] = useState(false);
  const [mailMergeUseGmail, setMailMergeUseGmail] = useState(true);
  const [mailMergeCc, setMailMergeCc] = useState('');
  const [mailMergeReplyDeadline, setMailMergeReplyDeadline] = useState('');
  const defaultMailMergeSubject = 'Danh sách sinh viên đăng ký thực tập - {{company_name}}';
  const defaultMailMergeBody = `Kính gửi Quý Công ty,

Khoa Công nghệ thông tin - Trường Đại học Công nghệ, Đại học Quốc gia Hà Nội trân trọng gửi tới Quý Công ty danh sách sinh viên đăng ký thực tập đã được Khoa rà soát trong đợt triển khai thực tập năm học hiện tại.

Thông tin tổng hợp:
- Doanh nghiệp/Nơi tiếp nhận: {{company_name}}
- Số sinh viên trong danh sách gửi Quý Công ty: {{approved_student_count}}
- Email liên hệ đang ghi nhận: {{contact_email}}
{{reply_deadline_line}}
{{applicants_drive_link_line}}

{{applicant_list_text}}

Kính đề nghị Quý Công ty xem xét hồ sơ, liên hệ sinh viên để phỏng vấn/trao đổi nếu cần và phản hồi kết quả tiếp nhận cho Khoa để phối hợp quản lý học phần thực tập.

Trân trọng,
Khoa Công nghệ thông tin
Trường Đại học Công nghệ, ĐHQGHN`;
  const [mailMergeSubject, setMailMergeSubject] = useState(defaultMailMergeSubject);
  const [mailMergeBody, setMailMergeBody] = useState(defaultMailMergeBody);
  const [openCompanyActionKey, setOpenCompanyActionKey] = useState<string | null>(null);
  const pageSize = 20;

  const [showAddForm, setShowAddForm] = useState(false);
  const [newCompany, setNewCompany] = useState({ name: '', slots: '', contact_email: '', address: '', phone: '', contact_name: '', recruitment_link: '' });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editCompany, setEditCompany] = useState({ name: '', slots: '5', contact_email: '', address: '', phone: '', contact_name: '', recruitment_link: '' });

  const fetchCompanies = async () => {
    clearJsonCache('companies');
    setLoading(true);
    try {
      const [companyRes, regRes] = await Promise.all([
        fetch(`${API_BASE}/api/admin/companies`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/api/admin/registrations`, { headers: { Authorization: `Bearer ${token}` } })
      ]);
      const companyData = await companyRes.json();
      const regData = await regRes.json();
      setCompanies(Array.isArray(companyData) ? companyData : []);
      setRegistrations(Array.isArray(regData) ? regData : []);
    } catch (e) {
      alert('Lỗi lấy danh sách công ty');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCompanies(); }, [token]);

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const filteredAndSorted = useMemo(() => {
    let result = [...companies];
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      result = result.filter(c =>
        c.name?.toLowerCase().includes(lower) ||
        c.address?.toLowerCase().includes(lower) ||
        c.contact_email?.toLowerCase().includes(lower) ||
        c.contact_name?.toLowerCase().includes(lower) ||
        c.contacts?.toLowerCase().includes(lower)
      );
    }
    if (sortConfig) {
      result.sort((a, b) => {
        let aVal = a[sortConfig.key] ?? '';
        let bVal = b[sortConfig.key] ?? '';
        if (['slots', 'applicant_count', 'approved_applicant_count', 'sent_count', 'remaining_slots'].includes(sortConfig.key)) {
          aVal = Number(aVal) || 0; bVal = Number(bVal) || 0;
        }
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return result;
  }, [companies, searchTerm, sortConfig]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, sortConfig, companies.length]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedCompanies = filteredAndSorted.slice((safeCurrentPage - 1) * pageSize, safeCurrentPage * pageSize);

  const getCompanyRegistrations = (company: any) => registrations.filter((r: any) => {
    if (company.record_type === 'other') {
      return (r.other_company_name || '').trim().toLowerCase() === (company.name || '').trim().toLowerCase();
    }
    return Number(r.company_id) === Number(company.id) ||
      (r.other_company_name || '').trim().toLowerCase() === (company.name || '').trim().toLowerCase();
  });

  const extractEmails = (value: string) => Array.from(new Set((value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []));
  const companyActionKey = (company: any) => company.company_key || String(company.id || company.name);
  const selectedCompanyKeySet = useMemo(() => new Set(selectedCompanyKeys), [selectedCompanyKeys]);
  const selectedPageCompanyKeys = paginatedCompanies.map(companyActionKey);
  const selectedPageCount = selectedPageCompanyKeys.filter(key => selectedCompanyKeySet.has(key)).length;
  const isPageSelected = selectedPageCompanyKeys.length > 0 && selectedPageCount === selectedPageCompanyKeys.length;
  const toggleCompanySelection = (company: any, checked: boolean) => {
    const key = companyActionKey(company);
    setSelectedCompanyKeys(prev => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return Array.from(next);
    });
  };
  const toggleCurrentPageSelection = (checked: boolean) => {
    setSelectedCompanyKeys(prev => {
      const next = new Set(prev);
      selectedPageCompanyKeys.forEach(key => checked ? next.add(key) : next.delete(key));
      return Array.from(next);
    });
  };
  const openSelectedMailMerge = () => {
    if (selectedCompanyKeys.length === 0) return alert('Vui lòng chọn ít nhất một công ty.');
    setMailMergeScope('selected');
    setMailMergeOpen(true);
  };
  const isOfficialBusinessCompany = (company: any) =>
    company.record_type !== 'other' && !['Công ty khác', 'Trường Đại học Công nghệ'].includes(company.name || '');

  const approvedRegistrationsForCompany = (company: any) =>
    getCompanyRegistrations(company).filter((r: any) => r.status === 'approved');

  const companyRecipientEmails = (company: any) =>
    company.record_type === 'other'
      ? extractEmails(company.contacts || '')
      : extractEmails([company.contact_email, company.contacts].filter(Boolean).join(' '));
  const mailMergeCcEmails = () => extractEmails(mailMergeCc);

  const buildApplicantListText = (data: any[], maxRows = 30) => {
    const rows = data.slice(0, maxRows).map((row: any, idx: number) =>
      `${idx + 1}. ${row.student_id || ''} - ${row.student_name || ''} - ${row.class_name || ''} - ${row.course_code || ''} - ${row.phone || ''} - ${row.personal_email || ''}${row.note ? ` - Ghi chú: ${row.note}` : ''}`
    );
    if (data.length > maxRows) rows.push(`\n(Danh sách đầy đủ có ${data.length} sinh viên. Vui lòng đính kèm file XLSX đã xuất từ hệ thống nếu cần.)`);
    return rows.join('\n');
  };

  const renderCompanyTemplate = (template: string, company: any, data: any[]) => {
    const emails = companyRecipientEmails(company);
    const deadlineDisplay = mailMergeReplyDeadline
      ? new Date(`${mailMergeReplyDeadline}T00:00:00+07:00`).toLocaleDateString('vi-VN')
      : '';
    const replacements: Record<string, string> = {
      company_name: company.name || '',
      contact_name: company.contact_name || 'Quý Công ty',
      contact_email: emails[0] || '',
      student_count: String(getCompanyRegistrations(company).length),
      approved_student_count: String(data.length),
      reply_deadline: deadlineDisplay,
      reply_deadline_line: deadlineDisplay ? `- Thời hạn Khoa mong nhận phản hồi: ${deadlineDisplay}` : '',
      applicants_drive_link: company.applicants_drive_link || '',
      applicants_drive_link_line: company.applicants_drive_link ? `- Link danh sách sinh viên: ${company.applicants_drive_link}` : '',
      applicant_list_text: company.applicants_drive_link ? '' : buildApplicantListText(data),
    };
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => replacements[key] ?? '');
  };

  const mailMergeSourceCompanies = useMemo(() => {
    const source = mailMergeScope === 'page'
      ? paginatedCompanies
      : mailMergeScope === 'selected'
        ? companies.filter(company => selectedCompanyKeySet.has(companyActionKey(company)))
        : filteredAndSorted;
    const withApproved = source.filter(company => isOfficialBusinessCompany(company) && approvedRegistrationsForCompany(company).length > 0);
    if (mailMergeScope === 'unsent') {
      return withApproved.filter(company => approvedRegistrationsForCompany(company).some((reg: any) => !reg.sent_to_company_at));
    }
    return withApproved;
  }, [mailMergeScope, paginatedCompanies, filteredAndSorted, companies, selectedCompanyKeySet, registrations]);

  const mailMergeItems = useMemo(() => mailMergeSourceCompanies.map(company => {
    const data = approvedRegistrationsForCompany(company);
    const emails = companyRecipientEmails(company);
    return {
      company,
      data,
      emails,
      subject: renderCompanyTemplate(mailMergeSubject, company, data),
      body: renderCompanyTemplate(mailMergeBody, company, data),
      registrationIds: data.map((row: any) => Number(row.registration_id)).filter(Boolean),
    };
  }), [mailMergeSourceCompanies, mailMergeSubject, mailMergeBody, mailMergeReplyDeadline]);

  const openMailMergeComposer = (item: any) => {
    if (!item.emails.length) return;
    const bodyForUrl = item.body.length > 6500
      ? `${item.body.slice(0, 6200)}\n\n(Nội dung bị rút gọn do giới hạn URL. Vui lòng đính kèm/xuất file XLSX từ hệ thống nếu cần danh sách đầy đủ.)`
      : item.body;
    const url = mailMergeUseGmail
      ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(item.emails.join(','))}&cc=${encodeURIComponent(mailMergeCcEmails().join(','))}&su=${encodeURIComponent(item.subject)}&body=${encodeURIComponent(bodyForUrl)}`
      : `mailto:${encodeURIComponent(item.emails.join(','))}?cc=${encodeURIComponent(mailMergeCcEmails().join(','))}&subject=${encodeURIComponent(item.subject)}&body=${encodeURIComponent(bodyForUrl)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const saveApplicantsDriveLink = async (company: any, link: string) => {
    const res = await fetch(`${API_BASE}/api/admin/companies/${company.id}/applicants-drive-link`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ applicants_drive_link: link })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Không lưu được link Drive cho ${company.name}.`);
  };

  const createDriveLinkForCompany = async (accessToken: string, folderId: string, company: any, data: any[]) => {
    const { headers, rows } = companyApplicantsXlsxData(company, data);
    const safeName = (company.name || 'cong_ty').replace(/[^a-z0-9]+/gi, '_');
    const file = await xlsxBlob(headers, rows, 'Đăng ký');
    const link = await uploadXlsxToDrive(accessToken, folderId, `dang_ky_${safeName}.xlsx`, file);
    await saveApplicantsDriveLink(company, link);
    return link;
  };

  const createDriveLinksForMailMerge = async () => {
    const items = mailMergeItems.filter(item => item.data.length > 0 && item.company.id);
    if (items.length === 0) return alert('Không có doanh nghiệp chính thức nào có đăng ký đã duyệt để tạo link.');
    if (!GOOGLE_API_KEY) return alert('Chưa cấu hình VITE_GOOGLE_API_KEY nên hệ thống chưa tạo được link Google Drive.');
    if (!confirm(`Tạo lại link Google Drive cho ${items.length} doanh nghiệp? Nếu đã có link cũ, hệ thống sẽ lưu link mới thay thế trong DB.`)) return;
    setMailMergeSending(true);
    try {
      const accessToken = await getDriveAccessToken();
      const folder = await pickDriveFolder(accessToken);
      for (const item of items) {
        await createDriveLinkForCompany(accessToken, folder.id, item.company, item.data);
      }
      await fetchCompanies();
      alert(`Đã tạo và lưu link Drive cho ${items.length} doanh nghiệp trong thư mục "${folder.name}".`);
    } catch (e: any) {
      alert(e?.message || 'Không tạo được link Drive.');
    } finally {
      setMailMergeSending(false);
    }
  };

  const createDriveLinksForFilteredOfficial = async () => {
    const hasSelectedCompanies = selectedCompanyKeys.length > 0;
    const sourceCompanies = hasSelectedCompanies
      ? companies.filter(company => selectedCompanyKeySet.has(companyActionKey(company)))
      : filteredAndSorted;
    const items = sourceCompanies
      .filter(company => isOfficialBusinessCompany(company))
      .map(company => ({ company, data: approvedRegistrationsForCompany(company) }))
      .filter(item => item.data.length > 0 && item.company.id);
    if (items.length === 0) return alert(hasSelectedCompanies
      ? 'Không có doanh nghiệp chính thức nào trong danh sách đã chọn có đăng ký đã duyệt.'
      : 'Không có doanh nghiệp chính thức nào trong danh sách đang lọc có đăng ký đã duyệt.');
    if (!GOOGLE_API_KEY) return alert('Chưa cấu hình VITE_GOOGLE_API_KEY nên hệ thống chưa tạo được link Google Drive.');
    if (!confirm(`Tạo lại link Google Drive cho ${items.length} doanh nghiệp chính thức ${hasSelectedCompanies ? 'đã chọn' : 'trong danh sách đang lọc'}? Link mới sẽ được lưu thay thế link cũ trong DB.`)) return;
    setMailMergeSending(true);
    try {
      const accessToken = await getDriveAccessToken();
      const folder = await pickDriveFolder(accessToken);
      for (const item of items) {
        await createDriveLinkForCompany(accessToken, folder.id, item.company, item.data);
      }
      await fetchCompanies();
      alert(`Đã tạo và lưu link Drive cho ${items.length} doanh nghiệp trong thư mục "${folder.name}".`);
    } catch (e: any) {
      alert(e?.message || 'Không tạo được link Drive.');
    } finally {
      setMailMergeSending(false);
    }
  };

  const sendBrevoMailMergeItem = async (item: any) => {
    if (!isOfficialBusinessCompany(item.company)) return alert('Chỉ gửi email thật cho doanh nghiệp chính thức.');
    if (!item.emails.length) return alert('Doanh nghiệp này chưa có email liên hệ.');
    if (!confirm(`Gửi email thật qua Brevo tới ${item.company.name}?`)) return;
    setMailMergeSending(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/companies/send-applicants-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          company_name: item.company.name,
          recipient_email: item.emails[0],
          cc_emails: mailMergeCcEmails(),
          subject: item.subject,
          body: item.body,
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.error || 'Gửi email thật thất bại.');
      await fetchCompanies();
      alert(`Đã gửi email thật cho ${item.company.name}.`);
    } catch (e: any) {
      alert(e?.message || 'Gửi email thật thất bại.');
    } finally {
      setMailMergeSending(false);
    }
  };

  const sendAllBrevoMailMerge = async () => {
    const sendable = mailMergeItems.filter(item => item.emails.length > 0 && item.data.length > 0 && isOfficialBusinessCompany(item.company));
    if (sendable.length === 0) return alert('Không có doanh nghiệp chính thức nào đủ điều kiện gửi Brevo.');
    if (!confirm(`Gửi email thật qua Brevo cho ${sendable.length} doanh nghiệp? Các lỗi quota/cấu hình sẽ dừng tiến trình và hiển thị thông báo.`)) return;
    setMailMergeSending(true);
    try {
      let sent = 0;
      for (const item of sendable) {
        const res = await fetch(`${API_BASE}/api/admin/companies/send-applicants-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            company_name: item.company.name,
            recipient_email: item.emails[0],
            cc_emails: mailMergeCcEmails(),
            subject: item.subject,
            body: item.body,
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`${item.company.name}: ${data.error || 'Gửi email thật thất bại.'}`);
        sent++;
      }
      await fetchCompanies();
      alert(`Đã gửi email thật cho ${sent} doanh nghiệp.`);
    } catch (e: any) {
      alert(e?.message || 'Gửi email thật thất bại.');
    } finally {
      setMailMergeSending(false);
    }
  };

  const markMailMergeSent = async (items: any[]) => {
    const registrationIds = Array.from(new Set(items.flatMap(item => item.registrationIds))).filter(Boolean);
    if (registrationIds.length === 0) return;
    const res = await fetch(`${API_BASE}/api/admin/registrations/mark-sent`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ registration_ids: registrationIds, note: 'Mail merge thủ công' })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Đánh dấu đã gửi DN thất bại.');
  };

  const openAllMailMerge = async () => {
    const sendable = mailMergeItems.filter(item => item.emails.length > 0 && item.data.length > 0);
    const missingEmail = mailMergeItems.length - sendable.length;
    if (sendable.length === 0) return alert('Không có công ty nào đủ điều kiện gửi mail merge.');
    if (!confirm(`Mở ${sendable.length} email đã merge${missingEmail ? ` (${missingEmail} công ty thiếu email sẽ bỏ qua)` : ''}? Trình duyệt có thể hỏi quyền mở nhiều cửa sổ.`)) return;
    setMailMergeSending(true);
    try {
      sendable.forEach(item => openMailMergeComposer(item));
      if (confirm('Sau khi mở email, đánh dấu các đăng ký tương ứng là Đã gửi DN?')) {
        await markMailMergeSent(sendable);
        await fetchCompanies();
      }
    } catch (e: any) {
      alert(e?.message || 'Mail merge thất bại.');
    } finally {
      setMailMergeSending(false);
    }
  };

  const exportMailMergeZip = async () => {
    const items = mailMergeItems.filter(item => item.data.length > 0);
    if (items.length === 0) return alert('Không có dữ liệu để xuất.');
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    await Promise.all(items.map(async item => {
      const { headers, rows } = companyApplicantsXlsxData(item.company, item.data);
      const safeName = (item.company.name || 'cong_ty').replace(/[^a-z0-9]+/gi, '_');
      zip.file(`dang_ky_${safeName}.xlsx`, await xlsxArrayBuffer(headers, rows, 'Đăng ký'));
    }));
    const blob = await zip.generateAsync({ type: 'blob' });
    saveAs(blob, 'mail_merge_danh_sach_theo_cong_ty.zip');
  };

  const exportXlsx = async () => {
    const headers = ['STT', 'Loại', 'Tên doanh nghiệp', 'Chỉ tiêu', 'Ứng viên', 'Đã duyệt', 'Đã gửi DN', 'Link Drive', 'Email liên hệ', 'Người liên hệ', 'SĐT', 'Địa chỉ'];
    const rows = filteredAndSorted.map((c, idx) => [
      idx + 1,
      c.record_type === 'other' ? 'Tự liên hệ' : 'Danh sách chính thức',
      c.name,
      c.record_type === 'other' ? '' : c.slots,
      c.applicant_count ?? 0,
      c.approved_applicant_count ?? 0,
      c.sent_count ? `${c.sent_count}${c.last_sent_at ? ` (${new Date(c.last_sent_at).toLocaleString('vi-VN')})` : ''}` : '',
      c.applicants_drive_link || '',
      c.contact_email || extractEmails(c.contacts || '').join('; '),
      c.contact_name || '',
      c.phone || '',
      c.address || ''
    ]);
    await saveXlsx('danh_sach_cong_ty.xlsx', headers, rows, 'Công ty');
  };

  const exportApplicantsForCompany = async (company: any) => {
    const data = getCompanyRegistrations(company);
    if (data.length === 0) return alert('Công ty này chưa có đăng ký.');
    const headers = ['STT', 'Mã SV', 'Họ và tên', 'Ngày sinh', 'SĐT', 'Email cá nhân', 'Lớp KH', 'Mã môn học', 'Ghi chú', 'Trạng thái', 'Đã gửi DN', 'Thời gian đăng ký'];
    const rows = data.map((r, idx) => [
      idx + 1,
      r.student_id || '',
      cleanStudentName(r.student_name, r.student_id),
      r.dob || '',
      r.phone || '',
      r.personal_email || '',
      r.class_name || '',
      formatCourseCode(r.course_code),
      r.note || '',
      r.status === 'approved' ? 'Đã duyệt' : r.status === 'rejected' ? 'Từ chối' : 'Chờ duyệt',
      r.sent_to_company_at ? new Date(r.sent_to_company_at).toLocaleString('vi-VN') : '',
      r.created_at ? new Date(r.created_at).toLocaleString('vi-VN') : ''
    ]);
    const safeName = (company.name || 'cong_ty').replace(/[^a-z0-9]+/gi, '_');
    await saveXlsx(`dang_ky_${safeName}.xlsx`, headers, rows, 'Đăng ký');
  };

  const companyApplicantsXlsxData = (company: any, data: any[]) => {
    const headers = ['STT', 'Mã SV', 'Họ và tên', 'Ngày sinh', 'SĐT', 'Email cá nhân', 'Lớp KH', 'Mã môn học', 'Ghi chú'];
    const rows = data.map((r, idx) => [
      idx + 1,
      r.student_id || '',
      cleanStudentName(r.student_name, r.student_id),
      r.dob || '',
      r.phone || '',
      r.personal_email || '',
      r.class_name || '',
      formatCourseCode(r.course_code),
      r.note || '',
    ]);
    return { headers, rows };
  };

  const markCompanySent = async (company: any) => {
    const approvedCount = Number(company.approved_applicant_count || 0);
    if (approvedCount === 0) return alert('Công ty này chưa có đăng ký đã duyệt để đánh dấu gửi.');
    if (!confirm(`Đánh dấu ${approvedCount} đăng ký đã duyệt của "${company.name}" là đã gửi đến doanh nghiệp?`)) return;
    setMarkingSentKey(company.company_key || String(company.id || company.name));
    try {
      const payload = company.record_type === 'other'
        ? { other_company_name: company.name }
        : { company_name: company.name };
      const res = await fetch(`${API_BASE}/api/admin/registrations/mark-sent`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Cập nhật trạng thái gửi thất bại.');
      fetchCompanies();
    } catch (e) {
      alert('Lỗi kết nối khi cập nhật trạng thái gửi.');
    } finally {
      setMarkingSentKey(null);
    }
  };

  const composeCompanyEmail = async (company: any) => {
    if (!isOfficialBusinessCompany(company)) return alert('Chỉ soạn/gửi email doanh nghiệp cho doanh nghiệp chính thức.');
    const emails = company.record_type === 'other' ? extractEmails(company.contacts || '') : extractEmails(company.contact_email || '');
    if (emails.length === 0) return alert('Chưa có email liên hệ cho công ty này. Vui lòng xuất danh sách và gửi thủ công.');
    const data = getCompanyRegistrations(company).filter((r: any) => r.status === 'approved');
    const approvedCount = Number(company.approved_applicant_count || 0);
    if (approvedCount === 0 || data.length === 0) return alert('Công ty này chưa có đăng ký đã duyệt để gửi.');
    const safeName = (company.name || 'cong_ty').replace(/[^a-z0-9]+/gi, '_');
    let driveLink = '';
    if (GOOGLE_API_KEY) {
      const uploadToDrive = confirm('Tạo file XLSX trên Google Drive và chèn link vào email?\n\nChọn OK để chọn thư mục Drive.\nChọn Cancel để chỉ soạn email, bạn có thể tự đính kèm file XLSX.');
      if (uploadToDrive) {
        setMarkingSentKey(company.company_key || String(company.id || company.name));
        try {
          const accessToken = await getDriveAccessToken();
          const folder = await pickDriveFolder(accessToken);
          const { headers, rows } = companyApplicantsXlsxData(company, data);
          const file = await xlsxBlob(headers, rows, 'Đăng ký');
          driveLink = await uploadXlsxToDrive(accessToken, folder.id, `dang_ky_${safeName}.xlsx`, file);
          if (company.id) await saveApplicantsDriveLink(company, driveLink);
          alert(`Đã tạo file trong thư mục "${folder.name}" và bật quyền xem bằng link.`);
        } catch (e: any) {
          alert(e?.message || 'Không tạo được file Google Drive. Email sẽ được soạn không kèm link.');
        } finally {
          setMarkingSentKey(null);
        }
      }
    } else if (!company.applicants_drive_link) {
      alert('Chưa cấu hình VITE_GOOGLE_API_KEY nên hệ thống chưa mở được Google Drive Picker. Email sẽ được soạn sẵn; vui lòng tự đính kèm file XLSX hoặc link Drive.');
    }
    const subject = `Danh sách sinh viên đăng ký thực tập - ${company.name}`;
    driveLink = driveLink || company.applicants_drive_link || '';
    const fullList = data.map((row: any, idx: number) =>
      `${idx + 1}. ${row.student_id || ''} - ${row.student_name || ''} - ${row.class_name || ''} - ${row.course_code || ''} - ${row.phone || ''} - ${row.personal_email || ''}${row.note ? ` - Ghi chú: ${row.note}` : ''}`
    ).join('\n');
    const listForUrl = driveLink ? '' : fullList.length > 4500
      ? `${data.slice(0, 25).map((row: any, idx: number) => `${idx + 1}. ${row.student_id || ''} - ${row.student_name || ''} - ${row.class_name || ''} - ${row.course_code || ''}`).join('\n')}\n\n(Danh sách đầy đủ có ${data.length} sinh viên. Vui lòng đính kèm file XLSX đã xuất từ hệ thống hoặc link Google Drive.)`
      : fullList;
    const body = [
      `Kính gửi Quý Công ty ${company.name},`,
      '',
      'Khoa Công nghệ thông tin - Trường Đại học Công nghệ, Đại học Quốc gia Hà Nội trân trọng gửi tới Quý Công ty danh sách sinh viên đăng ký thực tập đã được Khoa rà soát.',
      '',
      `Số sinh viên trong danh sách: ${data.length}.`,
      driveLink ? `Link danh sách sinh viên: ${driveLink}` : '',
      driveLink ? 'Kính đề nghị Quý Công ty xem xét hồ sơ, liên hệ sinh viên để phỏng vấn/trao đổi nếu cần, và phản hồi kết quả tiếp nhận cho Khoa.' : '',
      listForUrl,
      '',
      'Trân trọng,',
      'Khoa Công nghệ thông tin',
      'Trường Đại học Công nghệ, ĐHQGHN',
    ].filter((line, idx, arr) => line !== '' || arr[idx - 1] !== '').join('\n');
    const useGmail = confirm('Mở Gmail để soạn thư?\n\nChọn OK: mở Gmail trên trình duyệt.\nChọn Cancel: mở ứng dụng Mail mặc định.');
    const url = useGmail
      ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(emails[0])}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
      : `mailto:${encodeURIComponent(emails[0])}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleFileUpload = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMessage(`Đang đọc file "${file.name}"...`);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    try {
      const rows = await readSpreadsheetRows(file);
      const imported: { name: string; slots?: number; contact_email?: string; address?: string; phone?: string; contact_name?: string }[] = [];

      for (let i = 0; i < rows.length; i++) {
        const parts = rows[i];
        if (!parts.some(Boolean)) continue;

        // Skip header
        if (i === 0 && (parts[0].toLowerCase() === 'stt' || parts[0].toLowerCase() === 'tên doanh nghiệp' || parts[0].toLowerCase() === 'tên')) continue;

        const isNumeric = (s: string) => /^\d+$/.test(s);
        let name = '';
        let slots = 5;

        if (parts.length >= 3 && isNumeric(parts[0])) {
          // STT, Tên, Chỉ tiêu, ...
          name = parts[1];
          if (parts[2] && isNumeric(parts[2])) slots = parseInt(parts[2]);
        } else if (parts.length >= 1 && !isNumeric(parts[0])) {
          name = parts[0];
          if (parts[1] && isNumeric(parts[1])) slots = parseInt(parts[1]);
        }

        if (name) imported.push({ name, slots });
      }

      if (imported.length === 0) {
        alert('Không tìm thấy dữ liệu hợp lệ trong file');
        return;
      }

      setImportMessage(`Đang import ${imported.length} doanh nghiệp lên hệ thống...`);
      const res = await fetch(`${API_BASE}/api/admin/companies/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ companies: imported, override })
      });
      if (res.ok) {
        alert('Import thành công!');
        fetchCompanies();
      } else {
        const err = await res.json();
        alert('Lỗi: ' + err.error);
      }
    } catch (e) {
      alert('Lỗi import');
    } finally {
      setImporting(false);
      setImportMessage('');
      e.target.value = '';
    }
  };

  const handleAdd = async () => {
    if (!newCompany.name.trim()) return alert('Vui lòng nhập tên công ty');
    try {
      const res = await fetch(`${API_BASE}/api/admin/companies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(newCompany)
      });
      if (res.ok) {
        setNewCompany({ name: '', slots: '', contact_email: '', address: '', phone: '', contact_name: '', recruitment_link: '' });
        setShowAddForm(false);
        fetchCompanies();
      } else {
        const err = await res.json();
        alert('Lỗi: ' + err.error);
      }
    } catch (e) {
      alert('Lỗi thêm công ty');
    }
  };

  const handleUpdate = async (id: number) => {
    if (!editCompany.name.trim()) return alert('Vui lòng nhập tên công ty');
    try {
      const res = await fetch(`${API_BASE}/api/admin/companies/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(editCompany)
      });
      if (res.ok) {
        setEditingId(null);
        fetchCompanies();
      } else {
        const err = await res.json();
        alert('Lỗi: ' + err.error);
      }
    } catch (e) {
      alert('Lỗi cập nhật');
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Bạn có chắc muốn xóa "${name}"? Toàn bộ đăng ký liên quan sẽ bị xóa.`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/companies/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) fetchCompanies();
      else alert('Xóa thất bại');
    } catch (e) {
      alert('Lỗi xóa');
    }
  };

  const SortIcon = ({ col }: { col: string }) => (
    <span className="ml-1 text-xs">{sortConfig?.key === col ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</span>
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <button
            onClick={() => navigate('/admin')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-slate-600 bg-white border border-black/[0.08] shadow-xs hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer mb-3"
          >
            &larr; Quay lại Quản trị
          </button>
          <h2 className="text-2xl font-bold text-[#0f172a] flex items-center gap-2">
            <Building2 className="text-[#034ea1]" size={24} /> Quản lý Công ty
            <PageDescriptionTooltip description="Danh sách công ty đã đăng ký trên hệ thống thực tập." />
          </h2>
        </div>
      </div>

      {/* Toolbar & Search */}
      <div className="bg-white border border-black/[0.08] rounded-2xl shadow-xs p-3.5 flex flex-col xl:flex-row gap-2.5 items-stretch xl:items-center justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
          <input
            type="text"
            placeholder="Tìm theo tên, địa chỉ, email..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-[#e2e8f0] rounded-xl text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all shadow-xs text-[#0f172a]"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none bg-[#f8fafc] border border-[#e2e8f0] rounded-xl px-3 py-2">
            <input type="checkbox" checked={override} disabled={importing} onChange={e => setOverride(e.target.checked)} className="rounded border-slate-300 text-[#034ea1] focus:ring-[#034ea1] w-4 h-4 disabled:opacity-60 cursor-pointer" />
            Ghi đè
          </label>
          <label className={`px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer border border-black/[0.08] hover:bg-[#f8fafc] bg-white text-[#0f172a] active:scale-[0.98] ${importing ? 'cursor-wait pointer-events-none' : ''}`}>
            {importing ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />} {importing ? 'Đang import...' : 'Import XLSX'}
            <input type="file" accept=".xlsx,.xls,.csv" disabled={importing} className="hidden" onChange={handleFileUpload} onClick={(e) => { (e.target as any).value = null }} />
          </label>
          <button
            onClick={() => navigate('/admin/approved-companies')}
            className="bg-[#e8f1fb] hover:bg-[#d9ecff] text-[#034ea1] px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer active:scale-[0.98]"
          >
            <Shield size={14} /> Công ty thẩm định
          </button>
          <button
            onClick={() => setMailMergeOpen(true)}
            className="bg-white hover:bg-[#f8fafc] text-[#0f172a] border border-black/[0.08] px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer active:scale-[0.98]"
          >
            <Send size={14} /> Mail merge
          </button>
          {selectedCompanyKeys.length > 0 && (
            <button
              onClick={openSelectedMailMerge}
              className="bg-[#f5f3ff] hover:bg-[#ede9fe] text-[#6d28d9] px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer active:scale-[0.98]"
              title="Tạo mail merge cho các công ty đang được chọn"
            >
              <Send size={14} /> Mail merge đã chọn ({selectedCompanyKeys.length})
            </button>
          )}
          <button
            onClick={createDriveLinksForFilteredOfficial}
            disabled={mailMergeSending}
            className="bg-white hover:bg-[#f8fafc] text-[#0f172a] border border-black/[0.08] px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60 disabled:cursor-wait cursor-pointer active:scale-[0.98]"
          >
            {mailMergeSending ? <RefreshCw size={14} className="animate-spin" /> : <FileText size={14} />} {selectedCompanyKeys.length > 0 ? 'Tạo link Drive đã chọn' : 'Tạo link Drive'}
          </button>
          <button
            onClick={exportXlsx}
            disabled={importing}
            className="bg-[#034ea1] hover:bg-[#023a7a] text-white px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer active:scale-[0.98]"
          >
            <Download size={14} /> Xuất XLSX
          </button>
        </div>
      </div>

      {selectedCompanyKeys.length > 0 && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-150 rounded-2xl p-4 shadow-sm text-xs text-blue-800">
          <span>Đã chọn: <strong>{selectedCompanyKeys.length}</strong> công ty.</span>
          <button type="button" onClick={() => toggleCurrentPageSelection(!isPageSelected)} className="font-bold text-blue-600 hover:underline">
            {isPageSelected ? 'Bỏ chọn trang' : 'Chọn trang'}
          </button>
          <button type="button" onClick={() => setSelectedCompanyKeys([])} className="font-bold text-slate-500 hover:underline ml-2">
            Xóa chọn
          </button>
        </div>
      )}

      {importing && (
        <div aria-live="polite" className="mb-6 flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <RefreshCw size={18} className="animate-spin shrink-0" />
          <span>{importMessage || 'Hệ thống đang import dữ liệu, vui lòng đợi...'}</span>
        </div>
      )}

      {mailMergeOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 p-3 sm:p-4 overflow-y-auto">
          <div className="mx-auto my-3 sm:my-6 w-full max-w-6xl rounded-2xl bg-white border border-slate-200 shadow-2xl flex flex-col max-h-[calc(100vh-1.5rem)] sm:max-h-[calc(100vh-3rem)]">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 shrink-0">
              <div>
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Send size={18} className="text-indigo-600" /> Mail merge doanh nghiệp
                  <PageDescriptionTooltip description="Tạo email riêng cho từng công ty có sinh viên đã duyệt. Hệ thống mở Gmail/Mail để admin gửi thủ công." />
                </h3>
              </div>
              <button onClick={() => setMailMergeOpen(false)} disabled={mailMergeSending} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-60">
                <X size={20} />
              </button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-0 min-h-0 flex-1 overflow-hidden">
              <div className="lg:col-span-2 border-r border-slate-200 p-5 overflow-y-auto min-h-0">
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Phạm vi công ty</label>
                    <select value={mailMergeScope} onChange={e => setMailMergeScope(e.target.value as any)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500">
                      <option value="filtered">Toàn bộ danh sách đang lọc</option>
                      <option value="page">Trang hiện tại</option>
                      <option value="selected">Công ty đã chọn ({selectedCompanyKeys.length})</option>
                      <option value="unsent">Đang lọc và chưa gửi DN</option>
                    </select>
                    {mailMergeScope === 'selected' && selectedCompanyKeys.length === 0 && (
                      <p className="mt-1 text-[11px] text-amber-600">Chưa chọn công ty nào trong bảng Quản lý công ty.</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Cách mở email</label>
                    <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-sm">
                      <button type="button" onClick={() => setMailMergeUseGmail(true)} className={`px-3 py-2 ${mailMergeUseGmail ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>Gmail</button>
                      <button type="button" onClick={() => setMailMergeUseGmail(false)} className={`px-3 py-2 ${!mailMergeUseGmail ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>Mail app</button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">CC email</label>
                    <input
                      value={mailMergeCc}
                      onChange={e => setMailMergeCc(e.target.value)}
                      placeholder="vd: fit@vnu.edu.vn; admin@vnu.edu.vn"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                    <p className="mt-1 text-[11px] text-slate-500">Có thể nhập nhiều email, phân tách bằng dấu phẩy, chấm phẩy hoặc khoảng trắng.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Hạn phản hồi</label>
                    <input type="date" value={mailMergeReplyDeadline} onChange={e => setMailMergeReplyDeadline(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Tiêu đề</label>
                    <input value={mailMergeSubject} onChange={e => setMailMergeSubject(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <label className="block text-xs font-semibold text-slate-600">Nội dung</label>
                      <button
                        type="button"
                        onClick={() => {
                          setMailMergeSubject(defaultMailMergeSubject);
                          setMailMergeBody(defaultMailMergeBody);
                        }}
                        className="text-xs font-semibold text-indigo-600 hover:underline"
                      >
                        Khôi phục mẫu
                      </button>
                    </div>
                    <textarea value={mailMergeBody} onChange={e => setMailMergeBody(e.target.value)} rows={12} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    Biến hỗ trợ: <code>{'{{company_name}}'}</code>, <code>{'{{contact_name}}'}</code>, <code>{'{{contact_email}}'}</code>, <code>{'{{student_count}}'}</code>, <code>{'{{approved_student_count}}'}</code>, <code>{'{{reply_deadline}}'}</code>, <code>{'{{reply_deadline_line}}'}</code>, <code>{'{{applicants_drive_link}}'}</code>, <code>{'{{applicants_drive_link_line}}'}</code>, <code>{'{{applicant_list_text}}'}</code>.
                  </div>
                </div>
              </div>
              <div className="lg:col-span-3 flex flex-col min-h-0 overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 shrink-0">
                  <div className="text-sm text-slate-600">
                    Sẵn sàng gửi: <strong>{mailMergeItems.filter(item => item.emails.length > 0 && item.data.length > 0).length}</strong> / <strong>{mailMergeItems.length}</strong> công ty
                  </div>
                  <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
                    <button onClick={createDriveLinksForMailMerge} disabled={mailMergeSending || mailMergeItems.length === 0} className="inline-flex items-center justify-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-60 disabled:cursor-not-allowed">
                      {mailMergeSending ? <RefreshCw size={16} className="animate-spin" /> : <FileText size={16} />} Tạo link Drive
                    </button>
                    <button onClick={exportMailMergeZip} disabled={mailMergeItems.length === 0} className="inline-flex items-center justify-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm font-semibold text-green-700 hover:bg-green-100 disabled:opacity-60 disabled:cursor-not-allowed">
                      <Download size={16} /> Xuất ZIP XLSX
                    </button>
                    <button onClick={sendAllBrevoMailMerge} disabled={mailMergeSending || mailMergeItems.length === 0} className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 disabled:cursor-not-allowed">
                      {mailMergeSending ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />} Gửi Brevo
                    </button>
                    <button onClick={openAllMailMerge} disabled={mailMergeSending || mailMergeItems.length === 0} className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed">
                      {mailMergeSending ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
                      Mở tất cả email
                    </button>
                  </div>
                </div>
                <div className="overflow-y-auto p-5 space-y-3 min-h-0 flex-1">
                  {mailMergeItems.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">Không có công ty nào có đăng ký đã duyệt trong phạm vi hiện tại.</div>
                  ) : mailMergeItems.map(item => (
                    <div key={item.company.company_key || item.company.id || item.company.name} className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-slate-900">{item.company.name}</div>
                          <div className="text-xs text-slate-500 mt-1">
                            {item.data.length} sinh viên đã duyệt · {item.emails.length ? item.emails[0] : 'Thiếu email liên hệ'}
                            {item.company.applicants_drive_link && <> · <a href={item.company.applicants_drive_link} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline">Link Drive</a></>}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <button onClick={() => exportApplicantsForCompany(item.company)} className="rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100">XLSX</button>
                          <button onClick={() => openMailMergeComposer(item)} disabled={item.emails.length === 0} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed">Soạn</button>
                          <button onClick={() => sendBrevoMailMergeItem(item)} disabled={item.emails.length === 0 || mailMergeSending} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed">Brevo</button>
                        </div>
                      </div>
                      <div className="mt-3 rounded-lg bg-slate-50 border border-slate-100 p-3">
                        <div className="text-xs font-semibold text-slate-500 mb-1">Preview</div>
                        <div className="text-sm font-semibold text-slate-800">{item.subject}</div>
                        <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-xs text-slate-600 font-sans">{item.body}</pre>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add company form */}
      {!showAddForm ? (
        <div className="mb-6">
          <button
            onClick={() => setShowAddForm(true)}
            className="bg-[#034ea1] hover:bg-[#023a7a] text-white px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 shadow-xs cursor-pointer active:scale-[0.98]"
          >
            <Plus size={15} /> Thêm Công ty
          </button>
        </div>
      ) : (
        <div className="mb-6 bg-white border border-black/[0.08] rounded-2xl p-5 space-y-3.5 shadow-xs">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-[#0f172a] flex items-center gap-2">
              <Plus size={16} className="text-[#034ea1]" /> Thêm công ty mới
            </h3>
            <button onClick={() => setShowAddForm(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input placeholder="Tên doanh nghiệp *" value={newCompany.name} onChange={e => setNewCompany({ ...newCompany, name: e.target.value })} className="border border-[#e2e8f0] rounded-xl px-3.5 py-2 text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all shadow-xs" />
            <input type="number" min="1" placeholder="Chỉ tiêu tiếp nhận" value={newCompany.slots} onChange={e => setNewCompany({ ...newCompany, slots: e.target.value })} className="border border-[#e2e8f0] rounded-xl px-3.5 py-2 text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all shadow-xs" />
            <input placeholder="Email liên hệ" value={newCompany.contact_email} onChange={e => setNewCompany({ ...newCompany, contact_email: e.target.value })} className="border border-[#e2e8f0] rounded-xl px-3.5 py-2 text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all shadow-xs" />
            <input placeholder="Người liên hệ" value={newCompany.contact_name} onChange={e => setNewCompany({ ...newCompany, contact_name: e.target.value })} className="border border-[#e2e8f0] rounded-xl px-3.5 py-2 text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all shadow-xs" />
            <input placeholder="Số điện thoại" value={newCompany.phone} onChange={e => setNewCompany({ ...newCompany, phone: e.target.value })} className="border border-[#e2e8f0] rounded-xl px-3.5 py-2 text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all shadow-xs" />
            <input placeholder="Địa chỉ" value={newCompany.address} onChange={e => setNewCompany({ ...newCompany, address: e.target.value })} className="border border-[#e2e8f0] rounded-xl px-3.5 py-2 text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all shadow-xs" />
          </div>
          <input placeholder="Link tuyển dụng" value={newCompany.recruitment_link} onChange={e => setNewCompany({ ...newCompany, recruitment_link: e.target.value })} className="w-full border border-[#e2e8f0] rounded-xl px-3.5 py-2 text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all shadow-xs" />
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button onClick={() => setShowAddForm(false)} className="bg-white hover:bg-[#f8fafc] text-[#0f172a] border border-black/[0.08] px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xs transition-all active:scale-[0.98] cursor-pointer">Hủy</button>
            <button onClick={handleAdd} className="bg-[#034ea1] hover:bg-[#023a7a] text-white px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 shadow-xs cursor-pointer active:scale-[0.98]">
              <Plus size={15} /> Lưu công ty
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-black/[0.08] rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs text-slate-600">
            <thead className="bg-[#f9f9fb] text-slate-700 font-semibold border-b border-slate-100 text-[10px] tracking-wider uppercase select-none">
              <tr>
                <th className="p-3 font-semibold w-10">
                  <input
                    type="checkbox"
                    checked={isPageSelected}
                    disabled={paginatedCompanies.length === 0}
                    onChange={e => toggleCurrentPageSelection(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-40"
                    title="Chọn/bỏ chọn công ty trong trang hiện tại"
                  />
                </th>
                <th className="p-3 font-semibold w-12">STT</th>
                <th className="p-3 font-semibold cursor-pointer hover:bg-slate-100" onClick={() => handleSort('name')}>Tên doanh nghiệp<SortIcon col="name" /></th>
                <th className="p-3 font-semibold">Loại</th>
                <th className="p-3 font-semibold text-center cursor-pointer hover:bg-slate-100 w-20" onClick={() => handleSort('slots')}>Chỉ tiêu<SortIcon col="slots" /></th>
                <th className="p-3 font-semibold text-center cursor-pointer hover:bg-slate-100 w-20" onClick={() => handleSort('applicant_count')}>ƯV<SortIcon col="applicant_count" /></th>
                <th className="p-3 font-semibold text-center cursor-pointer hover:bg-slate-100 w-24" onClick={() => handleSort('approved_applicant_count')}>Đã duyệt<SortIcon col="approved_applicant_count" /></th>
                <th className="p-3 font-semibold cursor-pointer hover:bg-slate-100" onClick={() => handleSort('last_sent_at')}>Gửi DN<SortIcon col="last_sent_at" /></th>
                <th className="p-3 font-semibold">Link Drive</th>
                <th className="p-3 font-semibold cursor-pointer hover:bg-slate-100" onClick={() => handleSort('contact_email')}>Email<SortIcon col="contact_email" /></th>
                <th className="p-3 font-semibold">Người LH</th>
                <th className="p-3 font-semibold">SĐT</th>
                <th className="p-3 font-semibold cursor-pointer hover:bg-slate-100" onClick={() => handleSort('address')}>Địa chỉ<SortIcon col="address" /></th>
                <th className="p-3 font-semibold text-right w-44">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedCompanies.map((c, idx) => (
                <tr key={c.company_key || c.id || `${c.record_type}-${c.name}`} className="hover:bg-slate-50/50 transition-colors text-xs">
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selectedCompanyKeySet.has(companyActionKey(c))}
                      onChange={e => toggleCompanySelection(c, e.target.checked)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      title="Chọn công ty"
                    />
                  </td>
                  <td className="p-3 text-slate-500">{(safeCurrentPage - 1) * pageSize + idx + 1}</td>
                  {editingId === c.id && c.record_type !== 'other' ? (
                    <>
                      <td className="p-3"><input autoFocus value={editCompany.name} onChange={e => setEditCompany({ ...editCompany, name: e.target.value })} className="w-full border border-orange-200 rounded-xl px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-orange-100 focus:border-orange-500 outline-none transition-all bg-white font-semibold text-slate-800" /></td>
                      <td className="p-3"><span className="bg-slate-100 text-slate-600 px-2 py-1 rounded-full font-semibold">Chính thức</span></td>
                      <td className="p-3"><input type="number" value={editCompany.slots} onChange={e => setEditCompany({ ...editCompany, slots: e.target.value })} className="w-16 border border-orange-200 rounded-xl px-2.5 py-1.5 text-xs text-center focus:ring-2 focus:ring-orange-100 focus:border-orange-500 outline-none transition-all bg-white font-semibold text-slate-800 animate-none" /></td>
                      <td className="p-3 text-center text-slate-500">{c.applicant_count ?? 0}</td>
                      <td className="p-3 text-center text-slate-500">{c.approved_applicant_count ?? 0}</td>
                      <td className="p-3 text-slate-500">{c.last_sent_at ? new Date(c.last_sent_at).toLocaleString('vi-VN') : 'Chưa gửi'}</td>
                      <td className="p-3 text-slate-400">—</td>
                      <td className="p-3"><input value={editCompany.contact_email} onChange={e => setEditCompany({ ...editCompany, contact_email: e.target.value })} className="w-full border border-orange-200 rounded-xl px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-orange-100 focus:border-orange-500 outline-none transition-all bg-white font-semibold text-slate-800" /></td>
                      <td className="p-3"><input value={editCompany.contact_name} onChange={e => setEditCompany({ ...editCompany, contact_name: e.target.value })} className="w-full border border-orange-200 rounded-xl px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-orange-100 focus:border-orange-500 outline-none transition-all bg-white font-semibold text-slate-800" /></td>
                      <td className="p-3"><input value={editCompany.phone} onChange={e => setEditCompany({ ...editCompany, phone: e.target.value })} className="w-full border border-orange-200 rounded-xl px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-orange-100 focus:border-orange-500 outline-none transition-all bg-white font-semibold text-slate-800" /></td>
                      <td className="p-3"><input value={editCompany.address} onChange={e => setEditCompany({ ...editCompany, address: e.target.value })} className="w-full border border-orange-200 rounded-xl px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-orange-100 focus:border-orange-500 outline-none transition-all bg-white font-semibold text-slate-800" /></td>
                      <td className="p-3 text-right flex items-center justify-end gap-1">
                        <button onClick={() => handleUpdate(c.id)} className="text-green-600 hover:bg-green-50 p-2 rounded-xl transition-colors cursor-pointer" title="Lưu"><Save size={16} /></button>
                        <button onClick={() => setEditingId(null)} className="text-slate-400 hover:bg-slate-100 p-2 rounded-xl transition-colors cursor-pointer" title="Hủy"><X size={16} /></button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="p-3 text-slate-800 font-medium">
                        {c.name}
                        {c.record_type === 'other' && <div className="text-[11px] text-slate-500 font-normal mt-1">Từ đăng ký “Công ty khác”</div>}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded-full font-semibold ${c.record_type === 'other' ? 'bg-blue-50 text-blue-700 border border-blue-100' : 'bg-slate-100 text-slate-600'}`}>
                          {c.record_type === 'other' ? 'Tự liên hệ' : 'Chính thức'}
                        </span>
                      </td>
                      <td className="p-3 text-center">{c.record_type === 'other' ? '—' : c.slots}</td>
                      <td className="p-3 text-center">{c.applicant_count ?? 0}</td>
                      <td className="p-3 text-center">{c.approved_applicant_count ?? 0}</td>
                      <td className="p-3 text-slate-600 whitespace-nowrap">
                        {c.last_sent_at ? (
                          <span className="text-emerald-700 font-semibold">{new Date(c.last_sent_at).toLocaleString('vi-VN')}</span>
                        ) : (
                          <span className="text-slate-300">Chưa gửi</span>
                        )}
                        {Number(c.sent_count || 0) > 0 && <div className="text-[11px] text-slate-400">{c.sent_count} đăng ký</div>}
                      </td>
                      <td className="p-3 text-slate-600">
                        {c.applicants_drive_link ? <a href={c.applicants_drive_link} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline">Mở link</a> : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="p-3 text-slate-600">{c.contact_email ? <a href={`mailto:${c.contact_email}`} className="text-blue-600 hover:underline">{c.contact_email}</a> : (extractEmails(c.contacts || '').length > 0 ? <span>{extractEmails(c.contacts || '').join(', ')}</span> : <span className="text-slate-300">—</span>)}</td>
                      <td className="p-3 text-slate-600">{c.contact_name || <span className="text-slate-300">—</span>}</td>
                      <td className="p-3 text-slate-600">{c.phone || <span className="text-slate-300">—</span>}</td>
                      <td className="p-3 text-slate-600 max-w-[200px] truncate" title={c.address || c.contacts}>{c.address || c.contacts || <span className="text-slate-300">—</span>}</td>
                      <td className="p-3 text-right">
                        <div className="relative inline-block text-left">
                          <button
                            onClick={() => setOpenCompanyActionKey(openCompanyActionKey === companyActionKey(c) ? null : companyActionKey(c))}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Thao tác <ChevronDown size={13} />
                          </button>
                          {openCompanyActionKey === companyActionKey(c) && (
                            <>
                              <div className="fixed inset-0 z-20" onClick={() => setOpenCompanyActionKey(null)} />
                              <div className="absolute right-0 z-30 mt-2 w-56 rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                                <button onClick={() => { exportApplicantsForCompany(c); setOpenCompanyActionKey(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50">
                                  <Download size={14} className="text-green-600" /> Xuất danh sách XLSX
                                </button>
                                {isOfficialBusinessCompany(c) && (
                                  <button onClick={() => { composeCompanyEmail(c); setOpenCompanyActionKey(null); }} disabled={markingSentKey === companyActionKey(c)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                                    <FileText size={14} className="text-indigo-600" /> Tạo link/soạn email
                                  </button>
                                )}
                                <button onClick={() => { markCompanySent(c); setOpenCompanyActionKey(null); }} disabled={markingSentKey === companyActionKey(c)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                                  <CheckCircle2 size={14} className="text-emerald-600" /> Đánh dấu đã gửi
                                </button>
                                {c.record_type !== 'other' && (
                                  <>
                                    <button onClick={() => { setEditingId(c.id); setEditCompany({ name: c.name, slots: String(c.slots), contact_email: c.contact_email || '', address: c.address || '', phone: c.phone || '', contact_name: c.contact_name || '', recruitment_link: c.recruitment_link || '' }); setOpenCompanyActionKey(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50">
                                      <Edit2 size={14} className="text-blue-600" /> Sửa công ty
                                    </button>
                                    <button onClick={() => { handleDelete(c.id, c.name); setOpenCompanyActionKey(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-red-600 hover:bg-red-50">
                                      <Trash2 size={14} /> Xóa công ty
                                    </button>
                                  </>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PaginationControls
          total={filteredAndSorted.length}
          currentPage={currentPage}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          label="công ty"
        />
        {companies.length > 0 && filteredAndSorted.length === 0 && !loading && (
          <div className="text-center py-12 px-4 text-slate-500 text-sm">
            Không tìm thấy công ty phù hợp với bộ lọc hiện tại.
          </div>
        )}
        {companies.length === 0 && !loading && (
          <div className="text-center py-16 px-4">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-100">
              <Building2 size={24} className="text-slate-400" />
            </div>
            <p className="text-slate-500 text-base font-medium">Chưa có dữ liệu công ty.</p>
            <p className="text-slate-400 text-sm mt-1">Vui lòng đồng bộ từ Google Sheet hoặc thêm thủ công.</p>
          </div>
        )}
      </div>
    </div>
  );
}
