/**
 * src/lib/wikiImport/types.ts — HỢP ĐỒNG CHUNG của bộ Wiki Importer mới (bug 120/121/122).
 * ─────────────────────────────────────────────────────────────────────────
 * Bộ cào cũ chỉ đọc MỘT trang rồi ném nguyên văn cho AI — không crawl link con, không depth,
 * không dedup URL, không resume. Bộ mới là pipeline module hoá:
 *     platform → fetchClient → crawler(BFS) → coordinator(batch song song) → entryGen
 * với FactIndex chống trùng NỘI DUNG (không chỉ trùng chữ) xuyên suốt.
 */

/** Nền tảng wiki — nhận diện TỔNG QUÁT, không hardcode từng website. */
export type WikiPlatform =
  /** Họ MediaWiki: Fandom, Wikipedia, wiki.gg, Miraheze, Bulbapedia, tự host… — có api.php. */
  | 'mediawiki'
  /** Baidu Baike — HTML thuần, cấu trúc /item/. */
  | 'baidu'
  /** Wiki khác không nhận diện được — đọc HTML tổng quát. */
  | 'generic';

export interface WikiImportConfig {
  /** URL wiki hoặc một trang bất kỳ trong wiki. */
  url: string;
  /** Số entry muốn tạo. */
  totalEntries: number;
  /** Token mục tiêu mỗi entry (0 = không ép). */
  tokensPerEntry: number;
  /** Bật = BFS đi rộng dần cho tới trần trang; tắt = chỉ trang gốc + link trực tiếp. */
  autoExpand: boolean;
  /** Độ sâu crawl tối đa (1 = chỉ trang gốc; 2 = thêm link trong trang gốc; …). */
  maxDepth: number;
  /** Trần tổng số trang được cào — chống cào vô tận cả Wikipedia. */
  maxPages: number;
  /** Chỉ lấy nội dung canon (lọc trang/category non-canon, fanon, what-if…). */
  canonOnly: boolean;
  /** Số batch AI chạy song song. */
  concurrentBatches: number;
  /** Yêu cầu thêm của user cho AI (tuỳ chọn). */
  extraInstructions?: string;
  /** Vị trí entry mặc định khi ghi vào lorebook. */
  defaultPosition: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  insertionOrderStart: number;
}

/** Một trang đã cào xong, đã trích nội dung. */
export interface PageDoc {
  url: string;
  title: string;
  /** Bí danh: redirect, tên gọi khác trong infobox, langlinks (ja/zh/en…). */
  aliases: string[];
  /** Nội dung chữ đã làm sạch, theo thứ tự section. */
  text: string;
  /** Cặp key-value của infobox (nếu có). */
  infobox: Record<string, string>;
  /** Link nội bộ tìm thấy trong trang (đã normalize, đã lọc meta). */
  links: string[];
  /** Category của trang (để lọc canon / phân chủ đề). */
  categories: string[];
  platform: WikiPlatform;
  /** Độ sâu BFS lúc gặp trang này. */
  depth: number;
}

/** Trạng thái crawl — persist được để resume sau khi ngắt/F5. */
export interface CrawlState {
  /** URL đã cào xong (normalize). */
  visited: string[];
  /** Hàng đợi còn lại: [url, depth]. */
  queue: Array<[string, number]>;
  /** Trang đã trích xong (nguồn cho coordinator). */
  pages: PageDoc[];
  /** URL chết/lỗi đã gặp — không thử lại. */
  dead: string[];
}

export interface CrawlProgress {
  phase: 'crawl' | 'generate' | 'done' | 'error' | 'stopped';
  pagesCrawled: number;
  pagesQueued: number;
  pagesDead: number;
  /** Ước lượng giây còn lại của pha hiện tại (null = chưa đủ dữ liệu). */
  etaSeconds: number | null;
  entriesCreated: number;
  entriesTarget: number;
  note?: string;
}

export interface WikiImportControl {
  signal?: AbortSignal;
  isPaused?: () => boolean;
  log: (msg: string) => void;
  onProgress: (p: CrawlProgress) => void;
}

/** fetch có thể inject để test không cần mạng. */
export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  url: string;
  text(): Promise<string>;
}>;
