/**
 * ─── P0 Roadmap Trợ Lý AI — Working memory RAM (Tầng 2) ───
 * Xem docs/ROADMAP_TRO_LY_AI.md mục 3.
 *
 * LRU CÓ PIN (không phải LFU): workload là "phiên làm việc theo card" — đổi card thì dữ liệu card
 * cũ nguội hẳn; LFU sẽ giữ rác cũ có tần suất lịch sử cao. `pinned` (glossary, card đang mở)
 * không bao giờ bị evict. Evict CHỈ gỡ khỏi RAM — tầng 3 (IndexedDB) vẫn giữ vĩnh viễn.
 *
 * Dung lượng tính theo tổng ký tự text (xấp xỉ RAM) thay vì đếm bản ghi — 1 doc_chunk 2k ký tự
 * nặng gấp trăm lần 1 fact 20 ký tự.
 */
import type { MemoryRecord } from './memoryStore';

export interface CacheStats {
  entries: number;
  chars: number;
  hits: number;
  misses: number;
  evictions: number;
}

export class MemoryCache {
  /** Map giữ thứ tự chèn — dùng làm hàng đợi LRU (get sẽ re-insert). */
  private map = new Map<string, MemoryRecord>();
  private chars = 0;
  private stats: CacheStats = { entries: 0, chars: 0, hits: 0, misses: 0, evictions: 0 };

  constructor(
    /** Ngân sách RAM theo ký tự text (~2 byte/ký tự + overhead). 20M ký tự ≈ 40-80MB. */
    private maxChars = 20_000_000,
  ) {}

  get(id: string): MemoryRecord | undefined {
    const rec = this.map.get(id);
    if (!rec) { this.stats.misses++; return undefined; }
    this.stats.hits++;
    // LRU: chuyển lên "mới nhất"
    this.map.delete(id);
    this.map.set(id, rec);
    return rec;
  }

  put(rec: MemoryRecord): void {
    const old = this.map.get(rec.id);
    if (old) { this.chars -= old.text.length; this.map.delete(rec.id); }
    this.map.set(rec.id, rec);
    this.chars += rec.text.length;
    this.evictIfNeeded();
  }

  delete(id: string): void {
    const old = this.map.get(id);
    if (old) { this.chars -= old.text.length; this.map.delete(id); }
  }

  has(id: string): boolean { return this.map.has(id); }

  /** Toàn bộ bản ghi đang trong RAM (cho vector search trên tập nóng). */
  values(): MemoryRecord[] { return [...this.map.values()]; }

  getStats(): CacheStats {
    return { ...this.stats, entries: this.map.size, chars: this.chars };
  }

  clear(): void { this.map.clear(); this.chars = 0; }

  private evictIfNeeded(): void {
    if (this.chars <= this.maxChars) return;
    // Duyệt từ CŨ nhất (đầu Map); bỏ qua pinned
    for (const [id, rec] of this.map) {
      if (this.chars <= this.maxChars) break;
      if (rec.pinned) continue;
      this.map.delete(id);
      this.chars -= rec.text.length;
      this.stats.evictions++;
    }
    // Nếu toàn pinned mà vẫn vượt: chấp nhận vượt (pin là cam kết) — log để đo
    if (this.chars > this.maxChars) {
      console.warn(`[MemoryCache] toàn bản ghi pinned, RAM vượt ngân sách: ${this.chars}/${this.maxChars} ký tự`);
    }
  }
}
