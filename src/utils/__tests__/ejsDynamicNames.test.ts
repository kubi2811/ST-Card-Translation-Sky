/**
 * (D) Tên entry EJS GHÉP lúc chạy — ca PhatSiz hỏi: `技能体系_执行指令` dịch thành "Hệ Thống Kỹ
 * Năng Thực Thi Chỉ Thị" có ổn không. Ổn nếu code gọi bằng tên viết sẵn; VỠ nếu code ghép tên
 * (`getwi(null, 模块 + '_执行指令')`). Trước đây tool chỉ bắt tên viết sẵn ⇒ ca ghép bị bỏ qua.
 */
import { describe, it, expect } from 'vitest';
import { detectDynamicEjsEntryRefs, applyEjsDynamicLock, getEjsDynamicLock, buildEjsPromptBlock } from '../ejsSync';
import type { CharacterCard } from '../../types/card';

const mk = (code: string, extra: string[] = []): CharacterCard => ({
  data: {
    name: 'x',
    character_book: {
      entries: [
        { comment: '控制器', content: code },
        { comment: '技能体系_执行指令', content: '...' },
        { comment: '历史事件_执行指令', content: '...' },
        { comment: '普通条目', content: '...' },
        ...extra.map(c => ({ comment: c, content: '...' })),
      ],
    },
  },
} as unknown as CharacterCard);

describe('(D) dò tên entry ghép lúc chạy', () => {
  it.each([
    ["<% const r = await getwi(null, 模块 + '_执行指令'); %>"],
    ['<%= await getwi(null, `${当前模块}_执行指令`) %>'],
    ["<% await activewi(null, name + '_执行指令', true) %>"],
    ["<% const list = entries.filter(e => e.comment.endsWith('_执行指令')) %>"],
  ])('%s ⇒ khoá các entry có đuôi _执行指令', (code) => {
    const lock = detectDynamicEjsEntryRefs(mk(code));
    expect(lock.fragments).toContain('_执行指令');
    expect(lock.lockedNames.sort()).toEqual(['历史事件_执行指令', '技能体系_执行指令']);
    expect(lock.examples.length).toBeGreaterThan(0);
  });

  it('gọi bằng tên VIẾT SẴN ⇒ không khoá gì (Chiến lược C đồng bộ được)', () => {
    const lock = detectDynamicEjsEntryRefs(mk("<% await getwi(null, '技能体系_执行指令') %> <% getwi(null, `历史事件_执行指令`) %>"));
    expect(lock.fragments).toEqual([]);
    expect(lock.lockedNames).toEqual([]);
  });

  it('tên lấy hẳn từ biến (không mảnh chữ nào) ⇒ không có gì để khoá, không khoá bừa', () => {
    expect(detectDynamicEjsEntryRefs(mk('<% await getwi(null, entryName) %>')).lockedNames).toEqual([]);
  });
});

describe('(D) áp khoá khi dịch', () => {
  const card = mk("<% getwi(null, 模块 + '_执行指令') %>");
  const lock = detectDynamicEjsEntryRefs(card);

  it('tên entry bị khoá ⇒ trả về bản gốc', () => {
    const r = applyEjsDynamicLock({ path: 'data.character_book.entries[1].comment', original: '技能体系_执行指令' }, 'Hệ Thống Kỹ Năng Thực Thi Chỉ Thị', lock);
    expect(r.text).toBe('技能体系_执行指令');
    expect(r.note?.msg).toMatch(/Giữ nguyên tên entry/);
  });

  it('tên entry không liên quan ⇒ vẫn dịch bình thường', () => {
    const r = applyEjsDynamicLock({ path: 'data.character_book.entries[3].comment', original: '普通条目' }, 'Mục thường', lock);
    expect(r.text).toBe('Mục thường');
    expect(r.note).toBeUndefined();
  });

  it('code mất mảnh ghép sau khi dịch ⇒ cảnh báo', () => {
    const r = applyEjsDynamicLock(
      { path: 'data.character_book.entries[0].content', original: "<% getwi(null, 模块 + '_执行指令') %>", label: 'Bộ điều khiển' },
      "<% getwi(null, 模块 + '_Lệnh Thực Thi') %>", lock);
    expect(r.note?.level).toBe('warning');
    expect(r.note?.msg).toContain('_执行指令');
  });

  it('prompt EJS dặn AI giữ nguyên mảnh + tên bị khoá', () => {
    getEjsDynamicLock(card);
    const block = buildEjsPromptBlock({}, {}, false);
    expect(block).toMatch(/KEEP VERBATIM/);
    expect(block).toContain('"_执行指令"');
    expect(block).toContain('"技能体系_执行指令"');
    getEjsDynamicLock(null);
    expect(buildEjsPromptBlock({}, {}, false)).not.toMatch(/KEEP VERBATIM/);
  });
});
