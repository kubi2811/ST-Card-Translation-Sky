/**
 * (bug 263 — gogopikachu.) Đánh giá chunk sai ⇒ dịch lại chunk lỗi "về vạch xuất phát":
 *   1. chunk đã dịch 27.000 ký tự chỉ sót vài chữ Hán bị gắn nhãn "chưa dịch", và nút "dịch lại
 *      chunk lỗi" xoá trắng cả loạt chunk đó;
 *   2. đường tự vá (quét chữ Hán sót / dịch lại mục chưa đạt) xoá ô TRƯỚC khi cầm khoá — mục đang
 *      bị lượt khác giữ thì ô nằm "Pending" mãi;
 *   3. ô dịch lưu còn ký hiệu che `__PROTECTED_URL_n__` ⇒ "Ghép lại" lộ ký hiệu vào thẻ.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { auditChunks, restoreLeakedUrlPlaceholders, restoreLeakedCells, planAutoJoin } from '../chunkAudit';

const read = (p: string) => readFileSync(join(__dirname, p), 'utf8');

describe('bug 263 — nhãn chunk nói đúng bệnh', () => {
  const src = '/* 注释说明 */\nconst a = "好感度";\n'.repeat(200);
  it('đã dịch, sót vài chữ ⇒ residual (vá), không phải "chưa dịch" và không bị xoá', () => {
    const out = '/* Chú thích */\nconst a = "Độ hảo cảm";\n'.repeat(199) + '/* 注释 */\nconst a = "Độ hảo cảm";\n';
    const a = auditChunks([src], [out]);
    expect(a.issues[0]).toMatchObject({ kind: 'residual', severity: 'warn', han: 2 });
    expect(a.blockingIndices).toEqual([]);
    expect(a.residualIndices).toEqual([0]);
  });
  it('chép nguyên văn ⇒ untranslated + identical; sót nặng ⇒ untranslated có số', () => {
    const same = auditChunks([src], [src]).issues[0];
    expect(same).toMatchObject({ kind: 'untranslated', identical: true });
    const heavy = auditChunks([src], [src.replace('好感度', 'Độ hảo cảm')]).issues[0];
    expect(heavy.kind).toBe('untranslated');
    expect(heavy.identical).toBeFalsy();
    expect(heavy.han).toBeGreaterThan(0);
  });
});

describe('bug 263 — ký hiệu che không được lọt vào bản ghép', () => {
  // Bộ che đánh số LINK trước, TÊN FILE sau (bước 5) ⇒ trong một ô link luôn mang số nhỏ hơn.
  const raw = "/* 改 卡片脚本/_src/状态栏面板.模板.js 生成 */\n// 见 https://cdn.example.com/a/b/c.js";
  const leaked = "/* Sửa __PROTECTED_URL_4__ tạo ra */\n// xem __PROTECTED_URL_3__";
  it('gỡ theo ô gốc: số hiệu tăng dần ↔ mục che theo thứ tự', () => {
    const fixed = restoreLeakedUrlPlaceholders(leaked, raw);
    expect(fixed).toBe("/* Sửa 卡片脚本/_src/状态栏面板.模板.js tạo ra */\n// xem https://cdn.example.com/a/b/c.js");
  });
  it('số lượng lệch ⇒ trả nguyên, không đoán', () => {
    expect(restoreLeakedUrlPlaceholders('x __PROTECTED_URL_0__', 'không có link')).toBe('x __PROTECTED_URL_0__');
  });
  it('tự ghép khi mở lại phiên cũng gỡ', () => {
    const plan = planAutoJoin([{ path: 'p', label: 'L', original: raw + raw, translated: '', completedChunks: [leaked, leaked], rawChunks: [raw, raw], totalChunks: 2 }]);
    expect(plan[0].joined).not.toContain('__PROTECTED_URL_');
    expect(restoreLeakedCells([leaked, undefined], [raw, raw])[1]).toBeUndefined();
  });
});

describe('bug 263 — nối dây', () => {
  const HOOK = read('../../hooks/useTranslation.ts');
  const API = read('../apiClient.ts');
  const FE = read('../../components/FieldEditor.tsx');
  it('engine lưu ô dịch đã gỡ che (cả lúc xong chunk lẫn lúc lỗi giữa chừng)', () => {
    expect((API.match(/onChunkComplete\(idx, unmaskForStore\(/g) || []).length).toBe(2);
    expect((API.match(/completedForResume\.map\(unmaskForStore\)/g) || []).length).toBe(2);
    expect(API).toContain('soFar.map(unmaskForStore)');
  });
  it('armTargetedCjkResume không tự xoá ô — caller truyền clearChunks (xoá sau khi cầm khoá)', () => {
    const fn = HOOK.slice(HOOK.indexOf('const armTargetedCjkResume = useCallback'));
    expect(fn.slice(0, fn.indexOf('}, [store]);'))).not.toContain('updateField');
    expect(HOOK).toContain('targeted ? { clearChunks: targeted } : undefined');
  });
  it('nút dịch lại chỉ lấy chunk hỏng; chunk sót có nút Vá riêng', () => {
    expect(FE).toContain('clearChunks: [...audit.blockingIndices]');
    expect(FE).not.toContain('clearChunks: [...audit.suspectIndices]');
    expect(FE).toContain('requestResidualPatch(field.path)');
  });
});
