/**
 * (bug 255 — PhatSiz) Script tavernHelper "生理周期调度" dịch xong vỡ cú pháp JS, dịch lại cũng không
 * cứu được:
 *   1. từ điển MVU thay key 来源 NẰM GIỮA key khác 基准来源 ⇒ `{ 基准Nguồn Gốc: … }` (khoá có dấu cách);
 *   2. mục từ điển học lệch `user` → "Tỷ Lệ Mang Thai" ⇒ HERO_ALIASES mất 'user'/'User'/'USER';
 *   3. chốt "dịch lại không được tệ hơn" giữ lại bản đang có dù bản đó VỠ CÚ PHÁP.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { applyMvuToText, isRenamedAsciiKey } from '../mvuSync';
import { jsParseErrorAny } from '../scriptSafety';
import { repairUnquotedObjectKeys } from '../repairObjectKeys';
import { judgeRetryResult } from '../retryRegression';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', n), 'utf8');
const RAW = fx('bug255-cycle.raw.js.txt');
const BROKEN = fx('bug255-cycle.broken.js.txt');

const DICT: Record<string, string> = {
  '来源': 'Nguồn Gốc', '日期': 'Ngày', '事件': 'Sự Kiện', '时间': 'Thời Gian', '确诊': 'Xác Chẩn',
  'user': 'Tỷ Lệ Mang Thai', '周期': 'Chu Kỳ', '周期长度': 'Độ Dài Chu Kỳ', '私密档案': 'Hồ Sơ Riêng Tư',
  '角色': 'Nhân Vật', '全局': 'Toàn Cục',
};

describe('bug 255 — key tiếng Trung chỉ thay khi đứng riêng, không thay giữa từ khác', () => {
  it('file thật: không còn chữ Việt dính chữ Hán, script vẫn chạy', () => {
    const out = repairUnquotedObjectKeys(applyMvuToText(RAW, DICT, true)).code;
    expect(jsParseErrorAny(out)).toBeNull();
    expect(out).not.toMatch(/基准Nguồn Gốc/);
    expect(out).toContain('基准来源: resolved.source');
    expect(out).not.toMatch(/[一-鿿](?:Nguồn Gốc|Ngày|Sự Kiện|Thời Gian|Xác Chẩn|Chu Kỳ)|(?:Nguồn Gốc|Ngày|Sự Kiện|Thời Gian|Xác Chẩn|Chu Kỳ)[一-鿿]/);
    // key đứng riêng vẫn được thay như cũ
    expect(out).toContain("stat['Ngày']");
    expect(out).toContain("rec['Độ Dài Chu Kỳ']");
  });

  it('dot-access không cắt giữa key dài hơn: rec.周期第几天 không thành rec[\'Chu Kỳ\']第几天', () => {
    const out = applyMvuToText('rec.周期第几天 = rec.周期 + 1;', { '周期': 'Chu Kỳ' }, true);
    expect(out).toContain('rec.周期第几天');
    expect(out).toContain("rec['Chu Kỳ'] + 1");
  });

  it('key ASCII không bao giờ bị đổi tên', () => {
    const out = applyMvuToText("const A = ['主角', 'user', 'User', 'USER'];", { user: 'Tỷ Lệ Mang Thai' }, true);
    expect(out).toContain("'user', 'User', 'USER'");
    expect(isRenamedAsciiKey('user', 'Tỷ Lệ Mang Thai')).toBe(true);
    expect(isRenamedAsciiKey('stat_data', 'stat_data')).toBe(false);
    expect(isRenamedAsciiKey('好感度', 'Độ Hảo Cảm')).toBe(false);
  });
});

describe('bug 255 — dịch lại: bản đang có VỠ CÚ PHÁP thì không được giữ', () => {
  it('bản cũ vỡ JS (ít Hán hơn) vs bản gốc chạy được ⇒ nhận bản gốc', () => {
    expect(jsParseErrorAny(BROKEN)).not.toBeNull();
    const v = judgeRetryResult({ original: RAW, previous: BROKEN, next: RAW });
    expect(v.worse).toBe(false);
  });
  it('bản cũ chạy được, bản mới vỡ JS ⇒ giữ bản cũ', () => {
    const good = applyMvuToText(RAW, { '日期': 'Ngày' }, true);
    expect(jsParseErrorAny(good)).toBeNull();
    const v = judgeRetryResult({ original: RAW, previous: good, next: BROKEN });
    expect(v.worse).toBe(true);
  });
});
