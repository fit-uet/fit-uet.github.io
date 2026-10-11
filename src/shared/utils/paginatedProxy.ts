import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

/**
 * GoF Proxy Pattern - Subject Interface & Types
 * Đại diện cho hợp đồng dữ liệu phân trang
 */
export interface PaginatedQuery {
  page: number;
  limit: number;
  search?: string;
  filter?: Record<string, any>;
  sort?: { key: string; direction: 'asc' | 'desc' };
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type PageFetcher<T> = (query: PaginatedQuery) => Promise<PaginatedResult<T>>;

/**
 * Subject Interface
 */
export interface IPaginatedSource<T> {
  fetchPage(query: PaginatedQuery, forceRefresh?: boolean): Promise<PaginatedResult<T>>;
}

/**
 * RealSubject
 * Đại diện thực tế thực hiện lệnh gọi mạng / HTTP API tới máy chủ.
 */
export class RealPaginatedSource<T> implements IPaginatedSource<T> {
  constructor(private fetcher: PageFetcher<T>) {}

  async fetchPage(query: PaginatedQuery): Promise<PaginatedResult<T>> {
    return this.fetcher(query);
  }
}

export interface ProxyCacheEntry<T> {
  data: PaginatedResult<T>;
  timestamp: number;
}

export interface PaginatedProxyOptions {
  ttlMs?: number;
  maxCacheEntries?: number;
}

/**
 * PaginatedVirtualProxy
 * Đóng vai trò là Virtual Proxy & Cache Proxy theo mẫu thiết kế GoF:
 * 1. Virtual Proxy: Trì hoãn việc tải dữ liệu tới khi thực sự cần (Lazy evaluation).
 * 2. Cache Proxy: Lưu trữ kết quả các trang đã tải để đáp ứng tức thì (0ms) khi duyệt lại.
 * 3. Request Deduplication: Tránh gửi các yêu cầu trùng lặp cùng một thời điểm.
 * 4. Background Prefetching: Nạp trước trang kế tiếp (page + 1) để chuyển trang liền mạch.
 * 5. Invalidation: Hỗ trợ xoá bộ nhớ đệm khi có thao tác chỉnh sửa/thêm/xoá dữ liệu.
 */
export class PaginatedVirtualProxy<T> implements IPaginatedSource<T> {
  private realSource: IPaginatedSource<T>;
  private cache = new Map<string, ProxyCacheEntry<T>>();
  private pendingRequests = new Map<string, Promise<PaginatedResult<T>>>();
  private ttlMs: number;
  private maxCacheEntries: number;

  constructor(
    realSourceOrFetcher: IPaginatedSource<T> | PageFetcher<T>,
    options?: PaginatedProxyOptions
  ) {
    if (typeof realSourceOrFetcher === 'function') {
      this.realSource = new RealPaginatedSource<T>(realSourceOrFetcher);
    } else {
      this.realSource = realSourceOrFetcher;
    }
    this.ttlMs = options?.ttlMs ?? 3 * 60 * 1000; // Mặc định 3 phút
    this.maxCacheEntries = options?.maxCacheEntries ?? 50;
  }

  public buildKey(query: PaginatedQuery): string {
    const sortedFilter = query.filter
      ? Object.keys(query.filter)
          .sort()
          .reduce((acc, k) => ({ ...acc, [k]: (query.filter as any)[k] }), {})
      : {};
    return JSON.stringify({
      p: query.page,
      l: query.limit,
      s: (query.search || '').trim().toLowerCase(),
      f: sortedFilter,
      sort: query.sort ? `${query.sort.key}_${query.sort.direction}` : '',
    });
  }

  public hasCached(query: PaginatedQuery): boolean {
    const key = this.buildKey(query);
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  public getCached(query: PaginatedQuery): PaginatedResult<T> | null {
    const key = this.buildKey(query);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  async fetchPage(query: PaginatedQuery, forceRefresh = false): Promise<PaginatedResult<T>> {
    const key = this.buildKey(query);

    // 1. Kiểm tra Cache Proxy
    if (!forceRefresh) {
      const cached = this.getCached(query);
      if (cached) {
        return cached;
      }
    }

    // 2. Request deduplication: Nếu request cho key này đang chờ phản hồi, dùng lại Promise
    if (this.pendingRequests.has(key)) {
      return this.pendingRequests.get(key)!;
    }

    // 3. Chuyển quyền uỷ nhiệm cho RealSubject qua Virtual Proxy
    const requestPromise = (async () => {
      try {
        const result = await this.realSource.fetchPage(query);
        // Quản lý kích thước bộ nhớ đệm (LRU eviction cơ bản)
        if (this.cache.size >= this.maxCacheEntries) {
          const oldestKey = this.cache.keys().next().value;
          if (oldestKey) this.cache.delete(oldestKey);
        }
        this.cache.set(key, { data: result, timestamp: Date.now() });
        return result;
      } finally {
        this.pendingRequests.delete(key);
      }
    })();

    this.pendingRequests.set(key, requestPromise);
    return requestPromise;
  }

  /**
   * Background Prefetching: Nạp trước dữ liệu trong nền, không chặn luồng chính
   */
  async prefetch(query: PaginatedQuery): Promise<void> {
    if (this.hasCached(query)) return;
    try {
      await this.fetchPage(query);
    } catch (err) {
      // Prefetch chạy nền không nên phát sinh alert/crash
      console.debug('[PaginatedVirtualProxy] Prefetch ignored error:', err);
    }
  }

  /**
   * Xoá toàn bộ bộ nhớ đệm
   */
  invalidate(): void {
    this.cache.clear();
    this.pendingRequests.clear();
  }

  /**
   * Xoá bộ nhớ đệm có chọn lọc theo predicate
   */
  invalidateMatching(predicate: (key: string) => boolean): void {
    for (const key of Array.from(this.cache.keys())) {
      if (predicate(key)) {
        this.cache.delete(key);
      }
    }
  }

  getStats() {
    return {
      cacheSize: this.cache.size,
      pendingRequests: this.pendingRequests.size,
    };
  }
}

/**
 * Options cho React Hook usePaginatedProxy
 */
export interface UsePaginatedProxyOptions<T> {
  fetcher: PageFetcher<T>;
  initialPage?: number;
  pageSize?: number;
  search?: string;
  filter?: Record<string, any>;
  sort?: { key: string; direction: 'asc' | 'desc' };
  enablePrefetch?: boolean;
  ttlMs?: number;
}

/**
 * usePaginatedProxy Hook
 * Cung cấp state reactive tích hợp hoàn hảo với GoF PaginatedVirtualProxy
 */
export function usePaginatedProxy<T>({
  fetcher,
  initialPage = 1,
  pageSize = 25,
  search = '',
  filter = {},
  sort,
  enablePrefetch = true,
  ttlMs = 3 * 60 * 1000,
}: UsePaginatedProxyOptions<T>) {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [data, setData] = useState<PaginatedResult<T>>({
    items: [],
    total: 0,
    page: initialPage,
    limit: pageSize,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tạo và giữ Proxy instance cố định cho fetcher này
  const proxy = useMemo(() => {
    return new PaginatedVirtualProxy<T>(fetcher, { ttlMs });
  }, [fetcher, ttlMs]);

  const query: PaginatedQuery = useMemo(
    () => ({
      page: currentPage,
      limit: pageSize,
      search,
      filter,
      sort,
    }),
    [currentPage, pageSize, search, filter, sort]
  );

  // Tránh race conditions bằng execution counter
  const executionCounterRef = useRef(0);

  const loadPage = useCallback(
    async (pageToLoad: number, forceRefresh = false) => {
      const execId = ++executionCounterRef.current;
      const targetQuery: PaginatedQuery = {
        ...query,
        page: pageToLoad,
      };

      // Nếu đã có trong cache và không ép refresh, không cần nhấp nháy loading
      const isCached = proxy.hasCached(targetQuery);
      if (!isCached || forceRefresh) {
        setLoading(true);
      }
      setError(null);

      try {
        const result = await proxy.fetchPage(targetQuery, forceRefresh);
        if (execId === executionCounterRef.current) {
          setData(result);
          setLoading(false);

          // Background prefetching: Tự động nạp trước trang kế tiếp nếu còn trang
          if (enablePrefetch && result.page < result.totalPages) {
            const nextQuery: PaginatedQuery = {
              ...targetQuery,
              page: result.page + 1,
            };
            // Sử dụng microtask / requestIdleCallback để không chiếm giữ render frame
            if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
              (window as any).requestIdleCallback(() => proxy.prefetch(nextQuery));
            } else {
              setTimeout(() => proxy.prefetch(nextQuery), 100);
            }
          }
        }
      } catch (err: any) {
        if (execId === executionCounterRef.current) {
          setError(err?.message || 'Không thể tải dữ liệu trang.');
          setLoading(false);
        }
      }
    },
    [proxy, query, enablePrefetch]
  );

  // Khi query (search, filter, sort) thay đổi, reset về trang 1
  useEffect(() => {
    setCurrentPage(1);
  }, [search, JSON.stringify(filter), sort?.key, sort?.direction, pageSize]);

  // Nạp trang mỗi khi currentPage hoặc query thay đổi
  useEffect(() => {
    loadPage(currentPage);
  }, [currentPage, loadPage]);

  // Hành động làm mới: Xoá cache và nạp lại trang hiện tại
  const refresh = useCallback(async () => {
    proxy.invalidate();
    await loadPage(currentPage, true);
  }, [proxy, loadPage, currentPage]);

  const setPage = useCallback((newPage: number) => {
    setCurrentPage(newPage);
  }, []);

  return {
    items: data.items,
    total: data.total,
    page: data.page,
    limit: data.limit,
    totalPages: data.totalPages,
    loading,
    error,
    setPage,
    refresh,
    proxy,
    prefetchPage: useCallback((page: number) => proxy.prefetch({ ...query, page }), [proxy, query]),
  };
}
