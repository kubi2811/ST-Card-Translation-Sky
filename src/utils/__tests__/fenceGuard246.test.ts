// Bug 246 (gogopikachu) — dịch regex có ``` thì AI hay bỏ mất ``` ⇒ regex hỏng trong SillyTavern,
// mà mọi bộ kiểm của tool vẫn báo sạch. Khoá lại: (1) dấu bị rơi được đặt về đúng chỗ, (2) không
// bao giờ bọc thêm lớp thừa, (3) bộ kiểm sức khoẻ thẻ báo được chiều THIẾU.
import { describe, it, expect } from 'vitest';
import { restoreDroppedFences, countFenceLines } from '../fenceGuard';
import { cleanTranslationResponse } from '../apiClient';
import { scanFieldsHealth } from '../cardHealth';
import type { TranslationField } from '../../types/card';

const ORIG = [
  '<状态栏>',
  '```html',
  '<div class="bar">生命: $1</div>',
  '```',
  '<结尾>',
].join('\n');

describe('restoreDroppedFences', () => {
  it('AI làm rơi cả hai dấu giữa field (có chữ trước/sau) ⇒ đặt lại đúng dòng', () => {
    const trans = ['<Thanh trạng thái>', '<div class="bar">Sinh mệnh: $1</div>', '<Kết thúc>'].join('\n');
    const r = restoreDroppedFences(ORIG, trans);
    expect(r.text).toBe(['<Thanh trạng thái>', '```html', '<div class="bar">Sinh mệnh: $1</div>', '```', '<Kết thúc>'].join('\n'));
    expect(r.restored).toBe(2);
    expect(r.stillMissing).toBe(0);
  });

  it('chỉ rơi dấu ĐÓNG ⇒ không bọc thêm lớp mở thứ hai', () => {
    const orig = '```html\n<div>你好</div>\n```';
    const trans = '```html\n<div>Xin chào</div>';
    const cleaned = cleanTranslationResponse(orig, trans);
    expect(cleaned).toBe('```html\n<div>Xin chào</div>\n```');
    expect(countFenceLines(cleaned)).toBe(2);
  });

  it('rơi cả hai dấu của khối bọc trọn ⇒ bọc lại như cũ', () => {
    const orig = '```html\n<div>你好</div>\n```';
    const cleaned = cleanTranslationResponse(orig, '<div>Xin chào</div>');
    expect(cleaned).toBe('```html\n<div>Xin chào</div>\n```');
  });

  it('số dòng đổi ⇒ vẫn vá được hai đầu', () => {
    const orig = '```html\n<div>\n你好\n</div>\n```';
    const trans = '<div>Xin chào</div>';
    const r = restoreDroppedFences(orig, trans);
    expect(r.text).toBe('```html\n<div>Xin chào</div>\n```');
    expect(r.stillMissing).toBe(0);
  });

  it('bản dịch đủ hàng rào ⇒ không đụng', () => {
    const trans = ORIG.replace('生命', 'Sinh mệnh');
    expect(restoreDroppedFences(ORIG, trans).text).toBe(trans);
  });

  it('gốc không có hàng rào ⇒ không thêm gì', () => {
    expect(restoreDroppedFences('<div>你好</div>', '<div>Xin chào</div>').text).toBe('<div>Xin chào</div>');
  });
});

describe('bug 246 — bộ kiểm sức khoẻ thẻ bắt được ``` bị mất', () => {
  const field = (translated: string): TranslationField => ({
    path: 'data.extensions.regex_scripts[0].replaceString',
    label: 'Regex #0 replaceString',
    group: 'regex',
    original: ORIG,
    translated,
    status: 'done',
  } as TranslationField);

  it('mất ``` ⇒ lỗi mức error, chặn xuất', () => {
    const rep = scanFieldsHealth([field('<Thanh trạng thái>\n<div class="bar">Sinh mệnh: $1</div>\n<Kết thúc>')]);
    expect(rep.counts.lostFences).toBe(2);
    expect(rep.issues.some(i => i.kind === 'fence_lost' && i.severity === 'error')).toBe(true);
    expect(rep.ok).toBe(false);
  });

  it('đủ ``` ⇒ không báo', () => {
    const rep = scanFieldsHealth([field(ORIG.replace('生命', 'Sinh mệnh'))]);
    expect(rep.counts.lostFences).toBe(0);
  });
});
