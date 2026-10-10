import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { User as UserIcon, Plus, Trash2, Shield } from 'lucide-react';
import { API_BASE, Button, PageDescriptionTooltip, PageHeader } from '../../../shared';

export function AdminRegistry({ token }: { token: string }) {
  const navigate = useNavigate();
  const [admins, setAdmins] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newAdminEmail, setNewAdminEmail] = useState('');

  const fetchAdmins = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/admin/admins`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setAdmins(data);
    } catch (e) {
      alert('Lỗi lấy danh sách admin');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAdmins(); }, [token]);

  const handleAddAdmin = async () => {
    if (!newAdminEmail.trim() || !newAdminEmail.endsWith('@vnu.edu.vn')) {
      alert('Vui lòng nhập email @vnu.edu.vn hợp lệ');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/admin/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: newAdminEmail.trim() })
      });
      if (res.ok) {
        const data = await res.json();
        setNewAdminEmail('');
        fetchAdmins();
        alert(data.message || 'Đã thêm admin thành công.');
      } else {
        const err = await res.json();
        alert(err.error || 'Lỗi khi thêm admin');
      }
    } catch {
      alert('Lỗi kết nối');
    }
  };

  const handleRemoveAdmin = async (id: number) => {
    if (!confirm('Bạn có chắc muốn xóa quyền admin của người dùng này?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/admins/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchAdmins();
      } else {
        const err = await res.json();
        alert(err.error || 'Lỗi khi xóa admin');
      }
    } catch {
      alert('Lỗi kết nối');
    }
  };

  const toggleLecturer = async (admin: any) => {
    const newVal = !admin.is_lecturer;
    const action = newVal ? 'thêm' : 'xóa';
    if (!confirm(`Bạn có muốn ${action} "${admin.name}" khỏi danh sách Giảng viên?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/admins/${admin.id}/lecturer`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ is_lecturer: newVal })
      });
      if (res.ok) {
        fetchAdmins();
      } else {
        const err = await res.json();
        alert('Lỗi: ' + err.error);
      }
    } catch {
      alert('Lỗi cập nhật');
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
            <Shield className="text-[#034ea1]" size={24} /> Quản lý Quản trị viên
            <PageDescriptionTooltip description="Danh sách các tài khoản có quyền Admin. Admin có thể đồng thời là Giảng viên." />
          </h2>
          <p className="text-xs text-slate-500 mt-1">Quản lý quyền truy cập quản trị và vai trò giảng viên đi kèm.</p>
        </div>
      </div>

      {/* Add admin */}
      <div className="bg-white border border-black/[0.08] rounded-2xl shadow-xs p-5 space-y-3.5">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
          <Plus size={16} className="text-[#034ea1]" /> Thêm Quản trị viên mới
        </h3>
        <div className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="email"
            placeholder="VD: nguyenvanan@vnu.edu.vn"
            value={newAdminEmail}
            onChange={(e) => setNewAdminEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddAdmin()}
            className="flex-1 px-4 py-2 border border-[#e2e8f0] rounded-xl text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all shadow-xs text-[#0f172a]"
          />
          <button
            onClick={handleAddAdmin}
            className="flex items-center justify-center gap-1.5 bg-[#034ea1] hover:bg-[#023a7a] text-white px-5 py-2 rounded-xl text-xs font-semibold shadow-xs transition-all cursor-pointer whitespace-nowrap active:scale-[0.98]"
          >
            <Plus size={15} /> Thêm Admin
          </button>
        </div>
        <p className="text-[11px] text-slate-400 font-medium">Chỉ chấp nhận email có đuôi @vnu.edu.vn. Người dùng phải đăng nhập lại để quyền Admin có hiệu lực.</p>
      </div>

      <div className="bg-[#e8f1fb] border border-[#d4e5f7] rounded-2xl p-4 text-xs font-medium text-[#034ea1] leading-relaxed shadow-xs">
        <strong>Lưu ý:</strong> Bật công tắc <strong>"Là Giảng viên"</strong> sẽ tự động đồng bộ tên của Admin đó vào danh sách Giảng viên để sinh viên có thể chọn khi đăng ký thực tập tại Trường.
      </div>

      {/* Admin list */}
      <div className="bg-white border border-black/[0.08] rounded-2xl overflow-hidden shadow-xs">
        <table className="w-full text-left border-collapse text-xs text-slate-600">
          <thead>
            <tr className="bg-[#f9f9fb] text-slate-700 font-semibold border-b border-slate-100 text-[10px] tracking-wider uppercase select-none">
              <th className="p-3.5 w-12 text-center">STT</th>
              <th className="p-3.5">Họ và Tên</th>
              <th className="p-3.5">Email</th>
              <th className="p-3.5 text-center">Là Giảng viên</th>
              <th className="p-3.5 text-center w-24">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={5} className="text-center py-10 text-slate-400">Đang tải...</td></tr>
            ) : admins.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-10 text-slate-400">Chưa có admin nào</td></tr>
            ) : (
              admins.map((admin, idx) => (
                <tr key={admin.id} className="hover:bg-[#f8fafc] transition-colors">
                  <td className="p-3.5 text-slate-400 text-center">{idx + 1}</td>
                  <td className="p-3.5">
                    <div className="flex items-center gap-3">
                      {admin.picture ? (
                        <img src={admin.picture} alt={admin.name} className="w-8 h-8 rounded-full border border-black/[0.08]" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-[#e8f1fb] flex items-center justify-center text-[#034ea1]">
                          <UserIcon size={14} />
                        </div>
                      )}
                      <span className="font-semibold text-slate-900 text-xs">{admin.name || <span className="text-slate-400 font-normal italic">Chưa đăng nhập</span>}</span>
                    </div>
                  </td>
                  <td className="p-3.5 text-slate-600">{admin.email}</td>
                  <td className="p-3.5 text-center">
                    <button
                      onClick={() => toggleLecturer(admin)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none cursor-pointer ${admin.is_lecturer ? 'bg-[#34c759]' : 'bg-[#e2e8f0]'
                        }`}
                      title={admin.is_lecturer ? 'Click để bỏ khỏi danh sách GV' : 'Click để thêm vào danh sách GV'}
                    >
                      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-xs transition-transform ${admin.is_lecturer ? 'translate-x-4.5' : 'translate-x-1'
                        }`} />
                    </button>
                    {admin.is_lecturer ? (
                      <span className="ml-2 text-[10px] font-semibold text-[#1b7f37] bg-[#ebf9ee] px-2 py-0.5 rounded-full">GV</span>
                    ) : null}
                  </td>
                  <td className="p-3.5 text-center">
                    <button
                      onClick={() => handleRemoveAdmin(admin.id)}
                      className="text-[#ff3b30] hover:bg-[#fff2f1] p-1.5 rounded-lg transition-colors cursor-pointer"
                      title="Xóa quyền admin"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
