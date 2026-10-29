export const formatCourseCode = (code?: string): string => {
  if (!code) return '';
  const trimmed = String(code).trim();
  const parts = trimmed.split(/\s+/);
  return parts[parts.length - 1] || '';
};

export function matchesCourseCode(value: unknown, filter: string) {
  if (!filter) return true;
  const code = (input: unknown) => String(input || '').toUpperCase().match(/\bINT\d{4}\b/)?.[0] || String(input || '').trim().toUpperCase();
  return code(value) === code(filter);
}

export const cleanStudentName = (rawName?: string, studentId?: string, email?: string): string => {
  if (!rawName) return '';
  let name = String(rawName).trim();

  const stripIdAndEmail = (str: string) => {
    let s = str;
    if (studentId) {
      const sId = String(studentId).trim();
      if (sId) {
        if (s.toLowerCase().startsWith(sId.toLowerCase())) {
          s = s.slice(sId.length).trim().replace(/^[-_.:/\s]+/, '');
        }
        if (s.toLowerCase().endsWith(sId.toLowerCase())) {
          s = s.slice(0, -sId.length).trim().replace(/[-_.:/\s]+$/, '');
        }
      }
    }
    if (email) {
      const userPart = String(email).split('@')[0]?.trim();
      if (userPart && userPart.length >= 3) {
        if (s.toLowerCase().startsWith(userPart.toLowerCase())) {
          s = s.slice(userPart.length).trim().replace(/^[-_.:/\s]+/, '');
        }
        if (s.toLowerCase().endsWith(userPart.toLowerCase())) {
          s = s.slice(0, -userPart.length).trim().replace(/[-_.:/\s]+$/, '');
        }
      }
    }
    s = s.replace(/^(?:mssv|msv|sv)?\s*[:#-]?\s*\(?\d{6,12}\)?\s*[-_.:/\s]*/i, '').trim();
    s = s.replace(/\s*[-_.:/]?\s*\(?\d{6,12}\)?$/i, '').trim();
    return s;
  };

  name = stripIdAndEmail(name);

  // 1. Handle duplicate name with separator: e.g. "Khuất Tuấn Anh - Khuất Tuấn Anh" or "Khuất Tuấn Anh - Khuất Tuấn"
  const sepParts = name.split(/\s*[-–—/|,]\s*/);
  if (sepParts.length === 2) {
    const p1 = sepParts[0].trim();
    const p2 = sepParts[1].trim();
    if (p1.localeCompare(p2, undefined, { sensitivity: 'accent' }) === 0 ||
        (p2.length >= 2 && p1.toLowerCase().startsWith(p2.toLowerCase()))) {
      name = p1;
    }
  }

  // 2. Handle repeated name or truncated repeated name without separator
  // e.g. "Lê Tuấn Đạt Lê Tuấn Đạt" or "Phạm Đức Toàn Phạm Đức T"
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    for (let i = 1; i < words.length; i++) {
      const first = words.slice(0, i).join(' ');
      const rest = words.slice(i).join(' ');
      if (first.localeCompare(rest, undefined, { sensitivity: 'accent' }) === 0) {
        name = first;
        break;
      }
      if (i >= 2 && rest.length >= 2 && first.toLowerCase().startsWith(rest.toLowerCase())) {
        name = first;
        break;
      }
    }
  }

  // 3. Handle 3-times repetition: e.g. length % 3 === 0
  const words3 = name.split(/\s+/).filter(Boolean);
  if (words3.length >= 3 && words3.length % 3 === 0) {
    const third = words3.length / 3;
    const p1 = words3.slice(0, third).join(' ');
    const p2 = words3.slice(third, third * 2).join(' ');
    const p3 = words3.slice(third * 2).join(' ');
    if (p1.localeCompare(p2, undefined, { sensitivity: 'accent' }) === 0 &&
        p2.localeCompare(p3, undefined, { sensitivity: 'accent' }) === 0) {
      name = p1;
    }
  }

  name = stripIdAndEmail(name);
  name = name.replace(/\s+/g, ' ').trim();

  return name || String(rawName).trim();
};

export const companyDescriptionText = (value: any) => {
  const text = String(value || '').trim();
  return /^Tuyển\s+\d+\s+sinh viên thực tập\.?$/i.test(text) ? '' : text;
};

export const companyDisplayDescription = (value: any) => companyDescriptionText(value) || 'Chưa rõ';

export const paginationBounds = (total: number, currentPage: number, pageSize: number) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(safePage * pageSize, total);
  return { totalPages, safePage, start, end };
};
