/**
 * src/lib/wikiImport/coordinator.ts — CHIA BATCH TẤT ĐỊNH + WORKER SONG SONG (bug 120/121/122).
 * ─────────────────────────────────────────────────────────────────────────
 * Yêu cầu 122: "Mỗi batch chỉ xử lý một tập dữ liệu riêng, không được xử lý dữ liệu mà batch
 * khác đã nhận." — mạnh hơn lane-hint của việc 90: ở đây DỮ LIỆU NGUỒN được chia hẳn, mỗi
 * worker chỉ nhìn thấy tập trang của mình; muốn trùng cũng không có nguyên liệu để trùng.
 *
 * Chống trùng 2 tầng bổ sung (nội dung, không chỉ chữ):
 *   1. FactIndex TF-IDF — coordinator ghi mỗi entry đã nhận; worker nộp entry mới thì kiểm.
 *   2. isDuplicateEntry (identity + Jaccard + RAG, việc 90) trên lorebook đang có.
 */

import type { PageDoc } from './types';

/**
 * Chia trang thành N phần TẤT ĐỊNH, round-robin theo thứ tự cào (trang gần nhau về chủ đề
 * thường được cào gần nhau — round-robin trải chủ đề đều giữa các batch, giảm cảnh hai batch
 * cùng ôm một cụm nhân vật).
 * Bất biến: mọi trang xuất hiện ĐÚNG MỘT lần trong ĐÚNG MỘT phần.
 */
export function partitionPages(pages: PageDoc[], batches: number): PageDoc[][] {
  const n = Math.max(1, Math.min(batches, pages.length || 1));
  const out: PageDoc[][] = Array.from({ length: n }, () => []);
  pages.forEach((p, i) => out[i % n].push(p));
  return out;
}

/**
 * Gom text nguồn cho MỘT batch, cắt theo ngân sách ký tự (context của model có hạn).
 * Trang sâu hơn (ít trung tâm hơn) bị cắt trước.
 */
export function buildBatchSource(pages: PageDoc[], maxChars = 42000): string {
  const sorted = [...pages].sort((a, b) => a.depth - b.depth);
  const parts: string[] = [];
  let used = 0;
  for (const p of sorted) {
    const infobox = Object.entries(p.infobox).map(([k, v]) => `${k}: ${v}`).join('\n');
    const aliasLine = p.aliases.length ? `Bí danh: ${p.aliases.join(', ')}\n` : '';
    const block = `═══ TRANG: ${p.title} ═══\n${aliasLine}${infobox ? infobox + '\n' : ''}${p.text}`;
    const budget = Math.min(block.length, Math.max(2000, Math.floor((maxChars - used) / 2)));
    if (used + budget > maxChars) break;
    parts.push(block.slice(0, budget));
    used += budget;
  }
  return parts.join('\n\n');
}

export interface ClaimStore {
  /** Tiêu đề entry đã có (mọi batch + lorebook hiện tại) — normalize hạ chữ. */
  titles: Set<string>;
  /** Đăng ký tiêu đề; false nếu batch khác đã nhận (chống 2 worker cùng viết 1 thực thể). */
  claim(title: string): boolean;
}

export function createClaimStore(existingTitles: string[]): ClaimStore {
  const norm = (s: string) => s.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();
  const titles = new Set(existingTitles.map(norm));
  return {
    titles,
    claim(title: string): boolean {
      const key = norm(title);
      if (!key || titles.has(key)) return false;
      titles.add(key);
      return true;
    },
  };
}
