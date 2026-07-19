// Khoá hành vi của "Tool tạo Template Preset": template sinh ra phải luôn cắt lại được thành
// đúng các Khối độc lập theo nhãn mở/đóng — đó là điểm mấu chốt để hệ thống phân loại được.
import { describe, it, expect } from 'vitest';
import {
  buildTemplate,
  buildBlocks,
  parseTemplateBlocks,
  validateTemplate,
  BLOCK_ORDER,
  startLabel,
  endLabel,
  type TemplateContext,
} from './templateBlocks';

const CTX: TemplateContext = {
  context: 'Một tu sĩ trẻ lạc vào Bí Cảnh Vạn Kiếm, nơi mỗi thanh kiếm là ký ức của người đã chết.',
  genre: 'Tu tiên',
  pov: 'third_limited',
  paragraphs: { min: 3, max: 5 },
};

describe('buildTemplate — cấu trúc 5 khối', () => {
  it('sinh đủ 5 khối, đúng thứ tự, đủ cặp nhãn mở/đóng', () => {
    const out = buildTemplate(CTX);
    let cursor = -1;
    for (const id of BLOCK_ORDER) {
      const s = out.indexOf(startLabel(id));
      const e = out.indexOf(endLabel(id));
      expect(s, `thiếu ${startLabel(id)}`).toBeGreaterThan(-1);
      expect(e, `thiếu ${endLabel(id)}`).toBeGreaterThan(s);
      expect(s, 'sai thứ tự khối').toBeGreaterThan(cursor);
      cursor = e;
    }
  });

  it('nhãn đúng định dạng [số._TÊN_START] như đặc tả', () => {
    expect(startLabel('SYSTEM_VARIABLES')).toBe('[1._SYSTEM_VARIABLES_START]');
    expect(endLabel('SILLYTAVERN_FORMAT')).toBe('[5._SILLYTAVERN_FORMAT_END]');
  });

  it('round-trip: build → parse ra lại đúng 5 khối, nội dung khớp buildBlocks', () => {
    const parsed = parseTemplateBlocks(buildTemplate(CTX));
    const direct = buildBlocks(CTX);
    expect(parsed.map(b => b.id)).toEqual(BLOCK_ORDER);
    expect(parsed.map(b => b.content)).toEqual(direct.map(b => b.content));
  });

  it('tắt bớt khối thì khối đó biến mất hoàn toàn', () => {
    const out = buildTemplate({ ...CTX, blocks: { THINKING_COT: false } });
    expect(out).not.toContain('THINKING_COT');
    expect(parseTemplateBlocks(out).map(b => b.id)).not.toContain('THINKING_COT');
  });
});

describe('nội dung khối bám đúng đặc tả', () => {
  const blocks = Object.fromEntries(buildBlocks(CTX).map(b => [b.id, b.content]));

  it('khối 1 khai báo đủ 3 biến bắt buộc bằng [SetVar: …]', () => {
    for (const v of ['pov_rule', 'style_rule', 'end_rule']) {
      expect(blocks.SYSTEM_VARIABLES).toContain(`[SetVar: ${v} = "`);
    }
  });

  it('khối 1: pov_rule cấm điều khiển {{user}}; end_rule chống câu tổng kết', () => {
    expect(blocks.SYSTEM_VARIABLES).toMatch(/CẤM.*\{\{user\}\}/s);
    expect(blocks.SYSTEM_VARIABLES).toContain('CHỐNG KẾT BÀI');
  });

  it('khối 2 yêu cầu bọc suy luận trong thẻ ẩn <thinking>', () => {
    expect(blocks.THINKING_COT).toContain('<thinking>');
    expect(blocks.THINKING_COT).toContain('</thinking>');
  });

  it('khối 3 gọi lại biến bằng [GetVar: …] đúng tên đã SetVar', () => {
    for (const v of ['pov_rule', 'style_rule']) {
      expect(blocks.NOVEL_GUIDELINES).toContain(`[GetVar: ${v}]`);
    }
  });

  it('khối 4 nêu đủ 3 nhóm: lặp cử chỉ, tả giải phẫu, OOC', () => {
    expect(blocks.ANTI_AI_CLICHE).toContain('nhướn mày');
    expect(blocks.ANTI_AI_CLICHE).toContain('nghiến răng');
    expect(blocks.ANTI_AI_CLICHE).toMatch(/CẤM nặn tính cách cho \{\{user\}\}/);
  });

  it('khối 5 cấm markdown header/in đậm và ép số đoạn theo cấu hình', () => {
    expect(blocks.SILLYTAVERN_FORMAT).toContain('CẤM dùng tiêu đề markdown');
    expect(blocks.SILLYTAVERN_FORMAT).toContain('3–5 đoạn văn');
  });

  it('bối cảnh người dùng nhập được nhúng vào biến setting', () => {
    expect(blocks.SYSTEM_VARIABLES).toContain('Bí Cảnh Vạn Kiếm');
    expect(blocks.SYSTEM_VARIABLES).toContain('Tu tiên');
  });

  it('số đoạn tuỳ chỉnh được', () => {
    const b = buildBlocks({ ...CTX, paragraphs: { min: 2, max: 4 } });
    expect(b.find(x => x.id === 'SILLYTAVERN_FORMAT')!.content).toContain('2–4 đoạn văn');
  });
});

describe('parseTemplateBlocks — khoan dung với đầu ra lệch của AI', () => {
  it('chấp nhận thiếu số thứ tự / thừa khoảng trắng / khác hoa-thường', () => {
    const messy = `[ SYSTEM_VARIABLES_START ]\nA\n[SYSTEM_VARIABLES_END]\n\n[2._thinking_cot_START]\nB\n[2._thinking_cot_END]`;
    const got = parseTemplateBlocks(messy);
    expect(got.map(b => [b.id, b.content])).toEqual([
      ['SYSTEM_VARIABLES', 'A'],
      ['THINKING_COT', 'B'],
    ]);
  });

  it('bỏ qua phần rác AI viết thêm ngoài nhãn', () => {
    const noisy = `Chào bạn, đây là template:\n\n${buildTemplate(CTX)}\n\nHy vọng hữu ích!`;
    expect(parseTemplateBlocks(noisy).map(b => b.id)).toEqual(BLOCK_ORDER);
  });
});

describe('validateTemplate — bắt lỗi thật', () => {
  it('template do tool sinh ra là hợp lệ (không vấn đề gì)', () => {
    expect(validateTemplate(buildTemplate(CTX))).toEqual([]);
  });

  it('mở mà quên đóng → báo unclosed, không phải missing', () => {
    const broken = `[1._SYSTEM_VARIABLES_START]\nA`;
    const issues = validateTemplate(broken, ['SYSTEM_VARIABLES']);
    expect(issues).toEqual([{ id: 'SYSTEM_VARIABLES', kind: 'unclosed' }]);
  });

  it('khối rỗng → báo empty', () => {
    const empty = `[1._SYSTEM_VARIABLES_START]\n\n[1._SYSTEM_VARIABLES_END]`;
    expect(validateTemplate(empty, ['SYSTEM_VARIABLES'])).toEqual([
      { id: 'SYSTEM_VARIABLES', kind: 'empty' },
    ]);
  });

  it('không có gì → báo missing đủ 5 khối', () => {
    expect(validateTemplate('văn bản trống trơn')).toHaveLength(5);
  });
});
