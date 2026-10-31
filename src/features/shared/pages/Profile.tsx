import { apiFetch as fetch } from '../../../shared/utils/requestCache';
import { useNavigate } from 'react-router-dom';
import React, { useState, useEffect } from 'react';
import { User as UserIcon, Save } from 'lucide-react';
import { API_BASE, CACHE_TTL, cachedJsonFetch, PageDescriptionTooltip } from '../../../shared';
import {COURSE_CATALOG} from '../../../shared/academic';
import {matchesCourseCode} from '../../../shared/utils/format';

export function Profile({ user, setUser, token }: { user: any, setUser: any, token: string }) {
  const isAdmin = user?.role === 'admin';
  const isLecturer = user?.role === 'lecturer';
  const isStaff = isAdmin || isLecturer;
  const legacyStudent = !isStaff && user?.legacy_internship_access !== 0;
  const [formData, setFormData] = useState({
    name: user?.name || '',
    student_id: user?.student_id || user?.email?.split('@')[0] || '',
    dob: user?.dob || '',
    class_name: user?.class_name || '',
    course_code: user?.course_code || '',
    phone: user?.phone || '',
    personal_email: user?.personal_email || ''
  });
  const [saving, setSaving] = useState(false);
  const [classesList, setClassesList] = useState<string[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (legacyStudent) {
      cachedJsonFetch<any>(`${API_BASE}/api/settings/campaign`, {
        cacheKey: 'settings:campaign',
        ttlMs: CACHE_TTL.campaign,
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(data => {
          if (data.classes_list) {
            setClassesList(data.classes_list.split(',').map((c: string) => c.trim()));
          }
        })
        .catch(() => { });

    }
  }, [token, legacyStudent]);

  // Sync formData when user prop changes (e.g. after registration updates phone/personal_email)
  useEffect(() => {
    setFormData({
      name: user?.name || '',
      student_id: user?.student_id || user?.email?.split('@')[0] || '',
      dob: user?.dob || '',
      class_name: user?.class_name || '',
      course_code: user?.course_code || '',
      phone: user?.phone || '',
      personal_email: user?.personal_email || ''
    });
  }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = isStaff
        ? { name: formData.name }
        : formData;
      const res = await fetch(`${API_BASE}/api/users/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const updatedUser = await res.json();
        setUser(updatedUser);
        localStorage.setItem('user', JSON.stringify(updatedUser));
        alert('Cập nhật hồ sơ thành công!');
        navigate('/');
      } else {
        const err = await res.json();
        alert(err.error || 'Có lỗi xảy ra khi cập nhật hồ sơ.');
      }
    } catch (e) {
      alert('Lỗi kết nối.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-slate-600 bg-white border border-black/[0.08] shadow-xs hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer mb-3"
        >
          &larr; Quay lại
        </button>
      </div>
      <div className="bg-white p-8 rounded-2xl shadow-xs border border-slate-200/80">
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-6 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-[#034ea1] flex items-center justify-center">
            <UserIcon size={18} />
          </div>
          Cập nhật Hồ sơ cá nhân
          {isStaff && (
            <PageDescriptionTooltip
              description={
                <>
                  Với tư cách <strong>{isLecturer ? 'Giảng viên' : `Quản trị viên${user.is_lecturer ? ' / Giảng viên' : ''}`}</strong>, hồ sơ của bạn chỉ cần cập nhật họ tên hiển thị.
                  {!!(isLecturer || user.is_lecturer) && <span> Tên này sẽ được <strong>đồng bộ tự động</strong> vào danh mục giảng viên. Học vị/chức danh được giữ theo danh mục do Khoa quản lý.</span>}
                </>
              }
            />
          )}
        </h2>

        <form onSubmit={handleSave} className="space-y-5">
          {/* Avatar + info banner */}
          <div className="flex items-center gap-4 mb-6 p-4 bg-[#f8fafc]/60 rounded-2xl border border-black/[0.04]">
            {user.picture ? (
              <img src={user.picture} alt="Avatar" className="w-16 h-16 rounded-full border-2 border-white shadow-xs object-cover" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-slate-200 border-2 border-white flex items-center justify-center text-[#004a99] font-bold shadow-xs">
                <UserIcon size={24} />
              </div>
            )}
            <div>
              <p className="font-semibold text-slate-900 text-base">{user.email}</p>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-[10px] text-slate-600 bg-slate-200/70 inline-block px-2 py-0.5 rounded-full uppercase tracking-wider font-semibold">
                  {user.role}
                </p>
                {user.is_lecturer ? (
                  <p className="text-[10px] text-teal-700 bg-teal-50 border border-teal-200/60 inline-block px-2 py-0.5 rounded-full font-semibold">
                    Giảng viên
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          {isStaff ? (
            /* ── ADMIN / LECTURER VIEW ── */
            <div className="space-y-5">
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Email</label>
                <input
                  type="text"
                  value={user.email}
                  disabled
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs bg-slate-100/70 text-slate-400 cursor-not-allowed font-medium"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Họ và tên <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-[#f8fafc]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-semibold focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] outline-none transition-all shadow-inner"
                />
              </div>
            </div>
          ) : (
            /* ── STUDENT VIEW ── */
            <>
              {!legacyStudent && <p className="text-sm text-slate-500">Học phần, lớp học phần và phân công được Khoa quản lý trong từng học kỳ/nhóm môn.</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Mã sinh viên <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    value={formData.student_id}
                    onChange={(e) => setFormData({ ...formData, student_id: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#f8fafc]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-mono font-semibold focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] outline-none transition-all shadow-inner"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Họ và tên <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#f8fafc]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-semibold focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] outline-none transition-all shadow-inner"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Ngày sinh {legacyStudent && <span className="text-red-500">*</span>}</label>
                  <input
                    type="date"
                    max={new Date().toISOString().split('T')[0]}
                    aria-label="Ngày sinh"
                    required={legacyStudent}
                    value={formData.dob}
                    onChange={(e) => setFormData({ ...formData, dob: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#f8fafc]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-semibold focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] outline-none transition-all shadow-inner"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Số điện thoại</label>
                  <input
                    type="tel"
                    pattern="^(0|\+84)[35789][0-9]{8}$"
                    title="Vui lòng nhập số điện thoại hợp lệ (10 số, VD: 0912345678)"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#f8fafc]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-semibold focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] outline-none transition-all shadow-inner"
                    placeholder="VD: 0912345678"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Email cá nhân (khác VNU)</label>
                  <input
                    type="email"
                    value={formData.personal_email}
                    onChange={(e) => setFormData({ ...formData, personal_email: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#f8fafc]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-semibold focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] outline-none transition-all shadow-inner"
                    placeholder="VD: abc@gmail.com"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Lớp khóa học {legacyStudent && <span className="text-red-500">*</span>}</label>
                  {legacyStudent ? <select
                    aria-label="Lớp khóa học"
                    required
                    value={formData.class_name}
                    onChange={(e) => setFormData({ ...formData, class_name: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#f8fafc]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-semibold focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] outline-none transition-all shadow-inner"
                  >
                    <option value="">-- Chọn lớp khóa học --</option>
                    {[...new Set([formData.class_name,...classesList].filter(Boolean))].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select> : <input aria-label="Lớp khóa học" type="text" value={formData.class_name} onChange={e=>setFormData({...formData,class_name:e.target.value})} className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs" />}
                </div>
                {legacyStudent && <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Học phần Thực tập (hồ sơ cũ) <span className="text-red-500">*</span></label>
                  <select
                    aria-label="Học phần Thực tập (hồ sơ cũ)"
                    required
                    value={formData.course_code}
                    onChange={(e) => setFormData({ ...formData, course_code: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#f8fafc]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-semibold focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] outline-none transition-all shadow-inner"
                  >
                    <option value="">-- Chọn học phần --</option>
                    {COURSE_CATALOG.filter(c=>c.group==='internship').map(c=><option key={c.code} value={matchesCourseCode(formData.course_code,c.code)?formData.course_code:`${c.name} ${c.code}`}>{c.name} {c.code}</option>)}
                  </select>
                </div>}
              </div>
            </>
          )}

          <div className="pt-5 border-t border-slate-100 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="bg-[#034ea1] hover:bg-[#023a7a] text-white px-5 py-2.5 rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save size={14} /> {saving ? 'Đang lưu...' : 'Lưu Hồ sơ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
