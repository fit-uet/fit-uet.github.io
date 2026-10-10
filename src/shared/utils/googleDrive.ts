import { GOOGLE_CLIENT_ID, GOOGLE_API_KEY } from '../config';

export const loadScriptOnce = (src: string) => new Promise<void>((resolve, reject) => {
  if (document.querySelector(`script[src="${src}"]`)) return resolve();
  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  script.onload = () => resolve();
  script.onerror = () => reject(new Error(`Không tải được script ${src}`));
  document.head.appendChild(script);
});

export const googleOAuthMessage = (error: any) => {
  const raw = typeof error === 'string' ? error : (error?.message || error?.error || '');
  if (String(raw).includes('access_denied')) {
    return 'Google từ chối cấp quyền Drive. Nếu OAuth app đang ở trạng thái Testing, hãy thêm tài khoản Google đang đăng nhập vào danh sách Test users trong Google Cloud Console, hoặc chuyển app sang Production sau khi cấu hình/xác minh phù hợp.';
  }
  if (String(raw).includes('popup')) {
    return 'Không mở được cửa sổ xác thực Google. Vui lòng cho phép popup với trang này rồi thử lại.';
  }
  return raw || 'Không lấy được quyền Google Drive.';
};

export const getDriveAccessToken = async () => {
  await loadScriptOnce('https://accounts.google.com/gsi/client');
  const google = (window as any).google;
  if (!google?.accounts?.oauth2) throw new Error('Không tải được Google Identity Services.');
  return await new Promise<string>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (response: any) => {
        if (response?.access_token) resolve(response.access_token);
        else reject(new Error(googleOAuthMessage(response)));
      },
      error_callback: (error: any) => reject(new Error(googleOAuthMessage(error))),
    });
    client.requestAccessToken({ prompt: 'consent' });
  });
};

export const pickDriveFolder = async (accessToken: string) => {
  if (!GOOGLE_API_KEY) throw new Error('Chưa cấu hình VITE_GOOGLE_API_KEY để dùng Google Drive Picker.');
  await loadScriptOnce('https://apis.google.com/js/api.js');
  const gapi = (window as any).gapi;
  const google = (window as any).google;
  await new Promise<void>((resolve) => gapi.load('picker', { callback: resolve }));
  return await new Promise<{ id: string; name: string }>((resolve, reject) => {
    const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setMimeTypes('application/vnd.google-apps.folder')
      .setSelectFolderEnabled(true);
    const picker = new google.picker.PickerBuilder()
      .setDeveloperKey(GOOGLE_API_KEY)
      .setOAuthToken(accessToken)
      .setOrigin(window.location.origin)
      .setTitle('Chọn thư mục Google Drive để lưu danh sách')
      .addView(view)
      .setCallback((data: any) => {
        if (data.action === google.picker.Action.PICKED) {
          const doc = data.docs?.[0];
          resolve({ id: doc.id, name: doc.name || 'Google Drive' });
        } else if (data.action === google.picker.Action.CANCEL) {
          reject(new Error('Bạn đã huỷ chọn thư mục Google Drive.'));
        }
      })
      .build();
    picker.setVisible(true);
  });
};

export const uploadXlsxToDrive = async (accessToken: string, folderId: string, filename: string, blob: Blob) => {
  const boundary = `fit_uet_${Date.now()}`;
  const metadata = {
    name: filename,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    parents: [folderId],
  };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ], { type: `multipart/related; boundary=${boundary}` });
  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const uploaded = await uploadRes.json();
  if (!uploadRes.ok) throw new Error(uploaded?.error?.message || 'Không upload được file lên Google Drive.');
  const permRes = await fetch(`https://www.googleapis.com/drive/v3/files/${uploaded.id}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });
  if (!permRes.ok) {
    const error = await permRes.json().catch(() => ({}));
    throw new Error(error?.error?.message || 'Không bật được quyền xem bằng link cho file Google Drive.');
  }
  return uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view?usp=sharing`;
};

// Backward-compatible alias used by existing Google Drive actions
export const getGoogleDriveAccessToken = getDriveAccessToken;
