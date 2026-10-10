import { useNavigate } from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
import { User as UserIcon, Upload, Download, ArrowUpDown, Search, RefreshCw, Save, Plus, Trash2, X, Edit2, Send } from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { API_BASE, saveXlsx, xlsxArrayBuffer, xlsxBlob, getGoogleDriveAccessToken, pickDriveFolder, uploadXlsxToDrive, readSpreadsheetRows, paginationBounds, clearJsonCache, PaginationControls, PageDescriptionTooltip, formatCourseCode, cleanStudentName } from '../../../shared';

export function LecturerRegistry({ token }: { token: string }) {
  const navigate = useNavigate();
  const [lecturers, setLecturers] = useState<any[]>([]);
  const [assignmentRows, setAssignmentRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [override, setOverride] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedLecturerIds, setSelectedLecturerIds] = useState<number[]>([]);
  const [driveBusy, setDriveBusy] = useState(false);
  const [mailMergeOpen, setMailMergeOpen] = useState(false);
  const [mailMergeScope, setMailMergeScope] = useState<'filtered' | 'page' | 'selected'>('filtered');
  const [mailMergeUseGmail, setMailMergeUseGmail] = useState(true);
  const [mailMergeCc, setMailMergeCc] = useState('');
  const [mailMergeReplyDeadline, setMailMergeReplyDeadline] = useState('');
  const [mailMergeSubject, setMailMergeSubject] = useState('Danh sách sinh viên thực tập được phân công hướng dẫn - {{lecturer_name}}');
  const [mailMergeBody, setMailMergeBody] = useState(`Kính gửi {{lecturer_name}},

Khoa Công nghệ Thông tin gửi Thầy/Cô danh sách sinh viên thực tập đã được phân công hướng dẫn.

Số lượng sinh viên: {{student_count}}
{{reply_deadline_line}}
{{students_drive_link_line}}
{{student_list_text}}

Kính mong Thầy/Cô rà soát thông tin và phản hồi lại Khoa nếu cần điều chỉnh.

Trân trọng,
Khoa Công nghệ Thông tin`);
  const [mailMergeSending, setMailMergeSending] = useState(false);
  const pageSize = 25;

  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newWorkUnit, setNewWorkUnit] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editWorkUnit, setEditWorkUnit] = useState('');

  const fetchLecturers = async () => {
    clearJsonCache('lecturers:names');
    try {
      const lecturerRes = await fetch(`${API_BASE}/api/admin/lecturers`, { headers: { Authorization: `Bearer ${token}` } });
      const lecturerData = await lecturerRes.json();
      setLecturers(Array.isArray(lecturerData) ? lecturerData : []);
      try {
        const assignmentRes = await fetch(`${API_BASE}/api/admin/lecturers/student-assignments`, { headers: { Authorization: `Bearer ${token}` } });
        const assignmentData = await assignmentRes.json();
        setAssignmentRows(Array.isArray(assignmentData?.rows) ? assignmentData.rows : []);
      } catch (assignmentError) {
        console.warn('[lecturers] cannot load advisor assignments', assignmentError);
        setAssignmentRows([]);
      }
    } catch (e) {
      alert('Lỗi lấy danh sách giảng viên');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLecturers(); }, [token]);

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };
  const SortIndicator = ({ col }: { col: string }) => (
    <span className="ml-1 inline-flex align-middle text-xs">
      {sortConfig?.key === col ? (sortConfig.direction === 'asc' ? '↑' : '↓') : <ArrowUpDown size={12} className="text-slate-400" />}
    </span>
  );
  const lecturerSortValue = (lecturer: any, key: string) => {
    if (key === 'student_count') return getLecturerStudentRows(lecturer).length;
    if (key === 'students_drive_link') return lecturer.students_drive_link ? 1 : 0;
    return lecturer[key] ?? '';
  };

  const filteredAndSorted = useMemo(() => {
    let result = [...lecturers];
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      result = result.filter(l =>
        l.name?.toLowerCase().includes(lower) ||
        l.email?.toLowerCase().includes(lower) ||
        l.work_unit?.toLowerCase().includes(lower)
      );
    }
    if (sortConfig) {
      result.sort((a, b) => {
        const aVal = lecturerSortValue(a, sortConfig.key);
        const bVal = lecturerSortValue(b, sortConfig.key);
        const direction = sortConfig.direction === 'asc' ? 1 : -1;
        const aNumber = Number(aVal);
        const bNumber = Number(bVal);
        if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && String(aVal).trim() !== '' && String(bVal).trim() !== '') {
          return (aNumber - bNumber) * direction;
        }
        return String(aVal).localeCompare(String(bVal), 'vi', { numeric: true, sensitivity: 'base' }) * direction;
      });
    }
    return result;
  }, [lecturers, searchTerm, sortConfig, assignmentRows]);
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, sortConfig, lecturers.length]);
  const pagination = paginationBounds(filteredAndSorted.length, currentPage, pageSize);
  const paginatedLecturers = filteredAndSorted.slice((pagination.safePage - 1) * pageSize, pagination.safePage * pageSize);
  const selectedLecturerIdSet = useMemo(() => new Set(selectedLecturerIds.map(String)), [selectedLecturerIds]);
  const selectedLecturers = useMemo(
    () => lecturers.filter(l => selectedLecturerIdSet.has(String(l.id))),
    [lecturers, selectedLecturerIdSet]
  );
  const pageLecturerIds = paginatedLecturers.map(l => Number(l.id)).filter(Boolean);
  const allPageSelected = pageLecturerIds.length > 0 && pageLecturerIds.every(id => selectedLecturerIdSet.has(String(id)));

  function parseAssignmentList(value: string) {
    return String(value || '').split(',')
      .map((item: string) => {
        const [id, name, email] = item.split('|');
        return { id: Number(id), name: (name || '').trim(), email: (email || '').trim() };
      })
      .filter(item => Number.isFinite(item.id) && item.id > 0 && item.name);
  }

  function getLecturerStudentRows(lecturer: any) {
    const lecturerId = Number(lecturer?.id);
    const rows: any[] = [];
    assignmentRows.forEach(row => {
      const primary = parseAssignmentList(row.primary_assignments);
      const co = parseAssignmentList(row.co_assignments);
      const primaryRequests = String(row.advisor_request_status || '') === 'rejected' ? [] : parseAssignmentList(row.primary_requests);
      const coRequests = String(row.advisor_request_status || '') === 'rejected' ? [] : parseAssignmentList(row.co_requests);
      const matchedPrimary = primary.some(item => item.id === lecturerId);
      const matchedCo = co.some(item => item.id === lecturerId);
      const matchedPrimaryRequest = primaryRequests.some(item => item.id === lecturerId);
      const matchedCoRequest = coRequests.some(item => item.id === lecturerId);
      if (!matchedPrimary && !matchedCo && !matchedPrimaryRequest && !matchedCoRequest) return;
      const roleParts = [
        matchedPrimary ? 'GVHD chính' : '',
        matchedCo ? 'Đồng hướng dẫn' : '',
        !matchedPrimary && matchedPrimaryRequest ? 'Đăng ký GVHD chính' : '',
        !matchedCo && matchedCoRequest ? 'Đăng ký đồng hướng dẫn' : '',
      ].filter(Boolean);
      const statusParts = [
        matchedPrimary || matchedCo ? 'Đã phân công' : '',
        (!matchedPrimary && matchedPrimaryRequest) || (!matchedCo && matchedCoRequest)
          ? String(row.advisor_request_status || '') === 'approved' ? 'Đăng ký đã duyệt' : 'Đăng ký chờ duyệt'
          : '',
      ].filter(Boolean);
      rows.push({
        ...row,
        lecturer_role: roleParts.join('; '),
        lecturer_assignment_status: statusParts.join('; '),
        primary_names: primary.length ? primary.map(item => item.name).join('; ') : primaryRequests.map(item => item.name).join('; '),
        co_names: co.length ? co.map(item => item.name).join('; ') : coRequests.map(item => item.name).join('; '),
      });
    });
    return rows.sort((a, b) => String(a.student_id || '').localeCompare(String(b.student_id || ''), 'vi', { numeric: true }));
  }

  const lecturerStudentXlsxData = (lecturer: any, rows = getLecturerStudentRows(lecturer)) => {
    const headers = ['STT', 'Mã SV', 'Họ và tên', 'Email', 'Lớp khóa học', 'Học phần', 'Nơi thực tập', 'Vai trò hướng dẫn', 'Trạng thái', 'GVHD chính', 'Đồng hướng dẫn'];
    const data = rows.map((row, idx) => [
      idx + 1,
      row.student_id || '',
      cleanStudentName(row.student_name, row.student_id),
      row.email || '',
      row.class_name || '',
      formatCourseCode(row.course_code),
      row.internship_place || '',
      row.lecturer_role || '',
      row.lecturer_assignment_status || '',
      row.primary_names || '',
      row.co_names || '',
    ]);
    return { headers, rows: data };
  };

  const saveLecturerDriveLink = async (lecturerId: number, link: string) => {
    const res = await fetch(`${API_BASE}/api/admin/lecturers/${lecturerId}/students-drive-link`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ students_drive_link: link }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Không lưu được link Drive cho giảng viên.');
    }
    setLecturers(prev => prev.map(l => Number(l.id) === lecturerId ? { ...l, students_drive_link: link } : l));
  };

  const createDriveLinkForLecturer = async (accessToken: string, folderId: string, lecturer: any) => {
    const students = getLecturerStudentRows(lecturer);
    if (students.length === 0) throw new Error(`${lecturer.name}: chưa có sinh viên được phân công.`);
    const { headers, rows } = lecturerStudentXlsxData(lecturer, students);
    const safeName = (lecturer.name || 'giang_vien').replace(/[^a-z0-9]+/gi, '_');
    const file = xlsxBlob(headers, rows, 'Sinh viên');
    const link = await uploadXlsxToDrive(accessToken, folderId, `sinh_vien_${safeName}.xlsx`, file);
    await saveLecturerDriveLink(Number(lecturer.id), link);
    return link;
  };

  const lecturerMailMergeSource = useMemo(() => {
    if (mailMergeScope === 'selected') return selectedLecturers;
    if (mailMergeScope === 'page') return paginatedLecturers;
    return filteredAndSorted;
  }, [mailMergeScope, selectedLecturers, paginatedLecturers, filteredAndSorted]);

  const extractEmails = (value: string) =>
    String(value || '').split(/[;,]+/).map(item => item.trim()).filter(item => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));

  const mailMergeCcEmails = useMemo(() => extractEmails(mailMergeCc), [mailMergeCc]);

  const buildStudentListText = (students: any[]) => {
    if (!students.length) return '- Chưa có sinh viên được phân công.';
    return students.map((row, idx) => `${idx + 1}. ${row.student_name || ''} (${row.student_id || ''}) - ${row.class_name || ''} - ${row.internship_place || ''}`).join('\n');
  };

  const renderLecturerTemplate = (template: string, lecturer: any, students: any[]) => {
    const driveLink = lecturer.students_drive_link || '';
    const values: Record<string, string> = {
      lecturer_name: lecturer.name || '',
      lecturer_email: lecturer.email || '',
      student_count: String(students.length),
      reply_deadline: mailMergeReplyDeadline || '',
      reply_deadline_line: mailMergeReplyDeadline ? `Hạn phản hồi: ${mailMergeReplyDeadline}` : '',
      students_drive_link: driveLink,
      students_drive_link_line: driveLink ? `Link danh sách sinh viên: ${driveLink}` : '',
      student_list_text: driveLink ? '' : `Danh sách sinh viên:\n${buildStudentListText(students)}`,
    };
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? '');
  };

  const mailMergeItems = useMemo(() => lecturerMailMergeSource
    .map(lecturer => {
      const students = getLecturerStudentRows(lecturer);
      return {
        lecturer,
        students,
        emails: extractEmails(lecturer.email || ''),
        subject: renderLecturerTemplate(mailMergeSubject, lecturer, students),
        body: renderLecturerTemplate(mailMergeBody, lecturer, students),
      };
    })
    .filter(item => item.students.length > 0), [lecturerMailMergeSource, mailMergeSubject, mailMergeBody, mailMergeReplyDeadline, assignmentRows]);

  const openLecturerMailMergeComposer = (item: any) => {
    const to = item.emails.join(',');
    const cc = mailMergeCcEmails.join(',');
    const subject = encodeURIComponent(item.subject);
    const body = encodeURIComponent(item.body);
    if (mailMergeUseGmail) {
      const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}${cc ? `&cc=${encodeURIComponent(cc)}` : ''}&su=${subject}&body=${body}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      const url = `mailto:${encodeURIComponent(to)}?${cc ? `cc=${encodeURIComponent(cc)}&` : ''}subject=${subject}&body=${body}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const createDriveLinksForLecturers = async (scope: 'filtered' | 'page' | 'selected' = mailMergeScope) => {
    const source = scope === 'selected' ? selectedLecturers : scope === 'page' ? paginatedLecturers : filteredAndSorted;
    const targets = source.filter(lecturer => getLecturerStudentRows(lecturer).length > 0);
    if (targets.length === 0) return alert('Không có giảng viên nào có sinh viên để tạo link Drive.');
    try {
      setDriveBusy(true);
      const accessToken = await getGoogleDriveAccessToken();
      const folder = await pickDriveFolder(accessToken);
      let ok = 0;
      for (const lecturer of targets) {
        try {
          await createDriveLinkForLecturer(accessToken, folder.id, lecturer);
          ok += 1;
        } catch (err) {
          console.warn('[lecturer-drive] skip', lecturer.name, err);
        }
      }
      alert(`Đã tạo/cập nhật ${ok}/${targets.length} link Drive trong thư mục "${folder.name}".`);
    } catch (e: any) {
      alert(e.message || 'Không tạo được link Google Drive.');
    } finally {
      setDriveBusy(false);
    }
  };

  const exportLecturerMailMergeZip = async () => {
    if (mailMergeItems.length === 0) return alert('Không có dữ liệu để xuất.');
    const zip = new JSZip();
    mailMergeItems.forEach(item => {
      const { headers, rows } = lecturerStudentXlsxData(item.lecturer, item.students);
      const safeName = (item.lecturer.name || 'giang_vien').replace(/[^a-z0-9]+/gi, '_');
      zip.file(`sinh_vien_${safeName}.xlsx`, xlsxArrayBuffer(headers, rows, 'Sinh viên'));
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    saveAs(blob, 'danh_sach_sinh_vien_theo_giang_vien.zip');
  };

  const openAllLecturerMailMerge = async () => {
    if (mailMergeItems.length === 0) return alert('Không có email nào để soạn.');
    setMailMergeSending(true);
    mailMergeItems.filter(item => item.emails.length > 0).forEach((item, idx) => {
      setTimeout(() => openLecturerMailMergeComposer(item), idx * 350);
    });
    setTimeout(() => setMailMergeSending(false), Math.max(500, mailMergeItems.length * 350));
  };

  const sendBrevoLecturerMailMergeItem = async (item: any) => {
    if (!item.emails.length) return alert('Giảng viên này chưa có email.');
    if (!confirm(`Gửi email thật qua Brevo tới ${item.lecturer.name}?`)) return;
    setMailMergeSending(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/lecturers/send-students-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          lecturer_name: item.lecturer.name,
          recipient_email: item.emails[0],
          cc_emails: mailMergeCcEmails,
          subject: item.subject,
          body: item.body,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.error || 'Gửi email thật thất bại.');
      alert(`Đã gửi email thật cho ${item.lecturer.name}.`);
    } catch (e: any) {
      alert(e?.message || 'Gửi email thật thất bại.');
    } finally {
      setMailMergeSending(false);
    }
  };

  const sendAllBrevoLecturerMailMerge = async () => {
    const sendable = mailMergeItems.filter(item => item.emails.length > 0);
    if (sendable.length === 0) return alert('Không có giảng viên nào đủ điều kiện gửi Brevo.');
    if (!confirm(`Gửi email thật qua Brevo cho ${sendable.length} giảng viên?`)) return;
    setMailMergeSending(true);
    try {
      let sent = 0;
      for (const item of sendable) {
        const res = await fetch(`${API_BASE}/api/admin/lecturers/send-students-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            lecturer_name: item.lecturer.name,
            recipient_email: item.emails[0],
            cc_emails: mailMergeCcEmails,
            subject: item.subject,
            body: item.body,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Gửi email tới ${item.lecturer.name} thất bại.`);
        sent += 1;
      }
      alert(`Đã gửi email thật cho ${sent} giảng viên.`);
    } catch (e: any) {
      alert(e?.message || 'Gửi email thật thất bại.');
    } finally {
      setMailMergeSending(false);
    }
  };

  const toggleLecturerSelection = (id: number) => {
    setSelectedLecturerIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  };

  const togglePageSelection = () => {
    setSelectedLecturerIds(prev => {
      const current = new Set(prev);
      if (allPageSelected) pageLecturerIds.forEach(id => current.delete(id));
      else pageLecturerIds.forEach(id => current.add(id));
      return Array.from(current);
    });
  };

  const exportXlsx = () => {
    const headers = ['STT', 'Họ và tên', 'Email', 'Đơn vị công tác', 'Số sinh viên hướng dẫn', 'Link Drive'];
    const rows = filteredAndSorted.map((l, idx) => [idx + 1, l.name, l.email || '', l.work_unit || '', getLecturerStudentRows(l).length, l.students_drive_link || '']);
    saveXlsx('danh_sach_giang_vien.xlsx', headers, rows, 'Giảng viên');
  };

  const handleFileUpload = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMessage(`Đang đọc file "${file.name}"...`);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    try {
      const rows = await readSpreadsheetRows(file);
      const imported: { name: string; email?: string; work_unit?: string }[] = [];
      const normalizeHeader = (value: string) => String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/\s+/g, ' ');
      const headers = rows[0]?.map(normalizeHeader) || [];
      const nameIndex = headers.findIndex(h => ['ho va ten', 'ten', 'ten giang vien', 'giang vien', 'ho ten'].includes(h));
      const emailIndex = headers.findIndex(h => ['email', 'email vnu', 'thu dien tu'].includes(h));
      const workUnitIndex = headers.findIndex(h => ['don vi cong tac', 'don vi', 'bo mon', 'khoa/bo mon', 'khoa', 'department', 'work unit', 'work_unit'].includes(h));
      const hasHeader = nameIndex >= 0 || emailIndex >= 0 || workUnitIndex >= 0;

      for (let i = 0; i < rows.length; i++) {
        const parts = rows[i];
        if (!parts.some(Boolean)) continue;
        if (hasHeader && i === 0) continue;

        const isNumeric = (s: string) => /^\d+$/.test(s);

        let name = '';
        let email = '';
        let workUnit = '';

        if (hasHeader) {
          name = nameIndex >= 0 ? parts[nameIndex] : '';
          email = emailIndex >= 0 ? parts[emailIndex] : '';
          workUnit = workUnitIndex >= 0 ? parts[workUnitIndex] : '';
        } else if (parts.length >= 4 && isNumeric(parts[0])) {
          // Format A: STT, Tên, Email, Đơn vị công tác
          name = parts[1];
          email = parts[2]?.includes('@') ? parts[2] : '';
          workUnit = parts[3] || (!email ? parts[2] : '');
        } else if (parts.length >= 3 && isNumeric(parts[0])) {
          // Format A: STT, Tên, Email hoặc STT, Tên, Đơn vị công tác
          name = parts[1];
          email = parts[2]?.includes('@') ? parts[2] : '';
          workUnit = parts[2]?.includes('@') ? '' : parts[2];
        } else if (parts.length >= 3 && !isNumeric(parts[0])) {
          // Format B: Tên, Email, Đơn vị công tác
          name = parts[0];
          email = parts[1]?.includes('@') ? parts[1] : '';
          workUnit = parts[2] || (!email ? parts[1] : '');
        } else if (parts.length >= 2 && !isNumeric(parts[0]) && parts[1].includes('@')) {
          // Format B: Tên, Email
          name = parts[0];
          email = parts[1];
        } else if (parts.length >= 2 && !isNumeric(parts[0])) {
          // Format B without email: Tên, Đơn vị công tác
          name = parts[0];
          workUnit = parts[1];
        } else if (parts.length >= 2 && isNumeric(parts[0])) {
          // Format A without email: STT, Tên
          name = parts[1];
        } else if (parts.length === 1) {
          // Format C: Tên only
          name = parts[0];
        }

        if (name) imported.push({ name, email: email || undefined, work_unit: workUnit || undefined });
      }

      if (imported.length === 0) {
        alert('Không tìm thấy dữ liệu hợp lệ trong file');
        return;
      }

      setImportMessage(`Đang import ${imported.length} giảng viên lên hệ thống...`);
      const res = await fetch(`${API_BASE}/api/admin/lecturers/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ lecturers: imported, override })
      });
      if (res.ok) {
        alert('Import thành công!');
        fetchLecturers();
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
    if (!newName.trim()) return alert('Vui lòng nhập tên giảng viên');
    try {
      const res = await fetch(`${API_BASE}/api/admin/lecturers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newName.trim(), email: newEmail.trim() || undefined, work_unit: newWorkUnit.trim() || undefined })
      });
      if (res.ok) {
        setNewName('');
        setNewEmail('');
        setNewWorkUnit('');
        fetchLecturers();
      } else {
        const err = await res.json();
        alert('Lỗi: ' + err.error);
      }
    } catch (e) {
      alert('Lỗi thêm giảng viên');
    }
  };

  const handleUpdate = async (id: number) => {
    if (!editName.trim()) return alert('Vui lòng nhập tên giảng viên');
    try {
      const res = await fetch(`${API_BASE}/api/admin/lecturers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: editName.trim(), email: editEmail.trim() || undefined, work_unit: editWorkUnit.trim() || undefined })
      });
      if (res.ok) {
        setEditingId(null);
        fetchLecturers();
      } else {
        const err = await res.json();
        alert('Lỗi: ' + err.error);
      }
    } catch (e) {
      alert('Lỗi cập nhật');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Bạn có chắc chắn muốn xóa giảng viên này?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/lecturers/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchLecturers();
      } else {
        alert('Xóa thất bại');
      }
    } catch (e) {
      alert('Lỗi xóa');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <button
            onClick={() => navigate('/admin')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-slate-600 bg-white border border-black/[0.08] shadow-xs hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer mb-3"
          >
            &larr; Quay lại Quản trị
          </button>
          <h2 className="text-2xl font-bold text-[#0f172a] flex items-center gap-2">
            <UserIcon className="text-[#034ea1]" size={24} /> Quản lý Giảng viên
            <PageDescriptionTooltip description="Import chỉ cập nhật danh sách giảng viên, không xóa đăng ký hoặc phân công hiện có." />
          </h2>
        </div>
      </div>

      <div className="bg-white border border-black/[0.08] rounded-2xl shadow-xs p-3.5 flex flex-col xl:flex-row gap-2.5 items-stretch xl:items-center justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
          <input
            type="text"
            placeholder="Tìm tên, email, đơn vị..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-[#e2e8f0] rounded-xl text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all shadow-xs text-[#0f172a]"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none bg-[#f8fafc] border border-[#e2e8f0] rounded-xl px-3 py-2">
            <input type="checkbox" checked={override} disabled={importing} onChange={e => setOverride(e.target.checked)} className="rounded border-slate-300 text-[#034ea1] focus:ring-[#034ea1] w-4 h-4 disabled:opacity-60 cursor-pointer" />
            Cập nhật dữ liệu trùng
          </label>
          <label className={`px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer border border-black/[0.08] hover:bg-[#f8fafc] bg-white text-[#0f172a] active:scale-[0.98] ${importing ? 'bg-slate-100 text-slate-400 cursor-wait pointer-events-none' : ''}`}>
            {importing ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />} {importing ? 'Đang import...' : 'Import XLSX'}
            <input type="file" accept=".xlsx,.xls,.csv" disabled={importing} className="hidden" onChange={handleFileUpload} onClick={(e) => { (e.target as any).value = null }} />
          </label>
          <button
            onClick={() => { setMailMergeScope('filtered'); setMailMergeOpen(true); }}
            disabled={importing}
            className="bg-white hover:bg-[#f8fafc] text-[#0f172a] border border-black/[0.08] px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer active:scale-[0.98]"
          >
            <Send size={14} /> Mail merge
          </button>
          {selectedLecturerIds.length > 0 && (
            <button
              onClick={() => { setMailMergeScope('selected'); setMailMergeOpen(true); }}
              disabled={importing}
              className="bg-[#f5f3ff] hover:bg-[#ede9fe] text-[#6d28d9] px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer active:scale-[0.98]"
            >
              <Send size={14} /> Mail merge đã chọn ({selectedLecturerIds.length})
            </button>
          )}
          <button
            onClick={() => createDriveLinksForLecturers(selectedLecturerIds.length ? 'selected' : 'filtered')}
            disabled={importing || driveBusy}
            className="bg-white hover:bg-[#f8fafc] text-[#0f172a] border border-black/[0.08] px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer active:scale-[0.98]"
          >
            {driveBusy ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />} {selectedLecturerIds.length ? 'Tạo link Drive đã chọn' : 'Tạo link Drive'}
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

      {importing && (
        <div aria-live="polite" className="mb-6 flex items-center gap-3 rounded-xl border border-green-200 bg-[#ebf9ee] px-4 py-3 text-sm text-[#1b7f37]">
          <RefreshCw size={18} className="animate-spin shrink-0" />
          <span>{importMessage || 'Hệ thống đang import dữ liệu, vui lòng đợi...'}</span>
        </div>
      )}

      <div className="bg-white border border-black/[0.08] rounded-2xl p-4 flex flex-wrap gap-2.5 items-center shadow-xs">
        <input
          type="text"
          placeholder="Họ và tên giảng viên..."
          value={newName}
          onChange={e => setNewName(e.target.value)}
          className="flex-1 min-w-[180px] max-w-xs border border-[#e2e8f0] rounded-xl px-3.5 py-2 text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all shadow-xs"
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <input
          type="email"
          placeholder="Email (tuỳ chọn)"
          value={newEmail}
          onChange={e => setNewEmail(e.target.value)}
          className="flex-1 min-w-[180px] max-w-xs border border-[#e2e8f0] rounded-xl px-3.5 py-2 text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all shadow-xs"
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <input
          type="text"
          placeholder="Đơn vị công tác (tuỳ chọn)"
          value={newWorkUnit}
          onChange={e => setNewWorkUnit(e.target.value)}
          className="flex-1 min-w-[180px] max-w-xs border border-[#e2e8f0] rounded-xl px-3.5 py-2 text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all shadow-xs"
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <button
          onClick={handleAdd}
          className="bg-[#034ea1] hover:bg-[#023a7a] text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-xs transition-all flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer active:scale-[0.98]"
        >
          <Plus size={15} /> Thêm Giảng viên
        </button>
      </div>

      <div className="bg-white border border-black/[0.08] rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs text-slate-600">
            <thead className="bg-[#f9f9fb] text-slate-700 font-semibold border-b border-slate-100 text-[10px] tracking-wider uppercase select-none">
              <tr>
                <th className="p-4 w-10">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={togglePageSelection}
                    className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer w-4 h-4"
                    title="Chọn tất cả giảng viên trong trang hiện tại"
                  />
                </th>
                <th className="p-4 font-semibold whitespace-nowrap w-16">STT</th>
                <th className="p-4 font-semibold whitespace-nowrap cursor-pointer hover:bg-slate-100" onClick={() => handleSort('name')}>
                  Họ và tên <SortIndicator col="name" />
                </th>
                <th className="p-4 font-semibold whitespace-nowrap cursor-pointer hover:bg-slate-100" onClick={() => handleSort('email')}>
                  Email <SortIndicator col="email" />
                </th>
                <th className="p-4 font-semibold whitespace-nowrap cursor-pointer hover:bg-slate-100" onClick={() => handleSort('work_unit')}>
                  Đơn vị công tác <SortIndicator col="work_unit" />
                </th>
                <th className="p-4 font-semibold whitespace-nowrap cursor-pointer hover:bg-slate-100" onClick={() => handleSort('student_count')}>
                  Sinh viên <SortIndicator col="student_count" />
                </th>
                <th className="p-4 font-semibold whitespace-nowrap cursor-pointer hover:bg-slate-100" onClick={() => handleSort('students_drive_link')}>
                  Link Drive <SortIndicator col="students_drive_link" />
                </th>
                <th className="p-4 font-semibold whitespace-nowrap text-right w-52">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAndSorted.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-10 text-center text-slate-500">
                    {lecturers.length === 0 ? 'Chưa có dữ liệu giảng viên.' : 'Không có giảng viên phù hợp.'}
                  </td>
                </tr>
              ) : paginatedLecturers.map((l, idx) => {
                const studentCount = getLecturerStudentRows(l).length;
                return (
                  <tr key={l.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-4 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={selectedLecturerIdSet.has(String(l.id))}
                        onChange={() => toggleLecturerSelection(Number(l.id))}
                        className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                        aria-label={`Chọn ${l.name}`}
                      />
                    </td>
                    <td className="p-4 text-sm text-slate-600">{(pagination.safePage - 1) * pageSize + idx + 1}</td>
                    <td className="p-4 text-sm text-slate-800 font-medium">
                      {editingId === l.id ? (
                        <input
                          autoFocus
                          type="text"
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          className="w-full border border-teal-500 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-500"
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleUpdate(l.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                        />
                      ) : l.name}
                    </td>
                    <td className="p-4 text-sm">
                      {editingId === l.id ? (
                        <input
                          type="email"
                          value={editEmail}
                          onChange={e => setEditEmail(e.target.value)}
                          placeholder="Email..."
                          className="w-full border border-teal-500 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-500"
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleUpdate(l.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                        />
                      ) : (
                        l.email
                          ? <a href={`mailto:${l.email}`} className="text-blue-600 hover:underline">{l.email}</a>
                          : <span className="text-slate-400 italic text-xs">Chưa có</span>
                      )}
                    </td>
                    <td className="p-4 text-sm">
                      {editingId === l.id ? (
                        <input
                          type="text"
                          value={editWorkUnit}
                          onChange={e => setEditWorkUnit(e.target.value)}
                          placeholder="Đơn vị công tác..."
                          className="w-full border border-teal-500 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-500"
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleUpdate(l.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                        />
                      ) : (
                        l.work_unit || <span className="text-slate-400 italic text-xs">Chưa có</span>
                      )}
                    </td>
                    <td className="p-4 text-sm text-slate-700 whitespace-nowrap">
                      {studentCount > 0 ? <span className="font-semibold">{studentCount}</span> : <span className="text-slate-400">0</span>}
                    </td>
                    <td className="p-4 text-sm whitespace-nowrap">
                      {l.students_drive_link ? <a href={l.students_drive_link} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline">Mở link</a> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="p-4 text-sm text-right flex items-center justify-end gap-2">
                      {editingId === l.id ? (
                        <>
                          <button onClick={() => handleUpdate(l.id)} className="text-green-600 hover:bg-green-50 p-2 rounded-lg transition-colors" title="Lưu"><Save size={18} /></button>
                          <button onClick={() => setEditingId(null)} className="text-slate-400 hover:bg-slate-100 p-2 rounded-lg transition-colors" title="Hủy"><X size={18} /></button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => { setMailMergeScope('selected'); setSelectedLecturerIds([Number(l.id)]); setMailMergeOpen(true); }}
                            className="text-indigo-600 hover:bg-indigo-50 p-2 rounded-lg transition-colors"
                            title="Mail merge giảng viên này"
                          >
                            <Send size={18} />
                          </button>
                          <button
                            onClick={async () => {
                              setDriveBusy(true);
                              try {
                                const accessToken = await getGoogleDriveAccessToken();
                                const folder = await pickDriveFolder(accessToken);
                                await createDriveLinkForLecturer(accessToken, folder.id, l);
                                alert(`Đã tạo/cập nhật link Drive cho ${l.name}.`);
                              } catch (e: any) {
                                alert(e.message || 'Không tạo được link Google Drive.');
                              } finally {
                                setDriveBusy(false);
                              }
                            }}
                            className="text-emerald-600 hover:bg-emerald-50 p-2 rounded-lg transition-colors"
                            title="Tạo link Drive"
                          >
                            <Upload size={18} />
                          </button>
                          <button onClick={() => { setEditingId(l.id); setEditName(l.name); setEditEmail(l.email || ''); setEditWorkUnit(l.work_unit || ''); }} className="text-blue-500 hover:bg-blue-50 p-2 rounded-lg transition-colors" title="Sửa"><Edit2 size={18} /></button>
                          <button onClick={() => handleDelete(l.id)} className="text-red-500 hover:bg-red-50 p-2 rounded-lg transition-colors" title="Xóa"><Trash2 size={18} /></button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <PaginationControls
          total={filteredAndSorted.length}
          currentPage={currentPage}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          label="giảng viên"
        />
      </div>

      {mailMergeOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
        <div className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
          <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5">
            <div>
              <h3 className="text-xl font-bold text-slate-900">Mail merge giảng viên</h3>
              <p className="mt-1 text-sm text-slate-500">
                Soạn email theo từng giảng viên từ danh sách sinh viên đã được phân công hướng dẫn.
              </p>
            </div>
            <button onClick={() => setMailMergeOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <X size={20} />
            </button>
          </div>

          <div className="space-y-5 p-6">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Phạm vi</label>
                <select value={mailMergeScope} onChange={e => setMailMergeScope(e.target.value as any)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500">
                  <option value="filtered">Danh sách đang lọc ({filteredAndSorted.length})</option>
                  <option value="page">Trang hiện tại ({paginatedLecturers.length})</option>
                  <option value="selected">Đã chọn ({selectedLecturerIds.length})</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Cách mở email</label>
                <select value={mailMergeUseGmail ? 'gmail' : 'mailto'} onChange={e => setMailMergeUseGmail(e.target.value === 'gmail')} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500">
                  <option value="gmail">Gmail trên trình duyệt</option>
                  <option value="mailto">Ứng dụng Mail mặc định</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Hạn phản hồi</label>
                <input value={mailMergeReplyDeadline} onChange={e => setMailMergeReplyDeadline(e.target.value)} placeholder="Ví dụ: trước 17h ngày 10/06/2026" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500" />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">CC email</label>
              <input value={mailMergeCc} onChange={e => setMailMergeCc(e.target.value)} placeholder="email1@vnu.edu.vn; email2@vnu.edu.vn" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Tiêu đề</label>
              <input value={mailMergeSubject} onChange={e => setMailMergeSubject(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Nội dung</label>
              <textarea value={mailMergeBody} onChange={e => setMailMergeBody(e.target.value)} rows={11} className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:ring-2 focus:ring-teal-500" />
              <p className="mt-2 text-xs text-slate-500">
                Biến hỗ trợ: <code>{'{{lecturer_name}}'}</code>, <code>{'{{lecturer_email}}'}</code>, <code>{'{{student_count}}'}</code>, <code>{'{{reply_deadline}}'}</code>, <code>{'{{reply_deadline_line}}'}</code>, <code>{'{{students_drive_link}}'}</code>, <code>{'{{students_drive_link_line}}'}</code>, <code>{'{{student_list_text}}'}</code>.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm text-slate-700">
                Có <strong>{mailMergeItems.length}</strong> giảng viên có sinh viên trong phạm vi này.
                {mailMergeItems.some(item => item.emails.length === 0) && <span className="ml-1 text-amber-700">Một số giảng viên chưa có email.</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => createDriveLinksForLecturers(mailMergeScope)} disabled={driveBusy || mailMergeItems.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
                  {driveBusy ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />} Tạo link Drive
                </button>
                <button onClick={exportLecturerMailMergeZip} disabled={mailMergeItems.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
                  <Download size={16} /> Xuất ZIP XLSX
                </button>
                <button onClick={sendAllBrevoLecturerMailMerge} disabled={mailMergeSending || mailMergeItems.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
                  {mailMergeSending ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />} Gửi Brevo
                </button>
                <button onClick={openAllLecturerMailMerge} disabled={mailMergeSending || mailMergeItems.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60">
                  {mailMergeSending ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />} Mở tất cả email
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Giảng viên</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Sinh viên</th>
                    <th className="px-4 py-3">Drive</th>
                    <th className="px-4 py-3 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {mailMergeItems.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Không có giảng viên có sinh viên trong phạm vi đã chọn.</td></tr>
                  ) : mailMergeItems.map(item => (
                    <tr key={item.lecturer.id} className="align-top hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{item.lecturer.name}</div>
                        <div className="text-xs text-slate-500">{item.lecturer.work_unit || 'Chưa có đơn vị công tác'}</div>
                      </td>
                      <td className="px-4 py-3">
                        {item.emails.length ? item.emails.join(', ') : <span className="text-amber-700">Chưa có email</span>}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-700">{item.students.length}</td>
                      <td className="px-4 py-3">
                        {item.lecturer.students_drive_link ? <a href={item.lecturer.students_drive_link} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline">Mở link</a> : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button onClick={() => sendBrevoLecturerMailMergeItem(item)} disabled={item.emails.length === 0 || mailMergeSending} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50">
                            Brevo
                          </button>
                          <button onClick={() => openLecturerMailMergeComposer(item)} disabled={item.emails.length === 0} className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
                            Soạn
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>}
    </div>
  );
}
