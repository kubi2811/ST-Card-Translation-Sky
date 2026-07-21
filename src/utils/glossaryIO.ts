// ─── Đọc/ghi & gộp từ điển dùng CHUNG cho Dịch Card ↔ Dịch Script ───
// Một chỗ duy nhất định nghĩa "file từ điển trông thế nào", nên bộ xuất ra từ Dịch Card
// nhập được thẳng vào Dịch Script và ngược lại — không lo lệch định dạng về sau.
//
// Định dạng CHUẨN (bản xuất): [{ "source": "秋青子", "target": "Thu Thanh Tử" }, …]
// Vẫn đọc được các dạng dễ gặp khác để user khỏi phải sửa file bằng tay:
//   • { "秋青子": "Thu Thanh Tử", … }          (object phẳng)
//   • [["秋青子", "Thu Thanh Tử"], …]           (mảng cặp)
//   • { "glossary": [...] } / { "entries": [...] } (bọc trong khoá)
//   • khoá viết kiểu khác: zh/vi, from/to, key/value, term/translation, original/translated
import type { GlossaryEntry } from '../types/card';

const pick = (o: Record<string, unknown>, keys: string[]): string => {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
};

const SRC_KEYS = ['source', 'src', 'zh', 'cn', 'from', 'key', 'term', 'original', 'chinese'];
const DST_KEYS = ['target', 'dst', 'vi', 'to', 'value', 'translation', 'translated', 'vietnamese'];

/** Parse text JSON thành danh sách mục từ điển. Ném lỗi nếu không đọc được gì. */
export function parseGlossaryJson(text: string): GlossaryEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('BAD_JSON');
  }

  // Bóc lớp bọc phổ biến
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    for (const k of ['glossary', 'entries', 'items', 'data', 'dict', 'dictionary']) {
      if (Array.isArray(obj[k])) { data = obj[k]; break; }
    }
  }

  const out: GlossaryEntry[] = [];
  const push = (source: string, target: string) => {
    const s = String(source ?? '').trim();
    const t = String(target ?? '').trim();
    if (s && t) out.push({ source: s, target: t });
  };

  if (Array.isArray(data)) {
    for (const it of data) {
      if (!it) continue;
      if (Array.isArray(it) && it.length >= 2) { push(String(it[0]), String(it[1])); continue; }
      if (typeof it === 'object') {
        const o = it as Record<string, unknown>;
        push(pick(o, SRC_KEYS), pick(o, DST_KEYS));
      }
    }
  } else if (data && typeof data === 'object') {
    // Object phẳng: { "hán": "việt" }
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (typeof v === 'string') push(k, v);
    }
  }

  if (!out.length) throw new Error('NO_ENTRIES');
  return out;
}

export interface MergeResult {
  merged: GlossaryEntry[];
  /** Mục mới được thêm */
  added: number;
  /** Trùng `source` nhưng bản dịch KHÁC → giữ bản đang có, chỉ báo cho user biết */
  conflicts: number;
  /** Trùng y hệt → bỏ qua im lặng */
  duplicates: number;
}

/**
 * Gộp `incoming` vào `base`. KHÔNG ghi đè mục đã có: bảng đích có thể đã được user
 * sửa tay, nên bản đang có luôn thắng — xung đột chỉ được ĐẾM và báo lại.
 */
export function mergeGlossaries(base: GlossaryEntry[], incoming: GlossaryEntry[]): MergeResult {
  const bySource = new Map<string, GlossaryEntry>();
  for (const g of base) {
    const s = (g.source || '').trim();
    if (s) bySource.set(s, g);
  }

  const merged = [...base];
  let added = 0, conflicts = 0, duplicates = 0;
  for (const g of incoming) {
    const s = (g.source || '').trim();
    const t = (g.target || '').trim();
    if (!s || !t) continue;
    const existing = bySource.get(s);
    if (!existing) {
      const entry: GlossaryEntry = { source: s, target: t };
      merged.push(entry);
      bySource.set(s, entry);
      added++;
    } else if ((existing.target || '').trim() !== t) {
      conflicts++;
    } else {
      duplicates++;
    }
  }
  return { merged, added, conflicts, duplicates };
}

/** Số mục "dùng được" (có cả 2 vế) — dùng để quyết định có nên hỏi user không. */
export const countUsable = (list: GlossaryEntry[]): number =>
  list.filter((g) => (g.source || '').trim() && (g.target || '').trim()).length;

/** Có mục nào của `incoming` mà `base` CHƯA có không? (không có thì đừng hỏi cho phiền) */
export const hasNewEntries = (base: GlossaryEntry[], incoming: GlossaryEntry[]): boolean => {
  const have = new Set(base.map((g) => (g.source || '').trim()).filter(Boolean));
  return incoming.some((g) => {
    const s = (g.source || '').trim();
    return s && (g.target || '').trim() && !have.has(s);
  });
};

export const glossaryToJson = (list: GlossaryEntry[]): string =>
  JSON.stringify(
    list.filter((g) => (g.source || '').trim() || (g.target || '').trim())
      .map(({ source, target }) => ({ source, target })),
    null, 2,
  );
