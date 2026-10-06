/**
 * src/utils/codeChars.ts — (bug 257) CHỮ HÁN ĐƠN LẺ TRONG CODE PHẢI DỊCH THEO MỘT BẢNG CỐ ĐỊNH.
 * ─────────────────────────────────────────────────────────────────────────────
 * Thẻ thật (thanh trạng thái "Thần Hào", 4.700 dòng HTML/JS): đường surgical tách mỗi chữ Hán nằm
 * giữa code thành một cụm rồi hỏi AI. Một chữ đứng trơ trọi không có ngữ cảnh ⇒ AI đọc PHIÊN ÂM
 * HÁN-VIỆT, và mỗi chỗ một kiểu:
 *   '无' → 'vô'            (schema/quy tắc viết "Không" ⇒ mọi phép so `=== 'vô'` không bao giờ đúng)
 *   /(\d{4})年(\d{1,2})月/ → /niên…nguyệt…nhật/  (AI viết "Năm/Tháng/Ngày" ⇒ regex ngày chết hết)
 *   '次' → 'thứ', '人' → 'nhân', '天' → 'thiên', '千/万/亿' → 'thiên/vạn/ức', '你' → 'nễ'
 *   ['日','一',…,'六'] → ['nhật','nhất','nhị',…,'lục'] (chỗ khác lại ra 'Hai','Ba'…)
 * Code so sánh / regex / ghép chuỗi chỉ chạy được khi CÙNG một chữ ra CÙNG một bản dịch, và bản dịch
 * đó phải trùng với chữ AI viết ra lúc chơi (theo quy tắc đã dịch). Nên các chữ đơn hay gặp được
 * dịch tại chỗ theo bảng dưới — không hỏi AI.
 */

/** Chữ đơn → bản dịch dùng trong code. Ưu tiên đúng chữ AI sẽ viết trong văn bản tiếng Việt. */
export const CODE_CHAR_VI: Record<string, string> = {
  // ngày giờ
  年: 'Năm', 月: 'Tháng', 日: 'Ngày', 号: 'ngày', 天: 'ngày', 周: 'Thứ',
  时: 'giờ', 秒: 'giây', 岁: 'tuổi',
  // đếm — CHỈ chữ một nghĩa trong code game. `分` (phút / điểm số), `名` (tên / người), `个`…
  // nhiều nghĩa ⇒ để AI đọc ngữ cảnh.
  次: 'lần', 人: 'người', 条: 'mục', 件: 'món', 级: 'cấp', 层: 'tầng', 点: 'điểm',
  // tiền
  元: 'tệ', 块: 'tệ', 千: 'nghìn', 万: 'vạn', 亿: 'trăm triệu',
  // có / không
  无: 'Không', 有: 'Có', 是: 'Có', 否: 'Không',
  // người
  你: 'Bạn', 我: 'Tôi', 男: 'Nam', 女: 'Nữ',
};

/** Thứ trong tuần — chỉ dùng khi chữ số đứng trong một DANH SÁCH thứ (xem isWeekdayContext). */
export const WEEKDAY_VI: Record<string, string> = {
  日: 'Chủ Nhật', 天: 'Chủ Nhật', 一: 'Hai', 二: 'Ba', 三: 'Tư', 四: 'Năm', 五: 'Sáu', 六: 'Bảy',
};

/**
 * Chữ `一…六 / 日` đang nằm trong một danh sách thứ trong tuần không? (≥ 5 chữ thứ khác nhau được
 * đặt trong nháy ngay quanh đó: `['日','一','二',…]`, `{ '一': 0, '二': 1, … }`).
 */
export function isWeekdayContext(text: string, start: number, end: number): boolean {
  const win = text.slice(Math.max(0, start - 80), Math.min(text.length, end + 80));
  const quoted = new Set((win.match(/['"`]([日天一二三四五六])['"`]/g) || []).map(q => q[1]));
  return quoted.size >= 5;
}

/**
 * Bản dịch tại chỗ cho cụm `token` (đã trim) ở vị trí [start, end) của `text`, hoặc null nếu cụm
 * không thuộc bảng. Nhận cả cụm vài chữ đơn cách nhau bằng dấu cách (`日 周` ⇒ `Ngày Thứ`).
 */
export function lookupCodeChars(token: string, text: string, start: number, end: number): string | null {
  const t = token.trim();
  if (!t) return null;
  const parts = t.split(/(\s+)/);
  const words = parts.filter((_, i) => i % 2 === 0);
  if (!words.every(w => w.length === 1)) return null;
  const weekday = words.length === 1 && WEEKDAY_VI[t] !== undefined && isWeekdayContext(text, start, end);
  if (weekday) return WEEKDAY_VI[t];
  if (!words.every(w => CODE_CHAR_VI[w] !== undefined)) return null;
  return parts.map((p, i) => (i % 2 === 0 ? CODE_CHAR_VI[p] : p)).join('');
}

const CJK_ONLY_CLASS = /\[([㐀-䶿一-鿿]{2,})\]/g;

/**
 * (bug 257) `[日号]` trong REGEX là "một trong các chữ này". Dịch từng chữ ra từ nhiều chữ cái là
 * thành `[Ngày mùng]` — "một trong các CHỮ CÁI N,g,à,y,…". Trước khi dịch, đổi nhóm ký tự chỉ toàn
 * chữ Hán trong regex literal sang nhóm lựa chọn tương đương `(?:日|号)` — dịch xong vẫn đúng nghĩa.
 * Chỉ đụng regex literal (`/…/flags` đứng sau toán tử hoặc `(`, `,`, `=`, `:`…), không đụng chuỗi.
 */
export function cjkCharClassesToAlternation(code: string): { text: string; count: number } {
  if (!code || !/\[[㐀-䶿一-鿿]{2,}\]/.test(code)) return { text: code, count: 0 };
  let count = 0;
  const re = /((?:^|[(,=:!&|?{};[]|\breturn)\s*)\/((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+)\/([gimsuy]*)/gm;
  const text = code.replace(re, (whole, pre: string, body: string, flags: string) => {
    if (!CJK_ONLY_CLASS.test(body)) { CJK_ONLY_CLASS.lastIndex = 0; return whole; }
    CJK_ONLY_CLASS.lastIndex = 0;
    const nb = body.replace(CJK_ONLY_CLASS, (_m, chars: string) => { count++; return `(?:${[...chars].join('|')})`; });
    try { new RegExp(nb, flags); } catch { return whole; }
    return `${pre}/${nb}/${flags}`;
  });
  return { text, count };
}
