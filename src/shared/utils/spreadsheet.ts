import * as XLSX from 'xlsx';

export const saveXlsx = (filename: string, headers: string[], rows: any[][], sheetName = 'Sheet1') => {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31) || 'Sheet1');
  XLSX.writeFile(workbook, filename);
};

export const xlsxArrayBuffer = (headers: string[], rows: any[][], sheetName = 'Sheet1') => {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31) || 'Sheet1');
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
};

export const xlsxBlob = (headers: string[], rows: any[][], sheetName = 'Sheet1') =>
  new Blob([xlsxArrayBuffer(headers, rows, sheetName)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

export const csvCells = (line: string) => {
  const cells: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"' && quoted && next === '"') {
      value += '"';
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      cells.push(value.trim());
      value = '';
    } else {
      value += ch;
    }
  }
  cells.push(value.trim());
  return cells;
};

export const readSpreadsheetRows = async (file: File) => {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' }).map(row => row.map(cell => String(cell ?? '').trim()));
  }
  const text = await file.text();
  return text.replace(/^\uFEFF/, '').split(/\r?\n/).map(csvCells).filter(row => row.some(Boolean));
};
