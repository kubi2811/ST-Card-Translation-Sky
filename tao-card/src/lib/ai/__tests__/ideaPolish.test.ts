// (bug 137) Cây đũa thần — chốt chặn 1-1: chỉ đổi trình bày, KHÔNG đổi ý. Phần đo được bằng
// máy là TÊN RIÊNG + CON SỐ: bản polish làm rơi cái nào là bị từ chối, giữ nguyên văn user.
import { describe, it, expect } from 'vitest';
import {
  extractAnchorTokens, verifyIdeaPolish, parseIdeaPolishResponse,
  buildIdeaPolishMessages, POLISHED_IDEA_READING_HINT,
} from '../ideaPolish';
import { buildBasicInfoPrompt } from '../autoCreatorPrompts';

const MESSY =
  'tạo card về Lâm Thiên Vũ tu tiên ở Thanh Vân Môn, hệ cảnh giới Luyện Khí rồi Trúc Cơ rồi Kim Đan, '
  + 'khởi đầu 16 tuổi có 100 linh thạch, sư phụ là Bạch Vân Tử, giọng văn kiếm hiệp cổ trang, '
  + 'cấm harem, thế giới có Ma Tộc ở phía bắc';

describe('(bug 137) extractAnchorTokens — phần "1-1" đo được', () => {
  it('bắt tên riêng nhiều từ + con số', () => {
    const t = extractAnchorTokens(MESSY);
    expect(t).toEqual(expect.arrayContaining(['Lâm Thiên Vũ', 'Thanh Vân Môn', 'Bạch Vân Tử', 'Ma Tộc', '16', '100']));
  });
});

describe('(bug 137) verifyIdeaPolish — rơi chi tiết là từ chối', () => {
  it('bản polish giữ đủ tên + số → OK (kể cả đổi thứ tự, thêm tiêu đề ##)', () => {
    const polished = [
      '## Nhân vật chính', '- Lâm Thiên Vũ, 16 tuổi, khởi đầu 100 linh thạch', '- Sư phụ: Bạch Vân Tử',
      '## Thế giới & bối cảnh', '- Thanh Vân Môn; Ma Tộc ở phía bắc',
      '## Hệ thống sức mạnh/chỉ số', '- Cảnh giới: Luyện Khí → Trúc Cơ → Kim Đan',
      '## Phong cách & giọng văn', '- Kiếm hiệp cổ trang; cấm harem',
    ].join('\n');
    expect(verifyIdeaPolish(MESSY, polished).ok).toBe(true);
  });

  it('bản polish làm RƠI sư phụ Bạch Vân Tử → từ chối, nêu đích danh token rơi', () => {
    const polished = '## Nhân vật chính\n- Lâm Thiên Vũ, 16 tuổi, 100 linh thạch ở Thanh Vân Môn\n- Ma Tộc, Luyện Khí, Trúc Cơ, Kim Đan';
    const r = verifyIdeaPolish(MESSY, polished);
    expect(r.ok).toBe(false);
    expect(r.dropped).toContain('Bạch Vân Tử');
  });

  it('đổi con số (100 → 1000) cũng là rơi token gốc → từ chối', () => {
    const polished = MESSY.replace('100 linh thạch', '1000 linh thạch');
    const r = verifyIdeaPolish(MESSY, polished);
    expect(r.ok).toBe(false);
    expect(r.dropped).toContain('100');
  });
});

describe('(bug 137) parse + prompt', () => {
  it('parse JSON chuẩn + chặn thiếu polishedIdea', () => {
    const ok = parseIdeaPolishResponse('```json\n{"polishedIdea":"## A\\n- x","suggestedRules":["- quy tắc 1"]}\n```');
    expect(ok.polishedIdea).toContain('## A');
    expect(ok.suggestedRules).toHaveLength(1);
    expect(() => parseIdeaPolishResponse('{"suggestedRules":[]}')).toThrow();
  });

  it('system prompt nêu đúng luật 1-1 (không thêm, không bớt, không đổi ý)', () => {
    const sys = buildIdeaPolishMessages(MESSY)[0].content;
    expect(sys).toContain('KHÔNG thêm chi tiết mới');
    expect(sys).toContain('1-1');
    expect(sys).toContain('suggestedRules');
  });

  it('ý tưởng có cấu trúc "## " → mọi prompt Auto Creator kèm chỉ dẫn đọc; văn xuôi thì không', () => {
    const cfg = { language: 'vi', includePersonality: true, includeScenario: true } as never;
    const structured = buildBasicInfoPrompt('## Nhân vật chính\n- Lâm Thiên Vũ', cfg, null);
    expect(structured).toContain(POLISHED_IDEA_READING_HINT.trim().slice(0, 30));
    const plain = buildBasicInfoPrompt('tạo card tu tiên bình thường', cfg, null);
    expect(plain).not.toContain('LƯU Ý ĐỌC Ý TƯỞNG');
  });
});
