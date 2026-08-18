/**
 * BỐN KHO BIẾN CỦA SILLYTAVERN, VÀ CHUYỆN ĐỌC NHẦM KHO.
 * ─────────────────────────────────────────────────────────────────────────────
 * MVU lưu stat_data ở kho MESSAGE (gắn theo TỪNG tin nhắn — mvuReference.ts). `{{getvar::X}}`,
 * `{{setvar::X}}`, `/setvar` đụng vào kho CHAT — kho khác hẳn.
 *
 * Bug #162 đã bắt đúng chuyện này ở đường GHI. Đường ĐỌC thì chưa: prompt của Game UI Studio còn
 * DẠY dùng `getvar::`, và bộ kiểm tính nó là binding hợp lệ ⇒ widget qua được kiểm rồi vào game
 * render ra rỗng. Thêm nữa macro chỉ được thế MỘT LẦN nên số đứng im, không đồng biến.
 *
 * Kèm theo: tên biến viết TRẦN trong khi schema để nó nằm LỒNG — `mvuGet(d,'Máu')` với schema
 * `/Người Chơi/Máu` trả undefined. Whitelist cố tình lỏng để không báo "bịa biến" oan, nên chỗ
 * này chỉ NHẮC kèm đường dẫn đủ chứ không chặn.
 */
import { describe, it, expect } from 'vitest';
import { validateRegexDraft, collectSchemaVarNames, type DraftScript } from '../gameUiValidator';
import { buildGameUiSystemPrompt } from '../../../prompts/gameUiStudioPrompt';
import type { MVUZODSchema } from '../../../types/mvuzod.types';

function mk(o: Partial<DraftScript>): DraftScript {
  return {
    scriptName: 'test', findRegex: '/<x>([\\s\\S]*?)<\\/x>/s', replaceString: '<div>$1</div>',
    trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false,
    runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null,
    ...o,
  } as DraftScript;
}
const codes = (r: { issues: { code: string }[] }) => r.issues.map((i) => i.code);

const SCHEMA = {
  version: '1.0',
  fields: [{
    path: '/Người Chơi', type: 'object', label: 'Người Chơi', defaultValue: {}, constraints: {},
    children: [{ path: '/Người Chơi/Máu', type: 'number', label: 'Máu', defaultValue: 100, constraints: {} }],
  }],
} as unknown as MVUZODSchema;

describe('WRONG_VAR_STORE — đọc/ghi nhầm kho biến', () => {
  it('{{getvar::Máu}} bị chặn dù TÊN BIẾN hoàn toàn hợp lệ', () => {
    const r = validateRegexDraft(
      [mk({ replaceString: '<div>{{getvar::Máu}}</div>' })],
      '<x>a</x>', ['Máu'],
    );
    expect(codes(r)).toContain('WRONG_VAR_STORE');
    expect(r.issues.find(i => i.code === 'WRONG_VAR_STORE')?.level).toBe('error');
    expect(r.ok).toBe(false);
    // Tên biến đúng nên KHÔNG được báo bịa — hai lỗi khác nhau, đừng lẫn.
    expect(codes(r)).not.toContain('UNKNOWN_VAR');
  });

  it('{{setvar::}} và /setvar cũng bị chặn', () => {
    const r1 = validateRegexDraft([mk({ replaceString: '<div>{{setvar::Máu::5}}</div>' })], '<x>a</x>', ['Máu']);
    const r2 = validateRegexDraft([mk({ replaceString: '<script>/setvar Máu 5</script>' })], '<x>a</x>', ['Máu']);
    expect(codes(r1)).toContain('WRONG_VAR_STORE');
    expect(codes(r2)).toContain('WRONG_VAR_STORE');
  });

  it('lời báo phải chỉ đúng đường thay thế (mvuGet/mvuData), không chỉ nói "sai"', () => {
    const r = validateRegexDraft([mk({ replaceString: '<div>{{getvar::Máu}}</div>' })], '<x>a</x>', ['Máu']);
    const msg = r.issues.find(i => i.code === 'WRONG_VAR_STORE')!.message;
    expect(msg).toContain('mvuGet');
    expect(msg).toContain('mvuData');
  });

  it('thẻ KHÔNG có hệ biến MVU thì không báo oan — kho chat là kho duy nhất nó có', () => {
    const r = validateRegexDraft([mk({ replaceString: '<div>{{getvar::Máu}}</div>' })], '<x>a</x>', []);
    expect(codes(r)).not.toContain('WRONG_VAR_STORE');
  });

  it('bind bằng JS trong iframe thì KHÔNG bị chặn', () => {
    const html = `<div>${'x'.repeat(220)}</div><script>var d = mvuData(); mvuGet(d, 'Người Chơi.Máu', '—');</script>`;
    const r = validateRegexDraft([mk({ replaceString: html })], '<x>a</x>', collectSchemaVarNames(SCHEMA));
    expect(codes(r)).not.toContain('WRONG_VAR_STORE');
    expect(codes(r)).not.toContain('UNKNOWN_VAR');
    expect(r.ok).toBe(true);
  });
});

describe('AMBIGUOUS_VAR — tên trần trong khi biến nằm lồng', () => {
  it('nhắc kèm ĐƯỜNG DẪN ĐỦ, và chỉ là cảnh báo (không chặn)', () => {
    const html = `<div>${'x'.repeat(220)}</div><script>var d = mvuData(); mvuGet(d, 'Máu', '—');</script>`;
    const r = validateRegexDraft([mk({ replaceString: html })], '<x>a</x>', collectSchemaVarNames(SCHEMA));
    const iss = r.issues.find(i => i.code === 'AMBIGUOUS_VAR');
    expect(iss).toBeTruthy();
    expect(iss!.level).toBe('warn');
    expect(iss!.message).toContain('Người Chơi.Máu');
    expect(r.ok).toBe(true);   // vẫn cho qua — whitelist lỏng là có chủ ý, tránh báo bịa oan
  });

  it('biến ở TẦNG GỐC viết trần thì không nhắc gì', () => {
    const flat = { version: '1.0', fields: [
      { path: '/Ngày', type: 'number', label: 'Ngày', defaultValue: 1, constraints: {} },
    ] } as unknown as MVUZODSchema;
    const html = `<div>${'x'.repeat(220)}</div><script>var d = mvuData(); mvuGet(d, 'Ngày', 0);</script>`;
    const r = validateRegexDraft([mk({ replaceString: html })], '<x>a</x>', collectSchemaVarNames(flat));
    expect(codes(r)).not.toContain('AMBIGUOUS_VAR');
  });
});

describe('prompt Game UI Studio không còn dạy đọc nhầm kho', () => {
  const prompt = buildGameUiSystemPrompt(SCHEMA, {}, [], '', null, collectSchemaVarNames(SCHEMA));

  it('dạy đường đúng: mvuData/mvuGet trong <script>', () => {
    expect(prompt).toContain('mvuData()');
    expect(prompt).toContain('mvuGet(');
  });

  it('nói thẳng {{getvar::}} là CẤM, kèm lý do kho biến', () => {
    expect(prompt).toContain('{{getvar::');
    expect(prompt).toMatch(/CẤM[\s\S]{0,400}getvar::/);
    expect(prompt).toContain('WRONG_VAR_STORE');
  });

  it('không còn câu cũ bảo được dùng getvar:: để bind biến', () => {
    expect(prompt).not.toContain('CHỈ được dùng các tên dưới đây trong getvar::');
  });
});
