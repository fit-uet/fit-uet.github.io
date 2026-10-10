import React from 'react';
import { Button } from '../ui/Button';
import { paginationBounds } from '../utils/format';

export function PaginationControls({
  total,
  currentPage,
  pageSize,
  onPageChange,
  label = 'bản ghi',
}: {
  total: number;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  label?: string;
}) {
  if (total === 0) return null;
  const { totalPages, safePage, start, end } = paginationBounds(total, currentPage, pageSize);
  return (
    <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-500 font-medium select-none">
      <div>
        Hiển thị <strong>{start}</strong>-<strong>{end}</strong> / <strong>{total}</strong> {label}
      </div>
      <div className="flex items-center gap-2.5">
        <Button
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage <= 1}
          size="sm"
        >
          Trước
        </Button>
        <span className="min-w-16 text-center text-xs font-semibold text-slate-600">Trang {safePage} / {totalPages}</span>
        <Button
          onClick={() => onPageChange(Math.min(totalPages, safePage + 1))}
          disabled={safePage >= totalPages}
          size="sm"
        >
          Sau
        </Button>
      </div>
    </div>
  );
}
