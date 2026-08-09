/**
 * (bug 218) SYSTEM PROMPT CORE — user hỏi "Trợ Lý A.I có System Prompt Core chưa?".
 * ─────────────────────────────────────────────────────────────────────────────
 * Chưa có: prompt được ghép bằng một template literal nằm giữa hàm gửi tin, trộn sáu nguồn vào
 * một chuỗi — không xem được, không tắt được từng phần, không biết phần nào ăn token, và thứ tự
 * chỉ là tình cờ theo việc ai viết dòng nào trước.
 *
 * Test này khoá bốn thứ: thứ tự có chủ ý, tầng khoá không tắt được, ghép ra đúng chuỗi gửi đi,
 * và thiết lập cũ không được nuốt mất tầng mới thêm ở bản sau.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LAYER_ORDER, LAYER_META, buildLayers, normalizeOrder, composeSystemPrompt,
  estimateTokens, layerStats, type LayerId,
} from '../promptCore';

const base = { core: 'Bạn là Trợ Lý thẻ nhân vật.' };

describe('(bug 218) thứ tự tầng có chủ ý', () => {
  it('lõi đứng đầu, CHỈ THỊ NGƯỜI DÙNG đứng cuối', () => {
    expect(DEFAULT_LAYER_ORDER[0]).toBe('core');
    expect(DEFAULT_LAYER_ORDER[DEFAULT_LAYER_ORDER.length - 1]).toBe('directive');
  });

  it('mọi tầng đều có nhãn và lời giải thích "tắt đi thì mất gì"', () => {
    for (const id of DEFAULT_LAYER_ORDER) {
      expect(LAYER_META[id].label, id).toBeTruthy();
      expect(LAYER_META[id].why.length, id).toBeGreaterThan(20);
    }
  });

  it('giữ thứ tự người dùng đặt', () => {
    const order: LayerId[] = ['directive', 'core'];
    expect(normalizeOrder(order).slice(0, 2)).toEqual(['directive', 'core']);
  });

  it('BỔ SUNG tầng còn thiếu — thiết lập cũ không được nuốt mất tầng mới', () => {
    // Ca thật: người dùng lưu thứ tự từ bản trước, bản sau thêm tầng 'skills' và 'chats'.
    const cu: LayerId[] = ['core', 'persona', 'memory', 'context', 'directive'];
    const ra = normalizeOrder(cu);
    expect(ra).toContain('skills');
    expect(ra).toContain('chats');
    expect(new Set(ra).size).toBe(DEFAULT_LAYER_ORDER.length);
  });

  it('bỏ khoá lạ và khoá trùng', () => {
    const ra = normalizeOrder(['core', 'core', 'khong-co-that' as LayerId]);
    expect(ra.filter((x) => x === 'core')).toHaveLength(1);
    expect(ra).not.toContain('khong-co-that');
  });
});

describe('(bug 218) bật/tắt tầng', () => {
  it('tắt tầng thì nội dung tầng đó không vào prompt', () => {
    const layers = buildLayers({ ...base, memory: 'KÝ ỨC ĐÂY', disabled: ['memory'] });
    expect(composeSystemPrompt(layers)).not.toContain('KÝ ỨC ĐÂY');
  });

  it('tầng LÕI không tắt được, kể cả khi thiết lập cũ ghi nó vào danh sách tắt', () => {
    const layers = buildLayers({ ...base, disabled: ['core'] });
    expect(layers.find((l) => l.id === 'core')!.enabled).toBe(true);
    expect(composeSystemPrompt(layers)).toContain('Bạn là Trợ Lý thẻ nhân vật.');
  });

  it('tầng rỗng thì không để lại dòng trống trong prompt', () => {
    const s = composeSystemPrompt(buildLayers({ ...base, persona: '', memory: '   ' }));
    expect(s).toBe('Bạn là Trợ Lý thẻ nhân vật.');
    expect(s).not.toMatch(/\n\n\n/);
  });
});

describe('(bug 218) khung bọc giữ nguyên câu chữ đã dùng — không đổi hành vi', () => {
  it('Prompt Chỉ Thị vẫn có khung TUÂN THỦ TUYỆT ĐỐI và nằm CUỐI', () => {
    const s = composeSystemPrompt(buildLayers({ ...base, memory: 'ký ức', directive: 'Luôn trả lời ngắn' }));
    expect(s).toContain('TUÂN THỦ TUYỆT ĐỐI');
    expect(s.indexOf('Luôn trả lời ngắn')).toBeGreaterThan(s.indexOf('ký ức'));
    expect(s.trimEnd().endsWith('Luôn trả lời ngắn')).toBe(true);
  });

  it('cờ R18 ra đúng câu cũ, và không bật thì không có dòng nào', () => {
    expect(composeSystemPrompt(buildLayers({ ...base, nsfw: true }))).toContain('R18/NSFW');
    expect(composeSystemPrompt(buildLayers({ ...base, nsfw: false }))).not.toContain('R18');
  });

  it('tài liệu ngữ cảnh giữ đúng nhãn cũ', () => {
    expect(composeSystemPrompt(buildLayers({ ...base, context: 'file A' })))
      .toContain('[DANH SÁCH TÀI LIỆU NGỮ CẢNH HIỆN TẠI]');
  });

  it('chỉ thị rỗng thì KHÔNG chèn khung rỗng', () => {
    expect(composeSystemPrompt(buildLayers({ ...base, directive: '   ' }))).not.toContain('TUÂN THỦ');
  });
});

describe('(bug 218) đếm token để biết tầng nào ăn chỗ', () => {
  it('tiếng Việt tốn token hơn tiếng Anh cùng độ dài', () => {
    const anh = 'a'.repeat(100);
    const viet = 'ữ'.repeat(100);
    expect(estimateTokens(viet)).toBeGreaterThan(estimateTokens(anh));
  });

  it('chuỗi rỗng ⇒ 0, không chia cho 0', () => {
    expect(estimateTokens('')).toBe(0);
    expect(layerStats([]).totalTokens).toBe(0);
  });

  it('tầng đã tắt KHÔNG tính vào tổng — nếu không thì bảng vô nghĩa', () => {
    const layers = buildLayers({ ...base, memory: 'x'.repeat(400), disabled: ['memory'] });
    const { rows, totalChars } = layerStats(layers);
    expect(rows.find((r) => r.id === 'memory')!.chars).toBe(0);
    expect(totalChars).toBe(base.core.length);
  });

  it('phần trăm cộng lại xấp xỉ 100 khi có nội dung', () => {
    const layers = buildLayers({ core: 'a'.repeat(200), memory: 'b'.repeat(200), directive: 'c'.repeat(200) });
    const { rows } = layerStats(layers);
    const tong = rows.reduce((n, r) => n + r.percent, 0);
    expect(Math.abs(tong - 100)).toBeLessThanOrEqual(2);
  });

  it('đánh dấu tầng RỖNG để panel nói "lượt này không có gì" thay vì im lặng', () => {
    const rows = layerStats(buildLayers(base)).rows;
    expect(rows.find((r) => r.id === 'chats')!.empty).toBe(true);
    expect(rows.find((r) => r.id === 'core')!.empty).toBe(false);
  });
});

describe('(bug 218) panel và hàm gửi tin phải dùng CHUNG một phép ghép', () => {
  it('composeSystemPrompt là hàm thuần — cùng input ra cùng chuỗi', () => {
    const inp = { ...base, skills: 'kỹ năng', memory: 'ký ức', chats: 'chat cũ', directive: 'chỉ thị' };
    expect(composeSystemPrompt(buildLayers(inp))).toBe(composeSystemPrompt(buildLayers(inp)));
  });

  it('đủ tám tầng có nội dung thì đều xuất hiện, đúng thứ tự đã khai', () => {
    const s = composeSystemPrompt(buildLayers({
      core: 'LOI', persona: 'VAI', nsfw: true, skills: 'KYNANG',
      memory: 'KYUC', chats: 'CHATCU', context: 'TAILIEU', directive: 'CHITHI',
    }));
    const vt = ['LOI', 'VAI', 'R18', 'KYNANG', 'KYUC', 'CHATCU', 'TAILIEU', 'CHITHI'].map((k) => s.indexOf(k));
    expect(vt.every((i) => i >= 0)).toBe(true);
    expect([...vt].sort((a, b) => a - b)).toEqual(vt);
  });
});
