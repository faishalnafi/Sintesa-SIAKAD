import { useEffect, useMemo, useState } from "react";

/**
 * Jumlah data (baris) maksimal yang ditampilkan per 1 tampilan tabel.
 * Bukan batas jumlah halaman — halaman boleh banyak (ceil(total / PAGE_SIZE)).
 */
export const PAGE_SIZE = 10;

export type PaginationState<T> = {
  page: number;
  setPage: (p: number) => void;
  pageSize: number;
  total: number;
  totalPages: number;
  pageItems: T[];
  from: number;
  to: number;
};

/**
 * Client-side pagination: tiap tampilan menampilkan paling banyak `pageSize` data (default 10).
 * Jumlah halaman tidak dibatasi.
 */
export function usePagination<T>(
  items: T[],
  options?: { pageSize?: number; resetKey?: string | number },
): PaginationState<T> {
  const pageSize = options?.pageSize ?? PAGE_SIZE;
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [options?.resetKey, pageSize]);

  const total = items.length;
  // Halaman tak terbatas secara konseptual — dihitung dari total data / 10
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    // Hanya slice 10 data untuk tampilan saat ini
    return items.slice(start, start + pageSize);
  }, [items, safePage, pageSize]);

  const start = (safePage - 1) * pageSize;

  return {
    page: safePage,
    setPage,
    pageSize,
    total,
    totalPages,
    pageItems,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + pageSize, total),
  };
}
