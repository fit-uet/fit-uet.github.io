import { rowsToSettings, cleanStudentName } from './helpers';

export async function checkAndQueueScheduledReminders(dbClient: any): Promise<{
  studentCount: number;
  lecturerCount: number;
}> {
  const settings = rowsToSettings(
    (
      await dbClient.execute(`
    SELECT key, value FROM settings
    WHERE key IN ('final_report_close_at', 'grading_close_at')
  `)
    ).rows
  );

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  let studentCount = 0;
  let lecturerCount = 0;

  // 1. Check final_report_close_at (T-3 to T-0 days)
  if (settings.final_report_close_at) {
    const reportDeadline = new Date(settings.final_report_close_at);
    const diffHours = (reportDeadline.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (diffHours > 0 && diffHours <= 72) {
      const studentRows = (
        await dbClient.execute(`
        SELECT f.user_id, u.id, u.student_id, u.name, u.email, u.personal_email, u.class_name, u.course_code,
               CASE WHEN c.name = 'Công ty khác' THEN r.other_company_name ELSE c.name END as internship_place,
               fr.status as report_status,
               GROUP_CONCAT(CASE WHEN aa.role = 'primary' THEN l.name END) as primary_advisors
        FROM final_internships f
        JOIN users u ON u.id = f.user_id
        LEFT JOIN companies c ON c.id = f.company_id
        LEFT JOIN registrations r ON r.id = f.registration_id
        LEFT JOIN final_reports fr ON fr.user_id = f.user_id
        LEFT JOIN advisor_assignments aa ON aa.user_id = f.user_id
        LEFT JOIN lecturers l ON l.id = aa.lecturer_id
        WHERE fr.id IS NULL OR fr.status IN ('missing', 'needs_revision')
        GROUP BY f.user_id
      `)
      ).rows as any[];

      const deadlineStr = settings.final_report_close_at
        ? ` trước ${settings.final_report_close_at.replace('T', ' ')} (GMT+7)`
        : '';

      for (const r of studentRows) {
        if (!r.email && !r.personal_email) continue;
        const recent = (
          await dbClient.execute({
            sql: `SELECT id FROM notifications
                  WHERE user_id = ? AND type = 'final_report_due_reminder'
                    AND created_at >= datetime('now', '+7 hours', '-24 hours')
                  LIMIT 1`,
            args: [r.id],
          })
        ).rows;
        if (recent.length > 0) continue; // 24-hour throttle cooldown

        const displayName = cleanStudentName(r.name, r.student_id, r.email);
        const isRevision = r.report_status === 'needs_revision';
        const subject = `[FIT-UET] Nhắc nộp Báo cáo Thực tập tốt nghiệp - Hạn chót:${deadlineStr || ' theo thông báo'}`;
        const body = `Kính gửi em ${displayName} (${r.student_id || '-'}), Lớp ${r.class_name || '-'},\n\nKhoa Công nghệ Thông tin - Trường ĐH Công nghệ nhắc em về việc hoàn thành nộp Báo cáo Thực tập tốt nghiệp:\n- Học phần: ${r.course_code || 'Thực tập'}\n- Nơi thực tập: ${r.internship_place || '-'}\n- Giảng viên hướng dẫn chính: ${r.primary_advisors || 'Khoa phân công'}\n- Tình trạng hiện tại: ${isRevision ? 'Cần nộp lại theo góp ý của GVHD' : 'Chưa nộp báo cáo'}\n- Thời hạn nộp cuối cùng:${deadlineStr || ' theo thông báo của Khoa'}.\n\nLƯU Ý QUAN TRỌNG:\n1. Báo cáo định dạng file PDF, dung lượng tối đa 10 MB.\n2. Sinh viên không nộp báo cáo đúng hạn sẽ không có căn cứ để Giảng viên hướng dẫn đánh giá và cho điểm học phần.\n\n👉 Đường dẫn nộp báo cáo trực tuyến:\nhttps://fit-uet.github.io/internship-registration-system/#/student/report\n\nTrân trọng,\nVăn phòng Khoa Công nghệ Thông tin - Trường Đại học Công nghệ, ĐHQGHN.`;

        await dbClient.execute({
          sql: `INSERT INTO notifications (user_id, recipient_email, type, subject, body, status, created_at)
                VALUES (?, ?, ?, ?, ?, 'queued', datetime('now', '+7 hours'))`,
          args: [Number(r.id), r.email || r.personal_email, 'final_report_due_reminder', subject, body],
        });
        studentCount++;
      }
    }
  }

  // 2. Check grading_close_at (T-3 to T-0 days)
  if (settings.grading_close_at) {
    const gradeDeadline = new Date(settings.grading_close_at);
    const diffHours = (gradeDeadline.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (diffHours > 0 && diffHours <= 72) {
      const rows = (
        await dbClient.execute(`
        SELECT f.user_id,
               u.student_id, u.name as student_name, u.email as student_email, u.class_name, u.course_code,
               CASE WHEN c.name = 'Công ty khác' THEN r.other_company_name ELSE c.name END as internship_place,
               fr.status as report_status, fr.submitted_at as report_submitted_at,
               g.status as grade_status,
               l.id as lecturer_id, l.name as lecturer_name, l.email as lecturer_email, l.work_unit
        FROM final_internships f
        JOIN users u ON u.id = f.user_id
        LEFT JOIN companies c ON c.id = f.company_id
        LEFT JOIN registrations r ON r.id = f.registration_id
        LEFT JOIN final_reports fr ON fr.user_id = f.user_id
        LEFT JOIN grades g ON g.user_id = f.user_id
        JOIN advisor_assignments aa ON aa.user_id = f.user_id AND aa.role = 'primary'
        JOIN lecturers l ON l.id = aa.lecturer_id
        WHERE g.id IS NULL OR g.status != 'submitted'
        ORDER BY l.name ASC, u.student_id ASC
      `)
      ).rows as any[];

      const lecturerMap = new Map<number, any>();
      for (const r of rows) {
        if (!lecturerMap.has(r.lecturer_id)) {
          lecturerMap.set(r.lecturer_id, {
            lecturer_id: r.lecturer_id,
            lecturer_name: r.lecturer_name,
            lecturer_email: r.lecturer_email,
            work_unit: r.work_unit,
            students: [],
          });
        }
        lecturerMap.get(r.lecturer_id).students.push({
          user_id: r.user_id,
          student_id: r.student_id,
          student_name: cleanStudentName(r.student_name, r.student_id, r.student_email),
          class_name: r.class_name,
          course_code: r.course_code,
          internship_place: r.internship_place,
          report_status: r.report_status || 'missing',
          waiting_for_grade: r.report_status === 'submitted' || r.report_status === 'accepted',
        });
      }

      const deadlineStr = settings.grading_close_at
        ? ` trước ${settings.grading_close_at.replace('T', ' ')} (GMT+7)`
        : '';

      for (const gv of lecturerMap.values()) {
        if (!gv.lecturer_email) continue;

        // Anti-spam check
        const recent = (
          await dbClient.execute({
            sql: `SELECT id FROM notifications
                  WHERE recipient_email = ? AND type = 'lecturer_grade_pending_reminder'
                    AND created_at >= datetime('now', '+7 hours', '-24 hours')
                  LIMIT 1`,
            args: [gv.lecturer_email],
          })
        ).rows;
        if (recent.length > 0) continue; // 24-hour throttle cooldown

        const waitingLecturerCount = gv.students.filter((s: any) => s.waiting_for_grade).length;
        const waitingStudentCount = gv.students.filter((s: any) => !s.waiting_for_grade).length;

        let tableText = 'STT | Mã SV | Họ tên | Lớp | Học phần | Nơi TT | Trạng thái BC | Tình trạng\n';
        tableText += '-----------------------------------------------------------------------------------\n';
        gv.students.forEach((s: any, idx: number) => {
          const condition = s.waiting_for_grade ? 'Chờ Thầy/Cô chấm' : 'Chờ SV nộp báo cáo';
          const bc = s.report_status === 'submitted' ? 'Đã nộp' : s.report_status === 'accepted' ? 'Đã duyệt' : 'Chưa nộp';
          tableText += `${idx + 1} | ${s.student_id} | ${s.student_name} | ${s.class_name || '-'} | ${s.course_code || '-'} | ${s.internship_place || '-'} | ${bc} | ${condition}\n`;
        });

        const subject = `[FIT-UET] Danh sách sinh viên chưa hoàn thành điểm thực tập - GVHD: ${gv.lecturer_name}`;
        const body = `Kính gửi: Thầy/Cô ${gv.lecturer_name},\nĐơn vị: ${gv.work_unit || 'Khoa CNTT'},\n\nKhoa Công nghệ Thông tin kính gửi Thầy/Cô danh sách sinh viên thực tập do Thầy/Cô hướng dẫn chính hiện CHƯA ĐƯỢC HOÀN THIỆN ĐIỂM trên hệ thống:\n- Tổng số sinh viên chưa có điểm: ${gv.students.length} sinh viên\n  + Trong đó đã nộp báo cáo (chờ Thầy/Cô chấm): ${waitingLecturerCount} sinh viên\n  + Trong đó sinh viên chưa nộp báo cáo: ${waitingStudentCount} sinh viên\n- Thời hạn nhập điểm của Khoa:${deadlineStr || ' theo thông báo của Khoa'}.\n\nCHI TIẾT DANH SÁCH SINH VIÊN:\n${tableText}\n\nKÍNH ĐỀ NGHỊ THẦY/CÔ:\n1. Đối với sinh viên ĐÃ nộp báo cáo: Kính nhờ Thầy/Cô vào hệ thống xem báo cáo và nộp điểm chính thức về Khoa.\n2. Đối với sinh viên CHƯA nộp báo cáo: Kính nhờ Thầy/Cô đôn đốc sinh viên nộp báo cáo trước khi hết hạn.\n\n👉 Đường dẫn vào trang Chấm điểm của Thầy/Cô:\nhttps://fit-uet.github.io/internship-registration-system/#/lecturer/grades\n\nKhoa CNTT xin trân trọng cảm ơn Thầy/Cô!`;

        const userMatch = (
          await dbClient.execute({
            sql: 'SELECT id FROM users WHERE email = ? LIMIT 1',
            args: [gv.lecturer_email],
          })
        ).rows[0] as any;

        await dbClient.execute({
          sql: `INSERT INTO notifications (user_id, recipient_email, type, subject, body, status, created_at)
                VALUES (?, ?, ?, ?, ?, 'queued', datetime('now', '+7 hours'))`,
          args: [userMatch ? Number(userMatch.id) : null, gv.lecturer_email, 'lecturer_grade_pending_reminder', subject, body],
        });
        lecturerCount++;
      }
    }
  }

  return { studentCount, lecturerCount };
}
