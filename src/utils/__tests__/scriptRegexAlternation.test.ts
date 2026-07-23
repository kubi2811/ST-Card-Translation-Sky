// (User 23/07) Regex trong SCRIPT khớp NHÃN tiếng Trung mà chính script đó render ra.
//
// Đây là kiểu hỏng khó thấy nhất: dịch xong thẻ vẫn mở được, script vẫn chạy, không một dòng
// lỗi nào — chỉ có một mảng chức năng lặng lẽ biến mất vì regex không còn khớp gì.
//
// Ca thật lấy từ card Mythic (bugNeedFix/94): `/(小总结|大总结)\s*#\s*(\d+)/g` dùng để dựng
// "memory chip", mà `小总结` cũng là nhãn hiển thị, xuất hiện 36 lần trong script.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyRegexAlternation } from '../../scriptTranslate/regexAlternation';

const DICT = { 小总结: 'Tiểu Tổng Kết', 大总结: 'Đại Tổng Kết' };

describe('vá regex khớp nhãn tiếng Trung trong script thẻ', () => {
  it('KHÔNG vá thì memory chip chết im lặng — đây là hiện trường', () => {
    const re = /(小总结|大总结)\s*#\s*(\d+)/g;
    expect('小总结 #12'.match(re)).not.toBeNull();
    // Sau khi dịch nhãn, chuỗi mà model/script sinh ra là tiếng Việt:
    expect('Tiểu Tổng Kết #12'.match(/(小总结|大总结)\s*#\s*(\d+)/g)).toBeNull();
  });

  it('vá xong: khớp CẢ bản dịch lẫn bản gốc (dữ liệu cũ vẫn chạy)', () => {
    const code = 'const RECALL_RE = /(小总结|大总结)\\s*#\\s*(\\d+)/g;';
    const r = applyRegexAlternation(code, DICT);
    expect(r.changed).toBe(1);
    expect(r.reverted).toBe(0);

    const body = /\/(.+)\/g;$/.exec(r.code)![1];
    const patched = new RegExp(body, 'g');
    expect('Tiểu Tổng Kết #12'.match(patched)).not.toBeNull();
    patched.lastIndex = 0;
    expect('小总结 #12'.match(patched)).not.toBeNull();
  });

  it('chạy lại lần hai không nhân bản nhánh (idempotent)', () => {
    const code = 'const RE = /(小总结|大总结)\\s*#\\s*(\\d+)/g;';
    const once = applyRegexAlternation(code, DICT).code;
    const twice = applyRegexAlternation(once, DICT);
    expect(twice.code).toBe(once);
    expect(twice.changed).toBe(0);
  });

  it('không có gì trong từ điển → không đụng tới code', () => {
    const code = 'const RE = /(小总结)/g;';
    expect(applyRegexAlternation(code, {}).code).toBe(code);
  });
});

// ── Trên chính script của card thật ────────────────────────────────────────────
const CARD = fileURLToPath(new URL('../../../bugNeedFix/94/reborn_card.json', import.meta.url));
const hasFixture = fs.existsSync(CARD);

describe.skipIf(!hasFixture)('trên script THẬT của card Mythic', () => {
  const card = hasFixture ? JSON.parse(fs.readFileSync(CARD, 'utf8')) : null;
  const scripts: { name?: string; content?: string }[] =
    card?.data?.extensions?.TavernHelper_scripts ?? card?.data?.extensions?.tavern_helper?.scripts ?? [];

  it('card có script chứa nhãn 小总结 — đúng điều kiện gây lỗi', () => {
    const total = scripts.reduce((n, s) => n + (String(s?.content ?? '').split('小总结').length - 1), 0);
    expect(total).toBeGreaterThan(10);
  });

  it('vá toàn bộ script: mọi regex sửa xong đều biên dịch được, 0 literal phải hoàn nguyên', () => {
    let changed = 0, reverted = 0;
    for (const s of scripts) {
      const r = applyRegexAlternation(String(s?.content ?? ''), DICT);
      changed += r.changed;
      reverted += r.reverted;
    }
    expect(changed).toBeGreaterThan(0);
    expect(reverted).toBe(0);
  });
});
