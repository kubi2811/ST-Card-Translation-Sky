import type { TranslationField } from '../types/card';

/**
 * ─── Tái dùng bản dịch giữa các PHIÊN BẢN card (version reuse) ───
 *
 * Card Trung update liên tục (Tuhu_V2.2 → V2.3). Cache tiến trình (`translation-progress/`)
 * key theo ĐÚNG tên file nên đổi tên file là mất sạch — user phải dịch lại từ đầu dù bản
 * update thường chỉ đổi 10-20% nội dung.
 *
 * Giải pháp: khi import card mà không có cache trùng tên, quét các cache tiến trình CŨ,
 * match từng field theo NỘI DUNG GỐC (không phải path — lorebook update hay chèn/đảo entry
 * làm path xô lệch), field nào nguyên văn không đổi thì bê bản dịch cũ sang luôn (done),
 * chỉ còn phần mới/đổi cần dịch.
 *
 * An toàn tuyệt đối như twin-reuse trong-run (translationReuse.ts): chỉ tái dùng khi trùng
 * HỆT cả (a) nội dung gốc, (b) nhóm field, (c) loại entry — bản dịch copy sang không thể
 * sai ngữ cảnh. File này thuần logic để test vitest; I/O cache nằm ở store.
 */

export interface VersionSnapshot {
  /** Tên file cache (= tên card cũ, ví dụ "Tuhu_V2.2.png") */
  key: string;
  savedAt?: number;
  fields: TranslationField[];
  /** Từ điển đi kèm tiến trình cũ (đồng bộ tên biến MVU/EJS giữa 2 phiên bản) */
  dicts?: {
    mvuDictionary?: Record<string, string>;
    ejsEntryNameDict?: Record<string, string>;
    ejsKeywordDict?: Record<string, string>;
  };
}

export interface VersionReuseResult {
  fields: TranslationField[];
  /** Số field đã bê được bản dịch cũ sang */
  reused: number;
  /** Số field khớp theo từng cache nguồn */
  bySource: Record<string, number>;
  /** Cache đóng góp nhiều bản dịch nhất (nguồn để merge từ điển) */
  topSource: VersionSnapshot | null;
}

const SEP = '\x1f';
const bankKey = (f: TranslationField) => `${f.group}${SEP}${f.entryType || ''}${SEP}${f.original}`;

/**
 * Match field của card MỚI với kho bản dịch từ các cache cũ.
 * `snapshots` phải được caller sắp MỚI NHẤT TRƯỚC — khi 2 cache cùng có 1 nội dung,
 * bản dịch mới hơn thắng (user có thể đã dịch lại/chỉnh tay ở phiên bản gần nhất).
 */
export function applyVersionReuse(
  fields: TranslationField[],
  snapshots: VersionSnapshot[],
): VersionReuseResult {
  // Kho: nội dung gốc + nhóm + loại → bản dịch (cache mới nhất thắng vì duyệt trước)
  const bank = new Map<string, { translated: string; sourceKey: string }>();
  for (const snap of snapshots) {
    for (const f of snap.fields) {
      if (f.status !== 'done' || !f.translated || !f.original?.trim()) continue;
      const k = bankKey(f);
      if (!bank.has(k)) bank.set(k, { translated: f.translated, sourceKey: snap.key });
    }
  }
  if (bank.size === 0) return { fields, reused: 0, bySource: {}, topSource: null };

  const bySource: Record<string, number> = {};
  let reused = 0;
  const out = fields.map(f => {
    if (f.status !== 'pending' || !f.original?.trim()) return f;
    const hit = bank.get(bankKey(f));
    if (!hit) return f;
    reused++;
    bySource[hit.sourceKey] = (bySource[hit.sourceKey] || 0) + 1;
    return { ...f, translated: hit.translated, status: 'done' as const, reusedFrom: hit.sourceKey };
  });

  let topSource: VersionSnapshot | null = null;
  let topCount = 0;
  for (const snap of snapshots) {
    const c = bySource[snap.key] || 0;
    if (c > topCount) { topCount = c; topSource = snap; }
  }
  return { fields: out, reused, bySource, topSource };
}
