// bugNeedFix/33 — guard chống "AI bịa thêm code" (safeString) khi dịch script Zod schema.
import { describe, it, expect } from 'vitest';
import { verifyCodeStructureParity, detectInventedDeclarations } from '../surgical';

// Bản GỐC: schema Zod, const có tên chữ Hán, chỉ có enum (KHÔNG có safeString).
const ORIGINAL = `import { registerMvuSchema } from 'https://cdn/mvu_zod.js';

// 大场景枚举
const 大场景枚举 = z.enum([
  '夏目家',
  '冬野家',
  '夏目咖啡屋',
]);

const schema = z.object({
  "场景": 大场景枚举.prefault('夏目家'),
  "描述": z.string().prefault('无'),
});`;

// Bản DỊCH BỊA (đúng ca user báo): AI TỰ THÊM hàm safeString ở đầu + đổi z.string()→safeString().
const HALLUCINATED = `import { registerMvuSchema } from 'https://cdn/mvu_zod.js';

const safeString = () => z.preprocess(
  (val) => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'object') {
      try { return JSON.stringify(val); } catch { return String(val); }
    }
    return String(val);
  },
  z.string()
);

const CanhLonEnum = z.enum([
  'Nhà Natsume',
  'Nhà Fuyuno',
  'Quán Cafe Natsume',
]);

const schema = z.object({
  "Cảnh": CanhLonEnum.prefault('Nhà Natsume'),
  "Mô Tả": safeString().prefault('Không'),
});`;

// Bản DỊCH TRUNG THỰC: chỉ dịch chữ Hán trong chuỗi/comment + phiên âm tên const, GIỮ cấu trúc.
const FAITHFUL = `import { registerMvuSchema } from 'https://cdn/mvu_zod.js';

// Đại Cảnh Enum
const DaiCanhEnum = z.enum([
  'Nhà Natsume',
  'Nhà Fuyuno',
  'Quán Cafe Natsume',
]);

const schema = z.object({
  "Cảnh": DaiCanhEnum.prefault('Nhà Natsume'),
  "Mô Tả": z.string().prefault('Không'),
});`;

describe('detectInventedDeclarations — bắt khai báo AI tự bịa', () => {
  it('BUG 33: safeString là khai báo MỚI không có trong gốc → bị bắt', () => {
    const invented = detectInventedDeclarations(ORIGINAL, HALLUCINATED);
    expect(invented).toContain('safeString');
  });

  it('phiên âm tên const (大场景枚举→DaiCanhEnum) KHÔNG làm tăng SỐ khai báo (không phải bịa)', () => {
    // DaiCanhEnum "mới" về TÊN, nhưng thay thế 1 khai báo cũ → tổng số khai báo không đổi.
    const origDecls = (ORIGINAL.match(/\b(?:const|let|var|function)\s+/g) || []).length;
    const faithDecls = (FAITHFUL.match(/\b(?:const|let|var|function)\s+/g) || []).length;
    expect(faithDecls).toBe(origDecls); // 2 = 2 (không thêm hàm)
  });
});

describe('verifyCodeStructureParity — ngoặc lệch khi AI thêm code', () => {
  it('BUG 33: bản bịa safeString THÊM rất nhiều ngoặc → maxDiff lớn (≥4)', () => {
    const parity = verifyCodeStructureParity(ORIGINAL, HALLUCINATED);
    expect(parity.ok).toBe(false);
    expect(parity.maxDiff).toBeGreaterThanOrEqual(4);
  });

  it('bản dịch TRUNG THỰC giữ nguyên số ngoặc → maxDiff = 0 (không báo nhầm)', () => {
    const parity = verifyCodeStructureParity(ORIGINAL, FAITHFUL);
    expect(parity.ok).toBe(true);
    expect(parity.maxDiff).toBe(0);
  });

  it('đổi ngoặc CJK/fullwidth 【】（）→ ASCII []() KHÔNG bị tính lệch', () => {
    const o = `// chú thích（quan trọng）và danh sách【A】`;
    const t = `// ghi chú (quan trọng) và danh sách [A]`;
    const parity = verifyCodeStructureParity(o, t);
    expect(parity.ok).toBe(true);
    expect(parity.maxDiff).toBe(0);
  });
});

describe('Quyết định guard tổng hợp (mô phỏng useTranslation)', () => {
  const flagged = (orig: string, trans: string) => {
    const parity = verifyCodeStructureParity(orig, trans);
    const invented = detectInventedDeclarations(orig, trans);
    return parity.maxDiff >= 4 || (invented.length > 0 && parity.maxDiff >= 1);
  };

  it('bản BỊA → bị chặn', () => {
    expect(flagged(ORIGINAL, HALLUCINATED)).toBe(true);
  });
  it('bản TRUNG THỰC (kể cả phiên âm tên const) → KHÔNG bị chặn', () => {
    expect(flagged(ORIGINAL, FAITHFUL)).toBe(false);
  });
  it('không đổi gì → không chặn', () => {
    expect(flagged(ORIGINAL, ORIGINAL)).toBe(false);
  });
});
