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
 *
 * (bug 229) Bản cũ chia ngân sách kiểu CHIA ĐÔI LIÊN TIẾP: mỗi trang được lấy nửa phần còn
 * lại, `Math.max(2000, (maxChars - used) / 2)`, và `break` ngay khi trang kế không lọt. Với 20
 * trang cùng cỡ thì trang đầu nuốt 21.000 trong 42.000 ký tự và vòng lặp đứt ở trang thứ NĂM —
 * đo được 5/20 trang tới được AI. Tức là crawler cào 60 trang nhưng model chỉ bao giờ đọc ~15,
 * rồi tool vẫn đòi nó sinh đủ số entry từ phần nguồn teo tóp đó.
 *
 * Nay chia CÔNG BẰNG: mỗi trang một suất bằng nhau, trang nào ngắn hơn suất thì trả lại phần
 * thừa cho các trang còn lại (hai lượt là hội tụ đủ dùng). Trang sâu hơn vẫn xếp sau nên nếu
 * buộc phải cắt thì cắt phần ít trung tâm trước.
 */
export function buildBatchSource(pages: PageDoc[], maxChars = 42000): string {
  const sorted = [...pages].sort((a, b) => a.depth - b.depth);
  if (sorted.length === 0) return '';

  const blocks = sorted.map((p) => {
    const infobox = Object.entries(p.infobox).map(([k, v]) => `${k}: ${v}`).join('\n');
    const aliasLine = p.aliases.length ? `Bí danh: ${p.aliases.join(', ')}\n` : '';
    return `═══ TRANG: ${p.title} ═══\n${aliasLine}${infobox ? infobox + '\n' : ''}${p.text}`;
  });

  // Sàn 800 ký tự/trang: dưới mức đó thì đoạn trích cụt tới vô nghĩa, thà nhận ít trang hơn.
  const MIN_SLICE = 800;
  const fit = Math.max(1, Math.min(blocks.length, Math.floor(maxChars / MIN_SLICE)));
  const kept = blocks.slice(0, fit);

  // Hai lượt cấp phát: lượt đầu chia đều, lượt sau chia lại phần thừa của các trang ngắn.
  const share = Math.floor(maxChars / kept.length);
  let sizes = kept.map(b => Math.min(b.length, share));
  const leftover = maxChars - sizes.reduce((a, b) => a + b, 0);
  const hungry = kept.filter((b, i) => b.length > sizes[i]).length;
  if (leftover > 0 && hungry > 0) {
    const bonus = Math.floor(leftover / hungry);
    sizes = kept.map((b, i) => (b.length > sizes[i] ? Math.min(b.length, sizes[i] + bonus) : sizes[i]));
  }
  return kept.map((b, i) => b.slice(0, sizes[i])).join('\n\n');
}

export interface ClaimStore {
  /** Tiêu đề entry đã có (mọi batch + lorebook hiện tại) — normalize hạ chữ. */
  titles: Set<string>;
  /** Đăng ký tiêu đề; false nếu batch khác đã nhận (chống 2 worker cùng viết 1 thực thể). */
  claim(title: string): boolean;
  /**
   * (bug 229) TRẢ LẠI chỗ đã giữ khi entry bị loại sau đó (quá sơ sài, trùng nội dung…).
   * Không trả thì thực thể đó bị ghi vào danh sách "ĐÃ CÓ ENTRY" gửi cho AI, nên vòng sinh bù
   * được lệnh TRÁNH đúng thực thể mà nó cần viết lại — thiếu bao nhiêu cũng không bù nổi.
   */
  release(title: string): void;
}

export function createClaimStore(existingTitles: string[]): ClaimStore {
  const norm = (s: string) => s.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();
  const titles = new Set(existingTitles.map(norm));
  const preexisting = new Set(titles);
  return {
    titles,
    claim(title: string): boolean {
      const key = norm(title);
      if (!key || titles.has(key)) return false;
      titles.add(key);
      return true;
    },
    release(title: string): void {
      const key = norm(title);
      // Chỉ nhả cái do lượt này giữ — không được xoá tiêu đề vốn đã có trong lorebook.
      if (key && !preexisting.has(key)) titles.delete(key);
    },
  };
}
