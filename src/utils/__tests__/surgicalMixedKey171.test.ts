/**
 * (bug 171) DỊCH REGEX LÀM SẬP SCRIPT — khoá thuộc tính TRỘN CJK VỚI ASCII bị xẻ nhỏ.
 * ─────────────────────────────────────────────────────────────────────────────
 * Bằng chứng user gửi (ảnh trong bug/171):
 *   a) `${f.Tiếng Lòng || 'vô'}`            ← dot-notation mà khoá có DẤU CÁCH: JS không cho phép
 *   b) `${f['Với']user Quan Hệ || 'Không Rõ'}` ← bracket bị cắt nham nhở, `user Quan Hệ` rơi ra ngoài
 *
 * Nguyên bản của (b) là một khoá TRỘN: `f.与user关系`. Bộ tách token cắt quanh cụm Latin nên ra HAI
 * cụm Hán rời (`与` và `关系`), mỗi cụm được bọc ngoặc riêng — trong khi đúng ra cả khoá `与user关系`
 * là MỘT đơn vị và phải bọc trọn: `f['Với user Quan Hệ']`.
 *
 * Đây là lỗi chết người chứ không phải lỗi trình bày: sai cú pháp trong <script> là cả khối không
 * parse được, mọi nút trong thẻ liệt — cùng họ với bug 161.
 */
import { describe, it, expect } from 'vitest';
import { extractCJKTokens, reinsertTranslations } from '../surgical';

/** Dịch bằng bảng tra rồi ghép lại — đúng đường tool đi. */
function translateWith(src: string, map: Record<string, string>): string {
  const tokens = extractCJKTokens(src);
  for (const t of tokens) {
    const k = t.text.trim();
    if (map[k] !== undefined) t.translated = map[k];
  }
  return reinsertTranslations(src, tokens);
}

const jsOk = (code: string) => {
  try { new Function(code); return { ok: true, err: '' }; }
  catch (e) { return { ok: false, err: (e as Error).message }; }
};

describe('(bug 171a) khoá dot-notation dịch ra có DẤU CÁCH phải chuyển sang bracket', () => {
  it('f.心声 → f[\'Tiếng Lòng\'], không phải f.Tiếng Lòng', () => {
    const out = translateWith('const s = `${f.心声 || "vô"}`;', { '心声': 'Tiếng Lòng' });
    expect(out, 'dot-notation + dấu cách = SyntaxError').not.toMatch(/f\.Tiếng Lòng/);
    expect(jsOk(out).ok, `vỡ cú pháp: ${jsOk(out).err} — ${out}`).toBe(true);
  });
});

describe('(bug 171b) khoá TRỘN CJK+ASCII phải được coi là MỘT đơn vị', () => {
  it('ca thật: f.与user关系 không được xẻ thành f[\'…\']user …', () => {
    const src = 'const s = `${f.与user关系 || "Không Rõ"}`;';
    const out = translateWith(src, { '与': 'Với', '关系': 'Quan Hệ' });
    expect(out, 'mảnh ASCII rơi ra ngoài ngoặc = script chết').not.toMatch(/\]\s*user/);
    expect(jsOk(out).ok, `vỡ cú pháp: ${jsOk(out).err} — ${out}`).toBe(true);
  });

  it('m.与user关系 cũng vậy (ảnh user có cả hai biến f và m)', () => {
    const src = 'const s = `${m.与user关系 || "Người Lạ"}`;';
    const out = translateWith(src, { '与': 'Với', '关系': 'Quan Hệ' });
    expect(out).not.toMatch(/\]\s*user/);
    expect(jsOk(out).ok, `vỡ: ${out}`).toBe(true);
  });

  it('info[\'与user关系\'] — đã có ngoặc sẵn thì KHÔNG bọc thêm lần nữa', () => {
    const src = `const s = info['与user关系'] || 'Không Rõ';`;
    const out = translateWith(src, { '与': 'Với', '关系': 'Quan Hệ' });
    expect(out, 'bọc chồng ngoặc/nháy là vỡ ngay').not.toMatch(/\[\s*\[|''/);
    expect(jsOk(out).ok, `vỡ: ${out}`).toBe(true);
  });

  it('khoá trộn có ASCII ở ĐẦU vẫn an toàn (n._预产天数 — ca bug 151, không được hồi quy)', () => {
    const src = 'const s = n._预产天数;';
    const out = translateWith(src, { '预产天数': 'Số ngày dự sinh' });
    expect(jsOk(out).ok, `vỡ: ${out}`).toBe(true);
  });
});

describe('(bug 171) cùng một khoá phải ra CÙNG một tên ở mọi chỗ', () => {
  it('khoá trộn xuất hiện nhiều nơi → tách ra cùng MỘT token, không mỗi chỗ một kiểu', () => {
    // User nêu đúng hệ quả thứ hai: "chỗ thì 'Với User Quan Hệ', chỗ thì 'dữ user mối quan hệ của'".
    // Gốc rễ vẫn là cái cũ — khoá bị xẻ nhỏ nên mỗi mảnh đi dịch riêng, không còn gì buộc chúng
    // khớp nhau. Gộp thành một token thì mọi lần xuất hiện là CÙNG một chuỗi, và cơ chế nhất quán
    // sẵn có (token định danh dùng chung một bản dịch) mới có chỗ bám.
    const src = [
      'const a = `${f.与user关系}`;',
      'const b = `${m.与user关系}`;',
      'const c = info.与user关系;',
    ].join('\n');
    const tokens = extractCJKTokens(src);
    const keyTokens = tokens.filter((t) => t.text.includes('与') && t.text.includes('关系'));
    expect(keyTokens.length, 'phải nhận ra cả 3 lần xuất hiện').toBe(3);
    for (const t of keyTokens) {
      expect(t.text, 'mỗi lần phải là TRỌN khoá, không phải mảnh').toBe('与user关系');
    }
  });
});

describe('(bug 171) văn xuôi KHÔNG bị đụng nhầm', () => {
  it('cụm Hán trong câu chữ thường vẫn dịch bình thường, không bọc ngoặc', () => {
    const out = translateWith('<p>心声</p>', { '心声': 'Tiếng Lòng' });
    expect(out).toBe('<p>Tiếng Lòng</p>');
  });
});
