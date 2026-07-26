/**
 * numericSemantics.ts — (bugNeedFix/113) Biến số nào CÓ TRẦN, biến số nào KHÔNG.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "Game UI + Schema hiện tại thiếu ràng buộc số học ở các biến số. Nếu không mô tả chi tiết
 * phạm vi giá trị, UI tự động áp giới hạn mặc định 0-100 cho TẤT CẢ biến số:
 *   • Ghi 'Thiên phú theo thang 1–5 sao' → UI giới hạn 0-5   ← đúng
 *   • Ghi 'Tiền tệ của thế giới này là ___' → mặc định 0-100  ← SAI, tiền không có trần
 *   • Ghi 'Ngày' → mặc định 0-100                            ← SAI, ngày tăng mãi
 *   • Số lượng vật phẩm cũng mặc định 0-100"                 ← SAI
 * Ảnh kèm theo cho thấy đúng thế: "Ngày (Thời gian trôi) 1/100", "Tiền tệ Veil Coin 75/100",
 * "Lọ Tinh Chất Veil 2/100" — kèm thanh tiến trình gần như trống, vô nghĩa.
 *
 * BA TẦNG cùng góp phần vào con số 100 đó:
 *   1. Ví dụ JSON trong prompt ghi thẳng `"constraints": { "min": 0, "max": 100 }` → AI chép y
 *      nguyên cho mọi biến số, kể cả tiền và ngày.
 *   2. `getMaxValue()` của bộ dựng thanh trạng thái: không có max thì `return 100`.
 *   3. Opening Form: slider `min=0 max=100` cho cả tiền lẫn ngày.
 *
 * Cái sai không phải "thiếu ràng buộc" mà là ÁP ĐẶT ràng buộc cho thứ vốn không có trần. Có hai
 * loại biến số khác nhau về bản chất:
 *
 *   ĐỒNG HỒ ĐO (gauge)  — HP, VP, độ hảo cảm, tiến độ %, thang sao: có trần rõ ràng, ý nghĩa nằm
 *                         ở TỈ LỆ so với trần ⇒ vẽ thanh tiến trình là đúng.
 *   BỘ ĐẾM (counter)    — ngày, tiền, số lượng vật phẩm, điểm tích luỹ: tăng/giảm không trần, ý
 *                         nghĩa nằm ở CON SỐ ⇒ chỉ hiện số, vẽ thanh là vô nghĩa.
 *
 * File này quyết định một biến số thuộc loại nào, để schema đừng kẹp trần bừa và giao diện đừng
 * vẽ thanh bừa.
 */
import type { MVUZODField } from '../../types/mvuzod.types';

/** Bỏ dấu + hạ thường để so khớp từ khoá bất kể cách viết. */
function norm(s: string): string {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

/**
 * BỘ ĐẾM — không có trần trên. Gom cả tiếng Việt (có/không dấu), tiếng Anh và Hán tự vì thẻ nguồn
 * thường là tiếng Trung.
 */
const COUNTER_WORDS = [
  // thời gian trôi
  'ngay', 'thoi gian', 'thang', 'nam', 'tuan', 'gio thu', 'luot', 'turn', 'day', 'date', 'time',
  '天数', '日期', '时间', '回合',
  // tiền tệ
  'tien', 'vang', 'xu', 'bac', 'coin', 'gold', 'money', 'currency', 'credit', 'linh thach',
  '金币', '灵石', '货币', '钱',
  // số lượng / tích luỹ
  'so luong', 'so du', 'ton kho', 'count', 'qty', 'quantity', 'amount', 'stock', 'tong',
  'tich luy', 'kinh nghiem', 'exp', 'diem cong hien', 'diem tich', 'so lan', 'luot dung',
  'kill', 'so diem', 'population', 'dan so',
  '数量', '经验', '积分', '贡献',
];

/**
 * ĐỒNG HỒ ĐO — có trần tự nhiên. Chỉ dùng khi schema KHÔNG khai trần: đoán để biết nên vẽ thanh.
 */
const GAUGE_WORDS = [
  'hp', 'mp', 'sp', 'mau', 'sinh luc', 'sinh menh', 'the luc', 'noi luc', 'mana', 'nang luong',
  'energy', 'stamina', 'do ben', 'durability', 'do hao cam', 'hao cam', 'thien cam', 'affection',
  'tin nhiem', 'trust', 'do', 'ty le', 'phan tram', 'percent', 'tien do', 'progress',
  'sao', 'star', 'cap do', 'level', 'tang', 'do tinh tao', 'san khoai', 'kiet suc', 'no',
  '好感', '血量', '生命', '体力', '灵力', '能量', '进度', '等级',
];

function hitsAny(text: string, words: string[]): boolean {
  const t = norm(text);
  return words.some((w) => t.includes(w));
}

/** Chữ để soi ngữ nghĩa: nhãn + tên biến + mô tả. */
function semanticText(field: MVUZODField): string {
  const leaf = String(field.path || '').split('/').filter(Boolean).pop() ?? '';
  return [field.label, leaf, field.description].filter(Boolean).join(' ');
}

/** Biến số này là BỘ ĐẾM không trần? */
export function isUnboundedCounter(field: MVUZODField): boolean {
  if (field.type !== 'number') return false;
  return hitsAny(semanticText(field), COUNTER_WORDS);
}

/** Biến số này trông như ĐỒNG HỒ ĐO (nên có trần, nên vẽ thanh)? */
export function looksLikeGauge(field: MVUZODField): boolean {
  if (field.type !== 'number') return false;
  return hitsAny(semanticText(field), GAUGE_WORDS);
}

/**
 * Trần mặc định `0-100` mà AI chép từ ví dụ trong prompt — dấu hiệu: ĐÚNG min 0 và max 100.
 * Người dùng cố ý viết "thang 0-100" thì cũng ra y hệt, nhưng khi đó biến sẽ là % / độ hảo cảm
 * (khớp GAUGE_WORDS) nên không bị coi là chép bừa.
 */
function isCopiedDefaultRange(field: MVUZODField): boolean {
  const c = field.constraints ?? {};
  const min = c.clamp?.[0] ?? c.min;
  const max = c.clamp?.[1] ?? c.max;
  return min === 0 && max === 100;
}

export interface NumericDecision {
  /** Có trần hữu hạn để vẽ thanh tiến trình / kẹp giá trị hay không. */
  bounded: boolean;
  /** Trần (chỉ có nghĩa khi bounded). */
  max?: number;
  /** Sàn. */
  min?: number;
  /** Vì sao — để log/test đọc được. */
  reason: 'schema-explicit' | 'gauge-guess' | 'counter' | 'no-info';
}

/**
 * Quyết định cuối cùng cho một biến số.
 *
 * Thứ tự ưu tiên:
 *  1. BỘ ĐẾM + trần đúng bằng 0-100 ⇒ coi là trần chép bừa từ ví dụ prompt, BỎ trần.
 *     (Ngày/tiền/số lượng bị kẹp ở 100 là lỗi nặng: chơi tới ngày 101 là đứng.)
 *  2. Schema khai trần (khác cái mặc định bị chép) ⇒ tôn trọng tuyệt đối — đây là ca
 *     "thang 1–5 sao" mà user nói đang chạy ĐÚNG.
 *  3. Không khai gì: đoán theo ngữ nghĩa — đồng hồ đo thì cho trần 100, bộ đếm thì không trần.
 */
export function decideNumericBounds(field: MVUZODField): NumericDecision {
  const c = field.constraints ?? {};
  const min = c.clamp?.[0] ?? c.min;
  const max = c.clamp?.[1] ?? c.max;
  const counter = isUnboundedCounter(field);

  if (counter && isCopiedDefaultRange(field) && !looksLikeGauge(field)) {
    return { bounded: false, min: 0, reason: 'counter' };
  }
  if (typeof max === 'number' && Number.isFinite(max)) {
    return { bounded: true, min: typeof min === 'number' ? min : 0, max, reason: 'schema-explicit' };
  }
  if (counter) return { bounded: false, min: typeof min === 'number' ? min : 0, reason: 'counter' };
  if (looksLikeGauge(field)) {
    return { bounded: true, min: typeof min === 'number' ? min : 0, max: 100, reason: 'gauge-guess' };
  }
  // Không biết gì: KHÔNG bịa trần. Thà hiện con số trần trụi còn hơn kẹp sai rồi mất dữ liệu.
  return { bounded: false, min: typeof min === 'number' ? min : undefined, reason: 'no-info' };
}

/**
 * Dọn trần bịa khỏi schema: bộ đếm mang trần 0-100 chép từ ví dụ prompt thì bỏ `max`/`clamp`.
 * Phải làm ở tầng SCHEMA chứ không chỉ ở giao diện — vì Zod `clamp`/`max` sẽ KẸP giá trị thật,
 * tiền của người chơi vượt 100 là bị cắt về 100, mất dữ liệu chứ không chỉ hiển thị sai.
 */
export function stripBogusNumericCaps<T extends { fields: MVUZODField[] }>(
  schema: T,
): { schema: T; stripped: string[] } {
  const stripped: string[] = [];

  const walk = (fields: MVUZODField[]): MVUZODField[] => (fields ?? []).map((f) => {
    const next: MVUZODField = { ...f };
    if (Array.isArray(f.children) && f.children.length) next.children = walk(f.children);

    if (f.type === 'number') {
      const d = decideNumericBounds(f);
      if (!d.bounded && (f.constraints?.max !== undefined || f.constraints?.clamp)) {
        const leaf = String(f.path || '').split('/').filter(Boolean).pop() ?? f.path;
        stripped.push(String(leaf));
        const c = { ...(f.constraints ?? {}) };
        delete c.max;
        delete c.clamp;
        // Giữ sàn 0 cho bộ đếm (âm tiền/âm số lượng thường là lỗi), bỏ trần.
        if (c.min === undefined && d.min !== undefined) c.min = d.min;
        next.constraints = c;
      }
    }
    return next;
  });

  return { schema: { ...schema, fields: walk(schema.fields) }, stripped };
}
