import { useNavigate, useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import {
  Building2,
  RefreshCw,
  Save,
  X,
  Edit2,
  ChevronLeft,
  Mail,
  Phone,
  MapPin,
  ExternalLink,
  Users,
  BookOpen,
  CheckCircle2,
} from 'lucide-react';
import { API_BASE, companyDescriptionText, companyDisplayDescription } from '../../../shared';

export function CompanyDetail({ user, token }: { user: any; token: string }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [company, setCompany] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadCompany = () => {
    setLoading(true);
    fetch(`${API_BASE}/api/companies/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json())
      .then((data) => {
        setCompany(data);
        setEditForm({
          name: data?.name || '',
          description: companyDescriptionText(data?.description) || '',
          slots: data?.slots || 5,
          contact_email: data?.contact_email || '',
          contact_name: data?.contact_name || '',
          phone: data?.phone || '',
          address: data?.address || '',
          recruitment_link: data?.recruitment_link || '',
          history: data?.history || '',
          qualifications: data?.qualifications || '',
        });
        setLoading(false);
      })
      .catch((e) => {
        console.error(e);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadCompany();
  }, [id, token]);

  const saveCompany = async () => {
    if (!editForm?.name?.trim()) return alert('Tên công ty không được để trống.');
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/companies/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...editForm,
          description: editForm.description?.trim() || 'Chưa rõ',
        }),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Không lưu được thông tin công ty.');
      setEditing(false);
      await loadCompany();
      alert('Đã cập nhật thông tin công ty.');
    } catch (e) {
      alert('Không thể kết nối đến máy chủ.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-28 text-[#64748b]">
        <div className="w-8 h-8 rounded-full border-2 border-[#034ea1] border-t-transparent animate-spin mb-3" />
        <span className="text-xs font-medium">Đang tải thông tin doanh nghiệp...</span>
      </div>
    );
  }

  if (!company || company.error) {
    return (
      <div className="max-w-xl mx-auto py-20 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-[#b91c1c]/10 text-[#b91c1c] flex items-center justify-center mx-auto">
          <Building2 size={24} />
        </div>
        <h2 className="text-xl font-bold text-[#0f172a]">Không tìm thấy doanh nghiệp</h2>
        <p className="text-xs text-[#64748b]">Doanh nghiệp không tồn tại hoặc đã bị xóa khỏi hệ thống.</p>
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold text-white bg-[#034ea1] hover:bg-[#023a7a] transition-all cursor-pointer"
        >
          Quay lại
        </button>
      </div>
    );
  }

  const description = companyDisplayDescription(company.description);

  return (
    <div className="max-w-5xl mx-auto space-y-7 pb-12">
      {/* Apple Navigation & Top Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <button
          onClick={() => navigate(-1)}
          className="group inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium text-[#64748b] bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:text-[#0f172a] hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer"
        >
          <ChevronLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
          Quay lại
        </button>

        {user?.role === 'admin' && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold text-white bg-[#034ea1] hover:bg-[#023a7a] active:scale-[0.98] transition-all cursor-pointer shadow-xs"
          >
            <Edit2 size={13} />
            Chỉnh sửa thông tin
          </button>
        )}
      </div>

      {/* Admin Edit Modal / Sheet */}
      {user?.role === 'admin' && editing && editForm && (
        <div className="bg-white rounded-3xl p-7 border border-black/[0.06] shadow-[0_2px_12px_rgba(0,0,0,0.03)] space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-black/[0.04]">
            <h2 className="text-base font-bold text-[#0f172a] tracking-tight flex items-center gap-2">
              <Edit2 size={16} className="text-[#034ea1]" />
              Chỉnh sửa thông tin doanh nghiệp
            </h2>
            <button
              onClick={() => {
                setEditing(false);
                setEditForm({ ...company, description: companyDescriptionText(company.description) || '' });
              }}
              className="text-[#64748b] hover:text-[#0f172a] p-1.5 rounded-full hover:bg-[#f8fafc] transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#64748b] mb-1.5">
                Tên công ty / Đơn vị *
              </label>
              <input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="w-full bg-[#f8fafc] focus:bg-white border border-black/[0.08] rounded-xl px-3.5 py-2.5 text-xs font-semibold text-[#0f172a] outline-none focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] transition-all"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#64748b] mb-1.5">
                Mô tả giới thiệu
              </label>
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                rows={3}
                placeholder="Giới thiệu chung về doanh nghiệp..."
                className="w-full bg-[#f8fafc] focus:bg-white border border-black/[0.08] rounded-xl px-3.5 py-2.5 text-xs outline-none focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] transition-all leading-relaxed resize-y"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#64748b] mb-1.5">
                Chỉ tiêu tiếp nhận (Số lượng SV)
              </label>
              <input
                type="number"
                value={editForm.slots}
                onChange={(e) => setEditForm({ ...editForm, slots: parseInt(e.target.value) || 0 })}
                className="w-full bg-[#f8fafc] focus:bg-white border border-black/[0.08] rounded-xl px-3.5 py-2.5 text-xs outline-none focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] transition-all font-semibold"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#64748b] mb-1.5">
                Người liên hệ
              </label>
              <input
                value={editForm.contact_name}
                onChange={(e) => setEditForm({ ...editForm, contact_name: e.target.value })}
                placeholder="Họ tên người phụ trách tuyển dụng..."
                className="w-full bg-[#f8fafc] focus:bg-white border border-black/[0.08] rounded-xl px-3.5 py-2.5 text-xs outline-none focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] transition-all"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#64748b] mb-1.5">
                Email liên hệ
              </label>
              <input
                value={editForm.contact_email}
                onChange={(e) => setEditForm({ ...editForm, contact_email: e.target.value })}
                className="w-full bg-[#f8fafc] focus:bg-white border border-black/[0.08] rounded-xl px-3.5 py-2.5 text-xs outline-none focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] transition-all"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#64748b] mb-1.5">
                Số điện thoại
              </label>
              <input
                value={editForm.phone}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                className="w-full bg-[#f8fafc] focus:bg-white border border-black/[0.08] rounded-xl px-3.5 py-2.5 text-xs outline-none focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] transition-all"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#64748b] mb-1.5">
                Địa chỉ văn phòng
              </label>
              <input
                value={editForm.address}
                onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                className="w-full bg-[#f8fafc] focus:bg-white border border-black/[0.08] rounded-xl px-3.5 py-2.5 text-xs outline-none focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] transition-all"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#64748b] mb-1.5">
                Link tuyển dụng / JD chi tiết
              </label>
              <input
                value={editForm.recruitment_link}
                onChange={(e) => setEditForm({ ...editForm, recruitment_link: e.target.value })}
                placeholder="https://..."
                className="w-full bg-[#f8fafc] focus:bg-white border border-black/[0.08] rounded-xl px-3.5 py-2.5 text-xs outline-none focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] transition-all font-mono"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#64748b] mb-1.5">
                Lịch sử & Quy mô tổ chức
              </label>
              <textarea
                value={editForm.history}
                onChange={(e) => setEditForm({ ...editForm, history: e.target.value })}
                rows={3}
                className="w-full bg-[#f8fafc] focus:bg-white border border-black/[0.08] rounded-xl px-3.5 py-2.5 text-xs outline-none focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] transition-all leading-relaxed resize-y"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#64748b] mb-1.5">
                Yêu cầu & Tiêu chí tiếp nhận
              </label>
              <textarea
                value={editForm.qualifications}
                onChange={(e) => setEditForm({ ...editForm, qualifications: e.target.value })}
                rows={3}
                className="w-full bg-[#f8fafc] focus:bg-white border border-black/[0.08] rounded-xl px-3.5 py-2.5 text-xs outline-none focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] transition-all leading-relaxed resize-y"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-black/[0.04]">
            <button
              onClick={() => {
                setEditing(false);
                setEditForm({ ...company, description: companyDescriptionText(company.description) || '' });
              }}
              disabled={saving}
              className="px-4 py-2 rounded-full border border-black/[0.08] text-xs font-semibold text-[#0f172a] hover:bg-[#f8fafc] cursor-pointer"
            >
              Hủy
            </button>
            <button
              onClick={saveCompany}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-xs font-semibold text-white bg-[#034ea1] hover:bg-[#023a7a] active:scale-[0.98] transition-all cursor-pointer shadow-xs disabled:opacity-50"
            >
              {saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
              Lưu thay đổi
            </button>
          </div>
        </div>
      )}

      {/* Apple Enterprise Profile Showcase Card */}
      <div className="bg-white rounded-3xl p-8 sm:p-10 border border-black/[0.06] shadow-[0_2px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
        {/* Header Strip */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6 pb-8 border-b border-black/[0.05]">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-3xl bg-[#034ea1]/10 text-[#034ea1] flex items-center justify-center shrink-0 shadow-inner">
              <Building2 size={32} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <span className="inline-flex items-center gap-1 px-3 py-0.5 rounded-full text-[11px] font-bold bg-[#15803d]/10 text-[#1d833f]">
                  <CheckCircle2 size={12} /> Đối tác thực tập FIT UET
                </span>
                <span className="inline-flex items-center gap-1 px-3 py-0.5 rounded-full text-[11px] font-semibold bg-[#f8fafc] text-[#0f172a]">
                  <Users size={12} className="text-[#64748b]" /> Chỉ tiêu: {company.slots} sinh viên
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-black text-[#0f172a] tracking-tight">{company.name}</h1>
              <p className="text-xs sm:text-sm text-[#334155] mt-2 max-w-2xl leading-relaxed">{description}</p>
            </div>
          </div>

          {company.recruitment_link && (
            <a
              href={company.recruitment_link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold text-white bg-[#034ea1] hover:bg-[#023a7a] active:scale-[0.98] transition-all shadow-xs cursor-pointer whitespace-nowrap self-start"
            >
              <span>Xem trang tuyển dụng</span>
              <ExternalLink size={13} />
            </a>
          )}
        </div>

        {/* Master Details Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-8 items-start">
          {/* Left: Contact Specifications (col-span-5) */}
          <div className="lg:col-span-5 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#64748b]">Thông tin liên hệ & Địa điểm</h3>
            <div className="bg-[#f8fafc] border border-black/[0.04] rounded-2xl p-5 divide-y divide-black/[0.04] text-xs">
              <div className="py-2.5 first:pt-0 flex items-start gap-3">
                <Mail size={15} className="text-[#034ea1] shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] uppercase font-bold text-[#64748b]">Email tuyển dụng</span>
                  <div className="font-semibold text-[#0f172a] mt-0.5 truncate">
                    {company.contact_email ? (
                      <a href={`mailto:${company.contact_email}`} className="text-[#034ea1] hover:underline">
                        {company.contact_email}
                      </a>
                    ) : (
                      'Chưa cập nhật'
                    )}
                  </div>
                </div>
              </div>

              <div className="py-2.5 flex items-start gap-3">
                <Phone size={15} className="text-[#15803d] shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] uppercase font-bold text-[#64748b]">Điện thoại</span>
                  <div className="font-semibold text-[#0f172a] mt-0.5">
                    {company.phone ? (
                      <a href={`tel:${company.phone}`} className="hover:underline">
                        {company.phone}
                      </a>
                    ) : (
                      'Chưa cập nhật'
                    )}
                  </div>
                </div>
              </div>

              <div className="py-2.5 flex items-start gap-3">
                <Users size={15} className="text-[#af52de] shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] uppercase font-bold text-[#64748b]">Người phụ trách</span>
                  <div className="font-semibold text-[#0f172a] mt-0.5">{company.contact_name || 'Chưa cập nhật'}</div>
                </div>
              </div>

              <div className="py-2.5 last:pb-0 flex items-start gap-3">
                <MapPin size={15} className="text-[#c2410c] shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] uppercase font-bold text-[#64748b]">Địa chỉ trụ sở</span>
                  <div className="font-semibold text-[#0f172a] mt-0.5 leading-normal">{company.address || 'Chưa cập nhật'}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Right: History & Qualifications (col-span-7) */}
          <div className="lg:col-span-7 space-y-6">
            {/* History Card */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#64748b] mb-3 flex items-center gap-1.5">
                <BookOpen size={14} className="text-[#034ea1]" />
                Lịch sử & Quy mô tổ chức
              </h3>
              <div className="bg-[#f8fafc] border border-black/[0.04] rounded-2xl p-5 text-xs text-[#0f172a] leading-relaxed whitespace-pre-wrap">
                {company.history || 'Đơn vị chưa cập nhật thông tin chi tiết về lịch sử phát triển và quy mô.'}
              </div>
            </div>

            {/* Qualifications Card */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#64748b] mb-3 flex items-center gap-1.5">
                <CheckCircle2 size={14} className="text-[#15803d]" />
                Yêu cầu & Tiêu chí tiếp nhận sinh viên
              </h3>
              <div className="bg-[#034ea1]/[0.04] border border-[#034ea1]/15 rounded-2xl p-5 text-xs text-[#005bb5] leading-relaxed whitespace-pre-wrap font-medium">
                {company.qualifications || 'Đơn vị tiếp nhận sinh viên theo quy chế đào tạo chung của Khoa CNTT.'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
