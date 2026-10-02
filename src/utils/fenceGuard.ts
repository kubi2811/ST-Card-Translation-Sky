/**
 * src/utils/fenceGuard.ts — (bug 246) TRẢ LẠI HÀNG RÀO ``` MÀ AI LÀM RƠI.
 * ─────────────────────────────────────────────────────────────────────────────
 * User (gogopikachu): "Khi dịch các regex có chứa phần ``` thì AI sẽ hay bỏ qua cả phần ``` đó
 * và làm bể script… lỗi này cũng qua được cả các khâu kiểm tra lỗi trong tool, nhưng đem vào
 * silly thì báo lỗi và hư regex ngay lập tức."
 *
 * SillyTavern dựa vào dòng ```html … ``` để biết đoạn nào là HTML cần render. AI coi ba dấu
 * huyền là "định dạng markdown của câu trả lời" nên hay xoá đi. Trước đây chỉ có MỘT ca được cứu:
 * cả field bọc trọn trong một cặp ``` và AI làm rơi CẢ HAI. Mọi hình dạng khác đều lọt:
 *   • có chữ/thẻ trước dòng ```html (rất hay gặp: `<status>` rồi mới tới khối HTML);
 *   • AI chỉ làm rơi dấu ĐÓNG — nhánh cũ thấy "không khớp mẫu bọc trọn" nên BỌC THÊM một lớp,
 *     ra hai dấu mở liền nhau;
 *   • nhiều khối ``` trong một field.
 * Và không bộ kiểm nào đếm ``` theo chiều THIẾU (chỉ có chiều THỪA của bug chèn ``` vào code).
 *
 * Nguyên tắc: hàng rào là CẤU TRÚC, không phải chữ — bản dịch phải có đúng những dòng hàng rào
 * như bản gốc, ở đúng chỗ. Dịch không đổi số dòng (gần như luôn đúng với HTML/regex), nên ghép lại
 * theo dòng là chắc chắn; số dòng đổi thì chỉ dám vá hai đầu, phần còn lại BÁO chứ không đoán.
 */

/** Một dòng CHỈ gồm hàng rào markdown: ``` + tên ngôn ngữ tuỳ chọn. */
const FENCE_LINE_RE = /^[ \t]*```[\w+-]*[ \t]*$/;

const isFenceLine = (line: string) => FENCE_LINE_RE.test(line);

/** Đếm số dòng hàng rào trong văn bản. */
export function countFenceLines(text: string): number {
  if (!text || !text.includes('```')) return 0;
  return text.split('\n').filter(isFenceLine).length;
}

export interface FenceRestoreResult {
  text: string;
  /** Số dòng hàng rào đã trả lại. */
  restored: number;
  /** Bản dịch vẫn thiếu hàng rào sau khi vá (không đủ căn cứ để đặt lại) — cần người kiểm. */
  stillMissing: number;
}

/**
 * Trả lại những dòng ``` có trong bản gốc mà bản dịch làm rơi. Không bao giờ XOÁ hàng rào, không
 * đụng tới bản dịch nếu số hàng rào đã đủ.
 */
export function restoreDroppedFences(original: string, translated: string): FenceRestoreResult {
  const origCount = countFenceLines(original);
  const transCount = countFenceLines(translated);
  if (origCount === 0 || transCount >= origCount) {
    return { text: translated, restored: 0, stillMissing: 0 };
  }

  const eol = translated.includes('\r\n') ? '\r\n' : '\n';
  const origLines = original.replace(/\r\n/g, '\n').split('\n');
  const transLines = translated.replace(/\r\n/g, '\n').split('\n');

  // (1) Số dòng NỘI DUNG (không tính hàng rào) hai bên bằng nhau ⇒ dòng nội dung i của bản dịch
  // chính là bản dịch của dòng nội dung i bản gốc. Dựng lại theo đúng khung của bản gốc.
  const transBody = transLines.filter((l) => !isFenceLine(l));
  const origBodyCount = origLines.length - origCount;
  if (transBody.length === origBodyCount) {
    let bi = 0;
    const rebuilt = origLines.map((l) => (isFenceLine(l) ? l : transBody[bi++]));
    return { text: rebuilt.join(eol), restored: origCount - transCount, stillMissing: 0 };
  }

  // (2) Số dòng đổi ⇒ chỉ vá hai đầu, nơi vị trí hàng rào không cần đoán.
  const firstOrig = origLines.findIndex((l) => l.trim() !== '');
  const lastOrig = findLastIndex(origLines, (l) => l.trim() !== '');
  const firstTrans = transLines.findIndex((l) => l.trim() !== '');
  const lastTrans = findLastIndex(transLines, (l) => l.trim() !== '');
  const lines = transLines.slice();
  let restored = 0;

  if (firstOrig >= 0 && isFenceLine(origLines[firstOrig]) && firstTrans >= 0 && !isFenceLine(transLines[firstTrans])) {
    lines.splice(firstTrans, 0, origLines[firstOrig]);
    restored++;
  }
  if (lastOrig >= 0 && isFenceLine(origLines[lastOrig]) && lastTrans >= 0 && !isFenceLine(transLines[lastTrans])) {
    const at = findLastIndex(lines, (l) => l.trim() !== '') + 1;
    lines.splice(at, 0, origLines[lastOrig]);
    restored++;
  }
  const missing = Math.max(0, origCount - (transCount + restored));
  return { text: restored > 0 ? lines.join(eol) : translated, restored, stillMissing: missing };
}

function findLastIndex<T>(arr: T[], pred: (v: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i;
  return -1;
}
