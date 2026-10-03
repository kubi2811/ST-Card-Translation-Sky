/**
 * (bug 28) Sáng Đại Tiên: "Phần giao diện tiếng Việt còn nhiều phần mô tả tiếng Anh".
 *
 * Gốc rễ: `ui/vi.ts` được dựng bằng cách CHÉP NGUYÊN VĂN giao diện cũ, mà giao diện cũ vốn trộn
 * tiếng Anh — nên 160 chuỗi của bản VI giống hệt bản EN (mô tả chunk, RAG, MVU, kiểm regex…).
 * Test này chặn tái diễn: chuỗi VI mà y hệt EN, không có dấu tiếng Việt, lại có từ hai từ tiếng
 * Anh trở lên ⇒ đỏ. Tên riêng / thuật ngữ quen dùng thì ghi vào ALLOW kèm lý do.
 */
import { describe, it, expect } from 'vitest';
import viUi from '../ui/vi';
import enUi from '../ui/en';
import viL from '../locales/vi';
import enL from '../locales/en';

const VI_MARK = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const ENGLISH_PHRASE = /[a-z]{3,}\s+[a-z]{3,}/i;

/** Giữ tiếng Anh có chủ ý: tên sản phẩm, tên đường dẫn trên GitHub, thuật ngữ tham số của API/ST. */
const ALLOW = new Set([
  'railModCard', 'railCrawler', 'appRegexManager', 'ppApiKey',
  'eltGuidePatLink',            // đường dẫn menu trên trang GitHub — người dùng phải thấy đúng chữ đó
  'appTitle', 'apiKey', 'corsProxy', 'depthPrompt', 'groupDepthPrompt', 'catTemplateLiteralContent',
  'frequencyPenalty', 'presencePenalty', 'repetitionPenalty',
]);

function leftovers(vi: Record<string, unknown>, en: Record<string, unknown>, path = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(vi)) {
    const e = en?.[k];
    if (typeof v === 'string') {
      if (ALLOW.has(k)) continue;
      if (v === e && !VI_MARK.test(v) && ENGLISH_PHRASE.test(v)) out.push(`${path}${k} = ${v}`);
    } else if (v && typeof v === 'object') {
      out.push(...leftovers(v as Record<string, unknown>, e as Record<string, unknown>, `${path}${k}.`));
    }
  }
  return out;
}

describe('(bug 28) giao diện tiếng Việt không còn chuỗi tiếng Anh', () => {
  it('ui/vi.ts', () => {
    expect(leftovers(viUi as unknown as Record<string, unknown>, enUi as unknown as Record<string, unknown>)).toEqual([]);
  });
  it('locales/vi.ts', () => {
    expect(leftovers(viL as unknown as Record<string, unknown>, enL as unknown as Record<string, unknown>)).toEqual([]);
  });
});
