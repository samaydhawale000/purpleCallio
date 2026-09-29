'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  pageCount: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, pageCount, totalItems, pageSize, onPageChange }: PaginationProps) {
  if (totalItems === 0) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(totalItems, page * pageSize);

  return (
    <div className="flex items-center justify-between gap-3 pt-4 mt-2 border-t border-[#E7DFF5]">
      <p className="text-xs text-[#3D3650]">
        Showing {start}–{end} of {totalItems}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-[#E7DFF5] text-[#3D3650] hover:text-[#170B2E] hover:border-[#D6C4EE] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-[#3D3650] disabled:hover:border-[#E7DFF5]"
        >
          <ChevronLeft size={13} />
          Prev
        </button>
        <span className="text-xs text-[#3D3650] px-1">
          Page {page} of {pageCount}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount}
          className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-[#E7DFF5] text-[#3D3650] hover:text-[#170B2E] hover:border-[#D6C4EE] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-[#3D3650] disabled:hover:border-[#E7DFF5]"
        >
          Next
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}
