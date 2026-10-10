import { useNavigate } from 'react-router-dom';
import React, { useState, useEffect, useMemo } from 'react';
import { Users, CheckCircle2, Download, ArrowUpDown, Search, Building2, RefreshCw, Save, Plus, X, ChevronDown, FileText, Edit2, Clock, Send, Trash2, UserX } from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { API_BASE, saveXlsx, xlsxArrayBuffer, paginationBounds, CACHE_TTL, cachedJsonFetch, PaginationControls, formatCourseCode, cleanStudentName } from '../../../shared';

export function AdminPanel({ token, user: propUser }: { token: string; user?: any }) {
  const user = propUser || (localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')!) : null);
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [approvedCompanyNames, setApprovedCompanyNames] = useState<string[]>([]);
  const [adminStudents, setAdminStudents] = useState<any[]>([]);
  const [adminLecturerNames, setAdminLecturerNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCourse, setFilterCourse] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [exportingUnconfirmed, setExportingUnconfirmed] = useState(false);
  const [exportingRegisteredStudents, setExportingRegisteredStudents] = useState(false);
  const [savingToSheet, setSavingToSheet] = useState(false);
  const [savingRegistration, setSavingRegistration] = useState(false);
  const [deletingRegistration, setDeletingRegistration] = useState(false);
  const [addingRegistration, setAddingRegistration] = useState(false);
  const [editingRegistration, setEditingRegistration] = useState<any | null>(null);
  const [editRegistrationForm, setEditRegistrationForm] = useState({
    company_id: '',
    course_code: '',
    other_company_name: '',
    other_company_role: '',
    other_company_contact: '',
    note: '',
    preference_order: '',
  });
  const emptyAddRegistrationForm = {
    user_id: '',
    company_id: '',
    course_code: '',
    other_company_name: '',
    other_company_role: '',
    other_company_contact: '',
    note: '',
    preference_order: '',
    status: 'approved',
    review_comment: '',
  };
  const [addRegistrationForm, setAddRegistrationForm] = useState(emptyAddRegistrationForm);
  const [addStudentQuery, setAddStudentQuery] = useState('');
  const [addCompanyQuery, setAddCompanyQuery] = useState('');
  const [addOtherContact, setAddOtherContact] = useState({ contact_name: '', contact_phone: '', contact_email: '' });
  const [editCompanyQuery, setEditCompanyQuery] = useState('');
  const [editOtherContact, setEditOtherContact] = useState({ contact_name: '', contact_phone: '', contact_email: '' });
  const [registrationPage, setRegistrationPage] = useState(1);
  const registrationPageSize = 25;

  const navigate = useNavigate();

  useEffect(() => {
    fetchRegistrations();
    fetchRegistrationCompanies();
    fetchApprovedCompanyNames();
    fetchAdminStudents();
    fetchAdminLecturers();
  }, []);

  const fetchRegistrations = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/registrations`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setRegistrations(Array.isArray(data) ? data : []);
    } catch (e) { }
    setLoading(false);
  };

  const fetchRegistrationCompanies = async () => {
    try {
      const data = await cachedJsonFetch<any[]>(`${API_BASE}/api/companies`, {
        cacheKey: 'companies',
        ttlMs: CACHE_TTL.companies,
        headers: { Authorization: `Bearer ${token}` },
      });
      setCompanies(Array.isArray(data) ? data : []);
    } catch (e) {
      setCompanies([]);
    }
  };

  const fetchApprovedCompanyNames = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/approved-companies`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Không thể tải danh sách công ty gợi ý');
      setApprovedCompanyNames(
        (Array.isArray(data) ? data : [])
          .map(item => String(item?.name || '').trim())
          .filter(Boolean)
      );
    } catch (e) {
      setApprovedCompanyNames([]);
    }
  };

  const fetchAdminStudents = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/students`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setAdminStudents(Array.isArray(data) ? data : []);
    } catch (e) {
      setAdminStudents([]);
    }
  };

  const fetchAdminLecturers = async () => {
    try {
      const data = await cachedJsonFetch<any[]>(`${API_BASE}/api/lecturers`, {
        cacheKey: 'lecturers:names',
        ttlMs: CACHE_TTL.lecturers,
        headers: { Authorization: `Bearer ${token}` },
      });
      setAdminLecturerNames(Array.isArray(data) ? data : []);
    } catch (e) {
      setAdminLecturerNames([]);
    }
  };

  const addStudentLabel = (student: any) =>
    `${student.student_id || 'Chưa có MSSV'} - ${student.name || student.email || 'Sinh viên'}${student.email ? ` - ${student.email}` : ''}${student.class_name ? ` (${student.class_name})` : ''}`;

  const resolveAddStudent = (query: string) => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return null;
    const exact = adminStudents.find(student =>
      addStudentLabel(student).toLowerCase() === normalized ||
      String(student.student_id || '').toLowerCase() === normalized ||
      String(student.email || '').toLowerCase() === normalized
    );
    if (exact) return exact;
    const byName = adminStudents.filter(student => String(student.name || '').toLowerCase() === normalized);
    return byName.length === 1 ? byName[0] : null;
  };

  const resolveAddCompany = (query: string) => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return null;
    const exact = companies.find(company => String(company.name || '').trim().toLowerCase() === normalized);
    if (exact) return exact;
    const partial = companies.filter(company => String(company.name || '').toLowerCase().includes(normalized));
    return partial.length === 1 ? partial[0] : null;
  };

  const splitOtherContact = (value: string) => {
    const parts = String(value || '').split(' - ').map(part => part.trim()).filter(Boolean);
    return {
      contact_name: parts[0] || '',
      contact_phone: parts[1] || '',
      contact_email: parts.slice(2).join(' - ') || '',
    };
  };

  const registrationExportData = (dataList: any[]) => {
    const headers = ['STT', 'Mã SV', 'Họ và tên', 'Ngày sinh', 'SĐT', 'Email cá nhân', 'Lớp KH', 'Mã môn học', 'Nơi thực tập', 'Vị trí', 'Liên hệ', 'Ghi chú', 'Nhận xét duyệt', 'Trạng thái', 'Đã gửi DN', 'Thời gian đăng ký'];
    const rows = dataList.map((r, i) => {
      let noi_tt = r.company_name;
      if (r.company_name === 'Công ty khác') noi_tt = 'Công ty khác: ' + (r.other_company_name || '');

      let vi_tri = r.company_name === 'Công ty khác' ? (r.other_company_role || '') : 'Thực tập sinh';
      let lien_he = r.company_name === 'Công ty khác' ? (r.other_company_contact || '') : (r.contact_email || '');
      let ghi_chu = r.note || '';

      if (r.company_name === 'Trường Đại học Công nghệ') {
        lien_he = '';
        ghi_chu = 'GVHD: ' + (r.other_company_contact || '') + (r.other_company_role ? ` - Đồng HD: ${r.other_company_role}` : '') + (r.note ? ` - ${r.note}` : '');
      }

      return [
        i + 1,
        r.student_id,
        cleanStudentName(r.student_name, r.student_id),
        r.dob,
        r.phone || '',
        r.personal_email || '',
        r.class_name,
        formatCourseCode(r.course_code),
        noi_tt,
        vi_tri,
        lien_he,
        ghi_chu,
        r.review_comment || '',
        r.status === 'approved' ? 'Đã duyệt' : (r.status === 'rejected' ? 'Từ chối' : 'Chờ duyệt'),
        r.sent_to_company_at ? new Date(r.sent_to_company_at).toLocaleString('vi-VN') : '',
        new Date(r.created_at).toLocaleString('vi-VN')
      ];
    });
    return { headers, rows };
  };

  const handleExportCurrent = () => {
    const { headers, rows } = registrationExportData(filteredRegistrations);
    saveXlsx('danh_sach_hien_tai.xlsx', headers, rows, 'Danh sách');
    setIsExportMenuOpen(false);
  };

  const handleExportByCourse = async () => {
    const zip = new JSZip();
    const headers = ['STT', 'Mã SV', 'Họ và tên', 'Ngày sinh', 'Lớp khóa học'];
    uniqueCourses.forEach(course => {
      const data = registrations.filter(r => r.course_code === course);
      if (data.length > 0) {
        const uniqueStudents = Array.from(
          data.reduce((map, row) => {
            const key = String(row.student_id || row.email || row.user_id || '').trim();
            if (key && !map.has(key)) map.set(key, row);
            return map;
          }, new Map<string, any>()).values()
        );
        const rows = uniqueStudents.map((row: any, idx: number) => [
          idx + 1,
          row.student_id || '',
          cleanStudentName(row.student_name, row.student_id),
          row.dob || '',
          row.class_name || '',
        ]);
        zip.file(`Lop_${course || 'KhongXacDinh'}.xlsx`, xlsxArrayBuffer(headers, rows, 'Danh sách'));
      }
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    saveAs(blob, 'DanhSachTheoLop.zip');
    setIsExportMenuOpen(false);
  };

  const handleExportByCompany = async () => {
    const zip = new JSZip();
    uniqueCompanies.forEach(company => {
      const data = registrations.filter(r => r.company_name === company);
      if (data.length > 0) {
        const safeName = (company as string).replace(/[^a-z0-9]/gi, '_');
        const { headers, rows } = registrationExportData(data);
        zip.file(`CongTy_${safeName}.xlsx`, xlsxArrayBuffer(headers, rows, 'Danh sách'));
      }
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    saveAs(blob, 'DanhSachTheoCongTy.zip');
    setIsExportMenuOpen(false);
  };

  const handleExportUnconfirmed = async () => {
    if (exportingUnconfirmed) return;
    setExportingUnconfirmed(true);
    setIsExportMenuOpen(false);

    try {
      let unconfirmedList: any[] = [];
      try {
        const res = await fetch(`${API_BASE}/api/admin/unconfirmed-internships`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            unconfirmedList = data;
          }
        }
      } catch (e) {
        // Fallback below
      }

      if (unconfirmedList.length === 0) {
        let confirmedUserIds = new Set<number>();
        try {
          const finalRes = await fetch(`${API_BASE}/api/admin/final-internships`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (finalRes.ok) {
            const finalData = await finalRes.json();
            if (Array.isArray(finalData)) {
              confirmedUserIds = new Set(finalData.map((f: any) => Number(f.user_id)));
            }
          }
        } catch (e) {}

        const studentMap = new Map<number, any>();
        registrations.forEach(r => {
          const uid = Number(r.user_id);
          if (!uid || confirmedUserIds.has(uid)) return;

          if (!studentMap.has(uid)) {
            studentMap.set(uid, {
              user_id: uid,
              student_id: r.student_id || '',
              student_name: r.student_name || '',
              dob: r.dob || '',
              class_name: r.class_name || '',
              course_code: r.course_code || '',
              phone: r.phone || '',
              email: r.email || '',
              personal_email: r.personal_email || '',
              registered_places: [],
              registered_count: 0,
            });
          }

          const s = studentMap.get(uid);
          s.registered_count += 1;
          let place = r.company_name;
          if (r.company_name === 'Công ty khác') place = 'Công ty khác: ' + (r.other_company_name || '');
          const pref = r.preference_order ? `NV${r.preference_order}: ` : '';
          const st = r.status === 'approved' ? 'Đã duyệt' : (r.status === 'rejected' ? 'Từ chối' : 'Chờ duyệt');
          s.registered_places.push(`${pref}${place} (${st})`);
        });

        unconfirmedList = Array.from(studentMap.values()).map(s => ({
          ...s,
          registered_places: s.registered_places.join('; '),
          confirmation_status: 'Chưa xác nhận',
        }));
      }

      if (unconfirmedList.length === 0) {
        alert('Tất cả sinh viên đã xác nhận nơi thực tập hoặc không có sinh viên nào chưa xác nhận.');
        return;
      }

      const headers = [
        'STT',
        'Mã SV',
        'Họ và tên',
        'Ngày sinh',
        'Lớp khóa học',
        'Mã học phần',
        'Số điện thoại',
        'Email VNU',
        'Email cá nhân',
        'Số NV đã đăng ký',
        'Các nơi đã đăng ký',
        'Trạng thái xác nhận',
        'Ghi chú'
      ];

      const rows = unconfirmedList.map((item, idx) => [
        idx + 1,
        item.student_id || '',
        cleanStudentName(item.student_name || item.name, item.student_id),
        item.dob || '',
        item.class_name || '',
        formatCourseCode(item.course_code),
        item.phone || '',
        item.email || '',
        item.personal_email || '',
        item.registered_count || 0,
        item.registered_places || item.registered_places_summary || '',
        item.confirmation_status || 'Chưa xác nhận',
        item.note || ''
      ]);

      saveXlsx('danh_sach_sinh_vien_chua_xac_nhan_thuc_tap.xlsx', headers, rows, 'Chưa xác nhận TT');
    } catch (e: any) {
      alert('Lỗi xuất danh sách chưa xác nhận: ' + (e?.message || e));
    } finally {
      setExportingUnconfirmed(false);
    }
  };

  const handleExportRegisteredStudents = async () => {
    if (exportingRegisteredStudents) return;
    setExportingRegisteredStudents(true);
    setIsExportMenuOpen(false);

    try {
      let studentList: any[] = [];
      try {
        const res = await fetch(`${API_BASE}/api/admin/registered-students-export`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            studentList = data;
          }
        }
      } catch (e) {
        // Fallback below
      }

      if (studentList.length === 0) {
        let finalMap = new Map<number, any>();
        try {
          const finalRes = await fetch(`${API_BASE}/api/admin/final-internships`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (finalRes.ok) {
            const finalData = await finalRes.json();
            if (Array.isArray(finalData)) {
              finalData.forEach((f: any) => {
                const uid = Number(f.user_id);
                if (uid) finalMap.set(uid, f);
              });
            }
          }
        } catch (e) {}

        const studentMap = new Map<number, any>();
        registrations.forEach(r => {
          const uid = Number(r.user_id);
          if (!uid) return;

          if (!studentMap.has(uid)) {
            const finalInfo = finalMap.get(uid);
            let place = 'Chưa xác nhận';
            let gvhd = '';
            let gvdhd = '';

            if (finalInfo) {
              if (finalInfo.company_name === 'Công ty khác') {
                place = finalInfo.other_company_name || 'Công ty khác';
              } else {
                place = finalInfo.company_name || 'Chưa rõ';
              }
              if (finalInfo.school_lecturer) {
                gvhd = finalInfo.school_lecturer;
              }
              if (finalInfo.other_company_role) {
                gvdhd = finalInfo.other_company_role;
              }
            }

            studentMap.set(uid, {
              user_id: uid,
              student_id: r.student_id || '',
              student_name: r.student_name || '',
              dob: r.dob || '',
              class_name: r.class_name || '',
              course_code: r.course_code || '',
              phone: r.phone || '',
              email: r.email || '',
              personal_email: r.personal_email || '',
              final_internship_place: place,
              primary_advisors: gvhd,
              co_advisors: gvdhd,
            });
          }

          const s = studentMap.get(uid);
          if (r.company_name === 'Trường Đại học Công nghệ') {
            if (!s.primary_advisors && r.other_company_contact) {
              s.primary_advisors = r.other_company_contact;
            }
            if (!s.co_advisors && r.other_company_role) {
              s.co_advisors = r.other_company_role;
            }
          }
        });

        studentList = Array.from(studentMap.values()).sort((a, b) => {
          const cComp = (a.class_name || '').localeCompare(b.class_name || '');
          if (cComp !== 0) return cComp;
          return (a.student_id || '').localeCompare(b.student_id || '');
        });
      }

      if (studentList.length === 0) {
        alert('Không có dữ liệu sinh viên đăng ký để xuất.');
        return;
      }

      const headers = [
        'STT',
        'MSSV',
        'Họ và tên',
        'Ngày sinh',
        'Lớp khoá học',
        'Mã môn học',
        'GVHD',
        'GV ĐHD',
        'SĐT',
        'Email cá nhân',
        'Email VNU',
        'Nơi thực tập',
      ];

      const rows = studentList.map((item, idx) => [
        idx + 1,
        item.student_id || '',
        cleanStudentName(item.student_name || item.name, item.student_id),
        item.dob || '',
        item.class_name || '',
        formatCourseCode(item.course_code),
        item.primary_advisors || item.gvhd || '',
        item.co_advisors || item.gvdhd || '',
        item.phone || '',
        item.personal_email || '',
        item.email || '',
        item.final_internship_place || 'Chưa xác nhận',
      ]);

      saveXlsx('danh_sach_dang_ky_thuc_tap.xlsx', headers, rows, 'DS đăng ký');
    } catch (e: any) {
      alert('Lỗi xuất danh sách đăng ký: ' + (e?.message || e));
    } finally {
      setExportingRegisteredStudents(false);
    }
  };

  const handleSaveToGoogleSheets = async () => {
    if (savingToSheet) return;
    if (!confirm('Hệ thống sẽ ghi đè toàn bộ dữ liệu hiện tại lên Google Sheets. Bạn có chắc chắn?')) return;
    setSavingToSheet(true);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    try {
      const res = await fetch(`${API_BASE}/api/admin/export-to-sheet`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message || 'Đã lưu vào Google Sheets thành công!');
      } else {
        alert(data.error || 'Đã xảy ra lỗi khi lưu vào Google Sheets.');
      }
    } catch (e) {
      alert('Không thể kết nối đến máy chủ.');
    } finally {
      setSavingToSheet(false);
    }
  };

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key: string) => {
    if (!sortConfig || sortConfig.key !== key) {
      return <ArrowUpDown size={14} className="text-gray-400" />;
    }
    return sortConfig.direction === 'asc' ?
      <span className="text-blue-600 font-bold">↑</span> :
      <span className="text-blue-600 font-bold">↓</span>;
  };

  const handleUpdateStatus = async (id: number, status: string) => {
    try {
      const current = registrations.find(r => Number(r.registration_id) === Number(id));
      const commentPrompt = status === 'pending'
        ? ''
        : prompt(status === 'approved' ? 'Nhận xét gửi cho sinh viên khi duyệt (có thể để trống):' : 'Lý do/nhận xét gửi cho sinh viên khi từ chối:', current?.review_comment || '');
      if (commentPrompt === null) return;
      const review_comment = status === 'pending' ? '' : commentPrompt;
      const res = await fetch(`${API_BASE}/api/admin/registrations/${id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status, review_comment })
      });
      if (res.ok) {
        fetchRegistrations();
      } else {
        const data = await res.json();
        alert(data.error || 'Cập nhật thất bại');
      }
    } catch (e) {
      alert('Lỗi kết nối');
    }
  };

  const handleSendRegistrationComment = async (reg: any) => {
    const comment = prompt(
      `Nhận xét gửi cho ${reg.student_name || 'sinh viên'}:`,
      reg.review_comment || ''
    );
    if (comment === null) return;
    const review_comment = comment.trim();
    if (!review_comment) return alert('Vui lòng nhập nội dung nhận xét.');
    try {
      const res = await fetch(`${API_BASE}/api/admin/registrations/${reg.registration_id}/comment`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ review_comment })
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Gửi nhận xét thất bại.');
      fetchRegistrations();
      alert('Đã gửi nhận xét cho sinh viên.');
    } catch (e) {
      alert('Lỗi kết nối.');
    }
  };

  const handleSendFilteredRegistrationComment = async () => {
    if (filteredRegistrations.length === 0) return alert('Danh sách đang lọc đang trống.');
    const comment = prompt(`Nhận xét gửi cho ${filteredRegistrations.length} đăng ký trong danh sách đang lọc:`, '');
    if (comment === null) return;
    const review_comment = comment.trim();
    if (!review_comment) return alert('Vui lòng nhập nội dung nhận xét.');
    if (!confirm(`Gửi nhận xét này cho ${filteredRegistrations.length} đăng ký trong danh sách đang lọc?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/registrations/comments`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          registration_ids: filteredRegistrations.map(reg => Number(reg.registration_id)).filter(Boolean),
          review_comment
        })
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Gửi nhận xét thất bại.');
      fetchRegistrations();
      alert(`Đã gửi nhận xét cho ${data.count || 0} đăng ký.`);
    } catch (e) {
      alert('Lỗi kết nối.');
    }
  };

  const startEditRegistration = (reg: any) => {
    setEditingRegistration(reg);
    setEditCompanyQuery(reg.company_name || '');
    setEditOtherContact(splitOtherContact(reg.other_company_contact || ''));
    setEditRegistrationForm({
      company_id: String(reg.company_id || ''),
      course_code: reg.course_code || '',
      other_company_name: reg.other_company_name || '',
      other_company_role: reg.other_company_role || '',
      other_company_contact: reg.other_company_contact || '',
      note: reg.note || '',
      preference_order: reg.preference_order ? String(reg.preference_order) : '',
    });
  };

  const closeEditRegistration = () => {
    if (savingRegistration) return;
    setEditingRegistration(null);
    setEditCompanyQuery('');
    setEditOtherContact({ contact_name: '', contact_phone: '', contact_email: '' });
  };

  const openAddRegistration = () => {
    setAddRegistrationForm(emptyAddRegistrationForm);
    setAddStudentQuery('');
    setAddCompanyQuery('');
    setAddOtherContact({ contact_name: '', contact_phone: '', contact_email: '' });
    setAddingRegistration(true);
  };

  const closeAddRegistration = () => {
    if (savingRegistration) return;
    setAddingRegistration(false);
  };

  const handleAddRegistrationStudentChange = (query: string) => {
    const student = resolveAddStudent(query);
    setAddStudentQuery(query);
    setAddRegistrationForm({
      ...addRegistrationForm,
      user_id: student ? String(student.id) : '',
      course_code: student?.course_code || addRegistrationForm.course_code,
    });
  };

  const handleAddRegistrationCompanyChange = (query: string) => {
    const company = resolveAddCompany(query);
    setAddCompanyQuery(query);
    setAddRegistrationForm({
      ...addRegistrationForm,
      company_id: company ? String(company.id) : '',
    });
  };

  const handleEditRegistrationCompanyChange = (query: string) => {
    const company = resolveAddCompany(query);
    const currentCompany = editRegistrationForm.company_id ? companies.find(item => String(item.id) === String(editRegistrationForm.company_id)) : null;
    const companyTypeChanged = company && currentCompany && company.name !== currentCompany.name;
    setEditCompanyQuery(query);
    setEditRegistrationForm({
      ...editRegistrationForm,
      company_id: company ? String(company.id) : '',
      other_company_name: companyTypeChanged ? '' : editRegistrationForm.other_company_name,
      other_company_role: companyTypeChanged ? '' : editRegistrationForm.other_company_role,
      other_company_contact: companyTypeChanged ? '' : editRegistrationForm.other_company_contact,
    });
    if (companyTypeChanged) {
      setEditOtherContact({ contact_name: '', contact_phone: '', contact_email: '' });
    }
  };

  const handleSaveRegistrationAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const selectedStudent = addRegistrationForm.user_id ? adminStudents.find(item => String(item.id) === String(addRegistrationForm.user_id)) : resolveAddStudent(addStudentQuery);
    const selectedCompany = addRegistrationForm.company_id ? companies.find(item => String(item.id) === String(addRegistrationForm.company_id)) : resolveAddCompany(addCompanyQuery);
    if (!selectedStudent) return alert('Vui lòng nhập và chọn đúng sinh viên từ danh sách gợi ý.');
    if (!selectedCompany) return alert('Vui lòng nhập và chọn đúng nơi thực tập từ danh sách gợi ý.');
    const isOtherSelection = selectedCompany.name === 'Công ty khác';
    const otherContactValue = isOtherSelection
      ? [addOtherContact.contact_name, addOtherContact.contact_phone, addOtherContact.contact_email].map(v => String(v || '').trim()).filter(Boolean).join(' - ')
      : addRegistrationForm.other_company_contact;
    if (isOtherSelection) {
      if (!addOtherContact.contact_name.trim()) return alert('Vui lòng nhập người liên hệ.');
      if (!/^(0|\+84)[35789]\d{8}$/.test(addOtherContact.contact_phone.trim().replace(/[\s\-\.]/g, ''))) return alert('Số điện thoại liên hệ không hợp lệ.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addOtherContact.contact_email.trim())) return alert('Email liên hệ không hợp lệ.');
    }
    if (selectedCompany.name === 'Trường Đại học Công nghệ') {
      const primaryLecturer = addRegistrationForm.other_company_contact.trim();
      const coLecturer = addRegistrationForm.other_company_role.trim();
      if (primaryLecturer && !adminLecturerNames.includes(primaryLecturer)) return alert('Giảng viên hướng dẫn không hợp lệ. Vui lòng chọn từ danh sách gợi ý.');
      if (coLecturer && !adminLecturerNames.includes(coLecturer)) return alert('Giảng viên đồng hướng dẫn không hợp lệ. Vui lòng chọn từ danh sách gợi ý.');
      if (primaryLecturer && coLecturer && primaryLecturer === coLecturer) return alert('Giảng viên đồng hướng dẫn không được trùng với giảng viên hướng dẫn chính.');
    }
    setSavingRegistration(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/registrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...addRegistrationForm,
          user_id: String(selectedStudent.id),
          company_id: String(selectedCompany.id),
          other_company_contact: otherContactValue,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.error || 'Thêm đăng ký thất bại.');
      setAddingRegistration(false);
      setAddRegistrationForm(emptyAddRegistrationForm);
      setAddStudentQuery('');
      setAddCompanyQuery('');
      setAddOtherContact({ contact_name: '', contact_phone: '', contact_email: '' });
      await fetchRegistrations();
    } catch (e) {
      alert('Lỗi kết nối khi thêm đăng ký.');
    } finally {
      setSavingRegistration(false);
    }
  };

  const handleSaveRegistrationEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRegistration) return;
    const selectedCompany = editRegistrationForm.company_id ? companies.find(item => String(item.id) === String(editRegistrationForm.company_id)) : resolveAddCompany(editCompanyQuery);
    if (!selectedCompany) return alert('Vui lòng nhập và chọn đúng nơi thực tập từ danh sách gợi ý.');
    const isOtherSelection = selectedCompany.name === 'Công ty khác';
    const otherContactValue = isOtherSelection
      ? [editOtherContact.contact_name, editOtherContact.contact_phone, editOtherContact.contact_email].map(v => String(v || '').trim()).filter(Boolean).join(' - ')
      : editRegistrationForm.other_company_contact;
    if (isOtherSelection) {
      if (!editOtherContact.contact_name.trim()) return alert('Vui lòng nhập người liên hệ.');
      if (!/^(0|\+84)[35789]\d{8}$/.test(editOtherContact.contact_phone.trim().replace(/[\s\-\.]/g, ''))) return alert('Số điện thoại liên hệ không hợp lệ.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editOtherContact.contact_email.trim())) return alert('Email liên hệ không hợp lệ.');
    }
    if (selectedCompany.name === 'Trường Đại học Công nghệ') {
      const primaryLecturer = editRegistrationForm.other_company_contact.trim();
      const coLecturer = editRegistrationForm.other_company_role.trim();
      if (primaryLecturer && !adminLecturerNames.includes(primaryLecturer)) return alert('Giảng viên hướng dẫn không hợp lệ. Vui lòng chọn từ danh sách gợi ý.');
      if (coLecturer && !adminLecturerNames.includes(coLecturer)) return alert('Giảng viên đồng hướng dẫn không hợp lệ. Vui lòng chọn từ danh sách gợi ý.');
      if (primaryLecturer && coLecturer && primaryLecturer === coLecturer) return alert('Giảng viên đồng hướng dẫn không được trùng với giảng viên hướng dẫn chính.');
    }
    setSavingRegistration(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/registrations/${editingRegistration.registration_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...editRegistrationForm,
          company_id: String(selectedCompany.id),
          other_company_contact: otherContactValue,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.error || 'Cập nhật đăng ký thất bại.');
      setEditingRegistration(null);
      await fetchRegistrations();
    } catch (e) {
      alert('Lỗi kết nối khi cập nhật đăng ký.');
    } finally {
      setSavingRegistration(false);
    }
  };

  const handleDeleteRegistration = async () => {
    if (!editingRegistration) return;
    const studentInfo = `${editingRegistration.student_name || 'Sinh viên'} (${editingRegistration.student_id || 'Chưa có MSSV'})`;
    const companyDisplay = editCompanyQuery || editingRegistration.company_name || 'Nơi thực tập';
    const preferenceDisplay = editRegistrationForm.preference_order ? `NV${editRegistrationForm.preference_order}` : 'Chưa đặt NV';

    const confirmMessage = `Bạn có chắc chắn muốn xóa đăng ký thực tập này không?\n\n` +
      `• Sinh viên: ${studentInfo}\n` +
      `• Nơi thực tập: ${companyDisplay}\n` +
      `• Thứ tự: ${preferenceDisplay}\n\n` +
      `Lưu ý: Hành động này sẽ xóa hoàn toàn nguyện vọng này khỏi hệ thống và không thể hoàn tác!`;

    if (!window.confirm(confirmMessage)) return;

    setDeletingRegistration(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/registrations/${editingRegistration.registration_id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return alert(data.error || 'Xóa đăng ký thất bại.');
      }
      setEditingRegistration(null);
      await fetchRegistrations();
    } catch (e) {
      alert('Lỗi kết nối khi xóa đăng ký.');
    } finally {
      setDeletingRegistration(false);
    }
  };

  const handleApproveAll = async () => {
    if (!window.confirm("Bạn có chắc chắn muốn duyệt tất cả các đăng ký đang chờ?")) return;
    const commentPrompt = prompt('Nhận xét chung gửi cho các sinh viên được duyệt (có thể để trống):', '');
    if (commentPrompt === null) return;
    const review_comment = commentPrompt;
    try {
      const res = await fetch(`${API_BASE}/api/admin/registrations/approve-all`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ review_comment })
      });
      if (res.ok) {
        fetchRegistrations();
        alert('Đã duyệt tất cả');
      } else {
        const data = await res.json();
        alert(data.error || 'Duyệt thất bại');
      }
    } catch (e) {
      alert('Lỗi kết nối');
    }
  };

  const sortedRegistrations = [...registrations].sort((a, b) => {
    if (!sortConfig) return 0;
    const { key, direction } = sortConfig;
    const aVal = a[key] || '';
    const bVal = b[key] || '';

    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }

    if (aVal < bVal) return direction === 'asc' ? -1 : 1;
    if (aVal > bVal) return direction === 'asc' ? 1 : -1;
    return 0;
  });

  const uniqueCourses = Array.from(new Set(registrations.map(r => r.course_code).filter(Boolean)));
  const uniqueCompanies = Array.from(new Set(registrations.map(r => r.company_name).filter(Boolean)));
  const otherCompanyNameSuggestions = useMemo(() => {
    const uniqueNames = new Map<string, string>();
    const names = [
      ...approvedCompanyNames,
      ...registrations.map(registration => String(registration.other_company_name || '').trim()),
    ];

    names.filter(Boolean).forEach(name => {
      const normalizedName = name.toLocaleLowerCase('vi');
      if (!uniqueNames.has(normalizedName)) uniqueNames.set(normalizedName, name);
    });

    return Array.from(uniqueNames.values()).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [approvedCompanyNames, registrations]);

  const filteredRegistrations = sortedRegistrations.filter(reg => {
    const term = searchTerm.toLowerCase();
    const matchTerm = (
      (reg.student_name || '').toLowerCase().includes(term) ||
      (reg.email || '').toLowerCase().includes(term) ||
      (reg.company_name || '').toLowerCase().includes(term) ||
      (reg.other_company_name || '').toLowerCase().includes(term) ||
      (reg.other_company_contact || '').toLowerCase().includes(term) ||
      (reg.student_id || '').toLowerCase().includes(term) ||
      (reg.class_name || '').toLowerCase().includes(term) ||
      (reg.review_comment || '').toLowerCase().includes(term)
    );
    const matchCourse = filterCourse ? reg.course_code === filterCourse : true;
    const matchStatus = filterStatus ? reg.status === filterStatus : true;
    return matchTerm && matchCourse && matchStatus;
  });
  useEffect(() => {
    setRegistrationPage(1);
  }, [searchTerm, filterCourse, filterStatus, sortConfig, registrations.length]);
  const registrationPagination = paginationBounds(filteredRegistrations.length, registrationPage, registrationPageSize);
  const paginatedRegistrations = filteredRegistrations.slice(
    (registrationPagination.safePage - 1) * registrationPageSize,
    registrationPagination.safePage * registrationPageSize
  );

  const totalRegistrations = registrations.length;
  const totalStudents = new Set(registrations.map(r => r.user_id || r.student_id || r.email).filter(Boolean)).size;
  const totalCompanies = new Set(registrations.map(r => (
    r.company_name === 'Công ty khác'
      ? (r.other_company_name || r.company_name)
      : r.company_name
  )).filter(Boolean)).size;
  const pendingRegistrations = registrations.filter(r => r.status === 'pending').length;
  const approvedRegistrations = registrations.filter(r => r.status === 'approved').length;
  const rejectedRegistrations = registrations.filter(r => r.status === 'rejected').length;
  const clearRegistrationFilters = () => {
    setSearchTerm('');
    setFilterCourse('');
    setFilterStatus('');
  };
  const applyRegistrationStatusFilter = (status: string) => {
    setFilterStatus(status);
  };
  const editingCompany = companies.find(company => Number(company.id) === Number(editRegistrationForm.company_id));
  const editingIsOtherCompany = editingCompany?.name === 'Công ty khác';
  const editingIsSchoolInternship = editingCompany?.name === 'Trường Đại học Công nghệ';
  const addingCompany = companies.find(company => Number(company.id) === Number(addRegistrationForm.company_id));
  const addingIsOtherCompany = addingCompany?.name === 'Công ty khác';
  const addingIsSchoolInternship = addingCompany?.name === 'Trường Đại học Công nghệ';

  if (loading) return <div className="text-center py-20 text-slate-500">Đang tải dữ liệu...</div>;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="bg-white p-4 border border-slate-200 rounded-2xl shadow-sm space-y-4">
        {/* Row 1: Operations */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button onClick={() => navigate(user?.role === 'admin' ? '/admin' : '/')} className="bg-white text-slate-700 border border-slate-200 px-3.5 py-2 rounded-xl hover:bg-slate-50 text-xs font-semibold shadow-sm flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer mr-2">
              &larr; {user?.role === 'admin' ? 'Quay lại Quản trị' : 'Quay lại trang chủ'}
            </button>
            <h2 className="text-sm font-extrabold text-slate-800 ml-2 hidden md:block">Danh sách Đăng ký Thực tập</h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={openAddRegistration}
              className="bg-[#034ea1] text-white px-3.5 py-2 rounded-xl hover:bg-[#023a7a] text-xs font-semibold shadow-sm flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer active:scale-[0.98]"
            >
              <Plus size={14} /> Thêm đăng ký
            </button>
            <span title="Gửi cùng một nhận xét cho toàn bộ danh sách đăng ký đang được lọc ở bảng bên dưới.">
              <button
                onClick={handleSendFilteredRegistrationComment}
                disabled={filteredRegistrations.length === 0}
                className="bg-[#fff8eb] text-[#b25e00] border border-[#ffe7ba] px-3.5 py-2 rounded-xl hover:bg-[#ffe7ba] text-xs font-semibold shadow-xs flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50 transition-all cursor-pointer active:scale-[0.98]"
              >
                <Send size={14} /> Gửi nhận xét
              </button>
            </span>
            <button
              onClick={handleApproveAll}
              className="bg-[#e8f1fb] text-[#034ea1] border border-[#d4e5f7] px-3.5 py-2 rounded-xl hover:bg-[#d4e5f7] text-xs font-semibold shadow-xs flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer active:scale-[0.98]"
            >
              <CheckCircle2 size={14} /> Duyệt tất cả
            </button>

            <div className="relative">
              <button
                onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                className="bg-white text-[#0f172a] border border-[#e2e8f0] px-3.5 py-2 rounded-xl hover:bg-[#f8fafc] text-xs font-semibold shadow-xs flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer active:scale-[0.98]"
              >
                <Download size={14} /> Xuất dữ liệu <ChevronDown size={12} />
              </button>
              {isExportMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsExportMenuOpen(false)}></div>
                  <div className="absolute right-0 mt-2 w-72 bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-black/[0.08] py-1.5 z-50 overflow-hidden text-slate-800 origin-top-right">
                    <button onClick={handleExportCurrent} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 text-xs font-medium transition-colors border-b border-slate-50 w-full text-left cursor-pointer">
                      <FileText size={15} className="text-emerald-600 shrink-0" /> Xuất danh sách đang lọc (XLSX)
                    </button>
                    <button
                      onClick={handleExportRegisteredStudents}
                      disabled={exportingRegisteredStudents}
                      className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 text-xs font-medium transition-colors border-b border-slate-50 w-full text-left cursor-pointer disabled:opacity-50"
                    >
                      {exportingRegisteredStudents ? (
                        <RefreshCw size={15} className="text-blue-600 animate-spin shrink-0" />
                      ) : (
                        <Users size={15} className="text-blue-600 shrink-0" />
                      )}
                      Xuất DS đăng ký (XLSX)
                    </button>
                    <button onClick={handleExportByCourse} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 text-xs font-medium transition-colors border-b border-slate-50 w-full text-left cursor-pointer">
                      <Download size={15} className="text-blue-600 shrink-0" /> Xuất theo môn học (ZIP)
                    </button>
                    <button onClick={handleExportByCompany} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 text-xs font-medium transition-colors border-b border-slate-50 w-full text-left cursor-pointer">
                      <Download size={15} className="text-blue-600 shrink-0" /> Xuất theo công ty (ZIP)
                    </button>
                    <button
                      onClick={handleExportUnconfirmed}
                      disabled={exportingUnconfirmed}
                      className="flex items-center gap-2 px-4 py-2.5 hover:bg-amber-50/70 text-xs font-medium transition-colors w-full text-left cursor-pointer disabled:opacity-50"
                    >
                      {exportingUnconfirmed ? (
                        <RefreshCw size={15} className="text-amber-600 animate-spin shrink-0" />
                      ) : (
                        <UserX size={15} className="text-amber-600 shrink-0" />
                      )}
                      Xuất DS chưa xác nhận (XLSX)
                    </button>
                  </div>
                </>
              )}
            </div>

            <button
              onClick={handleSaveToGoogleSheets}
              disabled={savingToSheet}
              className="bg-white text-[#0f172a] border border-[#e2e8f0] px-3.5 py-2 rounded-xl hover:bg-[#f8fafc] text-xs font-semibold shadow-xs flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50 disabled:cursor-wait transition-all cursor-pointer active:scale-[0.98]"
            >
              {savingToSheet ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
              {savingToSheet ? 'Đang lưu...' : 'Lưu Google Sheets'}
            </button>
          </div>
        </div>

        {/* Row 2: Search & Filters */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-3 border-t border-slate-100">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            <input
              type="text"
              placeholder="Tìm sinh viên, lớp, công ty..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-[#e2e8f0] rounded-xl text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all shadow-xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filterCourse}
              onChange={(e) => setFilterCourse(e.target.value)}
              className="px-3 py-2 border border-[#e2e8f0] bg-white text-[#0f172a] rounded-xl text-xs font-semibold shadow-xs focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] outline-none transition-all cursor-pointer"
            >
              <option value="">Tất cả học phần</option>
              {uniqueCourses.map(course => (
                <option key={course} value={course}>{course}</option>
              ))}
            </select>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-2 border border-[#e2e8f0] bg-white text-[#0f172a] rounded-xl text-xs font-semibold shadow-xs focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] outline-none transition-all cursor-pointer"
            >
              <option value="">Tất cả trạng thái</option>
              <option value="pending">Chờ duyệt</option>
              <option value="approved">Đã duyệt</option>
              <option value="rejected">Từ chối</option>
            </select>

            {(searchTerm || filterCourse || filterStatus) && (
              <button
                type="button"
                onClick={clearRegistrationFilters}
                className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 font-bold px-3 py-2 rounded-xl transition-colors cursor-pointer"
              >
                Xóa bộ lọc
              </button>
            )}
          </div>
        </div>
      </div>

      {savingToSheet && (
        <div aria-live="polite" className="mb-6 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <RefreshCw size={18} className="animate-spin shrink-0" />
          <span>Đang ghi danh sách đăng ký lên Google Sheets, vui lòng đợi...</span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <button
          type="button"
          onClick={clearRegistrationFilters}
          className={`text-left bg-white p-4 rounded-2xl border shadow-sm flex flex-col justify-between transition-all hover:-translate-y-0.5 hover:shadow-md ${!searchTerm && !filterCourse && !filterStatus ? 'border-blue-500 ring-2 ring-blue-50' : 'border-slate-200'}`}
        >
          <div className="flex items-center justify-between w-full mb-2">
            <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Tổng nguyện vọng</span>
            <FileText size={16} className="text-slate-400" />
          </div>
          <span className="text-2xl font-bold text-slate-800">{totalRegistrations}</span>
        </button>
        <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between w-full mb-2">
            <span className="text-blue-600 text-xs font-semibold uppercase tracking-wider">SV đăng ký</span>
            <Users size={16} className="text-blue-500" />
          </div>
          <span className="text-2xl font-bold text-blue-700">{totalStudents}</span>
        </div>
        <div className="bg-cyan-50 p-4 rounded-2xl border border-cyan-100 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between w-full mb-2">
            <span className="text-cyan-700 text-xs font-semibold uppercase tracking-wider">Công ty</span>
            <Building2 size={16} className="text-cyan-600" />
          </div>
          <span className="text-2xl font-bold text-cyan-800">{totalCompanies}</span>
        </div>
        <button
          type="button"
          onClick={() => applyRegistrationStatusFilter('pending')}
          className={`text-left bg-orange-50 p-4 rounded-2xl border shadow-sm flex flex-col justify-between transition-all hover:-translate-y-0.5 hover:shadow-md ${filterStatus === 'pending' ? 'border-orange-400 ring-2 ring-orange-100' : 'border-slate-200'}`}
        >
          <div className="flex items-center justify-between w-full mb-2">
            <span className="text-orange-600 text-xs font-semibold uppercase tracking-wider">Chờ duyệt</span>
            <Clock size={16} className="text-orange-500" />
          </div>
          <span className="text-2xl font-bold text-slate-800">{pendingRegistrations}</span>
        </button>
        <div className="bg-green-50 p-4 rounded-2xl border border-green-100 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between w-full mb-2">
            <span className="text-green-600 text-xs font-semibold uppercase tracking-wider">Đã duyệt</span>
            <CheckCircle2 size={16} className="text-green-500" />
          </div>
          <span className="text-2xl font-bold text-slate-800">{approvedRegistrations}</span>
        </div>
        <div className="bg-red-50 p-4 rounded-2xl border border-red-100 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between w-full mb-2">
            <span className="text-red-600 text-xs font-semibold uppercase tracking-wider">Từ chối</span>
            <X size={16} className="text-red-500" />
          </div>
          <span className="text-2xl font-bold text-slate-800">{rejectedRegistrations}</span>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50/75 text-slate-700 font-semibold border-b border-slate-100 text-[10px] tracking-wider uppercase">
              <tr>
                <th className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('student_id')}>
                  <div className="flex items-center gap-1">Mã SV {getSortIcon('student_id')}</div>
                </th>
                <th className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('student_name')}>
                  <div className="flex items-center gap-1">Họ và tên {getSortIcon('student_name')}</div>
                </th>
                <th className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('dob')}>
                  <div className="flex items-center gap-1">Ngày sinh {getSortIcon('dob')}</div>
                </th>
                <th className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('phone')}>
                  <div className="flex items-center gap-1">SĐT {getSortIcon('phone')}</div>
                </th>
                <th className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('personal_email')}>
                  <div className="flex items-center gap-1">Email cá nhân {getSortIcon('personal_email')}</div>
                </th>
                <th className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('class_name')}>
                  <div className="flex items-center gap-1">Lớp KH {getSortIcon('class_name')}</div>
                </th>
                <th className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('course_code')}>
                  <div className="flex items-center gap-1">Mã môn {getSortIcon('course_code')}</div>
                </th>
                <th className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('company_name')}>
                  <div className="flex items-center gap-1">Nơi thực tập {getSortIcon('company_name')}</div>
                </th>
                <th className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('note')}>
                  <div className="flex items-center gap-1">Ghi chú {getSortIcon('note')}</div>
                </th>
                <th className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('created_at')}>
                  <div className="flex items-center gap-1">Thời gian {getSortIcon('created_at')}</div>
                </th>
                <th className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('sent_to_company_at')}>
                  <div className="flex items-center gap-1">Gửi DN {getSortIcon('sent_to_company_at')}</div>
                </th>
                <th className="px-4 py-3 text-center">Thao tác</th>
                <th className="px-4 py-3 text-center cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('status')}>
                  <div className="flex items-center justify-center gap-1">Trạng thái {getSortIcon('status')}</div>
                </th>
                <th className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('review_comment')}>
                  <div className="flex items-center gap-1">Nhận xét {getSortIcon('review_comment')}</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRegistrations.length === 0 ? (
                <tr>
                  <td colSpan={14} className="px-6 py-8 text-center text-gray-500">Không có dữ liệu.</td>
                </tr>
              ) : (
                paginatedRegistrations.map(reg => (
                  <tr key={reg.registration_id} className="border-b last:border-0 border-slate-100 hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 font-mono">{reg.student_id || '-'}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{reg.student_name}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{reg.dob ? new Date(reg.dob).toLocaleDateString('vi-VN') : '-'}</td>
                    <td className="px-4 py-3 whitespace-nowrap font-mono">{reg.phone || '-'}</td>
                    <td className="px-4 py-3">{reg.personal_email ? <a href={`mailto:${reg.personal_email}`} className="text-blue-600 hover:underline font-mono">{reg.personal_email}</a> : '-'}</td>
                    <td className="px-4 py-3 font-medium">{reg.class_name || '-'}</td>
                    <td className="px-4 py-3 text-[11px] font-semibold text-slate-700">{reg.course_code?.split(' ').pop() || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">
                        {reg.company_name === 'Công ty khác' ? ('Công ty khác: ' + (reg.other_company_name || '')) : reg.company_name}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {reg.company_name === 'Công ty khác' ? (
                        <div className="text-xs text-gray-600 font-normal leading-relaxed">
                          <span className="inline-block font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded mb-1 border border-blue-100">Tự liên hệ</span><br />
                          <span className="font-semibold text-gray-700">Vị trí:</span> {reg.other_company_role} <br />
                          <span className="font-semibold text-gray-700">Liên hệ:</span> {reg.other_company_contact}
                          {reg.note && <><br /><span className="font-semibold text-gray-700">Lưu ý thêm:</span> {reg.note}</>}
                        </div>
                      ) : reg.company_name === 'Trường Đại học Công nghệ' ? (
                        <div className="text-xs text-gray-600 font-normal leading-relaxed">
                          <span className="font-semibold text-gray-700">GVHD:</span> {reg.other_company_contact}
                          {reg.other_company_role && <><br /><span className="font-semibold text-gray-700">Đồng HD:</span> {reg.other_company_role}</>}
                          {reg.note && <><br /><span className="font-semibold text-gray-700">Ghi chú:</span> {reg.note}</>}
                        </div>
                      ) : (
                        reg.note
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px]">{new Date(reg.created_at).toLocaleString('vi-VN')}</td>
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-[11px]">
                      {reg.sent_to_company_at ? (
                        <span className="text-emerald-700 font-semibold">{new Date(reg.sent_to_company_at).toLocaleString('vi-VN')}</span>
                      ) : (
                        <span className="text-slate-400">Chưa gửi</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => startEditRegistration(reg)}
                        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 shadow-sm transition-colors cursor-pointer"
                        title="Sửa thông tin đăng ký"
                      >
                        <Edit2 size={12} /> Sửa
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <select
                        value={reg.status}
                        onChange={(e) => handleUpdateStatus(reg.registration_id, e.target.value)}
                        className={`text-[11px] font-bold px-2 py-1 rounded-xl outline-none cursor-pointer border border-transparent transition-all shadow-sm ${reg.status === 'pending' ? 'bg-orange-100 text-orange-800 hover:bg-orange-200/50 focus:ring-2 focus:ring-orange-100' :
                          reg.status === 'approved' ? 'bg-green-100 text-green-800 hover:bg-green-200/50 focus:ring-2 focus:ring-green-100' :
                            'bg-red-100 text-red-800 hover:bg-red-200/50 focus:ring-2 focus:ring-red-100'
                          }`}
                      >
                        <option value="pending" className="bg-white text-slate-800">Chờ Duyệt</option>
                        <option value="approved" className="bg-white text-slate-800">Đã Duyệt</option>
                        <option value="rejected" className="bg-white text-slate-800">Từ Chối</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-slate-600 min-w-[220px] whitespace-pre-wrap leading-relaxed">
                      <div className="space-y-1.5">
                        <div className="text-[11px]">{reg.review_comment || '-'}</div>
                        <button
                          onClick={() => handleSendRegistrationComment(reg)}
                          className="inline-flex items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 hover:bg-blue-100 transition-colors shadow-sm cursor-pointer"
                        >
                          <Send size={10} /> Gửi nhận xét
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <PaginationControls
          total={filteredRegistrations.length}
          currentPage={registrationPage}
          pageSize={registrationPageSize}
          onPageChange={setRegistrationPage}
          label="đăng ký"
        />
      </div>

      {addingRegistration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl border border-slate-200 max-h-[90vh] overflow-hidden">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Thêm đăng ký thực tập</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Bổ sung một nguyện vọng mới cho sinh viên, kể cả sinh viên đã có đăng ký trước đó.
                </p>
              </div>
              <button onClick={closeAddRegistration} disabled={savingRegistration} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-60">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSaveRegistrationAdd} className="overflow-y-auto max-h-[calc(90vh-73px)]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-6 py-5">
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Sinh viên *</label>
                  <input
                    list="admin-add-registration-students"
                    value={addStudentQuery}
                    onChange={e => handleAddRegistrationStudentChange(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Nhập MSSV, họ tên hoặc email sinh viên..."
                    required
                  />
                  <datalist id="admin-add-registration-students">
                    {adminStudents.map(student => (
                      <option key={student.id} value={addStudentLabel(student)} />
                    ))}
                  </datalist>
                  <p className="mt-1 text-[11px] text-slate-500">Chọn một gợi ý để hệ thống xác định đúng tài khoản sinh viên.</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Nơi thực tập *</label>
                  <input
                    list="admin-add-registration-companies"
                    value={addCompanyQuery}
                    onChange={e => handleAddRegistrationCompanyChange(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Nhập tên công ty hoặc nơi thực tập..."
                    required
                  />
                  <datalist id="admin-add-registration-companies">
                    {companies.map(company => (
                      <option key={company.id} value={company.name} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Thứ tự nguyện vọng</label>
                  <input
                    type="number"
                    min="1"
                    value={addRegistrationForm.preference_order}
                    onChange={e => setAddRegistrationForm({ ...addRegistrationForm, preference_order: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Để trống = thêm vào cuối"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Học phần</label>
                  <select
                    value={addRegistrationForm.course_code}
                    onChange={e => setAddRegistrationForm({ ...addRegistrationForm, course_code: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Giữ nguyên học phần hiện tại của sinh viên</option>
                    <option value="Thực tập Doanh nghiệp INT4002">Thực tập Doanh nghiệp INT4002</option>
                    <option value="Thực tập Chuyên ngành INT3508">Thực tập Chuyên ngành INT3508</option>
                    <option value="Thực tập Doanh nghiệp Nhật Bản INT4003">Thực tập Doanh nghiệp Nhật Bản INT4003</option>
                  </select>
                </div>

                {addingIsOtherCompany && (
                  <>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Tên công ty tự liên hệ *</label>
                      <input
                        value={addRegistrationForm.other_company_name}
                        onChange={e => setAddRegistrationForm({ ...addRegistrationForm, other_company_name: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Tên công ty"
                        required={addingIsOtherCompany}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Vị trí thực tập</label>
                      <input
                        value={addRegistrationForm.other_company_role}
                        onChange={e => setAddRegistrationForm({ ...addRegistrationForm, other_company_role: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="VD: Frontend Intern"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Người liên hệ *</label>
                      <input
                        value={addOtherContact.contact_name}
                        onChange={e => setAddOtherContact({ ...addOtherContact, contact_name: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="VD: Anh Nguyễn Văn A"
                        required={addingIsOtherCompany}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Điện thoại *</label>
                      <input
                        type="tel"
                        pattern="^(0|\+84)[35789][0-9]{8}$"
                        title="Vui lòng nhập số điện thoại hợp lệ (10 số, VD: 0912345678)"
                        value={addOtherContact.contact_phone}
                        onChange={e => setAddOtherContact({ ...addOtherContact, contact_phone: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="VD: 0987654321"
                        required={addingIsOtherCompany}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Email *</label>
                      <input
                        type="email"
                        value={addOtherContact.contact_email}
                        onChange={e => setAddOtherContact({ ...addOtherContact, contact_email: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="VD: a@company.com"
                        required={addingIsOtherCompany}
                      />
                    </div>
                  </>
                )}

                {addingIsSchoolInternship && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Giảng viên hướng dẫn</label>
                      <input
                        list="admin-add-registration-primary-lecturers"
                        value={addRegistrationForm.other_company_contact}
                        onChange={e => setAddRegistrationForm({ ...addRegistrationForm, other_company_contact: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Nhập/chọn GVHD nếu đã có"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Giảng viên đồng hướng dẫn</label>
                      <input
                        list="admin-add-registration-co-lecturers"
                        value={addRegistrationForm.other_company_role}
                        onChange={e => setAddRegistrationForm({ ...addRegistrationForm, other_company_role: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Nhập/chọn đồng hướng dẫn nếu có"
                      />
                    </div>
                    <datalist id="admin-add-registration-primary-lecturers">
                      {adminLecturerNames.map(name => <option key={name} value={name} />)}
                    </datalist>
                    <datalist id="admin-add-registration-co-lecturers">
                      {adminLecturerNames.map(name => <option key={name} value={name} />)}
                    </datalist>
                  </>
                )}

                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Ghi chú đăng ký</label>
                  <textarea
                    rows={3}
                    value={addRegistrationForm.note}
                    onChange={e => setAddRegistrationForm({ ...addRegistrationForm, note: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Ghi chú từ Khoa hoặc thông tin sinh viên cung cấp"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Trạng thái</label>
                  <select
                    value={addRegistrationForm.status}
                    onChange={e => setAddRegistrationForm({ ...addRegistrationForm, status: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="approved">Đã duyệt</option>
                    <option value="pending">Chờ duyệt</option>
                    <option value="rejected">Từ chối</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Nhận xét gửi sinh viên</label>
                  <input
                    value={addRegistrationForm.review_comment}
                    onChange={e => setAddRegistrationForm({ ...addRegistrationForm, review_comment: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Không bắt buộc"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
                <button type="button" onClick={closeAddRegistration} disabled={savingRegistration} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                  Huỷ
                </button>
                <button type="submit" disabled={savingRegistration} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
                  {savingRegistration ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
                  {savingRegistration ? 'Đang thêm...' : 'Thêm đăng ký'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingRegistration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl border border-slate-200 max-h-[90vh] overflow-hidden">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Sửa đăng ký thực tập</h3>
                <p className="text-sm text-slate-500 mt-1">
                  {editingRegistration.student_id || '-'} - {editingRegistration.student_name || 'Sinh viên'}
                </p>
              </div>
              <button onClick={closeEditRegistration} disabled={savingRegistration || deletingRegistration} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-60">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSaveRegistrationEdit} className="overflow-y-auto max-h-[calc(90vh-73px)]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-6 py-5">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Nơi thực tập *</label>
                  <input
                    list="admin-edit-registration-companies"
                    value={editCompanyQuery}
                    onChange={e => handleEditRegistrationCompanyChange(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Nhập tên công ty hoặc nơi thực tập..."
                    required
                  />
                  <datalist id="admin-edit-registration-companies">
                    {companies.map(company => (
                      <option key={company.id} value={company.name} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Thứ tự nguyện vọng</label>
                  <input
                    type="number"
                    min="1"
                    value={editRegistrationForm.preference_order}
                    onChange={e => setEditRegistrationForm({ ...editRegistrationForm, preference_order: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="VD: 1"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Học phần</label>
                  <select
                    value={editRegistrationForm.course_code}
                    onChange={e => setEditRegistrationForm({ ...editRegistrationForm, course_code: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">-- Chưa xác định --</option>
                    <option value="Thực tập Doanh nghiệp INT4002">Thực tập Doanh nghiệp INT4002</option>
                    <option value="Thực tập Chuyên ngành INT3508">Thực tập Chuyên ngành INT3508</option>
                    <option value="Thực tập Doanh nghiệp Nhật Bản INT4003">Thực tập Doanh nghiệp Nhật Bản INT4003</option>
                  </select>
                </div>

                {editingIsOtherCompany && (
                  <>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Tên công ty tự liên hệ *</label>
                      <input
                        list="admin-edit-other-company-names"
                        value={editRegistrationForm.other_company_name}
                        onChange={e => setEditRegistrationForm({ ...editRegistrationForm, other_company_name: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Nhập để tìm hoặc thêm tên công ty"
                        required={editingIsOtherCompany}
                      />
                      <datalist id="admin-edit-other-company-names">
                        {otherCompanyNameSuggestions.map(companyName => (
                          <option key={companyName} value={companyName} />
                        ))}
                      </datalist>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Tên khớp danh sách thẩm định sẽ tự động được duyệt; tên mới sẽ chuyển sang Chờ duyệt.
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Vị trí thực tập</label>
                      <input
                        value={editRegistrationForm.other_company_role}
                        onChange={e => setEditRegistrationForm({ ...editRegistrationForm, other_company_role: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="VD: Frontend Intern"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Người liên hệ *</label>
                      <input
                        value={editOtherContact.contact_name}
                        onChange={e => setEditOtherContact({ ...editOtherContact, contact_name: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="VD: Anh Nguyễn Văn A"
                        required={editingIsOtherCompany}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Điện thoại *</label>
                      <input
                        type="tel"
                        pattern="^(0|\+84)[35789][0-9]{8}$"
                        title="Vui lòng nhập số điện thoại hợp lệ (10 số, VD: 0912345678)"
                        value={editOtherContact.contact_phone}
                        onChange={e => setEditOtherContact({ ...editOtherContact, contact_phone: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="VD: 0987654321"
                        required={editingIsOtherCompany}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Email *</label>
                      <input
                        type="email"
                        value={editOtherContact.contact_email}
                        onChange={e => setEditOtherContact({ ...editOtherContact, contact_email: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="VD: a@company.com"
                        required={editingIsOtherCompany}
                      />
                    </div>
                  </>
                )}

                {editingIsSchoolInternship && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Giảng viên hướng dẫn</label>
                      <input
                        list="admin-edit-registration-primary-lecturers"
                        value={editRegistrationForm.other_company_contact}
                        onChange={e => setEditRegistrationForm({ ...editRegistrationForm, other_company_contact: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Nhập/chọn GVHD nếu đã có"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Giảng viên đồng hướng dẫn</label>
                      <input
                        list="admin-edit-registration-co-lecturers"
                        value={editRegistrationForm.other_company_role}
                        onChange={e => setEditRegistrationForm({ ...editRegistrationForm, other_company_role: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Nhập/chọn đồng hướng dẫn nếu có"
                      />
                    </div>
                    <datalist id="admin-edit-registration-primary-lecturers">
                      {adminLecturerNames.map(name => <option key={name} value={name} />)}
                    </datalist>
                    <datalist id="admin-edit-registration-co-lecturers">
                      {adminLecturerNames.map(name => <option key={name} value={name} />)}
                    </datalist>
                  </>
                )}

                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Ghi chú đăng ký</label>
                  <textarea
                    rows={3}
                    value={editRegistrationForm.note}
                    onChange={e => setEditRegistrationForm({ ...editRegistrationForm, note: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Ghi chú của sinh viên hoặc điều chỉnh từ Khoa"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
                <button
                  type="button"
                  onClick={handleDeleteRegistration}
                  disabled={savingRegistration || deletingRegistration}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50/60 px-3.5 py-2 text-sm font-medium text-red-600 hover:bg-red-100 hover:border-red-300 active:scale-[0.98] transition-all disabled:opacity-60"
                  title="Xoá nguyện vọng đăng ký này"
                >
                  {deletingRegistration ? <RefreshCw size={16} className="animate-spin" /> : <Trash2 size={16} />}
                  {deletingRegistration ? 'Đang xoá...' : 'Xoá đăng ký'}
                </button>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={closeEditRegistration}
                    disabled={savingRegistration || deletingRegistration}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 active:scale-[0.98] transition-all disabled:opacity-60"
                  >
                    Huỷ
                  </button>
                  <button
                    type="submit"
                    disabled={savingRegistration || deletingRegistration}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-60"
                  >
                    {savingRegistration ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
                    {savingRegistration ? 'Đang lưu...' : 'Lưu thay đổi'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
