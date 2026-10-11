import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Users, CheckCircle2, Download, FileText, MessageCircle, GraduationCap } from 'lucide-react';
import { saveAs } from 'file-saver';

import { API_BASE, saveXlsx, formatCourseCode, cleanStudentName } from '../../../shared';
import { ReportReviewPanel, type ReviewTarget } from './ReportReviewPanel';

export function LecturerHome({ user, token }: { user: any, token: string }) {
  const navigate = useNavigate();
  const [students, setStudents] = useState<any[]>([]);
  const [grades, setGrades] = useState<any[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [updatingContactIds, setUpdatingContactIds] = useState<Record<string, boolean>>({});
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);

  const fetchStudents = async () => {
    setLoadingStudents(true);
    try {
      const res = await fetch(`${API_BASE}/api/lecturer/students`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data?.error || 'Không tải được danh sách sinh viên phụ trách.');
      setStudents(Array.isArray(data) ? data : []);
    } catch (e) {
      setStudents([]);
    } finally {
      setLoadingStudents(false);
    }
  };

  const fetchGrades = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/lecturer/grades`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => []);
      setGrades(Array.isArray(data) ? data : []);
    } catch {
      setGrades([]);
    }
  };

  useEffect(() => {
    fetchStudents();
    fetchGrades();
  }, [token]);

  const formatBytes = (bytes: number) => {
    if (!bytes) return '-';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
  const isStudentGraded = (student: any) => {
    return student.grade_status === 'submitted' ||
      (student.final_score !== null && student.final_score !== undefined && student.final_score !== '') ||
      grades.some((g: any) => Number(g.user_id) === Number(student.user_id) && (g.grade_status === 'submitted' || (g.final_score !== null && g.final_score !== undefined && g.final_score !== '')));
  };
  const statusLabel = (student: any) => {
    const s = student?.report_status;
    if (s === 'accepted' || isStudentGraded(student)) return 'Đã nộp điểm';
    if (s === 'needs_revision') return 'Cần nộp lại';
    if (s === 'submitted') return 'Chưa chấm điểm';
    return 'Chưa nộp';
  };
  const uniqueStudents = Array.from(new Map(
    students
      .filter((student: any) => student.user_id)
      .map((student: any) => [Number(student.user_id), student])
  ).values()) as any[];
  const advisedStudentCount = uniqueStudents.length;
  const uncontactedCount = uniqueStudents.filter((student: any) => !student.contacted_at).length;
  const groupLecturerId = students.find((student: any) => student.lecturer_id)?.lecturer_id;

  const registeredCount = advisedStudentCount;
  const confirmedCount = uniqueStudents.filter((s: any) => s.confirmed_at || s.internship_place || s.internship_type).length;
  const reportCount = uniqueStudents.filter((s: any) => s.report_submitted_at || ['submitted', 'accepted', 'needs_revision'].includes(s.report_status)).length;
  const gradedCount = uniqueStudents.filter((s: any) =>
    s.grade_status === 'submitted' || s.grade_status === 'draft' || (s.final_score !== null && s.final_score !== undefined && s.final_score !== '') ||
    grades.some((g: any) => Number(g.user_id) === Number(s.user_id) && (g.grade_status === 'submitted' || g.grade_status === 'draft' || (g.final_score !== null && g.final_score !== undefined && g.final_score !== '')))
  ).length;

  const downloadReport = async (student: any) => {
    const res = await fetch(`${API_BASE}/api/reports/final/${student.user_id}/download`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return alert('Không tải được báo cáo.');
    saveAs(await res.blob(), student.report_filename || 'final-report.pdf');
  };

  const studentToReviewTarget = (student: any): ReviewTarget => {
    const grade = grades.find((g: any) => Number(g.user_id) === Number(student.user_id)) || {};
    return {
      user_id: student.user_id,
      userId: student.user_id,
      student_name: student.student_name,
      studentName: student.student_name,
      student_id: student.student_id,
      studentId: student.student_id,
      class_name: student.class_name,
      className: student.class_name,
      course_code: student.course_code,
      internship_place: student.internship_place,
      report_status: student.report_status,
      reportStatus: student.report_status,
      report_filename: student.report_filename,
      report_file_size: student.report_file_size,
      report_submitted_at: student.report_submitted_at,
      lecturer_comment: student.lecturer_comment,
      progress_score: grade.progress_score ?? student.progress_score,
      report_score: grade.report_score ?? student.report_score,
      company_score: grade.company_score ?? student.company_score,
      final_score: grade.final_score ?? student.final_score,
      comment: grade.comment ?? student.grade_comment ?? student.comment,
      grade_status: grade.grade_status ?? student.grade_status,
      locked_at: grade.locked_at ?? student.grade_locked_at,
      is_primary: student.advisor_role !== 'co',
      advisor_role: student.advisor_role,
    };
  };

  const openReview = (student: any) => {
    const idx = students.findIndex((s) => s.user_id === student.user_id);
    setReviewIndex(idx >= 0 ? idx : null);
  };

  const updateReportStatus = async (student: any, status: string) => {
    const lecturer_comment = status === 'needs_revision' ? prompt('Ghi chú yêu cầu sinh viên nộp lại:', '') || '' : '';
    const res = await fetch(`${API_BASE}/api/reports/final/${student.user_id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status, lecturer_comment })
    });
    if (res.ok) fetchStudents();
    else alert('Cập nhật trạng thái báo cáo thất bại.');
  };

  const updateStudentContact = async (student: any, contacted: boolean, note = student.contact_note || '') => {
    const key = String(student.assignment_id);
    setUpdatingContactIds(prev => ({ ...prev, [key]: true }));
    try {
      const res = await fetch(`${API_BASE}/api/lecturer/students/${student.assignment_id}/contact`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ contacted, contact_note: note })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.error || 'Cập nhật tình trạng liên hệ thất bại.');
      setStudents(prev => prev.map(item => Number(item.assignment_id) === Number(student.assignment_id)
        ? { ...item, contacted_at: data.contacted_at, contact_note: data.contact_note }
        : item
      ));
    } catch (e) {
      alert('Lỗi kết nối khi cập nhật tình trạng liên hệ.');
    } finally {
      setUpdatingContactIds(prev => ({ ...prev, [key]: false }));
    }
  };

  const editContactNote = (student: any) => {
    const note = prompt(`Ghi chú liên hệ với ${student.student_name || 'sinh viên'}:`, student.contact_note || '');
    if (note === null) return;
    updateStudentContact(student, !!student.contacted_at, note);
  };

  const exportLecturerStudentsXlsx = () => {
    if (students.length === 0) return alert('Chưa có sinh viên để xuất.');
    const headers = [
      'STT',
      'Mã SV',
      'Họ và tên',
      'Lớp khóa học',
      'Môn học',
      'Vai trò hướng dẫn',
      'Nơi thực tập',
      'SĐT',
      'Email VNU',
      'Email khác',
      'Tình trạng liên hệ',
      'Thời gian đánh dấu liên hệ',
      'Ghi chú liên hệ',
      'Báo cáo',
      'Tên file báo cáo',
      'Dung lượng báo cáo',
      'Ngày nộp báo cáo',
    ];
    const rows = students.map((student: any, index: number) => [
      index + 1,
      student.student_id || '',
      cleanStudentName(student.student_name, student.student_id),
      student.class_name || '',
      formatCourseCode(student.course_code),
      student.advisor_role === 'primary' ? 'Hướng dẫn chính' : 'Đồng hướng dẫn',
      student.internship_place || '',
      student.phone || '',
      student.email || '',
      student.personal_email || '',
      student.contacted_at ? 'Đã liên hệ' : 'Chưa liên hệ',
      student.contacted_at ? new Date(student.contacted_at).toLocaleString('vi-VN') : '',
      student.contact_note || '',
      statusLabel(student),
      student.report_filename || '',
      student.report_file_size ? formatBytes(Number(student.report_file_size || 0)) : '',
      student.report_submitted_at ? new Date(student.report_submitted_at).toLocaleString('vi-VN') : '',
    ]);
    const safeName = String(user?.name || 'giang_vien').replace(/[^a-zA-Z0-9À-ỹ_-]+/g, '_').slice(0, 60) || 'giang_vien';
    saveXlsx(`sinh_vien_phu_trach_${safeName}.xlsx`, headers, rows, 'Sinh viên phụ trách');
  };

  return (
    <>
      {reviewIndex !== null && students[reviewIndex] && (
        <ReportReviewPanel
          target={studentToReviewTarget(students[reviewIndex])}
          token={token}
          onClose={() => setReviewIndex(null)}
          onReportStatusChange={() => {
            fetchStudents();
            fetchGrades();
          }}
          onGradeChange={() => {
            fetchStudents();
            fetchGrades();
          }}
          currentIndex={reviewIndex}
          totalCount={students.length}
          onPrev={() => setReviewIndex((i) => (i !== null && i > 0 ? i - 1 : i))}
          onNext={() => setReviewIndex((i) => (i !== null && i < students.length - 1 ? i + 1 : i))}
          hasPrev={reviewIndex > 0}
          hasNext={reviewIndex < students.length - 1}
        />
      )}
      <div className="max-w-6xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Sinh viên phụ trách</h1>
          <p className="text-xs text-slate-500 mt-0.5">Học phần Thực tập</p>
        </div>
        <div className="flex items-center gap-2">
          {groupLecturerId && (
            <button
              onClick={() => navigate(`/chat/group/${groupLecturerId}`)}
              className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer hover:shadow active:scale-[0.98]"
            >
              <Users size={14} className="text-blue-600" /> Chat nhóm
            </button>
          )}
          <button
            onClick={exportLecturerStudentsXlsx}
            disabled={loadingStudents || students.length === 0}
            className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer hover:shadow active:scale-[0.98] disabled:opacity-50"
          >
            <Download size={14} className="text-slate-500" /> Xuất Excel
          </button>
          <button
            onClick={() => navigate('/lecturer/grades')}
            className="bg-[#034ea1] hover:bg-[#023a7a] text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer hover:shadow active:scale-[0.98]"
          >
            <CheckCircle2 size={14} /> Chấm điểm thực tập
          </button>
        </div>
      </div>

      {/* Thống kê sinh viên phụ trách */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Số SV phụ trách</span>
            <div className="p-2 bg-sky-50 rounded-xl text-sky-600">
              <Users size={18} />
            </div>
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-3xl font-bold text-slate-800">{registeredCount}</span>
            <span className="text-[11px] font-medium text-slate-400">tổng số</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-blue-600 text-xs font-semibold uppercase tracking-wider">Số SV xác nhận</span>
            <div className="p-2 bg-blue-50 rounded-xl text-blue-600">
              <CheckCircle2 size={18} />
            </div>
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-3xl font-bold text-blue-700">{confirmedCount}</span>
            <span className="text-[11px] font-medium text-slate-400">
              {registeredCount ? `${Math.round((confirmedCount / registeredCount) * 100)}%` : '0%'}
            </span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-amber-600 text-xs font-semibold uppercase tracking-wider">Số SV nộp báo cáo</span>
            <div className="p-2 bg-amber-50 rounded-xl text-amber-600">
              <FileText size={18} />
            </div>
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-3xl font-bold text-amber-700">{reportCount}</span>
            <span className="text-[11px] font-medium text-slate-400">
              {registeredCount ? `${Math.round((reportCount / registeredCount) * 100)}%` : '0%'}
            </span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-emerald-600 text-xs font-semibold uppercase tracking-wider">Số SV có điểm</span>
            <div className="p-2 bg-emerald-50 rounded-xl text-emerald-600">
              <GraduationCap size={18} />
            </div>
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-3xl font-bold text-emerald-700">{gradedCount}</span>
            <span className="text-[11px] font-medium text-slate-400">
              {registeredCount ? `${Math.round((gradedCount / registeredCount) * 100)}%` : '0%'}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-3.5 border-b border-slate-100 bg-slate-50/75 flex items-center justify-between gap-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-700">Danh sách sinh viên</span>
          <div className={`rounded-xl border px-3 py-1 text-xs font-semibold ${uncontactedCount > 0 ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
            {uncontactedCount > 0 ? `Chưa liên hệ: ${uncontactedCount}` : 'Tất cả đã liên hệ'}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs text-slate-600">
            <thead>
              <tr className="bg-slate-50/75 text-slate-700 font-semibold border-b border-slate-100 text-[10px] tracking-wider uppercase select-none">
                <th className="p-4">Mã SV</th>
                <th className="p-4">Họ tên</th>
                <th className="p-4">Vai trò</th>
                <th className="p-4">Nơi thực tập</th>
                <th className="p-4">Tình trạng liên hệ</th>
                <th className="p-4">Báo cáo</th>
                <th className="p-4">Liên hệ</th>
                <th className="p-4">Môn học</th>
                <th className="p-4">Trao đổi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingStudents ? (
                <tr><td colSpan={9} className="p-10 text-center text-slate-500">Đang tải danh sách...</td></tr>
              ) : students.length === 0 ? (
                <tr><td colSpan={9} className="p-10 text-center text-slate-500">Chưa có sinh viên được phân công.</td></tr>
              ) : students.map((student: any) => (
                <tr key={student.assignment_id} className="hover:bg-slate-50/50 transition-colors align-top">
                  <td className="p-4 font-mono font-semibold text-slate-800">{student.student_id || '-'}</td>
                  <td className="p-4 font-semibold text-slate-800">{cleanStudentName(student.student_name, student.student_id)}</td>
                  <td className="p-4">
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold ${student.advisor_role === 'primary' ? 'bg-emerald-50 border border-emerald-100 text-emerald-700' : 'bg-blue-50 border border-blue-100 text-blue-700'}`}>
                      {student.advisor_role === 'primary' ? 'Hướng dẫn chính' : 'Đồng hướng dẫn'}
                    </span>
                  </td>
                  <td className="p-4 font-medium text-slate-700">{student.internship_place || '-'}</td>
                  <td className="p-4 min-w-[190px]">
                    <div className={`rounded-xl border px-3 py-2 ${student.contacted_at ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                      <label className="flex items-center gap-2 text-xs font-bold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!student.contacted_at}
                          disabled={!!updatingContactIds[String(student.assignment_id)]}
                          onChange={e => updateStudentContact(student, e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        {student.contacted_at ? 'Đã liên hệ' : 'Chưa liên hệ'}
                      </label>
                      {student.contacted_at && (
                        <div className="mt-1 text-[10px] text-emerald-700">
                          {new Date(student.contacted_at).toLocaleString('vi-VN')}
                        </div>
                      )}
                      {student.contact_note && (
                        <div className="mt-2 rounded-lg bg-white/70 px-2 py-1 text-[11px] leading-relaxed text-slate-700 border border-white">
                          {student.contact_note}
                        </div>
                      )}
                      <button
                        onClick={() => editContactNote(student)}
                        disabled={!!updatingContactIds[String(student.assignment_id)]}
                        className="mt-2 text-[10px] font-semibold text-slate-700 hover:text-teal-700 disabled:opacity-60"
                      >
                        {student.contact_note ? 'Sửa ghi chú' : 'Thêm ghi chú'}
                      </button>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex flex-col gap-1.5 items-start">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                        student.report_status === 'accepted' || isStudentGraded(student)
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : student.report_status === 'needs_revision'
                          ? 'bg-orange-50 text-orange-700 border-orange-200'
                          : 'bg-rose-50 text-rose-700 border-rose-200'
                      }`}>
                        {statusLabel(student)}
                      </span>
                      {student.report_filename ? (
                        <>
                          <div className="text-[10px] text-slate-500 line-clamp-1 max-w-[170px]" title={student.report_filename}>
                            {student.report_filename} · {formatBytes(Number(student.report_file_size || 0))}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => openReview(student)}
                              className="inline-flex items-center gap-1 text-[#034ea1] hover:bg-[#e8f1fb] px-2.5 py-1 rounded-xl text-xs font-semibold transition-colors cursor-pointer border border-[#d4e5f7] bg-[#e8f1fb]/70 shadow-xs active:scale-[0.98]"
                            >
                              <FileText size={12} /> Xem & Chấm
                            </button>
                            <button
                              onClick={() => downloadReport(student)}
                              title="Tải file PDF"
                              className="p-1 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer border border-slate-200 bg-white shadow-xs active:scale-[0.98]"
                            >
                              <Download size={13} />
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center gap-1.5 pt-0.5">
                          <button
                            onClick={() => openReview(student)}
                            className="inline-flex items-center gap-1 text-[#034ea1] hover:bg-[#e8f1fb] px-2.5 py-1 rounded-xl text-xs font-semibold transition-colors cursor-pointer border border-[#d4e5f7] bg-[#e8f1fb]/70 shadow-xs active:scale-[0.98]"
                          >
                            <FileText size={12} /> Xem & Chấm
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="p-4 text-xs leading-relaxed text-slate-600">
                    <div>{student.phone || '-'}</div>
                    <div>{student.personal_email || student.email || '-'}</div>
                  </td>
                  <td className="p-4 text-xs font-semibold text-slate-700">{student.course_code || '-'}</td>
                  <td className="p-4">
                    <button
                      onClick={() => navigate(`/chat/${student.user_id}/${student.lecturer_id}`)}
                      className="inline-flex items-center gap-1 rounded-xl bg-[#e8f1fb] border border-[#d4e5f7] px-2.5 py-1 text-xs font-semibold text-[#034ea1] hover:bg-[#d4e5f7] transition-colors cursor-pointer shadow-xs active:scale-[0.98]"
                    >
                      <MessageCircle size={14} /> Chat
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      </div>
    </>
  );
}
