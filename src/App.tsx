import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { HashRouter, Link, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { LogOut, User as UserIcon, CheckCircle2, LogIn, LayoutDashboard, AlertTriangle, FileText, Bell, CircleHelp, MessageCircle, GraduationCap, Settings } from 'lucide-react';
import { API_BASE, clearJsonCache, GOOGLE_CLIENT_ID, isAuthExpiredResponse, jwtExpiresAtMs, MyNotifications } from './shared';
import { AppRoutes } from './app/AppRoutes';

function RoleSwitchButton({ user, onNavigate }: { user: any; onNavigate?: () => void }) {
  const location = useLocation();
  if (!user || user.role !== 'admin' || !user.is_lecturer) return null;

  const isLecturerView = location.pathname.startsWith('/lecturer');

  if (isLecturerView) {
    return (
      <Link
        to="/admin"
        onClick={onNavigate}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-white/15 hover:bg-white/25 border border-white/25 shadow-xs transition-all active:scale-[0.98] whitespace-nowrap cursor-pointer backdrop-blur-sm"
        title="Chuyển sang Trang Quản trị (Admin Dashboard)"
      >
        <LayoutDashboard size={14} className="text-blue-100" />
        <span className="hidden sm:inline">Trang Quản trị</span>
        <span className="sm:hidden text-[11px]">Admin</span>
      </Link>
    );
  }

  return (
    <Link
      to="/lecturer"
      onClick={onNavigate}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-white/15 hover:bg-white/25 border border-white/25 shadow-xs transition-all active:scale-[0.98] whitespace-nowrap cursor-pointer backdrop-blur-sm"
      title="Chuyển sang Trang Giảng viên (xem SV hướng dẫn & chấm điểm)"
    >
      <GraduationCap size={15} className="text-amber-200" />
      <span className="hidden sm:inline">Trang Giảng viên</span>
      <span className="sm:hidden text-[11px]">Giảng viên</span>
    </Link>
  );
}

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [user, setUser] = useState<any>(localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')!) : null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [unreadChats, setUnreadChats] = useState(0);

  const handleLoginSuccess = async (credentialResponse: any) => {
    setLoginError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: credentialResponse.credential }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setLoginError(data.error || 'Đăng nhập thất bại. Vui lòng thử lại sau.');
        return;
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
    } catch (e) {
      setLoginError('Đăng nhập thất bại. Vui lòng thử lại sau.');
    }
  };

  const clearAuthSession = (message?: string) => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    clearJsonCache();
    setToken(null);
    setUser(null);
    setUnreadNotifications(0);
    setUnreadChats(0);
    setIsNotificationOpen(false);
    setIsMenuOpen(false);
    if (message) setLoginError(message);
  };

  const logout = () => {
    clearAuthSession();
  };

  const handleAuthExpired = () => {
    clearAuthSession('Phiên đăng nhập đã hết hạn hoặc không còn hợp lệ. Vui lòng đăng nhập lại.');
  };

  useEffect(() => {
    if (!token) return;
    const expiresAt = jwtExpiresAtMs(token);
    if (!expiresAt) return;
    const msUntilExpiry = expiresAt - Date.now();
    if (msUntilExpiry <= 0) {
      handleAuthExpired();
      return;
    }
    const timer = window.setTimeout(handleAuthExpired, Math.min(msUntilExpiry, 2147483647));
    return () => window.clearTimeout(timer);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const listener = () => handleAuthExpired();
    window.addEventListener('auth-expired', listener);
    return () => window.removeEventListener('auth-expired', listener);
  }, [token]);

  const refreshUnreadNotifications = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/notifications/my`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (isAuthExpiredResponse(res, data)) return handleAuthExpired();
      if (res.ok) setUnreadNotifications(Number(data.unread || 0));
    } catch (e) { }
  };

  const refreshUnreadChats = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/chat/threads`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (isAuthExpiredResponse(res, data)) return handleAuthExpired();
      if (res.ok && Array.isArray(data)) {
        const total = data.reduce((sum, t) => sum + Number(t.unread_count || 0), 0);
        setUnreadChats(total);
      }
    } catch (e) { }
  };

  useEffect(() => {
    if (!token || !user) return;
    refreshUnreadNotifications();
    refreshUnreadChats();

    let lastFetchTime = Date.now();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        if (now - lastFetchTime >= 60000) {
          lastFetchTime = now;
          refreshUnreadNotifications();
          refreshUnreadChats();
        }
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        lastFetchTime = Date.now();
        refreshUnreadNotifications();
        refreshUnreadChats();
      }
    }, 180000);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(timer);
    };
  }, [token, user?.id]);

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <HashRouter>
        <div className="app-shell w-full h-full flex flex-col font-sans overflow-x-hidden">
          {/* Header */}
          <header className="app-header h-16 text-white px-6 flex items-center justify-between z-10 sticky top-0 w-full">
            <div className="app-header__inner mx-auto w-full flex items-center justify-between">
              <Link to="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity cursor-pointer">
                <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center hidden sm:flex overflow-hidden border border-white/20 shadow-sm">
                  <img src={`${import.meta.env.BASE_URL}logo.png`} alt="FIT UET 30 Years" className="w-full h-full object-contain p-0.5" />
                </div>
                <div>
                  <h1 className="text-sm md:text-base font-extrabold leading-tight uppercase tracking-tight">Khoa Công nghệ Thông tin</h1>
                  <p className="text-[9px] md:text-[10px] text-blue-100 font-bold uppercase tracking-wider opacity-90">Trường Đại học Công nghệ - ĐHQGHN</p>
                </div>
              </Link>

              {user ? (
                <div className="flex items-center gap-3">
                  {!!(user.role === 'student' || user.role === 'lecturer' || user.is_lecturer) && (
                    <Link
                      to="/chat"
                      onClick={() => { setIsMenuOpen(false); setIsNotificationOpen(false); }}
                      className="relative inline-flex items-center justify-center w-9 h-9 rounded-xl hover:bg-white/10 transition-colors text-white"
                      title={user.role === 'student' ? 'Trao đổi GVHD' : 'Trao đổi sinh viên'}
                    >
                      <MessageCircle size={18} />
                      {unreadChats > 0 && (
                        <span className="absolute -top-1 -right-1 min-w-4.5 h-4.5 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center border border-[#004a99]">
                          {unreadChats > 99 ? '99+' : unreadChats}
                        </span>
                      )}
                    </Link>
                  )}
                  <div className="relative">
                    <button
                      onClick={() => { setIsNotificationOpen(!isNotificationOpen); setIsMenuOpen(false); }}
                      className="relative w-9 h-9 rounded-xl hover:bg-white/10 flex items-center justify-center transition-colors focus:outline-none cursor-pointer text-white"
                      title="Thông báo"
                    >
                      <Bell size={18} />
                      {unreadNotifications > 0 && (
                        <span className="absolute -top-1 -right-1 min-w-4.5 h-4.5 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center border border-[#004a99]">
                          {unreadNotifications > 99 ? '99+' : unreadNotifications}
                        </span>
                      )}
                    </button>
                    {isNotificationOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setIsNotificationOpen(false)}></div>
                        <div className="absolute right-0 mt-2 w-[min(92vw,420px)] bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-black/[0.08] z-50 overflow-hidden text-slate-800 origin-top-right">
                          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                            <div className="font-bold text-slate-900 flex items-center gap-2"><Bell size={16} className="text-amber-600" /> Thông báo</div>
                            <Link to="/notifications" onClick={() => setIsNotificationOpen(false)} className="text-xs font-semibold text-blue-600 hover:underline">Xem tất cả</Link>
                          </div>
                          <div className="max-h-[70vh] overflow-y-auto">
                            <MyNotifications
                              token={token}
                              user={user}
                              compact
                              onChanged={setUnreadNotifications}
                              onClose={() => setIsNotificationOpen(false)}
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <RoleSwitchButton
                    user={user}
                    onNavigate={() => {
                      setIsMenuOpen(false);
                      setIsNotificationOpen(false);
                    }}
                  />

                  <div className="relative">
                    <button onClick={() => { setIsMenuOpen(!isMenuOpen); setIsNotificationOpen(false); }} className="flex items-center gap-2 hover:bg-white/10 text-white p-1 pr-2 rounded-xl transition-all cursor-pointer group focus:outline-none">
                      <div className="text-right hidden sm:block">
                        <p className="text-xs font-semibold group-hover:text-blue-100 transition-colors leading-tight">{user.name}</p>
                        <p className="text-[10px] text-blue-100/80 group-hover:text-blue-100 transition-all leading-tight mt-0.5">{user.email}</p>
                      </div>
                      {user.picture ? (
                        <img src={user.picture} alt="Avatar" className="w-8 h-8 rounded-full border-2 border-white/60 shadow-sm group-hover:border-white transition-colors object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-white/20 border-2 border-white/60 flex items-center justify-center text-white font-bold shadow-sm group-hover:border-white transition-colors"><UserIcon size={14} /></div>
                      )}
                    </button>

                    {isMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setIsMenuOpen(false)}></div>
                        <div className="absolute right-0 mt-2 w-52 bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-black/[0.08] py-1.5 z-50 overflow-hidden text-slate-800 origin-top-right">
                          <Link to="/profile" onClick={() => setIsMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 text-xs font-medium transition-colors border-b border-slate-50">
                            <UserIcon size={15} className="text-blue-600" /> Cập nhật hồ sơ
                          </Link>
                          {user.role === 'student' && (
                            <>
                              <Link to="/plan" onClick={() => setIsMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 text-xs font-medium transition-colors border-b border-slate-50">
                                <FileText size={15} className="text-blue-600" /> Kế hoạch triển khai
                              </Link>
                              <Link to="/reports/final" onClick={() => setIsMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 text-xs font-medium transition-colors border-b border-slate-50">
                                <FileText size={15} className="text-blue-600" /> Báo cáo thực tập
                              </Link>
                            </>
                          )}
                          {user.role === 'lecturer' && (
                            <>
                              <Link to="/lecturer" onClick={() => setIsMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 text-xs font-medium transition-colors border-b border-slate-50">
                                <GraduationCap size={15} className="text-blue-600" /> Trang giảng viên
                              </Link>
                              <Link to="/plan" onClick={() => setIsMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 text-xs font-medium transition-colors border-b border-slate-50">
                                <FileText size={15} className="text-blue-600" /> Kế hoạch triển khai
                              </Link>
                              <Link to="/lecturer-guide" onClick={() => setIsMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 text-xs font-medium transition-colors border-b border-slate-50">
                                <CircleHelp size={15} className="text-slate-500" /> Hướng dẫn sử dụng
                              </Link>
                              <Link to="/lecturer/grades" onClick={() => setIsMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 text-xs font-medium transition-colors border-b border-slate-50">
                                <CheckCircle2 size={15} className="text-emerald-600" /> Chấm điểm thực tập
                              </Link>
                            </>
                          )}
                          {user.role === 'admin' && (
                            <>
                              <Link to="/admin" onClick={() => setIsMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 text-xs font-medium transition-colors border-b border-slate-50">
                                <LayoutDashboard size={15} className="text-blue-600" /> Trang quản trị
                              </Link>
                              <Link to="/admin/settings" onClick={() => setIsMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 text-xs font-medium transition-colors border-b border-slate-50">
                                <Settings size={15} className="text-slate-600" /> Cài đặt hệ thống
                              </Link>
                              <Link to="/plan" onClick={() => setIsMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 text-xs font-medium transition-colors border-b border-slate-50">
                                <FileText size={15} className="text-blue-600" /> Kế hoạch triển khai
                              </Link>
                              {user.is_lecturer && (
                                <>
                                  <Link to="/lecturer-guide" onClick={() => setIsMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 text-xs font-medium transition-colors border-b border-slate-50">
                                    <CircleHelp size={15} className="text-slate-500" /> Hướng dẫn sử dụng
                                  </Link>
                                  <Link to="/lecturer/grades" onClick={() => setIsMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 text-xs font-medium transition-colors border-b border-slate-50">
                                    <CheckCircle2 size={15} className="text-emerald-600" /> Chấm điểm thực tập
                                  </Link>
                                </>
                              )}
                            </>
                          )}
                          <Link to="/faq" onClick={() => setIsMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 text-xs font-medium transition-colors border-b border-slate-50">
                            <CircleHelp size={15} className="text-amber-600" /> FAQ
                          </Link>
                          <button onClick={() => { setIsMenuOpen(false); logout(); }} className="flex items-center gap-2 px-4 py-2.5 hover:bg-red-50 text-xs font-medium text-red-600 w-full text-left transition-colors cursor-pointer">
                            <LogOut size={15} /> Đăng xuất
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </header>

          {/* Main Content */}
          <main className="app-main flex-1 px-6 py-8">
            {!token ? (
              <div className="max-w-md mx-auto mt-16 bg-white p-8 rounded-2xl shadow-sm border border-slate-200/80 text-center">
                <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-blue-100/60 shadow-xs">
                  <LogIn className="text-[#034ea1]" size={26} />
                </div>
                <h2 className="text-xl font-bold text-slate-900 mb-2 tracking-tight">Đăng nhập</h2>
                <p className="text-slate-500 text-xs mb-6 leading-relaxed">
                  Hệ thống đăng ký và quản lý Thực tập FIT UET.<br />
                  Yêu cầu đăng nhập bằng VNU mail <strong className="text-[#034ea1] font-semibold">@vnu.edu.vn</strong>
                </p>

                <div className="flex justify-center border border-slate-100 p-4 bg-slate-50/70 rounded-xl">
                  <GoogleLogin
                    onSuccess={handleLoginSuccess}
                    onError={() => setLoginError('Lỗi đăng nhập từ Google.')}
                    useOneTap
                    shape="pill"
                  />
                </div>
              </div>
            ) : (
              <AppRoutes
                user={user}
                setUser={setUser}
                token={token}
                onAuthExpired={handleAuthExpired}
                onUnreadNotificationsChanged={setUnreadNotifications}
                onUnreadChatsChanged={setUnreadChats}
              />
            )}
          </main>

          <div className="app-footer px-8 py-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-medium mt-auto">
            <p>© 2026 Khoa CNTT UET</p>
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <p>Hỗ trợ thông tin: baoptm@vnu.edu.vn (cô Bảo)</p>
              <p>Hỗ trợ kỹ thuật: 0961309175 (Tuyên)</p>
            </div>
          </div>

          {/* Login Error Modal */}
          {loginError && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
              <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 border border-slate-200">
                <div className="flex items-center gap-3 text-amber-600 mb-4">
                  <AlertTriangle size={24} />
                  <h3 className="text-lg font-bold">Thông Báo Phiên Làm Việc</h3>
                </div>
                <p className="text-slate-600 mb-6 text-sm leading-relaxed">
                  {loginError}
                </p>
                <div className="flex justify-end gap-3 mt-6">
                  <button
                    onClick={() => setLoginError(null)}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-sm transition-colors cursor-pointer"
                  >
                    Đăng nhập lại
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </HashRouter>
    </GoogleOAuthProvider>
  );
}

export default App;
