/**
 * (bugNeedFix/185) Đũa thần 3 chế độ + hồ sơ học theo người dùng.
 * ─────────────────────────────────────────────────────────────────────────────
 * Ba luật user đặt ra, mỗi luật một cụm test:
 *   1. ba chế độ tồn tại và prompt của mỗi chế độ nói đúng việc của nó;
 *   2. "Luôn phân biệt rõ ý tưởng gốc và nội dung AI đề xuất bổ sung" — hai chế độ sinh thêm
 *      phải bắt AI đánh dấu ✚, và chốt 1-1 vẫn canh ý gốc (thêm được, rơi thì không);
 *   3. "AI phải thích nghi theo thời gian sử dụng" — wandMemory ghi dấu vết cấu trúc và đúc
 *      được hồ sơ, KHÔNG lưu nguyên văn ý tưởng.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  WAND_MODES, buildWandMessages, buildIdeaPolishMessages, verifyIdeaPolish,
} from '../ideaPolish';
import {
  extractSections, guessGenre, recordWandRun, loadWandMemory, buildWandStyleContext,
} from '../wandMemory';

// wandMemory dùng localStorage — test chạy Node nên shim tối thiểu.
beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
});

describe('3 chế độ đũa thần', () => {
  it('đúng 3 lựa chọn theo yêu cầu user, polish đứng đầu (chế độ có từ trước)', () => {
    expect(WAND_MODES.map(m => m.id)).toEqual(['polish', 'world', 'enrich']);
    expect(WAND_MODES[0].label).toContain('Sắp xếp');
    expect(WAND_MODES[1].label).toContain('Thế giới');
    expect(WAND_MODES[2].label).toContain('Làm giàu');
  });

  it('polish giữ lối cũ: cấm thêm nội dung', () => {
    const sys = buildWandMessages('polish', 'x')[0].content;
    expect(sys).toContain('KHÔNG thêm chi tiết mới');
  });

  it('world: tự xác định mảng thiếu, không biến đổi bản chất thế giới', () => {
    const sys = buildWandMessages('world', 'x')[0].content;
    expect(sys).toContain('TỰ XÁC ĐỊNH');
    expect(sys).toContain('Không biến đổi bản chất thế giới');
    expect(sys).toContain('KHÔNG mâu thuẫn');
  });

  it('enrich: đào sâu phần sơ sài, phần đủ thì không thêm thừa, không lệch hướng', () => {
    const sys = buildWandMessages('enrich', 'x')[0].content;
    expect(sys).toContain('TỰ NHẬN DIỆN');
    expect(sys).toContain('KHÔNG thêm thừa');
    expect(sys).toContain('không lái ý tưởng');
  });

  it('mọi chế độ: thích nghi theo nội dung, KHÔNG áp template cố định + cùng khuôn JSON', () => {
    for (const m of WAND_MODES) {
      const sys = buildWandMessages(m.id, 'x')[0].content;
      expect(sys, m.id).toContain('KHÔNG áp một template cố định');
      expect(sys, m.id).toContain('"polishedIdea"');
    }
  });

  it('hai chế độ sinh thêm bắt buộc đánh dấu ✚ phần AI tự thêm', () => {
    for (const mode of ['world', 'enrich'] as const) {
      expect(buildWandMessages(mode, 'x')[0].content, mode).toContain('"✚ "');
    }
  });

  it('hồ sơ người dùng đi vào messages TRƯỚC ý tưởng, và chỉ khi có', () => {
    const withCtx = buildWandMessages('world', 'ý tưởng', { styleContext: 'HỒ SƠ NGƯỜI DÙNG: abc' });
    expect(withCtx).toHaveLength(3);
    expect(withCtx[1].content).toContain('HỒ SƠ NGƯỜI DÙNG');
    expect(withCtx[2].content).toContain('ý tưởng');
    expect(buildWandMessages('world', 'ý tưởng')).toHaveLength(2);
  });

  it('buildIdeaPolishMessages (tên cũ, bug 137/145) vẫn là chế độ polish', () => {
    const msgs = buildIdeaPolishMessages('x', ['Lâm Uyển']);
    expect(msgs[0].content).toContain('biên tập viên cấu trúc');
    expect(msgs.at(-1)!.content).toContain('Lâm Uyển');
  });
});

describe('chốt 1-1 dùng chung: THÊM thì được, LÀM RƠI thì không', () => {
  const ORIG = 'Lâm Uyển tu luyện ở Thiên Nam, có 3 tông môn lớn.';

  it('bản phác thảo thêm nội dung mới (kèm ✚) vẫn qua chốt', () => {
    const out = `## Nhân vật\n- Lâm Uyển tu luyện ở Thiên Nam, có 3 tông môn lớn.\n## Phe phái\n✚ Ma Đạo Liên Minh ẩn mình phía tây.`;
    expect(verifyIdeaPolish(ORIG, out).ok).toBe(true);
  });

  it('làm rơi tên riêng gốc thì bị từ chối, dù có thêm bao nhiêu thứ hay ho', () => {
    const out = `## Thế giới\n✚ Đại lục rộng lớn với 5 vương quốc.\n- có 3 tông môn lớn ở Thiên Nam.`;
    const r = verifyIdeaPolish(ORIG, out);
    expect(r.ok).toBe(false);
    expect(r.dropped).toContain('Lâm Uyển');
  });
});

describe('wandMemory — thích nghi theo thời gian dùng', () => {
  it('extractSections bóc "## …" và bỏ dấu ✚', () => {
    expect(extractSections('## Nhân vật\nx\n## ✚ Phe phái\ny')).toEqual(['Nhân vật', 'Phe phái']);
  });

  it('guessGenre nhận tu tiên / fantasy / sci-fi, không đoán bừa', () => {
    expect(guessGenre('tông môn linh khí cảnh giới')).toContain('tu tiên');
    expect(guessGenre('hiệp sĩ và ma pháp, guild mạo hiểm giả')).toContain('fantasy');
    expect(guessGenre('một câu chuyện tình cảm nhẹ nhàng')).toBeNull();
  });

  it('record 2 lần cùng cấu trúc ⇒ hồ sơ nêu thói quen; KHÔNG chứa nguyên văn ý tưởng', () => {
    const idea = 'Lâm Uyển tu luyện, linh khí tông môn dồi dào, bí mật XYZZY.';
    const out = '## Nhân vật chính\n- a\n## Hệ thống sức mạnh\n- b';
    recordWandRun('polish', idea, out);
    recordWandRun('world', idea, out);
    const ctx = buildWandStyleContext();
    expect(ctx).toContain('Nhân vật chính');
    expect(ctx).toContain('tu tiên');
    expect(ctx).toContain('không phải khuôn ép');
    expect(ctx).not.toContain('XYZZY');           // tuyệt đối không rò nội dung
    expect(JSON.stringify(loadWandMemory())).not.toContain('XYZZY');
  });

  it('chưa đủ lặp lại (mỗi tiêu đề 1 lần, không đoán được thể loại) ⇒ KHÔNG bịa hồ sơ', () => {
    recordWandRun('polish', 'một ý tưởng chung chung', '## A\n- x');
    expect(buildWandStyleContext()).toBe('');
  });

  it('trí nhớ có trần — không phình vô hạn', () => {
    for (let i = 0; i < 30; i++) recordWandRun('polish', 'ý ' + i, `## P${i}\n- x`);
    expect(loadWandMemory().runs.length).toBeLessThanOrEqual(12);
  });
});
