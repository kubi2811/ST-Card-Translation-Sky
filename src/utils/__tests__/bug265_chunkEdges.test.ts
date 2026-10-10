/**
 * (bug 265 — Tiểu Tu Sĩ) Khung chunk "Đủ và sạch 7/7" nhưng bản dịch bên ngoài vẫn nguyên tiếng
 * Trung: ghép các chunk ra script VỠ CÚ PHÁP nên chốt an toàn giữ bản gốc. Hai chỗ vỡ ở mép chunk,
 * tái hiện bằng chính script của user (48 KB, 7 chunk).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fitChunkEdges, fitCellsToRaw, isGluedContent } from '../chunkEdges';
import { joinChunks, planAutoJoin } from '../chunkAudit';
import { jsParseErrorAny } from '../scriptSafety';

describe('bug 265 — mép chunk của code khớp mép gốc', () => {
  // Rút gọn đúng ba kiểu mép trong script thật.
  const raw = [
    "const cfg = { a: 1 }; const b = { c: 2 }; const d = { e: 3 }; let f = {}; var g = {};\nconst style = doc.createElement('style');\n  ",
    'style.textContent = `\n    :host { color: red; }\n    .a { margin: 3px; }\n',
    '    @media (hover: hover) { .orb:hover { opacity: 1; } }\n  `;\n  ',
    '// 仅拥有自己的宿主节点。\n',
    '(function start() {\n  const 标题 = 1;\n})();\n',
  ];
  // Bản dịch như AI trả về + bước làm sạch cũ: cắt khoảng trắng hai đầu, tự đóng template literal.
  const done = [
    "const cfg = { a: 1 }; const b = { c: 2 }; const d = { e: 3 }; let f = {}; var g = {};\nconst style = doc.createElement('style');",
    'style.textContent = `\n    :host { color: red; }\n    .a { margin: 3px; }`',
    '@media (hover: hover) { .orb:hover { opacity: 1; } }\n  `;',
    '// Chỉ sở hữu các nút host của chính nó.',
    '(function start() {\n  const tieuDe = 1;\n})();',
  ];
  const original = raw.join('');

  it('ghép thẳng (cách cũ) vỡ cú pháp; khớp mép xong thì chạy được', () => {
    expect(jsParseErrorAny(original)).toBeNull();
    expect(isGluedContent(original)).toBe(true);
    expect(jsParseErrorAny(joinChunks(done, original))).not.toBeNull();
    const fitted = fitCellsToRaw(done, raw, original) as string[];
    expect(jsParseErrorAny(joinChunks(fitted, original))).toBeNull();
  });

  it('trả lại xuống dòng sau dòng // chú thích — dòng code kế không bị nuốt', () => {
    expect(fitChunkEdges(raw[3], done[3])).toBe('// Chỉ sở hữu các nút host của chính nó.\n');
    expect(fitChunkEdges(raw[2], done[2]).startsWith('    @media')).toBe(true);
  });

  it('bỏ dấu ` AI tự thêm ở mép; dấu ` có sẵn ở mép gốc thì giữ', () => {
    expect(fitChunkEdges(raw[1], done[1]).trimEnd().endsWith('}')).toBe(true);
    expect(fitChunkEdges('x = `a`;\n', 'x = `a`;')).toBe('x = `a`;\n');
    expect(fitChunkEdges('`tail', '`đuôi')).toBe('`đuôi');
    // gốc kết thúc bằng ` thì bản dịch kết thúc bằng ` là đúng
    expect(fitChunkEdges('a = `x`', 'a = `y`')).toBe('a = `y`');
  });

  it('văn xuôi (nối bằng dòng trống) không bị đụng', () => {
    const prose = '第一段。\n\n第二段。';
    expect(isGluedContent(prose)).toBe(false);
    expect(fitCellsToRaw(['Đoạn một.'], ['第一段。\n\n'], prose)).toEqual(['Đoạn một.']);
  });

  it('tự ghép khi mở lại phiên cũng khớp mép', () => {
    const plan = planAutoJoin([{ path: 'p', label: 'L', original, translated: original, completedChunks: done, rawChunks: raw, totalChunks: raw.length }]);
    expect(jsParseErrorAny(plan[0].joined)).toBeNull();
  });
});

describe('bug 265 — nối dây', () => {
  const API = readFileSync(join(__dirname, '../apiClient.ts'), 'utf8');
  const FE = readFileSync(join(__dirname, '../../components/FieldEditor.tsx'), 'utf8');
  it('engine khớp mép ở cả đường song song, tuần tự và lượt thử lại', () => {
    expect((API.match(/if \(gluedJoin\) chunkCleaned = fitChunkEdges\(chunks\[idx\], chunkCleaned\);/g) || []).length).toBe(2);
    expect((API.match(/gluedJoin \? fitChunkEdges\(chunks\[idx\], retryCleaned\) : retryCleaned/g) || []).length).toBe(2);
  });
  it('nút Ghép lại khớp mép, từ chối bản ghép vỡ cú pháp, và khung chunk báo khi bản dịch chưa khớp', () => {
    expect(FE).toContain('fitCellsToRaw(restoreLeakedCells(');
    expect(FE).toContain('if (joinedJsError) {');
    expect(FE).toContain('Bản dịch chưa khớp các chunk');
  });
});
