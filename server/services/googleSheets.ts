import { db } from '../db';

export async function exportRegistrationsToGoogleSheets() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) {
    const error = new Error('Chức năng này yêu cầu cấu hình Service Account (GOOGLE_SERVICE_ACCOUNT_EMAIL và GOOGLE_PRIVATE_KEY) trên Render.');
    (error as any).status = 400;
    throw error;
  }

  const setting = (await db.execute("SELECT value FROM settings WHERE key = 'export_google_sheet_url'")).rows[0] as unknown as { value: string };
  const url = setting?.value;
  if (!url) {
    const error = new Error('Bạn chưa cấu hình [Đường dẫn Google Sheet xuất dữ liệu] trong phần Cài đặt hệ thống.');
    (error as any).status = 400;
    throw error;
  }

  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) {
    const error = new Error('URL Google Sheet không hợp lệ');
    (error as any).status = 400;
    throw error;
  }
  const spreadsheetId = match[1];

  const data = (await db.execute(`
    SELECT
      u.student_id as "Mã SV",
      u.name as "Họ và tên",
      u.dob as "Ngày sinh",
      u.class_name as "Lớp KH",
      CASE
        WHEN INSTR(UPPER(u.course_code), 'INT') > 0 THEN SUBSTR(u.course_code, INSTR(UPPER(u.course_code), 'INT'))
        ELSE COALESCE(u.course_code, '')
      END as "Mã môn học",
      CASE WHEN c.name = 'Công ty khác' THEN 'Công ty khác: ' || coalesce(r.other_company_name, '') ELSE c.name END as "Nơi thực tập",
      CASE WHEN c.name = 'Công ty khác' THEN coalesce(r.other_company_role, '') ELSE 'Thực tập sinh' END as "Vị trí",
      CASE WHEN c.name = 'Công ty khác' THEN coalesce(r.other_company_contact, '') ELSE c.contact_email END as "Liên hệ",
      CASE WHEN c.name = 'Trường Đại học Công nghệ' THEN 'GVHD: ' || coalesce(r.other_company_contact, '') || CASE WHEN coalesce(r.note, '') != '' THEN ' - ' || r.note ELSE '' END ELSE r.note END as "Ghi chú",
      r.review_comment as "Nhận xét duyệt",
      r.status as "Trạng thái",
      r.created_at as "Thời gian đăng ký"
    FROM registrations r
    JOIN users u ON r.user_id = u.id
    JOIN companies c ON r.company_id = c.id
    ORDER BY r.created_at DESC
  `)).rows as any[];

  const headers = data.length > 0 ? ['STT', ...Object.keys(data[0])] : ['STT'];
  const rows = data.map((r, i) => [i + 1, ...Object.values(r)]);
  const sheetData = [headers, ...rows];

  const { google } = await import('googleapis');
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key.replace(/\\n/g, '\n') },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: sheetData },
  });

  return { rowCount: data.length, spreadsheetId };
}
