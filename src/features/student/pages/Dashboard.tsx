import { useNavigate } from 'react-router-dom';
import React, { useState, useEffect, useMemo } from 'react';
import {
  Upload, CheckCircle2, Download, LayoutDashboard, ArrowUpDown, AlertTriangle,
  ChevronRight, RefreshCw, Save, Plus, Trash2, X, ChevronDown, FileText, Edit2,
  Clock, Send, Lock, ClipboardList, UserCheck, FileCheck, User as UserIcon,
  GraduationCap, Bell, CircleHelp, Building2, Calendar, Award, ExternalLink, Sparkles, Mail, Shield, BookOpen
} from 'lucide-react';
import { saveAs } from 'file-saver';
import { API_BASE, DEFAULT_REGISTRATION_RULES, RegistrationRulesMarkdown, companyDescriptionText, isAuthExpiredResponse, CACHE_TTL, cachedJsonFetch, PaginationControls } from '../../../shared';
import { Badge, type BadgeVariant } from '../../../shared/ui';



export function Dashboard({ user, setUser, token, onAuthExpired }: { user: any, setUser: any, token: string, onAuthExpired: () => void }) {
  const [companies, setCompanies] = useState<any[]>([]);
  const [myRegs, setMyRegs] = useState<any[]>([]);
  const [myRegsError, setMyRegsError] = useState('');
  const [finalInternship, setFinalInternship] = useState<any>(null);
  const [myAdvisors, setMyAdvisors] = useState<any[]>([]);
  const [advisorRequest, setAdvisorRequest] = useState<any>(null);
  const [finalReport, setFinalReport] = useState<any>(null);
  const [myGrade, setMyGrade] = useState<any>(null);
  const [selectedMilestoneTab, setSelectedMilestoneTab] = useState<'registration' | 'confirmation' | 'advisor' | 'report' | null>(null);
  const [uploadingReport, setUploadingReport] = useState(false);
  const [campaign, setCampaign] = useState<any>({ year: '2026', start: '22/05/2026', end: '15/06/2026' });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [companyPage, setCompanyPage] = useState(1);
  const companyPageSize = 10;
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [showRegistrationDetails, setShowRegistrationDetails] = useState(false);
  const [showConfirmationDetails, setShowConfirmationDetails] = useState(false);
  const [editingPreferences, setEditingPreferences] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [selectedCompanies, setSelectedCompanies] = useState<Set<number>>(() => {
    try {
      const saved = sessionStorage.getItem('selectedCompanies');
      if (saved) return new Set(JSON.parse(saved));
    } catch { }
    return new Set();
  });
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [confirmFinalOpen, setConfirmFinalOpen] = useState(false);
  const [finalConfirmMode, setFinalConfirmMode] = useState<'company' | 'school'>('company');
  const [selectedFinalRegId, setSelectedFinalRegId] = useState('');
  const [finalSchoolLecturer, setFinalSchoolLecturer] = useState('');
  const [finalAttested, setFinalAttested] = useState(false);
  const [finalNote, setFinalNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [advisorRequestSaving, setAdvisorRequestSaving] = useState(false);
  const [isAdvisorEditOpen, setIsAdvisorEditOpen] = useState(false);
  const [isConfirmingFinal, setIsConfirmingFinal] = useState(false);
  const [itCompanyList, setItCompanyList] = useState<string[]>([]);
  const [lecturers, setLecturers] = useState<string[]>([]);
  const studentIdFromEmail = user?.email?.split('@')[0] || '';
  const [registerForm, setRegisterForm] = useState<any>({
    student_id: user?.student_id || studentIdFromEmail,
    dob: user?.dob || '',
    class_name: user?.class_name || '',
    course_code: user?.course_code || '',
    phone: user?.phone || '',
    personal_email: user?.personal_email || '',
    school_lecturer: '',
    school_co_lecturer: '',
    note: ''
  });
  const [otherCompanies, setOtherCompanies] = useState([{
    name: '',
    role: '',
    contact_name: '',
    contact_phone: '',
    contact_email: '',
    note: ''
  }]);
  const [advisorRequestForm, setAdvisorRequestForm] = useState({
    request_type: '',
    lecturer_name: '',
    co_lecturer_name: '',
    student_note: ''
  });
  const navigate = useNavigate();

  const hasRegistered = myRegs.length > 0;
  const primaryAdvisor = myAdvisors.find((advisor: any) => advisor.role === 'primary') || null;

  // Compute registration time window status (GMT+7)
  const registrationWindowStatus = useMemo(() => {
    const openStr = campaign?.registration_open_at;
    const closeStr = campaign?.registration_close_at;
    if (!openStr && !closeStr) return 'open'; // no restriction
    const toUTC = (s: string) => s ? new Date(s + ':00+07:00') : null;
    const now = new Date();
    const openUTC = openStr ? toUTC(openStr) : null;
    const closeUTC = closeStr ? toUTC(closeStr) : null;
    if (openUTC && now < openUTC) return 'not_open_yet';
    if (closeUTC && now > closeUTC) return 'closed';
    return 'open';
  }, [campaign]);
  const canWithdrawRegistration = registrationWindowStatus === 'open';

  const confirmationWindowStatus = useMemo(() => {
    const openStr = campaign?.confirmation_open_at;
    const closeStr = campaign?.confirmation_close_at;
    if (!openStr && !closeStr) return 'open';
    const toUTC = (s: string) => s ? new Date(s + ':00+07:00') : null;
    const now = new Date();
    const openUTC = openStr ? toUTC(openStr) : null;
    const closeUTC = closeStr ? toUTC(closeStr) : null;
    if (openUTC && now < openUTC) return 'not_open_yet';
    if (closeUTC && now > closeUTC) return 'closed';
    return 'open';
  }, [campaign]);

  const advisorRequestWindowStatus = useMemo(() => {
    const openStr = campaign?.advisor_request_open_at;
    const closeStr = campaign?.advisor_request_close_at;
    if (!openStr && !closeStr) return 'unconfigured';
    const toUTC = (s: string) => s ? new Date(s + ':00+07:00') : null;
    const now = new Date();
    const openUTC = openStr ? toUTC(openStr) : null;
    const closeUTC = closeStr ? toUTC(closeStr) : null;
    if (openUTC && now < openUTC) return 'not_open_yet';
    if (closeUTC && now > closeUTC) return 'closed';
    return 'open';
  }, [campaign]);
  const canEditAdvisorRequest = advisorRequestWindowStatus === 'open';

  const finalReportWindowStatus = useMemo(() => {
    const openStr = campaign?.final_report_open_at;
    const closeStr = campaign?.final_report_close_at;
    if (!openStr && !closeStr) return 'unconfigured';
    const toUTC = (s: string) => s ? new Date(s + ':00+07:00') : null;
    const now = new Date();
    const openUTC = openStr ? toUTC(openStr) : null;
    const closeUTC = closeStr ? toUTC(closeStr) : null;
    if (openUTC && now < openUTC) return 'not_open_yet';
    if (closeUTC && now > closeUTC) return 'closed';
    return 'open';
  }, [campaign]);

  const formatGMT7 = (isoLocal: string) => {
    if (!isoLocal) return '';
    const [date, time] = isoLocal.split('T');
    const [y, m, d] = date.split('-');
    return `${d}/${m}/${y} ${time}`;
  };

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 B';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const reportStatusLabel = (status?: string) => {
    if (status === 'accepted') return 'Đã chấp nhận';
    if (status === 'needs_revision') return 'Cần nộp lại';
    if (status === 'submitted') return 'Đã nộp';
    return 'Chưa nộp';
  };

  const khacCompany = companies.find(c => c.name === 'Công ty khác');
  const hasSelectedKhac = khacCompany && selectedCompanies.has(khacCompany.id);

  const schoolCompany = companies.find(c => c.name === 'Trường Đại học Công nghệ');
  const hasSelectedSchool = schoolCompany && selectedCompanies.has(schoolCompany.id);
  const selectedPreferencePreview = Array.from(selectedCompanies).flatMap((companyId) => {
    if (khacCompany && companyId === khacCompany.id) {
      return otherCompanies.map((otherCompany, index) => ({
        key: `other-${index}`,
        name: otherCompany.name?.trim() ? `(Khác) ${otherCompany.name.trim()}` : `Công ty tự liên hệ ${index + 1}`,
      }));
    }
    const company = companies.find(c => c.id === companyId);
    return [{ key: `company-${companyId}`, name: company?.name || 'Không rõ' }];
  });
  const selectedWishCount = selectedPreferencePreview.length;

  const startEditingPreferences = () => {
    const selectedIds = new Set<number>();
    const existingOtherCompanies: any[] = [];
    myRegs.forEach((reg: any) => {
      if (reg.company_name === 'Công ty khác' && khacCompany) {
        selectedIds.add(khacCompany.id);
        const contactParts = String(reg.other_company_contact || '').split(' - ');
        existingOtherCompanies.push({
          id: reg.id,
          name: reg.other_company_name || '',
          role: reg.other_company_role || '',
          contact_name: contactParts[0] || '',
          contact_phone: contactParts[1] || '',
          contact_email: contactParts.slice(2).join(' - ') || '',
          note: reg.note || ''
        });
      } else if (reg.company_id) {
        selectedIds.add(Number(reg.company_id));
      }
    });
    setSelectedCompanies(selectedIds);
    if (existingOtherCompanies.length > 0) {
      setOtherCompanies(existingOtherCompanies);
    } else {
      setOtherCompanies([{ name: '', role: '', contact_name: '', contact_phone: '', contact_email: '', note: '' }]);
    }
    setRegisterForm((prev: any) => ({ ...prev, note: '' }));
    setEditingPreferences(true);
  };

  const cancelEditingPreferences = () => {
    setSelectedCompanies(new Set());
    setOtherCompanies([{ name: '', role: '', contact_name: '', contact_phone: '', contact_email: '', note: '' }]);
    setEditingPreferences(false);
  };

  const savePreferenceEdits = async () => {
    if (savingPreferences) return;
    if (registrationWindowStatus !== 'open') {
      alert('Chỉ được sửa nguyện vọng trong thời gian Khoa mở đăng ký.');
      return;
    }
    if (selectedWishCount === 0) {
      alert('Vui lòng giữ ít nhất 1 nguyện vọng.');
      return;
    }
    if (selectedWishCount > 5) {
      alert('Sinh viên chỉ được chọn tối đa 5 nơi thực tập.');
      return;
    }
    const compactName = (value: string) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const seenCompanyIds = new Set<string>();
    const seenOtherNames = new Set<string>();
    const seenAllNames = new Set<string>();
    for (const companyId of Array.from(selectedCompanies)) {
      if (khacCompany && companyId === khacCompany.id) {
        for (const item of otherCompanies) {
          const name = String(item.name || '').trim();
          const role = String(item.role || '').trim();
          const contactName = String(item.contact_name || '').trim();
          const contactPhone = String(item.contact_phone || '').trim();
          const contactEmail = String(item.contact_email || '').trim();
          const contact = [item.contact_name, item.contact_phone, item.contact_email].map(v => String(v || '').trim()).filter(Boolean).join(' - ');
          if (!name || !role || !contactName || !contactPhone || !contactEmail || !contact) {
            alert('Vui lòng nhập đầy đủ tên công ty, vị trí và thông tin liên hệ cho các nguyện vọng tự liên hệ.');
            return;
          }
          const normalizedName = compactName(name);
          if (seenAllNames.has(normalizedName)) {
            alert(`Danh sách nguyện vọng bị trùng nơi thực tập "${name}".`);
            return;
          }
          seenAllNames.add(normalizedName);
          if (seenOtherNames.has(normalizedName)) {
            alert(`Nguyện vọng tự liên hệ bị trùng công ty "${name}".`);
            return;
          }
          seenOtherNames.add(normalizedName);
        }
      } else {
        const company = companies.find(c => Number(c.id) === Number(companyId));
        const companyName = company?.name || '';
        const companyIdText = String(companyId);
        if (!companyIdText || !company) {
          alert('Vui lòng chọn công ty hợp lệ cho tất cả nguyện vọng.');
          return;
        }
        if (seenCompanyIds.has(companyIdText)) {
          alert('Danh sách nguyện vọng có công ty bị chọn trùng.');
          return;
        }
        seenCompanyIds.add(companyIdText);
        const normalizedName = compactName(companyName);
        if (seenAllNames.has(normalizedName)) {
          alert(`Danh sách nguyện vọng bị trùng nơi thực tập "${companyName}".`);
          return;
        }
        seenAllNames.add(normalizedName);
      }
    }
    if (schoolCompany && selectedCompanies.has(schoolCompany.id) && selectedWishCount > 1) {
      alert('Nếu chọn Trường Đại học Công nghệ, sinh viên không được chọn thêm nơi thực tập khác.');
      return;
    }
    const accepted = window.confirm('Sinh viên chỉ được phép xác nhận thực tập tại 1 trong 5 nơi này. Nếu không pass tất cả, sẽ phải thực tập ở Trường.\n\nBạn chắc chắn muốn lưu thay đổi nguyện vọng?');
    if (!accepted) return;

    setSavingPreferences(true);
    try {
      const existingByCompanyId = new Map<number, any>(myRegs.filter((reg: any) => reg.company_name !== 'Công ty khác').map((reg: any) => [Number(reg.company_id), reg]));
      const payload = Array.from(selectedCompanies).flatMap((companyId) => {
        if (khacCompany && companyId === khacCompany.id) {
          return otherCompanies.map((c: any) => ({
            id: c.id || null,
            type: 'other',
            company_id: null,
            name: c.name,
            role: c.role,
            contact: [c.contact_name, c.contact_phone, c.contact_email].map(v => String(v || '').trim()).filter(Boolean).join(' - '),
            note: c.note || registerForm.note || '',
          }));
        }
        const existing = existingByCompanyId.get(Number(companyId));
        return [{
          id: existing?.id || null,
          type: 'company',
          company_id: Number(companyId),
          name: '',
          role: '',
          contact: '',
          note: existing?.note || registerForm.note || '',
        }];
      });
      const res = await fetch(`${API_BASE}/api/registrations/my/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ preferences: payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Không thể cập nhật nguyện vọng.');
        return;
      }
      const rows = data.registrations || [];
      setMyRegs(rows);
      setEditingPreferences(false);
      setSelectedCompanies(new Set());
      setOtherCompanies([{ name: '', role: '', contact_name: '', contact_phone: '', contact_email: '', note: '' }]);
      await fetchData();
      alert('Đã cập nhật nguyện vọng.');
    } catch (err) {
      alert('Lỗi kết nối khi cập nhật nguyện vọng.');
    } finally {
      setSavingPreferences(false);
    }
  };

  useEffect(() => {
    sessionStorage.setItem('selectedCompanies', JSON.stringify(Array.from(selectedCompanies)));
  }, [selectedCompanies]);

  // Sync registerForm whenever user profile updates (e.g. after registration saves phone/personal_email)
  useEffect(() => {
    setRegisterForm((prev: any) => ({
      ...prev,
      student_id: user?.student_id || studentIdFromEmail || prev.student_id,
      dob: user?.dob || prev.dob,
      class_name: user?.class_name || prev.class_name,
      course_code: user?.course_code || prev.course_code,
      phone: user?.phone || prev.phone,
      personal_email: user?.personal_email || prev.personal_email,
    }));
  }, [user]);

  const toggleCompanySelection = (companyId: number) => {
    setSelectedCompanies(prev => {
      const next = new Set(prev);
      const isSchool = schoolCompany && companyId === schoolCompany.id;
      const hasSchool = schoolCompany && prev.has(schoolCompany.id);

      if (next.has(companyId)) {
        next.delete(companyId);
      } else {
        if (isSchool) {
          alert("Lưu ý: Khi đăng ký Trường Đại học Công nghệ, bạn sẽ không được đăng ký thêm công ty nào khác.");
          return new Set([companyId]);
        }
        if (hasSchool) {
          alert("Bạn đã chọn Trường Đại học Công nghệ nên không thể chọn thêm công ty ngoài.");
          return prev;
        }
        if (next.size >= 5) return prev;
        next.add(companyId);
      }
      return next;
    });
  };

  const getLetterGrade = (score: number | null | undefined) => {
    if (score === null || score === undefined || isNaN(Number(score))) return { letter: '—', gpa: '—', label: 'Chưa có điểm' };
    const s = Number(score);
    if (s >= 9.0) return { letter: 'A+', gpa: '4.0', label: 'Xuất sắc' };
    if (s >= 8.5) return { letter: 'A', gpa: '4.0', label: 'Giỏi' };
    if (s >= 8.0) return { letter: 'B+', gpa: '3.5', label: 'Khá giỏi' };
    if (s >= 7.0) return { letter: 'B', gpa: '3.0', label: 'Khá' };
    if (s >= 6.5) return { letter: 'C+', gpa: '2.5', label: 'Trung bình khá' };
    if (s >= 5.5) return { letter: 'C', gpa: '2.0', label: 'Trung bình' };
    if (s >= 5.0) return { letter: 'D+', gpa: '1.5', label: 'Trung bình yếu' };
    if (s >= 4.0) return { letter: 'D', gpa: '1.0', label: 'Đạt' };
    return { letter: 'F', gpa: '0.0', label: 'Không đạt' };
  };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const isStudent = user?.role === 'student';
      const authHeaders = { Authorization: `Bearer ${token}` };
      const [compData, regRes, finalRes, advisorRes, advisorReqRes, reportRes, campData, itListData, lecData, gradeRes] = await Promise.all([
        cachedJsonFetch<any[]>(`${API_BASE}/api/companies`, {
          cacheKey: 'companies',
          ttlMs: CACHE_TTL.companies,
          headers: authHeaders,
          onAuthExpired,
        }),
        isStudent ? fetch(`${API_BASE}/api/registrations/my`, { headers: { Authorization: `Bearer ${token}` } }) : Promise.resolve(null),
        isStudent ? fetch(`${API_BASE}/api/internships/final/my`, { headers: { Authorization: `Bearer ${token}` } }) : Promise.resolve(null),
        isStudent ? fetch(`${API_BASE}/api/advisor/my`, { headers: { Authorization: `Bearer ${token}` } }) : Promise.resolve(null),
        isStudent ? fetch(`${API_BASE}/api/advisor/request/my`, { headers: { Authorization: `Bearer ${token}` } }) : Promise.resolve(null),
        isStudent ? fetch(`${API_BASE}/api/reports/final/my`, { headers: { Authorization: `Bearer ${token}` } }) : Promise.resolve(null),
        cachedJsonFetch<any>(`${API_BASE}/api/settings/campaign`, {
          cacheKey: 'settings:campaign',
          ttlMs: CACHE_TTL.campaign,
          headers: authHeaders,
          onAuthExpired,
        }),
        cachedJsonFetch<any[]>(`${API_BASE}/api/companies/it-list`, {
          cacheKey: 'companies:it-list:approved',
          ttlMs: CACHE_TTL.companies,
          headers: authHeaders,
          onAuthExpired,
        }),
        cachedJsonFetch<any[]>(`${API_BASE}/api/lecturers`, {
          cacheKey: 'lecturers:names',
          ttlMs: CACHE_TTL.lecturers,
          headers: authHeaders,
          onAuthExpired,
        }),
        isStudent ? fetch(`${API_BASE}/api/grades/my`, { headers: { Authorization: `Bearer ${token}` } }) : Promise.resolve(null),
      ]);

      setCompanies(Array.isArray(compData) ? compData : []);

      const authResponses = [regRes, finalRes, advisorRes, advisorReqRes, reportRes, gradeRes];
      for (const r of authResponses) {
        if (r && r.status === 401) {
          onAuthExpired();
          return;
        }
      }

      const regData = regRes ? await regRes.json().catch(() => null) : [];
      if (regRes && !regRes.ok) {
        if (isAuthExpiredResponse(regRes, regData)) return onAuthExpired();
        setMyRegsError(regData?.error || 'Không tải được danh sách đăng ký của bạn.');
      } else if (Array.isArray(regData)) {
        setMyRegs(regData);
        setMyRegsError('');
      } else {
        setMyRegsError('Dữ liệu đăng ký trả về không hợp lệ.');
      }

      const finalData = finalRes ? await finalRes.json() : null;
      setFinalInternship(finalData && !finalData.error ? finalData : null);

      const advisorData = advisorRes ? await advisorRes.json() : [];
      setMyAdvisors(Array.isArray(advisorData) ? advisorData : []);

      const advisorReqData = advisorReqRes ? await advisorReqRes.json().catch(() => null) : null;
      setAdvisorRequest(advisorReqData && !advisorReqData.error ? advisorReqData : null);
      if (advisorReqData && !advisorReqData.error) {
        setAdvisorRequestForm({
          request_type: advisorReqData.request_type === 'faculty_assign' ? '' : advisorReqData.request_type || '',
          lecturer_name: advisorReqData.lecturer_name || advisorReqData.lecturer_name_text || '',
          co_lecturer_name: advisorReqData.co_lecturer_name || advisorReqData.co_lecturer_name_text || '',
          student_note: advisorReqData.student_note || ''
        });
      }

      const reportData = reportRes ? await reportRes.json() : null;
      setFinalReport(reportData && !reportData.error ? reportData : null);

      const gradeData = gradeRes ? await gradeRes.json().catch(() => null) : null;
      setMyGrade(gradeData && !gradeData.error ? gradeData : null);

      if (campData && !campData.error) {
        setCampaign(campData);
      }

      setItCompanyList(Array.isArray(itListData) ? itListData : []);
      setLecturers(Array.isArray(lecData) ? lecData : []);
    } catch (e: any) {
      console.error(e);
      if (/401|unauthorized|hết hạn|invalid token/i.test(String(e?.message || ''))) {
        onAuthExpired();
        return;
      }
      if (user?.role === 'student') {
        setMyRegsError('Không kết nối được tới máy chủ để kiểm tra danh sách đăng ký.');
      }
    }
    setLoading(false);
  };

  const filteredCompanies = useMemo(() => companies.filter(company =>
    company.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    companyDescriptionText(company.description).toLowerCase().includes(searchTerm.toLowerCase())
  ), [companies, searchTerm]);

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

  const sortedCompanies = useMemo(() => [...filteredCompanies].sort((a, b) => {
    if (!sortConfig) return 0;
    const { key, direction } = sortConfig;
    const aVal = a[key] !== undefined ? a[key] : '';
    const bVal = b[key] !== undefined ? b[key] : '';

    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }

    if (aVal < bVal) return direction === 'asc' ? -1 : 1;
    if (aVal > bVal) return direction === 'asc' ? 1 : -1;
    return 0;
  }), [filteredCompanies, sortConfig]);
  useEffect(() => {
    setCompanyPage(1);
  }, [searchTerm, sortConfig, companies.length]);
  const companyTotalPages = Math.max(1, Math.ceil(sortedCompanies.length / companyPageSize));
  const safeCompanyPage = Math.min(companyPage, companyTotalPages);
  const paginatedCompanies = sortedCompanies.slice((safeCompanyPage - 1) * companyPageSize, safeCompanyPage * companyPageSize);

  const submitRegister = async (e: any) => {
    e.preventDefault();
    if (selectedWishCount === 0) return;
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const res = await fetch(`${API_BASE}/api/registrations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          company_ids: Array.from(selectedCompanies).filter(id => id !== khacCompany?.id),
          preferences: Array.from(selectedCompanies).flatMap((companyId) => {
            if (khacCompany && companyId === khacCompany.id) {
              return otherCompanies.map(c => ({
                type: 'other',
                name: c.name,
                role: c.role,
                contact: `${c.contact_name} - ${c.contact_phone} - ${c.contact_email}`,
                note: c.note || ''
              }));
            }
            return [{ type: 'company', company_id: companyId }];
          }),
          student_id: registerForm.student_id,
          dob: registerForm.dob,
          class_name: registerForm.class_name,
          course_code: registerForm.course_code,
          phone: registerForm.phone,
          personal_email: registerForm.personal_email,
          school_lecturer: registerForm.school_lecturer,
          school_co_lecturer: registerForm.school_co_lecturer,
          ...(canEditAdvisorRequest && advisorRequestForm.request_type ? {
            advisor_request: {
              request_type: advisorRequestForm.request_type,
              lecturer_name: advisorRequestForm.lecturer_name,
              co_lecturer_name: advisorRequestForm.co_lecturer_name,
              student_note: advisorRequestForm.student_note
            }
          } : {}),
          note: registerForm.note,
          other_companies: hasSelectedKhac ? otherCompanies.map(c => ({
            name: c.name,
            role: c.role,
            contact: `${c.contact_name} - ${c.contact_phone} - ${c.contact_email}`,
            note: c.note || ''
          })) : []
        })
      });
      const data = await res.json();
      if (res.ok) {
        if (data.user) {
          setUser(data.user);
          localStorage.setItem('user', JSON.stringify(data.user));
        }
        setRegisterModalOpen(false);
        setSelectedCompanies(new Set());
        setRegisterForm({ student_id: data.user?.student_id || user?.student_id || studentIdFromEmail, dob: data.user?.dob || user?.dob || '', class_name: data.user?.class_name || user?.class_name || '', course_code: data.user?.course_code || user?.course_code || '', phone: data.user?.phone || user?.phone || '', personal_email: data.user?.personal_email || user?.personal_email || '', school_lecturer: '', school_co_lecturer: '', note: '' });
        setAdvisorRequestForm({ request_type: '', lecturer_name: '', co_lecturer_name: '', student_note: '' });
        setOtherCompanies([{ name: '', role: '', contact_name: '', contact_phone: '', contact_email: '', note: '' }]);
        if (data.advisor_warning) alert(data.advisor_warning);
        fetchData();
      } else {
        alert(data.error);
      }
    } catch (e) {
      alert("Đăng ký lỗi!");
    } finally {
      setIsSubmitting(false);
    }
  };

  const uploadFinalReport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf') || (file.type && file.type !== 'application/pdf')) {
      alert('Vui lòng chọn file PDF.');
      e.target.value = '';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('File PDF vượt quá 10 MB. Vui lòng nén PDF xuống tối đa 10 MB rồi nộp lại.');
      e.target.value = '';
      return;
    }
    setUploadingReport(true);
    try {
      const res = await fetch(`${API_BASE}/api/reports/final`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/pdf',
          'X-Filename': encodeURIComponent(file.name)
        },
        body: file
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Nộp báo cáo thất bại.');
      setFinalReport(data);
      alert('Đã nộp báo cáo.');
    } catch (err) {
      alert('Lỗi kết nối khi nộp báo cáo.');
    } finally {
      setUploadingReport(false);
      e.target.value = '';
    }
  };

  const downloadMyFinalReport = async () => {
    if (!finalReport) return;
    const res = await fetch(`${API_BASE}/api/reports/final/${user.id}/download`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return alert('Không tải được báo cáo đã nộp.');
    saveAs(await res.blob(), finalReport.original_filename || 'final-report.pdf');
  };

  const handleWithdraw = async () => {
    if (!canWithdrawRegistration) {
      setIsWithdrawModalOpen(false);
      alert('Chỉ được hủy đăng ký trong thời gian Khoa mở đăng ký.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/registrations/my`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        fetchData();
        setIsWithdrawModalOpen(false);
      } else {
        alert(data.error || 'Không thể hủy đăng ký.');
      }
    } catch (e) {
      alert("Hủy lỗi!");
    }
  };

  const submitAdvisorRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (advisorRequestSaving) return;
    if (!canEditAdvisorRequest) {
      alert('Ngoài thời gian đăng ký Giảng viên hướng dẫn.');
      return;
    }
    if (advisorRequestForm.request_type !== 'agreed') {
      alert('Chỉ đăng ký GVHD khi sinh viên đã liên hệ và được giảng viên đồng ý hướng dẫn. Nếu chưa có GVHD, Khoa sẽ phân công sau.');
      return;
    }
    setAdvisorRequestSaving(true);
    try {
      const payload = {
        request_type: advisorRequestForm.request_type,
        lecturer_name: advisorRequestForm.lecturer_name,
        co_lecturer_name: advisorRequestForm.co_lecturer_name,
        student_note: advisorRequestForm.student_note,
      };
      const res = await fetch(`${API_BASE}/api/advisor/request/my`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.error || 'Không gửi được đăng ký GVHD.');
      setAdvisorRequest(data.request || null);
      setIsAdvisorEditOpen(false);
      alert(data.warning || 'Đã ghi nhận đăng ký GVHD.');
      fetchData();
    } catch (e) {
      alert('Lỗi kết nối khi gửi đăng ký GVHD.');
    } finally {
      setAdvisorRequestSaving(false);
    }
  };

  const cancelAdvisorRequest = async () => {
    if (advisorRequestSaving) return;
    if (!canEditAdvisorRequest) return alert('Ngoài thời gian đăng ký Giảng viên hướng dẫn.');
    if (!confirm('Hủy đăng ký giảng viên hướng dẫn hiện tại?')) return;
    setAdvisorRequestSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/advisor/request/my`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.error || 'Không hủy được đăng ký GVHD.');
      setAdvisorRequest(null);
      setMyAdvisors([]);
      setAdvisorRequestForm({ request_type: '', lecturer_name: '', co_lecturer_name: '', student_note: '' });
      setIsAdvisorEditOpen(true);
      fetchData();
    } catch (e) {
      alert('Lỗi kết nối khi hủy đăng ký GVHD.');
    } finally {
      setAdvisorRequestSaving(false);
    }
  };

  const approvedFinalOptions = myRegs.filter((reg: any) => reg.status === 'approved' && reg.company_name !== 'Trường Đại học Công nghệ');

  const openFinalConfirm = (mode: 'company' | 'school') => {
    setFinalConfirmMode(mode);
    setSelectedFinalRegId(mode === 'company' ? String(approvedFinalOptions[0]?.id || '') : '');
    setFinalSchoolLecturer(mode === 'school' && primaryAdvisor ? String(primaryAdvisor.lecturer_name || '') : '');
    setFinalAttested(false);
    setFinalNote('');
    setConfirmFinalOpen(true);
  };

  const submitFinalConfirmation = async (e: any) => {
    e.preventDefault();
    if (isConfirmingFinal) return;
    setIsConfirmingFinal(true);
    try {
      const payload = finalConfirmMode === 'school'
        ? {
          internship_type: 'school',
          school_lecturer: finalSchoolLecturer.trim(),
          school_assignment_request: !finalSchoolLecturer.trim(),
          note: finalNote
        }
        : { internship_type: 'company', registration_id: Number(selectedFinalRegId), attested: finalAttested, note: finalNote };
      const res = await fetch(`${API_BASE}/api/internships/final/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Xác nhận thất bại');
        return;
      }
      setConfirmFinalOpen(false);
      if (data.advisor_warning) alert(data.advisor_warning);
      fetchData();
    } catch (e) {
      alert('Lỗi kết nối khi xác nhận nơi thực tập.');
    } finally {
      setIsConfirmingFinal(false);
    }
  };

  if (loading) return <div className="text-center py-20 animate-pulse text-gray-500">Đang tải dữ liệu...</div>;
  const registrationRulesMarkdown = String(campaign.registration_rules_md || DEFAULT_REGISTRATION_RULES);
  const hasAdvisorSelection = myAdvisors.length > 0 || !!advisorRequest;
  const showAdvisorForm = advisorRequestWindowStatus === 'open' && (!hasAdvisorSelection || isAdvisorEditOpen);
  const campaignStatusItems = [
    {
      label: 'Đăng ký nguyện vọng',
      openAt: campaign.registration_open_at,
      closeAt: campaign.registration_close_at,
      status: (!campaign.registration_open_at && !campaign.registration_close_at) ? 'unconfigured' : registrationWindowStatus,
    },
    {
      label: 'Xác nhận nơi thực tập',
      openAt: campaign.confirmation_open_at,
      closeAt: campaign.confirmation_close_at,
      status: (!campaign.confirmation_open_at && !campaign.confirmation_close_at) ? 'unconfigured' : confirmationWindowStatus,
    },
    {
      label: 'Đăng ký GVHD',
      openAt: campaign.advisor_request_open_at,
      closeAt: campaign.advisor_request_close_at,
      status: (!campaign.advisor_request_open_at && !campaign.advisor_request_close_at) ? 'unconfigured' : advisorRequestWindowStatus,
    },
    {
      label: 'Nộp báo cáo',
      openAt: campaign.final_report_open_at,
      closeAt: campaign.final_report_close_at,
      status: (!campaign.final_report_open_at && !campaign.final_report_close_at) ? 'unconfigured' : finalReportWindowStatus,
    },
  ];
  const visibleCampaignStatusItems = campaignStatusItems;
  const campaignStatusText = (status: string) => status === 'open' ? 'Đang mở' : status === 'not_open_yet' ? 'Chưa mở' : status === 'unconfigured' ? 'Chưa cấu hình' : 'Đã đóng';
  const campaignBadgeVariant = (status: string): BadgeVariant => {
    if (status === 'open') return 'success';
    if (status === 'not_open_yet') return 'warning';
    return 'neutral';
  };
  const openCampaigns = campaignStatusItems.filter(item => item.status === 'open');
  const advisorCampaign = campaignStatusItems.find(item => item.label === 'Đăng ký GVHD');
  const registrationCampaign = campaignStatusItems.find(item => item.label === 'Đăng ký nguyện vọng' || item.label === 'Đăng ký thực tập');
  const openCampaign = (advisorCampaign?.status === 'open' && hasRegistered && !hasAdvisorSelection)
    ? advisorCampaign
    : (registrationCampaign?.status === 'open' && !hasRegistered)
      ? registrationCampaign
      : openCampaigns
        .sort((a, b) => String(b.openAt || '').localeCompare(String(a.openAt || '')))[0];
  const activeCampaignKey = openCampaign?.label?.includes('nguyện vọng') || openCampaign?.label?.includes('thực tập')
    ? 'registration'
    : openCampaign?.label === 'Xác nhận nơi thực tập'
      ? 'confirmation'
      : openCampaign?.label === 'Đăng ký GVHD'
        ? 'advisor'
        : 'report';
  const currentTab = selectedMilestoneTab || activeCampaignKey;
  const scoreText = (val: any) => (val === null || val === undefined || val === '' ? '—' : Number(val).toFixed(1));
  const activeCampaignTitle = openCampaign?.label || 'Đăng ký nguyện vọng';
  const showRegistrationTask = activeCampaignKey === 'registration' || registrationWindowStatus === 'open';
  const showConfirmationTask = activeCampaignKey === 'confirmation' && hasRegistered;
  const showAdvisorTask = advisorRequestWindowStatus === 'open' && hasRegistered;
  const showFinalReportTask = true;
  const showCompanyList = registrationWindowStatus === 'open' && (!hasRegistered || editingPreferences);
  const showConfirmationBlock = hasRegistered && showConfirmationDetails;
  const registrationSummary = hasRegistered
    ? `${myRegs.length} nơi đăng ký`
    : registrationWindowStatus === 'open'
      ? 'Chưa đăng ký'
      : 'Chưa có dữ liệu';
  const finalInternshipSummary = finalInternship
    ? (finalInternship.internship_type === 'school'
      ? 'Thực tập tại trường'
      : (finalInternship.company_name === 'Công ty khác' ? finalInternship.other_company_name || 'Công ty khác' : finalInternship.company_name))
    : 'Chưa xác nhận';
  const advisorSummary = myAdvisors.length > 0
    ? myAdvisors.map((a: any) => `${a.role === 'primary' ? 'Chính' : 'Đồng'}: ${a.lecturer_name}`).join('; ')
    : advisorRequest
      ? advisorRequest.request_type === 'faculty_assign'
        ? 'Khoa sẽ phân công'
        : advisorRequest.lecturer_name || advisorRequest.lecturer_name_text || 'Đã gửi đăng ký GVHD'
      : 'Chưa có GVHD';
  const finalReportSummary = finalReport ? reportStatusLabel(finalReport.status) : 'Chưa nộp';

  const stageTabs: Array<{
    id: 'registration' | 'confirmation' | 'advisor' | 'report';
    step: string;
    title: string;
    isDone: boolean;
    status: string;
    variant: BadgeVariant;
  }> = [
    {
      id: 'registration',
      step: '1',
      title: 'Nguyện vọng',
      isDone: hasRegistered,
      status: hasRegistered
        ? 'Đã ghi nhận'
        : (registrationWindowStatus === 'open' ? 'Đang mở' : 'Chưa đăng ký'),
      variant: hasRegistered
        ? 'success'
        : (registrationWindowStatus === 'open' ? 'info' : 'neutral'),
    },
    {
      id: 'confirmation',
      step: '2',
      title: 'Nơi thực tập',
      isDone: !!finalInternship,
      status: finalInternship
        ? 'Đã xác nhận'
        : (confirmationWindowStatus === 'open' ? 'Đang mở' : 'Chờ xác nhận'),
      variant: finalInternship
        ? 'success'
        : (confirmationWindowStatus === 'open' ? 'info' : 'warning'),
    },
    {
      id: 'advisor',
      step: '3',
      title: 'Giảng viên HD',
      isDone: myAdvisors.length > 0,
      status: myAdvisors.length > 0
        ? 'Đã phân công'
        : (advisorRequest ? 'Chờ duyệt' : 'Chưa có'),
      variant: myAdvisors.length > 0
        ? 'success'
        : (advisorRequest ? 'warning' : 'neutral'),
    },
    {
      id: 'report',
      step: '4',
      title: 'Báo cáo & Điểm',
      isDone: finalReport?.status === 'accepted',
      status: finalReport?.status === 'accepted'
        ? 'Đã duyệt'
        : (finalReport ? 'Đã nộp' : (finalReportWindowStatus === 'open' ? 'Đang mở' : 'Chưa nộp')),
      variant: finalReport?.status === 'accepted'
        ? 'success'
        : (finalReport ? 'info' : (finalReportWindowStatus === 'open' ? 'info' : 'neutral')),
    },
  ];


  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Student Academic Info & Quick Actions */}
      {user && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-xs">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-xs font-bold text-[#034ea1] bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-100">
              Kỳ {campaign.year}
            </span>
            <div className="text-xs text-slate-600 flex items-center gap-2">
              <span>MSSV: <strong className="text-slate-900">{user.student_id || studentIdFromEmail}</strong></span>
              <span className="text-slate-300">·</span>
              <span>Lớp: <strong className="text-slate-900">{user.class_name || 'Chưa cập nhật'}</strong></span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="https://drive.google.com/drive/u/0/folders/14Fm4yP-2Psj_qMpzI0pBARkcww1sblA3"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-slate-600 hover:text-[#034ea1] px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center gap-1.5 transition-colors"
            >
              <ExternalLink size={13} className="text-slate-500" /> Biểu mẫu Drive
            </a>
            {user?.role === 'admin' && (
              <button
                onClick={() => navigate('/admin')}
                className="bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Shield size={13} /> Quản trị Khoa
              </button>
            )}
          </div>
        </div>
      )}

      {/* 2. Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Sidebar (lg:col-span-3): Trạng thái hệ thống & Quy định đăng ký */}
        <aside className="lg:col-span-3 space-y-4 lg:sticky lg:top-6">
          {/* Card 1: Trạng thái hệ thống */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
              <div className="flex items-center gap-1.5">
                <Clock size={15} className="text-blue-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Trạng thái hệ thống</h3>
              </div>
              <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">GMT+7</span>
            </div>
            <div className="space-y-2">
              {visibleCampaignStatusItems.map((item) => (
                <div key={item.label} className="p-2.5 rounded-xl bg-slate-50/70 border border-slate-100 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-slate-800 truncate">{item.label}</span>
                    <Badge variant={campaignBadgeVariant(item.status)} size="sm">
                      {campaignStatusText(item.status)}
                    </Badge>
                  </div>

                  <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
                    <span>Hạn:</span>
                    <span className="font-medium text-slate-700">
                      {item.closeAt ? formatGMT7(item.closeAt) : 'Chưa thiết lập'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Card 2: Quy định đăng ký */}
          <details open className="group bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <summary className="flex items-center justify-between font-bold text-slate-800 cursor-pointer select-none text-xs uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <BookOpen size={15} className="text-blue-600" />
                Quy định thực tập
              </span>
              <ChevronDown size={14} className="text-slate-400 group-open:rotate-180 transition-transform" />
            </summary>
            <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600 leading-relaxed max-h-72 overflow-y-auto pr-1">
              {registrationRulesMarkdown.trim() ? (
                <RegistrationRulesMarkdown content={registrationRulesMarkdown} />
              ) : (
                <p className="italic text-slate-400">Khoa chưa cập nhật quy định cho đợt này.</p>
              )}
            </div>
          </details>
        </aside>

        {/* Right Content Column (lg:col-span-9): Stepper Navigation & Stage Workspace */}
        <div className="lg:col-span-9 min-w-0 space-y-4">
          {/* 4 Giai đoạn thực tập - Sleek Stepper Navigation Bar */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-1.5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-1">
              {stageTabs.map((tab) => {
                const isSelected = currentTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setSelectedMilestoneTab(tab.id as any)}
                    className={`py-2.5 px-3 rounded-xl text-left transition-all cursor-pointer flex items-center justify-between gap-1.5 ${
                      isSelected
                        ? 'bg-blue-50 text-blue-700 font-bold border border-blue-200/80 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50 font-medium border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                        isSelected
                          ? 'bg-blue-600 text-white'
                          : tab.isDone
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}>
                        {tab.isDone ? <CheckCircle2 size={12} /> : tab.step}
                      </span>
                      <span className="text-xs truncate">{tab.title}</span>
                    </div>
                    <Badge variant={tab.variant} size="sm">
                      {tab.status}
                    </Badge>

                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Stage Workspace */}
          <main className="space-y-4">
        {myRegsError && (
          <div className="rounded-2xl border border-amber-200/80 bg-amber-50/80 p-4 text-xs text-amber-900 leading-relaxed shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <strong>Hệ thống chưa kiểm tra được danh sách đăng ký của bạn.</strong>
              <p className="mt-0.5 text-amber-800">Vui lòng tải lại trang hoặc đăng nhập lại: {myRegsError}</p>
            </div>
            <button
              onClick={onAuthExpired}
              className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold text-xs whitespace-nowrap cursor-pointer transition-colors shadow-xs"
            >
              Đăng nhập lại ngay
            </button>
          </div>
        )}

        {/* GIAI ĐOẠN 4: NỘP BÁO CÁO & ĐIỂM */}
        {currentTab === 'report' && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-slate-100">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Báo cáo thực tập</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Hạn nộp: {campaign.final_report_close_at ? formatGMT7(campaign.final_report_close_at) : 'Chưa thiết lập'} (GMT+7)
                  </p>
                </div>
                <div>
                  {finalReport?.status === 'accepted' ? (
                    <Badge variant="success" size="md">Đã duyệt báo cáo</Badge>
                  ) : finalReport ? (
                    <Badge variant="info" size="md">Đã nộp báo cáo</Badge>
                  ) : (
                    <Badge variant="warning" size="md">Chưa nộp</Badge>
                  )}
                </div>

              </div>

              {finalReport ? (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl bg-slate-50/60 border border-slate-200 gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-slate-900 truncate" title={finalReport.original_filename}>
                      {finalReport.original_filename}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {formatBytes(Number(finalReport.file_size || 0))} · Nộp lúc {finalReport.submitted_at ? new Date(finalReport.submitted_at).toLocaleString('vi-VN') : '-'}
                    </div>
                    {finalReport.lecturer_comment && (
                      <div className="mt-2.5 text-xs text-amber-800 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
                        <strong>Nhận xét GVHD:</strong> {finalReport.lecturer_comment}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={downloadMyFinalReport}
                      className="bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-xl hover:bg-slate-50 text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer hover:shadow active:scale-[0.98]"
                    >
                      <Download size={14} className="text-slate-500" /> Tải PDF
                    </button>
                    <label className="bg-[#034ea1] hover:bg-[#023a7a] text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer hover:shadow active:scale-[0.98]">
                      <Upload size={14} />
                      {uploadingReport ? 'Đang nộp...' : 'Nộp lại'}
                      <input
                        type="file"
                        accept="application/pdf,.pdf"
                        disabled={finalReportWindowStatus !== 'open' || uploadingReport}
                        className="hidden"
                        onChange={uploadFinalReport}
                      />
                    </label>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center border border-dashed border-slate-250 rounded-xl space-y-2.5 bg-slate-50/40">
                  <p className="text-xs text-slate-500">Bạn chưa nộp file báo cáo thực tập.</p>
                  <label className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-[#034ea1] text-white hover:bg-[#023a7a] cursor-pointer shadow-xs hover:shadow transition-all active:scale-[0.98]">
                    <Upload size={14} />
                    {uploadingReport ? 'Đang tải lên...' : 'Chọn file PDF để nộp'}
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      disabled={finalReportWindowStatus !== 'open' || uploadingReport}
                      className="hidden"
                      onChange={uploadFinalReport}
                    />
                  </label>
                </div>
              )}

              {/* Score Section */}
              <div className="pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Kết quả đánh giá học phần</span>
                  <button
                    type="button"
                    onClick={() => navigate('/grades')}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
                  >
                    Bảng điểm chi tiết →
                  </button>
                </div>
                {myGrade?.final_score !== null && myGrade?.final_score !== undefined ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="text-xs text-slate-500 font-medium">Tổng kết</div>
                      <div className="text-2xl font-bold text-slate-900 mt-0.5">{Number(myGrade.final_score).toFixed(1)}</div>
                      <div className="text-[11px] text-emerald-600 font-semibold">{getLetterGrade(myGrade.final_score).letter} · GPA {getLetterGrade(myGrade.final_score).gpa}</div>
                    </div>
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="text-xs text-slate-500 font-medium">Quá trình (20%)</div>
                      <div className="text-base font-semibold text-slate-900 mt-1">{scoreText(myGrade.progress_score)}</div>
                    </div>
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="text-xs text-slate-500 font-medium">Báo cáo (20%)</div>
                      <div className="text-base font-semibold text-slate-900 mt-1">{scoreText(myGrade.report_score)}</div>
                    </div>
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="text-xs text-slate-500 font-medium">Đánh giá của DN/GVHD (60%)</div>
                      <div className="text-base font-semibold text-slate-900 mt-1">{scoreText(myGrade.company_score)}</div>
                    </div>

                  </div>
                ) : (
                  <div className="text-xs text-slate-500 font-medium">
                    Báo cáo đang trong quá trình chấm điểm.
                  </div>
                )}
              </div>

              {/* Clean, accurate note */}
              <div className="p-3.5 rounded-xl bg-blue-50/50 border border-blue-100 text-xs text-blue-900 leading-relaxed font-medium">
                <strong className="text-blue-950">Lưu ý:</strong> Sinh viên chỉ cần in riêng trang <strong>Phiếu đánh giá</strong> để xin nhận xét, điểm và chữ ký của người hướng dẫn + dấu của công ty. Sau đó scan và gộp vào file PDF nộp lên hệ thống.
              </div>
            </div>
          </div>
        )}

        {/* GIAI ĐOẠN 1: ĐĂNG KÝ NGUYỆN VỌNG */}
        {currentTab === 'registration' && (
          <div className="space-y-6">
            {hasRegistered ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
                {!editingPreferences ? (
                  <div>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100 mb-5">
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">Nguyện vọng đã đăng ký</h3>
                        <p className="text-xs text-slate-500 mt-1">
                          Thời gian ghi nhận: {myRegs[0]?.created_at ? new Date(myRegs[0].created_at).toLocaleDateString('vi-VN') : '-'}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={startEditingPreferences}
                          disabled={!canWithdrawRegistration}
                          className={`bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-xl hover:bg-slate-50 text-xs font-semibold shadow-xs transition-all cursor-pointer hover:shadow active:scale-[0.98] ${!canWithdrawRegistration ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          Sửa nguyện vọng
                        </button>
                        <button
                          type="button"
                          onClick={() => canWithdrawRegistration && setIsWithdrawModalOpen(true)}
                          disabled={!canWithdrawRegistration}
                          className={`bg-red-50 text-red-600 border border-red-200 px-4 py-2 rounded-xl hover:bg-red-100/80 text-xs font-semibold transition-all cursor-pointer hover:shadow active:scale-[0.98] ${!canWithdrawRegistration ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          Hủy tất cả
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2.5 mb-4">
                      {myRegs.map((reg: any, idx: number) => (
                        <div key={reg.id} className="flex items-start sm:items-center justify-between p-3.5 bg-slate-50/60 hover:bg-slate-100/60 border border-slate-200 rounded-xl transition-colors">
                          <div className="min-w-0 flex-1 pr-4">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[10px] font-bold text-[#034ea1] bg-[#034ea1]/10 px-2 py-0.5 rounded border border-[#034ea1]/20">NV{idx + 1}</span>
                              <span className="text-sm font-semibold text-slate-900">
                                {reg.company_name === 'Công ty khác' ? `(Khác) ${reg.other_company_name || ''}` : reg.company_name}
                              </span>
                            </div>
                            {reg.review_comment && (
                              <div className="text-xs text-slate-600 mt-1.5 bg-white border border-slate-200 rounded-lg p-2.5 shadow-xs">
                                <span className="font-semibold text-slate-800">Nhận xét của Khoa:</span> {reg.review_comment}
                              </div>
                            )}
                          </div>
                          <Badge
                            variant={reg.status === 'approved' ? 'success' : reg.status === 'rejected' ? 'error' : 'warning'}
                            size="sm"
                          >
                            {reg.status === 'pending' ? 'Chờ duyệt' : reg.status === 'approved' ? 'Đã duyệt' : 'Từ chối'}
                          </Badge>
                        </div>
                      ))}
                    </div>

                    {canWithdrawRegistration && (
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Trong thời gian Khoa mở đăng ký, sinh viên có thể chỉnh sửa từng nguyện vọng, thêm hoặc bỏ bớt nơi thực tập.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100">
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">Chỉnh sửa nguyện vọng</h3>
                        <p className="text-xs text-slate-500 mt-1">Chọn thêm hoặc bỏ bớt nơi thực tập từ danh sách bên dưới</p>
                      </div>
                      <Badge variant="info" size="md" dot={false}>
                        Đang chọn {selectedWishCount}/5
                      </Badge>
                    </div>


                    {selectedPreferencePreview.length > 0 && (
                      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                        <div className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Nguyện vọng sau khi chỉnh sửa</div>
                        <ol className="space-y-1.5 text-xs text-slate-900">
                          {selectedPreferencePreview.map((item, idx) => (
                            <li key={item.key} className="flex items-center gap-2">
                              <span className="font-bold text-[#034ea1] bg-[#034ea1]/10 px-1.5 py-0.5 rounded text-[10px]">NV{idx + 1}</span>
                              <span className="font-semibold text-slate-800">{item.name}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row justify-end gap-2 border-t border-slate-100 pt-4">
                      <button
                        type="button"
                        onClick={cancelEditingPreferences}
                        disabled={savingPreferences}
                        className="bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-xl hover:bg-slate-50 text-xs font-semibold cursor-pointer disabled:opacity-50"
                      >
                        Hủy chỉnh sửa
                      </button>
                      <button
                        type="button"
                        onClick={savePreferenceEdits}
                        disabled={savingPreferences}
                        className="bg-[#034ea1] hover:bg-[#023a7a] text-white px-5 py-2.5 rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-50 shadow-xs"
                      >
                        {savingPreferences ? 'Đang lưu...' : 'Lưu thay đổi'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm text-xs text-slate-500 space-y-1">
                <h3 className="font-bold text-base text-slate-900">Chưa có nguyện vọng nào</h3>
                <p>
                  {registrationWindowStatus === 'open'
                    ? 'Đợt đăng ký đang mở. Vui lòng tick chọn tối đa 5 nơi thực tập từ danh sách bên dưới rồi bấm Đăng ký.'
                    : 'Đợt đăng ký nguyện vọng hiện không mở.'}
                </p>
              </div>
            )}

            {/* Company table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row gap-3 sm:items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-800 text-sm">Danh mục nơi thực tập</span>
                  {(!hasRegistered || editingPreferences) && selectedWishCount > 0 && (
                    <Badge variant="info" size="sm" dot={false}>
                      Đã chọn: {selectedWishCount}/5
                    </Badge>
                  )}

                </div>
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Tìm nơi thực tập..."
                    className="px-3.5 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all w-full sm:w-64 bg-white text-slate-800 shadow-inner"
                  />
                  {!hasRegistered && registrationWindowStatus === 'open' && (
                    <button
                      type="button"
                      disabled={selectedWishCount === 0}
                      onClick={() => setRegisterModalOpen(true)}
                      className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer shadow-xs ${
                        selectedWishCount === 0 ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-[#034ea1] text-white hover:bg-[#023a7a]'
                      }`}
                    >
                      Đăng ký ({selectedWishCount})
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left min-w-[650px]">
                  <thead>
                    <tr className="bg-slate-50/80 text-slate-500 text-[11px] uppercase tracking-wider font-bold border-b border-slate-200">
                      <th className="px-3 py-2.5 text-center w-12">Chọn</th>
                      <th className="px-5 py-2.5 cursor-pointer hover:bg-slate-100/60" onClick={() => requestSort('name')}>
                        Nơi thực tập
                      </th>
                      <th className="px-5 py-2.5">Địa chỉ</th>
                      <th className="px-4 py-2.5 text-center">Chỉ tiêu</th>
                      <th className="px-4 py-2.5 text-center">Ứng viên</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs divide-y divide-slate-100">
                    {paginatedCompanies.map((company) => {
                      const isSelected = selectedCompanies.has(company.id);
                      const isRegistered = myRegs.some((r: any) => r.company_id === company.id);
                      return (
                        <tr key={company.id} className={`hover:bg-slate-50/60 transition-colors ${isSelected ? 'bg-blue-50/40' : ''}`}>
                          <td className="px-3 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected || (!editingPreferences && isRegistered)}
                              disabled={(!editingPreferences && hasRegistered) || (!isSelected && selectedWishCount >= 5)}
                              onChange={() => toggleCompanySelection(company.id)}
                              className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer disabled:opacity-40"
                            />
                          </td>
                          <td className="px-5 py-3 font-semibold text-blue-600">
                            <button
                              type="button"
                              onClick={() => navigate(`/company/${company.id}`)}
                              className="text-blue-600 hover:underline text-left cursor-pointer"
                            >
                              {company.name}
                            </button>
                          </td>
                          <td className="px-5 py-3 text-slate-600">{company.address}</td>
                          <td className="px-4 py-3 text-center font-medium text-slate-800">{company.slots}</td>
                          <td className="px-4 py-3 text-center font-medium text-slate-800">{company.applicant_count ?? 0}</td>
                        </tr>
                      );
                    })}
                    {sortedCompanies.length === 0 && !loading && (
                      <tr>
                        <td colSpan={5} className="px-5 py-6 text-center text-slate-400">Không tìm thấy nơi thực tập phù hợp.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <PaginationControls
                total={sortedCompanies.length}
                currentPage={companyPage}
                pageSize={companyPageSize}
                onPageChange={setCompanyPage}
                label="nơi thực tập"
              />
            </div>
          </div>
        )}

        {/* GIAI ĐOẠN 2: XÁC NHẬN NƠI THỰC TẬP */}
        {currentTab === 'confirmation' && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Xác nhận nơi thực tập</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Hạn xác nhận: {campaign.confirmation_close_at ? formatGMT7(campaign.confirmation_close_at) : 'Chưa thiết lập'} (GMT+7)
                </p>
              </div>
              {finalInternship && (
                <Badge variant="success" size="md">
                  Đã xác nhận
                </Badge>
              )}

            </div>

            {finalInternship ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs bg-slate-50/60 p-4 rounded-xl border border-slate-200">
                  <div>
                    <span className="text-slate-500 block mb-1">Đơn vị:</span>
                    <strong className="text-sm text-slate-900 font-bold">
                      {finalInternship.internship_type === 'school' ? 'Thực tập tại trường (ĐH Công nghệ - ĐHQGHN)' : finalInternship.company_name}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-1">Hình thức:</span>
                    <strong className="text-sm text-slate-900 font-bold">
                      {finalInternship.internship_type === 'school' ? 'Nghiên cứu tại Trường' : 'Doanh nghiệp'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-1">Thời gian:</span>
                    <span className="text-slate-800 font-medium">
                      {finalInternship.confirmed_at ? new Date(finalInternship.confirmed_at).toLocaleString('vi-VN') : '-'}
                    </span>
                  </div>
                </div>

                {!finalInternship.locked_at && confirmationWindowStatus === 'open' && (
                  <div className="border-t border-slate-100 pt-4 flex justify-end gap-2.5">
                    <button
                      type="button"
                      onClick={() => openFinalConfirm('company')}
                      disabled={approvedFinalOptions.length === 0}
                      className="bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-xl text-xs font-semibold hover:bg-slate-50 cursor-pointer disabled:opacity-50 shadow-xs hover:shadow active:scale-[0.98]"
                    >
                      Đổi công ty
                    </button>
                    <button
                      type="button"
                      onClick={() => openFinalConfirm('school')}
                      className="bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-xl text-xs font-semibold hover:bg-slate-50 cursor-pointer shadow-xs hover:shadow active:scale-[0.98]"
                    >
                      Đổi sang trường
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4 text-xs">
                <p className="text-slate-600">
                  Vui lòng xác nhận đơn vị thực tập chính thức của bạn trong đợt này.
                </p>
                <div className="flex justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => openFinalConfirm('company')}
                    disabled={confirmationWindowStatus !== 'open' || approvedFinalOptions.length === 0}
                    className="bg-[#034ea1] hover:bg-[#023a7a] text-white px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-50 shadow-xs"
                  >
                    Xác nhận công ty
                  </button>
                  <button
                    type="button"
                    onClick={() => openFinalConfirm('school')}
                    disabled={confirmationWindowStatus !== 'open'}
                    className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-50 shadow-xs"
                  >
                    Thực tập tại trường
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* GIAI ĐOẠN 3: GIẢNG VIÊN HƯỚNG DẪN */}
        {currentTab === 'advisor' && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Giảng viên hướng dẫn</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Hạn đăng ký GVHD: {campaign.advisor_request_close_at ? formatGMT7(campaign.advisor_request_close_at) : 'Chưa thiết lập'} (GMT+7)
                </p>
              </div>
              <div className="flex items-center gap-2">
                {myAdvisors.length > 0 ? (
                  <Badge variant="success" size="md">Đã phân công</Badge>
                ) : advisorRequest ? (
                  <Badge variant="warning" size="md">Chờ duyệt</Badge>
                ) : null}
                {canEditAdvisorRequest && (
                  <button
                    type="button"
                    onClick={() => setIsAdvisorEditOpen(prev => !prev)}
                    className="bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-xl text-xs font-semibold hover:bg-slate-50 cursor-pointer shadow-xs hover:shadow active:scale-[0.98]"
                  >
                    {isAdvisorEditOpen ? 'Đóng chỉnh sửa' : 'Đăng ký / Đổi GVHD'}
                  </button>
                )}
              </div>

            </div>

            {hasAdvisorSelection ? (
              <div className="p-4 rounded-xl bg-slate-50/60 border border-slate-200 space-y-3">
                <div className="space-y-2">
                  {myAdvisors.length > 0 ? (
                    myAdvisors.map((a: any) => (
                      <div key={`${a.role}-${a.lecturer_id}`} className="flex items-center justify-between gap-3 text-xs">
                        <div>
                          <span className="font-bold text-slate-900">{a.lecturer_name}</span>
                          <span className="text-slate-500 ml-1.5 font-medium">({a.role === 'primary' ? 'GV chính' : 'Đồng HD'})</span>
                          {a.lecturer_email && (
                            <div className="text-blue-600 text-xs mt-0.5 font-medium">{a.lecturer_email}</div>
                          )}
                        </div>
                        {a.lecturer_email && (
                          <a
                            href={`mailto:${a.lecturer_email}?subject=[Học phần Thực tập] ${user?.name} - ${user?.student_id}`}
                            className="bg-white text-slate-700 border border-slate-200 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-50 shadow-xs"
                          >
                            Gửi email
                          </a>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="text-xs font-bold text-slate-900">
                      {advisorRequest?.request_type === 'faculty_assign'
                        ? 'Khoa sẽ phân công'
                        : advisorRequest?.lecturer_name || advisorRequest?.lecturer_name_text || '-'}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-6 text-center border border-dashed border-slate-250 rounded-xl text-xs text-slate-500 bg-slate-50/40">
                Chưa có giảng viên hướng dẫn. Khoa sẽ phân công sau khi kết thúc đợt xác nhận nơi thực tập.
              </div>
            )}

            {showAdvisorForm && (
              <form onSubmit={submitAdvisorRequest} className="rounded-xl border border-slate-200 bg-slate-50/60 p-5 space-y-3">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Đăng ký giảng viên hướng dẫn</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  <select
                    value={advisorRequestForm.request_type}
                    onChange={e => {
                      const requestType = e.target.value;
                      setAdvisorRequestForm({
                        ...advisorRequestForm,
                        request_type: requestType,
                        lecturer_name: requestType ? advisorRequestForm.lecturer_name : '',
                        co_lecturer_name: requestType ? advisorRequestForm.co_lecturer_name : ''
                      });
                    }}
                    className="px-3.5 py-2 border border-slate-200 rounded-xl text-xs bg-white font-medium text-slate-800"
                  >
                    <option value="">Khoa tự phân công</option>
                    <option value="agreed">Sinh viên đã được GV đồng ý</option>
                  </select>
                  <input
                    value={advisorRequestForm.lecturer_name}
                    onChange={e => setAdvisorRequestForm({ ...advisorRequestForm, lecturer_name: e.target.value })}
                    disabled={!advisorRequestForm.request_type}
                    required={!!advisorRequestForm.request_type}
                    list="advisor-primary-lecturers"
                    placeholder="GVHD chính"
                    className="px-3.5 py-2 border border-slate-200 rounded-xl text-xs bg-white text-slate-800 disabled:bg-slate-100"
                  />
                  <input
                    value={advisorRequestForm.co_lecturer_name}
                    onChange={e => setAdvisorRequestForm({ ...advisorRequestForm, co_lecturer_name: e.target.value })}
                    disabled={!advisorRequestForm.request_type}
                    list="advisor-co-lecturers"
                    placeholder="Đồng hướng dẫn (nếu có)"
                    className="px-3.5 py-2 border border-slate-200 rounded-xl text-xs bg-white text-slate-800 disabled:bg-slate-100"
                  />
                  <datalist id="advisor-primary-lecturers">
                    {lecturers.map(name => <option key={name} value={name} />)}
                  </datalist>
                  <datalist id="advisor-co-lecturers">
                    {lecturers.map(name => <option key={name} value={name} />)}
                  </datalist>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={advisorRequestSaving || !canEditAdvisorRequest}
                    className="bg-[#034ea1] text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-[#023a7a] cursor-pointer disabled:opacity-50 shadow-xs"
                  >
                    {advisorRequestSaving ? 'Đang lưu...' : 'Lưu đăng ký GVHD'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
          </main>
        </div>
      </div>

      {/* Withdraw Modal */}
      {isWithdrawModalOpen && canWithdrawRegistration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 border border-slate-200">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <AlertTriangle size={24} />
              <h3 className="text-lg font-bold">Xác nhận hủy đăng ký</h3>
            </div>
            <p className="text-slate-600 mb-6 text-sm leading-relaxed">
              Bạn có chắc chắn muốn hủy toàn bộ nguyện vọng đăng ký thực tập hiện tại để đăng ký lại?
              <br /><br />
              <strong>Lưu ý:</strong> Hệ thống chỉ hủy danh sách nguyện vọng và nơi thực tập chính thức chưa khóa. Thông tin hồ sơ cá nhân, số điện thoại, email cá nhân và thông tin GVHD đã đăng ký/phân công sẽ được giữ lại.
            </p>
            <div className="flex justify-end gap-2.5 mt-6">
              <button
                onClick={() => setIsWithdrawModalOpen(false)}
                className="bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-xl hover:bg-slate-50 text-xs font-semibold shadow-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                Đóng
              </button>
              <button
                onClick={handleWithdraw}
                className="bg-red-600 hover:bg-red-750 text-white px-5 py-2.5 rounded-xl text-xs font-semibold shadow-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                Vẫn hủy Đăng ký
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmFinalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-800">Xác nhận nơi thực tập chính thức</h3>
              <button onClick={() => setConfirmFinalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={submitFinalConfirmation} className="space-y-4">
              <div className="grid grid-cols-2 gap-1 bg-slate-100 p-1 rounded-2xl">
                <button
                  type="button"
                  onClick={() => setFinalConfirmMode('company')}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${finalConfirmMode === 'company' ? 'bg-white text-blue-700 shadow-sm font-bold' : 'text-slate-500 hover:text-slate-850'}`}
                >
                  Công ty
                </button>
                <button
                  type="button"
                  onClick={() => setFinalConfirmMode('school')}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${finalConfirmMode === 'school' ? 'bg-white text-blue-700 shadow-sm font-bold' : 'text-slate-500 hover:text-slate-850'}`}
                >
                  Tại trường
                </button>
              </div>

              {finalConfirmMode === 'company' ? (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Nơi thực tập đã trúng tuyển *</label>
                    <select
                      required
                      value={selectedFinalRegId}
                      onChange={e => setSelectedFinalRegId(e.target.value)}
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all bg-slate-50/50 shadow-inner font-semibold text-slate-800"
                    >
                      <option value="">-- Chọn nơi thực tập --</option>
                      {approvedFinalOptions.map((reg: any) => (
                        <option key={reg.id} value={reg.id}>
                          {reg.company_name === 'Công ty khác' ? `Công ty khác: ${reg.other_company_name || ''}` : reg.company_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-start gap-3 bg-blue-50/50 border border-blue-100 rounded-2xl p-4 text-xs text-blue-900 font-medium cursor-pointer shadow-sm select-none">
                    <input
                      type="checkbox"
                      required
                      checked={finalAttested}
                      onChange={e => setFinalAttested(e.target.checked)}
                      className="mt-0.5 w-4 h-4 text-blue-600 rounded border-slate-250 focus:ring-blue-500"
                    />
                    <span>Tôi xác nhận đã được đơn vị này tiếp nhận thực tập và chịu trách nhiệm về thông tin khai báo.</span>
                  </label>
                </>
              ) : (
                <div className="space-y-3">
                  {primaryAdvisor ? (
                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/45 p-4">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Giảng viên hướng dẫn đã phân công</span>
                        <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[9px] font-bold">GV chính</span>
                      </div>
                      <p className="text-sm font-bold text-slate-800">{primaryAdvisor.lecturer_name}</p>
                      {primaryAdvisor.lecturer_email && (
                        <a href={`mailto:${primaryAdvisor.lecturer_email}`} className="mt-1 text-xs text-blue-600 hover:underline font-semibold block w-fit">
                          {primaryAdvisor.lecturer_email}
                        </a>
                      )}
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Giảng viên đã đồng ý hướng dẫn <span className="text-slate-400 font-normal normal-case">(nếu có)</span></label>
                      <input
                        type="text"
                        list="final-lecturers-list"
                        value={finalSchoolLecturer}
                        onChange={e => setFinalSchoolLecturer(e.target.value)}
                        className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all bg-slate-50/50 shadow-inner font-semibold text-slate-800"
                        placeholder="Để trống nếu Khoa phân công sau..."
                      />
                      <datalist id="final-lecturers-list">
                        {lecturers.map(lec => <option key={lec} value={lec} />)}
                      </datalist>
                    </div>
                  )}
                  <p className="text-[11px] text-slate-400 font-medium">Chỉ chọn thực tập tại trường khi bạn không trúng tuyển công ty nào hoặc thực hiện theo sắp xếp của Khoa.{!primaryAdvisor ? ' Nếu để trống GVHD, Khoa sẽ phân công sau.' : ''}</p>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Ghi chú</label>
                <textarea
                  rows={3}
                  value={finalNote}
                  onChange={e => setFinalNote(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all bg-slate-50/50 shadow-inner resize-y text-slate-850"
                  placeholder="Thông tin liên hệ mentor, thời gian bắt đầu, ghi chú với Khoa..."
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setConfirmFinalOpen(false)} className="bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-xl hover:bg-slate-50 text-xs font-semibold shadow-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer">
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isConfirmingFinal || (finalConfirmMode === 'company' && !selectedFinalRegId)}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-xs font-semibold shadow-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isConfirmingFinal ? 'Đang xác nhận...' : 'Xác nhận'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Register Modal */}
      {registerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 border border-slate-200 h-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-800">Đăng ký thực tập</h3>
              <button onClick={() => setRegisterModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={20} />
              </button>
            </div>
            <div className="mb-4">
              <p className="text-xs text-slate-500 mb-2">Bạn đang đăng ký <strong>{selectedWishCount}</strong> nguyện vọng:</p>
              <ul className="text-xs text-slate-700 space-y-1 bg-slate-50/70 p-3.5 rounded-2xl border border-slate-200 shadow-sm font-semibold">
                {selectedPreferencePreview.map((item, idx) => (
                  <li key={item.key} className="flex items-center gap-2"><span className="text-blue-600 font-bold text-xs">NV{idx + 1}</span> {item.name}</li>
                ))}
              </ul>
            </div>
            <form onSubmit={submitRegister} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Mã sinh viên *</label>
                <input required disabled={!!user?.student_id} type="text" className={`w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all bg-slate-50/50 shadow-inner font-mono font-semibold text-slate-850 ${user?.student_id ? 'bg-slate-100 text-slate-400 cursor-not-allowed border-slate-200' : ''}`} value={registerForm.student_id} onChange={e => setRegisterForm({ ...registerForm, student_id: e.target.value })} placeholder="VD: 20021234" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Ngày sinh *</label>
                <input required disabled={!!user?.dob} type="date" max={new Date().toISOString().split('T')[0]} className={`w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all bg-slate-50/50 shadow-inner font-semibold text-slate-850 ${user?.dob ? 'bg-slate-100 text-slate-400 cursor-not-allowed border-slate-200' : ''}`} value={registerForm.dob} onChange={e => setRegisterForm({ ...registerForm, dob: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Số điện thoại *</label>
                <input required type="tel" pattern="^(0|\+84)[35789][0-9]{8}$" title="Vui lòng nhập số điện thoại hợp lệ (10 số, VD: 0912345678)" className={`w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all bg-slate-50/50 shadow-inner font-semibold text-slate-850 ${user?.phone ? 'bg-slate-100 text-slate-400 cursor-not-allowed border-slate-200' : ''}`} disabled={!!user?.phone} value={registerForm.phone} onChange={e => setRegisterForm({ ...registerForm, phone: e.target.value })} placeholder="VD: 0912345678" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Email cá nhân (khác VNU) *</label>
                <input required type="email" className={`w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all bg-slate-50/50 shadow-inner font-semibold text-slate-850 ${user?.personal_email ? 'bg-slate-100 text-slate-400 cursor-not-allowed border-slate-200' : ''}`} disabled={!!user?.personal_email} value={registerForm.personal_email} onChange={e => setRegisterForm({ ...registerForm, personal_email: e.target.value })} placeholder="VD: abc@gmail.com" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Lớp khóa học *</label>
                <select required disabled={!!user?.class_name} className={`w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all bg-slate-50/50 shadow-inner font-semibold text-slate-850 ${user?.class_name ? 'bg-slate-100 text-slate-400 cursor-not-allowed border-slate-200' : ''}`} value={registerForm.class_name} onChange={e => setRegisterForm({ ...registerForm, class_name: e.target.value })}>
                  <option value="">-- Chọn lớp khóa học --</option>
                  {(campaign.classes_list ? campaign.classes_list.split(',').map((c: string) => c.trim()) : []).map((c: string) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Học phần thực tập *</label>
                <select required disabled={!!user?.course_code} className={`w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all bg-slate-50/50 shadow-inner font-semibold text-slate-850 ${user?.course_code ? 'bg-slate-100 text-slate-400 cursor-not-allowed border-slate-200' : ''}`} value={registerForm.course_code} onChange={e => setRegisterForm({ ...registerForm, course_code: e.target.value })}>
                  <option value="">-- Chọn mã môn học --</option>
                  <option value="Thực tập Doanh nghiệp INT4002">1. Thực tập Doanh nghiệp INT4002</option>
                  <option value="Thực tập Chuyên ngành INT3508">2. Thực tập Chuyên ngành INT3508</option>
                  <option value="Thực tập Doanh nghiệp Nhật Bản INT4003">3. Thực tập Doanh nghiệp Nhật Bản INT4003</option>
                </select>
                <p className="text-[10px] text-red-500 mt-1.5 italic font-medium">* Lưu ý: Sinh viên phải chọn chính xác học phần theo khung chương trình đào tạo của mình.</p>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Ghi chú thêm</label>
                <textarea className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all bg-slate-50/50 shadow-inner resize-y text-slate-800" rows={hasSelectedKhac ? 2 : 3} value={registerForm.note} onChange={e => setRegisterForm({ ...registerForm, note: e.target.value })} placeholder="Mong muốn, kỹ năng nổi bật..." />
              </div>

              {canEditAdvisorRequest ? (
                <div className="bg-slate-50/50 border border-slate-200 p-5 rounded-2xl space-y-3.5 shadow-inner">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Đăng ký giảng viên hướng dẫn</h4>
                    <p className="text-[11px] text-slate-500 mt-1 font-medium leading-relaxed">Chỉ điền khi sinh viên đã liên hệ và được giảng viên đồng ý hướng dẫn. Nếu chưa có GVHD, để trống; Khoa sẽ phân công sau.</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                    <select
                      value={advisorRequestForm.request_type}
                      onChange={e => {
                        const requestType = e.target.value;
                        setAdvisorRequestForm({
                          ...advisorRequestForm,
                          request_type: requestType,
                          lecturer_name: requestType ? advisorRequestForm.lecturer_name : '',
                          co_lecturer_name: requestType ? advisorRequestForm.co_lecturer_name : ''
                        });
                      }}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all font-semibold text-slate-850 cursor-pointer"
                    >
                      <option value="">Không đăng ký GVHD, Khoa sẽ phân công</option>
                      <option value="agreed">Sinh viên đã được GV đồng ý hướng dẫn</option>
                    </select>
                    <input
                      value={advisorRequestForm.lecturer_name}
                      onChange={e => setAdvisorRequestForm({ ...advisorRequestForm, lecturer_name: e.target.value })}
                      disabled={!advisorRequestForm.request_type}
                      required={!!advisorRequestForm.request_type}
                      list="registration-advisor-primary-lecturers"
                      placeholder="Nhập/chọn GVHD chính"
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all font-semibold text-slate-850 disabled:bg-slate-100 disabled:text-slate-400"
                    />
                    <input
                      value={advisorRequestForm.co_lecturer_name}
                      onChange={e => setAdvisorRequestForm({ ...advisorRequestForm, co_lecturer_name: e.target.value })}
                      disabled={!advisorRequestForm.request_type}
                      list="registration-advisor-co-lecturers"
                      placeholder="Nhập/chọn đồng hướng dẫn (nếu có)"
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all font-semibold text-slate-850 disabled:bg-slate-100 disabled:text-slate-400"
                    />
                    <datalist id="registration-advisor-primary-lecturers">
                      {lecturers.map(name => <option key={name} value={name} />)}
                    </datalist>
                    <datalist id="registration-advisor-co-lecturers">
                      {lecturers.map(name => <option key={name} value={name} />)}
                    </datalist>
                  </div>
                  <textarea
                    value={advisorRequestForm.student_note}
                    onChange={e => setAdvisorRequestForm({ ...advisorRequestForm, student_note: e.target.value })}
                    placeholder="Ghi chú thêm nếu có, ví dụ: thông tin đã trao đổi với GV hoặc lịch hẹn làm việc..."
                    className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs resize-y bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all text-slate-850 font-medium"
                    rows={2}
                  />
                </div>
              ) : (
                <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl text-xs text-slate-600 font-medium shadow-sm">
                  Đợt đăng ký GVHD hiện chưa mở. Khi đăng ký bổ sung nơi thực tập, hệ thống sẽ giữ nguyên GVHD đã đăng ký/phân công trước đó; nếu sinh viên chưa có GVHD, Khoa sẽ phân công sau.
                </div>
              )}

              {hasSelectedSchool && (
                <div className="bg-blue-50/50 border border-blue-100 p-4 rounded-2xl text-xs text-blue-900 font-medium shadow-sm">
                  <h4 className="font-bold text-blue-800 uppercase tracking-wider mb-1">Thực tập tại Trường</h4>
                  <p className="mt-1">Thông tin GVHD được lấy từ phần “Đăng ký giảng viên hướng dẫn” ở trên. Nếu chưa chọn trong bước này, Khoa sẽ phân công sau.</p>
                </div>
              )}

              {hasSelectedKhac && (
                <div className="bg-orange-50/50 border border-orange-100 p-5 rounded-2xl space-y-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-orange-800 uppercase tracking-wider">Thông tin Công ty tự liên hệ</h4>
                  </div>
                  {otherCompanies.map((otherCompany, index) => (
                    <div key={index} className="space-y-4 pb-4 border-b border-orange-200 last:border-0 last:pb-0 relative">
                      {otherCompanies.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setOtherCompanies(prev => prev.filter((_, i) => i !== index))}
                          className="absolute -top-1 -right-1 text-red-500 hover:text-red-600 bg-red-50 p-1 rounded-full cursor-pointer"
                        >
                          <X size={14} />
                        </button>
                      )}
                      {otherCompanies.length > 1 && <h5 className="text-xs font-bold text-orange-700">Công ty {index + 1}</h5>}
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Tên công ty *</label>
                        <input required list="it-companies-datalist" type="text" className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all bg-slate-50/50 shadow-inner font-semibold text-slate-800" value={otherCompany.name} onChange={e => setOtherCompanies(prev => prev.map((c, i) => i === index ? { ...c, name: e.target.value } : c))} placeholder="Công ty CP Công nghệ..." />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Vị trí Thực tập *</label>
                        <input required list="role-suggestions" type="text" className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all bg-slate-50/50 shadow-inner font-semibold text-slate-800" value={otherCompany.role} onChange={e => setOtherCompanies(prev => prev.map((c, i) => i === index ? { ...c, role: e.target.value } : c))} placeholder="Thực tập sinh Frontend..." />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Người liên hệ *</label>
                          <input required type="text" className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all bg-slate-50/50 shadow-inner font-semibold text-slate-800" value={otherCompany.contact_name} onChange={e => setOtherCompanies(prev => prev.map((c, i) => i === index ? { ...c, contact_name: e.target.value } : c))} placeholder="Anh Nguyễn Văn A" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Điện thoại *</label>
                          <input required type="tel" pattern="^(0|\+84)[35789][0-9]{8}$" title="Vui lòng nhập số điện thoại hợp lệ (10 số, VD: 0912345678)" className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all bg-slate-50/50 shadow-inner font-semibold text-slate-800" value={otherCompany.contact_phone} onChange={e => setOtherCompanies(prev => prev.map((c, i) => i === index ? { ...c, contact_phone: e.target.value } : c))} placeholder="0987654321" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Email *</label>
                          <input required type="email" className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all bg-slate-50/50 shadow-inner font-semibold text-slate-800" value={otherCompany.contact_email} onChange={e => setOtherCompanies(prev => prev.map((c, i) => i === index ? { ...c, contact_email: e.target.value } : c))} placeholder="a@company.com" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Ghi chú đăng ký</label>
                        <textarea rows={2} className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all bg-slate-50/50 shadow-inner resize-y text-slate-800" value={otherCompany.note || ''} onChange={e => setOtherCompanies(prev => prev.map((c, i) => i === index ? { ...c, note: e.target.value } : c))} placeholder="Lý do đăng ký, liên hệ GVHD..." />
                      </div>
                    </div>
                  ))}

                  {Array.from(selectedCompanies).filter(id => id !== khacCompany?.id).length + otherCompanies.length < 5 && (
                    <button
                      type="button"
                      onClick={() => setOtherCompanies(prev => [...prev, { name: '', role: '', contact_name: '', contact_phone: '', contact_email: '', note: '' }])}
                      className="mt-2 text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      + Thêm công ty tự liên hệ
                    </button>
                  )}
                  <datalist id="it-companies-datalist">
                    {itCompanyList.map((name, i) => <option key={i} value={name} />)}
                  </datalist>
                </div>
              )}

              <div className="flex justify-end gap-2.5 mt-6 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setRegisterModalOpen(false)} className="bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-xl hover:bg-slate-50 text-xs font-semibold shadow-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer">
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-xs font-semibold shadow-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      Đang xử lý...
                    </>
                  ) : 'Xác nhận đăng ký'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
