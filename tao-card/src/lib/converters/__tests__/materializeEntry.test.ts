// materializeEntry — CỔNG RA CHUNG của gần như mọi đường sinh lorebook (Auto Creator, AI Sinh
// Batch, Cào wiki, Minh Nguyệt, agentLoop, lorebookRefiner, documentChunker, systemEntries,
// cardTemplates). Trước đây KHÔNG có test nào, dù nó là chỗ quyết định toàn bộ cơ học entry.
//
// Trọng tâm: AI KHÔNG được đè lên preset ở những trường phụ thuộc CẤU TRÚC THẺ. Prompt xưa nay
// vẫn ghi "CẤU HÌNH BẮT BUỘC: constant=true, selective=false" rồi tin AI làm đúng — nhờ vả chứ
// không phải ép. Test này khoá phần ép lại.
import { describe, it, expect } from 'vitest';
import { materializeEntry } from '../cardDefaults';
import { lockedFieldsOf } from '../../worldbook/worldbookConfig';
import type { AIGeneratedEntry } from '../../../types/aiAgent.types';

const ai = (over: Partial<AIGeneratedEntry> = {}): AIGeneratedEntry => ({
  comment: 'Thử',
  content: 'nội dung',
  keys: ['a'],
  ...over,
} as AIGeneratedEntry);

describe('materializeEntry — chống đệ quy là bắt buộc 100%', () => {
  it('luôn bật prevent_recursion + exclude_recursion, kể cả khi không có category', () => {
    const e = materializeEntry(ai(), {}, 1);
    expect(e.extensions.prevent_recursion).toBe(true);
    expect(e.extensions.exclude_recursion).toBe(true);
  });
});

describe('materializeEntry — AI không được đè preset ở trường bị khoá', () => {
  it('thẻ ĐƠN: AI đòi constant=false vẫn phải ra true (quy luật thép)', () => {
    const e = materializeEntry(
      ai({ constant: false, selective: true }),
      { category: 'character_detail', cardType: 'single' },
      1,
    );
    expect(e.constant, 'preset thẻ đơn phải thắng').toBe(true);
    expect(e.selective).toBe(false);
  });

  it('thẻ NHIỀU NV: cùng category đó lại phải ra false — giá trị đúng tuỳ CẤU TRÚC THẺ', () => {
    const e = materializeEntry(
      ai({ constant: true, selective: false }),
      { category: 'character_detail', cardType: 'multi' },
      1,
    );
    expect(e.constant, 'thẻ nhiều nhân vật phải kích hoạt theo từ khoá').toBe(false);
    expect(e.selective).toBe(true);
  });

  it('D0: AI đổi depth/role thì entry hết là D0 — phải giữ nguyên định nghĩa', () => {
    const e = materializeEntry(
      ai({ depth: 9, role: 2, position: 1 }),
      { category: 'secondary_explanation', cardType: 'single' },
      1,
    );
    expect(e.extensions.depth, 'D0 phải ở depth 0').toBe(0);
    expect(e.extensions.role, 'D0 phải là system').toBe(0);
    expect(e.extensions.position).toBe(4);
  });
});

describe('materializeEntry — khoá chỉ chặn AI, KHÔNG chặn người dùng', () => {
  it('config của user vẫn đè được lên preset ở trường bị khoá', () => {
    const e = materializeEntry(
      ai({ depth: 9 }),
      { category: 'secondary_explanation', cardType: 'single', defaultDepth: 3 },
      1,
    );
    expect(e.extensions.depth, 'user chọn 3 thì phải là 3, không phải 9 của AI').toBe(3);
  });
});

describe('materializeEntry — trường tự do vẫn để AI quyết', () => {
  it('insertion_order của AI được tôn trọng', () => {
    const e = materializeEntry(ai({ insertion_order: 42 }), { category: 'npc', cardType: 'single' }, 1);
    expect(e.insertion_order).toBe(42);
  });

  it('category "custom" = user tự cầm lái, không khoá gì', () => {
    expect(lockedFieldsOf('custom')).toEqual([]);
    const e = materializeEntry(ai({ constant: true }), { category: 'custom' }, 1);
    expect(e.constant).toBe(true);
  });
});

// Đường sinh entry có TAXONOMY RIÊNG (storyDeepScan bám chuẩn worldbook Group 1-5 của user)
// vẫn phải đi qua đây để hưởng phần ống nước chung — nhưng không bị ép vào bảng phân loại của
// worldbookConfig, vì hai bảng phân loại đó phục vụ hai mục đích khác nhau.
describe('materializeEntry — placement: caller tự quyết cơ học', () => {
  const PL = {
    constant: true, selective: false, position: 4 as const, depth: 0,
    role: 0 as const, insertion_order: 900, scan_depth: null,
  };

  it('placement thắng cả preset lẫn AI', () => {
    const e = materializeEntry(
      ai({ constant: false, depth: 7, insertion_order: 5 }),
      { category: 'npc', cardType: 'single', placement: PL },
      1,
    );
    expect(e.constant).toBe(true);
    expect(e.extensions.depth).toBe(0);
    expect(e.extensions.role).toBe(0);
    expect(e.insertion_order).toBe(900);
  });

  it('positionName cho caller giữ nguyên chuỗi V3 của mình (@depth → before_char)', () => {
    // storyDeepScan xưa nay ghi 'before_char' cho entry @depth. Suy ngầm từ position số sẽ ra
    // 'after_char' — đổi ngầm như vậy là hồi quy im lặng, nên phải cho caller nói rõ.
    const derived = materializeEntry(ai(), { placement: PL }, 1);
    expect(derived.position, 'không khai thì suy như cũ').toBe('after_char');
    const explicit = materializeEntry(ai(), { placement: { ...PL, positionName: 'before_char' } }, 1);
    expect(explicit.position).toBe('before_char');
  });

  it('vẫn hưởng ống nước chung: chống đệ quy + cờ disable + display_index', () => {
    const e = materializeEntry(ai(), { placement: PL, enabled: false }, 7);
    expect(e.extensions.prevent_recursion).toBe(true);
    expect(e.extensions.exclude_recursion).toBe(true);
    expect(e.disable).toBe(true);
    expect(e.extensions.display_index).toBe(7);
  });

  it('useRegex=false được tôn trọng (keys là chuỗi thường, không phải regex)', () => {
    expect(materializeEntry(ai(), { placement: PL, useRegex: false }, 1).use_regex).toBe(false);
    expect(materializeEntry(ai(), { placement: PL }, 1).use_regex, 'mặc định vẫn true').toBe(true);
  });
});

describe('materializeEntry — cờ disable đi cùng enabled', () => {
  it('enabled=false thì disable=true (ST đọc cờ disable khi nhúng trong card)', () => {
    const e = materializeEntry(ai(), { enabled: false }, 1);
    expect(e.enabled).toBe(false);
    expect(e.disable).toBe(true);
  });
});
