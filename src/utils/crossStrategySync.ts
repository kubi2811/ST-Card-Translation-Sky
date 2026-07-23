/**
 * src/utils/crossStrategySync.ts — ĐỐI CHIẾU CHÉO TỪ ĐIỂN CHIẾN LƯỢC B ↔ C.
 * ─────────────────────────────────────────────────────────────────────────
 * (User 2026 — việc 79) Hai chiến lược dựng từ điển ĐỘC LẬP nhau:
 *   - B (mvuSync):  tên biến MVU/Zod   → bản dịch   (mvuDictionary)
 *   - C (ejsSync):  tên mục + từ khoá EJS → bản dịch (ejsEntryNameDict / ejsKeywordDict)
 *
 * Hai bên gọi AI riêng, KHÔNG bên nào thấy từ điển bên kia. Nên cùng một từ gốc (vd 修为)
 * rất hay ra hai bản dịch lệch nhau — B ra "Tu Vi", C ra "Cảnh Giới". Card dịch xong thì
 * biến MVU tên một đằng, tên mục/từ khoá EJS gọi một nẻo → getwi() trượt, bảng trạng thái
 * trống, lorebook không kích hoạt.
 *
 * Đã có sẵn hai bộ kiểm NỘI BỘ từng bên (validateDictionaryConflicts cho B,
 * enforceEjsDictConsistency cho C) nhưng CHƯA CÓ GÌ bắc cầu giữa hai bên. File này lo phần đó.
 *
 * Chạy TRƯỚC vòng dịch nên chỉ cần sửa từ điển: cả hai dict đều được áp xuống card ở bước sau.
 */

import { canonicalizeEjsValue } from './ejsSync';
import { HAN_RE_G } from './cjk';

/** Một chỗ hai chiến lược dịch lệch nhau. */
export interface CrossStrategyConflict {
  /** Từ gốc (key) xuất hiện ở cả hai bên. */
  source: string;
  /** Bên C chứa từ này nằm ở từ điển nào. */
  side: 'entry' | 'keyword';
  /** Bản dịch phía B (biến MVU). */
  mvuValue: string;
  /** Bản dịch phía C (tên mục / từ khoá EJS). */
  ejsValue: string;
  /** Bản được chọn làm chuẩn. */
  winner: 'B' | 'C';
  /** Giá trị cuối cùng cả hai bên sẽ dùng. */
  unified: string;
  /** Vì sao chọn bên đó — để ghi log cho user hiểu. */
  reason: string;
}

export interface UnifyResult {
  mvuDictionary: Record<string, string>;
  ejsEntryNameDict: Record<string, string>;
  ejsKeywordDict: Record<string, string>;
  conflicts: CrossStrategyConflict[];
  /** Số ô từ điển thực sự bị đổi giá trị. */
  fixedCount: number;
}

export interface UnifyOptions {
  /**
   * User đã bấm 🔒 khoá từ điển B → mọi lệch pha đều lấy bản B, không bàn thêm.
   * (Cùng tinh thần với `mvuDictLocked` ở pipeline: đã chốt thì không ai được ghi đè.)
   */
  mvuDictLocked?: boolean;
}

/**
 * Chuẩn hoá KEY để so khớp "cùng từ" giữa hai bên.
 * Bỏ ký tự vô hình + chuẩn NFC (chữ Việt có dấu có thể ở dạng tổ hợp khác nhau) + gộp
 * khoảng trắng. Hạ chữ thường để `HP` (biến MVU) khớp `hp` (từ khoá EJS) — vẫn cùng một từ.
 * KHÔNG động vào key gốc lưu trong dict, chỉ dùng làm khoá tra.
 */
function normalizeSourceKey(key: string): string {
  return (key || '')
    .replace(/[\u0000-\u001F\u200B-\u200D\uFEFF]/g, '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** So hai bản dịch bỏ qua hoa/thường + khoảng trắng + `_`/`-` (chỉ khác "vỏ", cùng chữ). */
function sameIgnoringShape(a: string, b: string): boolean {
  const norm = (s: string) => (s || '').normalize('NFC').toLowerCase().replace(/[\s_-]+/g, '');
  return norm(a) === norm(b);
}

/** Còn chữ Hán = chưa dịch (hoặc dịch dở). */
function stillHasHan(value: string): boolean {
  HAN_RE_G.lastIndex = 0;
  return HAN_RE_G.test(value || '');
}

/**
 * Chọn bản chuẩn khi hai bên lệch nhau. Thứ tự luật (dừng ở luật khớp đầu tiên):
 *
 *  1. User khoá từ điển B  → B thắng (user đã chốt, không được sửa lưng).
 *  2. Một bên rỗng          → bên còn lại thắng.
 *  3. Một bên còn chữ Hán   → bên ĐÃ DỊCH thắng (bên kia là dịch sót).
 *  4. Chỉ khác hoa/thường/`_`/`-` → B thắng: dict B đã được ép in hoa theo schema Zod
 *     (`enforceVariableCasing`), nên "Cảnh Giới" của B mới là dạng đúng, "Cảnh giới" của C sai.
 *  5. Còn lại               → B thắng: tên biến MVU có bán kính ảnh hưởng rộng hơn hẳn
 *     (schema Zod + khối UpdateVariable + bảng trạng thái + code UI đều gọi đúng tên đó),
 *     trong khi phía C chỉ cần đổi tên mục/từ khoá — và dict C được áp xuống card ngay sau đây.
 */
function pickWinner(
  mvuValue: string,
  ejsValue: string,
  opts: UnifyOptions,
): { winner: 'B' | 'C'; reason: string } {
  if (opts.mvuDictLocked) return { winner: 'B', reason: 'từ điển B đang khoá' };
  if (!ejsValue.trim()) return { winner: 'B', reason: 'bản C rỗng' };
  if (!mvuValue.trim()) return { winner: 'C', reason: 'bản B rỗng' };

  const mvuRaw = stillHasHan(mvuValue);
  const ejsRaw = stillHasHan(ejsValue);
  if (mvuRaw && !ejsRaw) return { winner: 'C', reason: 'bản B còn chữ Hán chưa dịch' };
  if (ejsRaw && !mvuRaw) return { winner: 'B', reason: 'bản C còn chữ Hán chưa dịch' };

  if (sameIgnoringShape(mvuValue, ejsValue)) {
    return { winner: 'B', reason: 'chỉ lệch hoa/thường — lấy dạng B đã ép theo schema' };
  }
  return { winner: 'B', reason: 'tên biến MVU ảnh hưởng rộng hơn (schema + UpdateVariable + bảng)' };
}

/**
 * Dò các từ gốc xuất hiện ở CẢ HAI bên nhưng được dịch khác nhau.
 * Chỉ báo cáo, không sửa gì — dùng cho panel/preview.
 */
export function findCrossStrategyConflicts(
  mvuDict: Record<string, string>,
  ejsEntryDict: Record<string, string>,
  ejsKeywordDict: Record<string, string>,
  opts: UnifyOptions = {},
): CrossStrategyConflict[] {
  const conflicts: CrossStrategyConflict[] = [];

  // Bảng tra của B theo key đã chuẩn hoá. Nếu hai key B chuẩn hoá trùng nhau thì lấy key
  // đầu tiên theo thứ tự chữ cái cho ổn định (trùng kiểu đó là xung đột NỘI BỘ B,
  // đã có validateDictionaryConflicts lo).
  const mvuByNorm = new Map<string, { key: string; value: string }>();
  for (const key of Object.keys(mvuDict || {}).sort()) {
    const value = mvuDict[key];
    // Giữ cả ô RỖNG: B bỏ trống nghĩa là chưa dịch được từ đó → lấp bằng bản C mới đúng.
    if (typeof value !== 'string') continue;
    const norm = normalizeSourceKey(key);
    if (!norm || mvuByNorm.has(norm)) continue;
    mvuByNorm.set(norm, { key, value });
  }
  if (mvuByNorm.size === 0) return conflicts;

  const scan = (dict: Record<string, string>, side: 'entry' | 'keyword') => {
    for (const ejsKey of Object.keys(dict || {}).sort()) {
      const ejsValue = dict[ejsKey];
      if (typeof ejsValue !== 'string') continue;
      const hit = mvuByNorm.get(normalizeSourceKey(ejsKey));
      if (!hit) continue;

      // Làm sạch bản C trước khi so — tránh báo lệch giả vì thừa nháy/khoảng trắng.
      const cleanEjs = canonicalizeEjsValue(ejsValue);
      if (cleanEjs === hit.value) continue;
      // Cả hai cùng bỏ trống thì chẳng có bản nào để thống nhất — đừng tạo nhiễu.
      if (!cleanEjs.trim() && !hit.value.trim()) continue;

      const { winner, reason } = pickWinner(hit.value, cleanEjs, opts);
      conflicts.push({
        source: ejsKey,
        side,
        mvuValue: hit.value,
        ejsValue: cleanEjs,
        winner,
        unified: winner === 'B' ? hit.value : cleanEjs,
        reason,
      });
    }
  };

  scan(ejsEntryDict, 'entry');
  scan(ejsKeywordDict, 'keyword');
  return conflicts;
}

/**
 * Dò rồi THỐNG NHẤT: ghi bản thắng vào cả hai phía, trả về ba từ điển đã đồng bộ.
 * Không gọi AI — luật chọn ở `pickWinner` là tất định nên chạy được cả khi mất mạng
 * và cho ra kết quả giống nhau mọi lần chạy.
 */
export function unifyCrossStrategyDicts(
  mvuDict: Record<string, string>,
  ejsEntryDict: Record<string, string>,
  ejsKeywordDict: Record<string, string>,
  opts: UnifyOptions = {},
): UnifyResult {
  const conflicts = findCrossStrategyConflicts(mvuDict, ejsEntryDict, ejsKeywordDict, opts);
  const outMvu = { ...(mvuDict || {}) };
  const outEntry = { ...(ejsEntryDict || {}) };
  const outKw = { ...(ejsKeywordDict || {}) };
  let fixedCount = 0;

  for (const c of conflicts) {
    // Phía C: ghi thẳng theo key thật (key gốc chính là `c.source`).
    const target = c.side === 'entry' ? outEntry : outKw;
    if (target[c.source] !== c.unified) {
      target[c.source] = c.unified;
      fixedCount++;
    }
    // Phía B: key có thể lệch vỏ so với key C nên phải dò lại theo key chuẩn hoá.
    const normSource = normalizeSourceKey(c.source);
    for (const mvuKey of Object.keys(outMvu)) {
      if (normalizeSourceKey(mvuKey) !== normSource) continue;
      if (outMvu[mvuKey] !== c.unified) {
        outMvu[mvuKey] = c.unified;
        fixedCount++;
      }
      break;
    }
  }

  return {
    mvuDictionary: outMvu,
    ejsEntryNameDict: outEntry,
    ejsKeywordDict: outKw,
    conflicts,
    fixedCount,
  };
}
