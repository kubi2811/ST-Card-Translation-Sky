/**
 * (bugNeedFix/169) AI phải nhìn được các preset hoàn thiện đã nhập, và đo được "đã đầy đủ chưa".
 */
import { describe, it, expect } from 'vitest';
import {
  classifyBlock, profileProject, isExemplar, compareToExemplars,
  buildExemplarContext, buildSupplementRequest, buildCloneRequest, FEATURE_LABEL,
} from './presetExemplars';
import type { Project, PromptBlock, SillyTavernPreset } from '../types';

function block(name: string, content = 'x'.repeat(300), over: Partial<PromptBlock> = {}): PromptBlock {
  return {
    identifier: `id-${name}`, name, system_prompt: true, role: 'system',
    content, enabled: true, injection_position: 0, injection_depth: 4,
    injection_order: 100, forbid_overrides: false, ...over,
  };
}

function project(name: string, blocks: PromptBlock[], regexCount = 0): Project {
  const preset = {
    prompts: blocks, prompt_order: [],
    temperature: 1, top_p: 1, top_k: 0, top_a: 0, min_p: 0,
    frequency_penalty: 0, presence_penalty: 0, repetition_penalty: 1,
    openai_max_context: 200000, openai_max_tokens: 4096,
    wrap_in_quotes: false, names_behavior: 0, stream_openai: true,
  } as unknown as SillyTavernPreset;
  return {
    id: `pj-${name}`, name, createdAt: 0, updatedAt: 0, preset,
    regexes: Array.from({ length: regexCount }, (_, i) => ({
      id: `r${i}`, scriptName: `rx${i}`, findRegex: '/a/', replaceString: 'b',
      placement: [2], disabled: false, markdownOnly: true, promptOnly: false,
    })) as Project['regexes'],
  };
}

/** Preset "hoàn thiện" kiểu Ako/Tawa: nhiều khối, phủ nhiều nhóm chức năng. */
function fullPreset(name: string): Project {
  return project(name, [
    block('Đạo Diễn Hệ Thống'), block('Nhập vai nhân vật'),
    block('Jailbreak chính'), block('JB phụ trợ'),
    block('Văn phong tả thực'), block('Giọng kể ngôi ba'),
    block('Định dạng đầu ra'), block('Markdown rules'),
    block('Lịch Sử Trò Chuyện', 'y'.repeat(300), { marker: true }),
    block('World Info nhúng'),
    block('Chống lặp câu'),
  ], 3);
}

describe('classifyBlock — nhận nhóm chức năng đa ngữ', () => {
  it('nhận đúng các nhóm chính', () => {
    expect(classifyBlock(block('Đạo Diễn Hệ Thống'))).toBe('persona');
    expect(classifyBlock(block('Jailbreak v2'))).toBe('jailbreak');
    expect(classifyBlock(block('Output Format'))).toBe('formatting');
    expect(classifyBlock(block('Chat History'))).toBe('history');
    expect(classifyBlock(block('世界书注入'))).toBe('worldinfo');
  });

  it('marker luôn là khối hệ thống', () => {
    expect(classifyBlock(block('Bất kỳ', '', { marker: true }))).toBe('system');
  });

  it('khối không thuộc nhóm nào thì trả null — KHÔNG đoán bừa', () => {
    expect(classifyBlock(block('Ghi chú linh tinh của tôi', 'abc'))).toBeNull();
  });
});

describe('isExemplar — chỉ preset đủ dày mới được làm mẫu', () => {
  it('preset hoàn thiện được nhận làm mẫu', () => {
    expect(isExemplar(profileProject(fullPreset('Ako')))).toBe(true);
  });

  it('dự án nháp 3 khối KHÔNG được làm mẫu (lấy nháp làm chuẩn còn tệ hơn không có)', () => {
    expect(isExemplar(profileProject(project('Test', [block('Đạo Diễn'), block('a'), block('b')])))).toBe(false);
  });
});

describe('compareToExemplars — "đã đầy đủ chưa"', () => {
  const exemplars = [fullPreset('Ako'), fullPreset('Tawa')];

  it('chỉ ra ĐÚNG nhóm còn thiếu so với mẫu', () => {
    const mine = project('Test', [block('Đạo Diễn Hệ Thống'), block('Nhập vai')]);
    const gap = compareToExemplars(mine, exemplars);
    expect(gap.hasExemplars).toBe(true);
    expect(gap.exemplarNames).toEqual(['Ako', 'Tawa']);
    expect(gap.missingGroups).toContain('jailbreak');
    expect(gap.missingGroups).toContain('formatting');
    // Nhóm mình ĐÃ có thì không được báo thiếu.
    expect(gap.missingGroups).not.toContain('persona');
    expect(gap.verdict).toMatch(/2 khối/);
  });

  it('preset đã phủ đủ thì nói rõ là đủ, không nặn lỗi để có cái vá', () => {
    const gap = compareToExemplars(fullPreset('Cua toi'), exemplars);
    expect(gap.missingGroups).toEqual([]);
    expect(gap.verdict).toMatch(/đã phủ đủ|Đã phủ đủ/i);
  });

  it('không có mẫu nào thì nói thẳng, không bịa kết luận', () => {
    const gap = compareToExemplars(project('Test', [block('a')]), []);
    expect(gap.hasExemplars).toBe(false);
    expect(gap.missingGroups).toEqual([]);
    expect(gap.verdict).toMatch(/Chưa có preset mẫu/);
  });

  it('báo cả việc mẫu có regex mà mình chưa có', () => {
    const gap = compareToExemplars(project('Test', [block('Đạo Diễn')]), exemplars);
    expect(gap.medianRegex).toBe(3);
    expect(gap.verdict).toMatch(/regex/i);
  });
});

describe('buildExemplarContext — ngữ cảnh bơm vào chat', () => {
  const exemplars = [fullPreset('Ako'), fullPreset('Tawa')];

  it('không có mẫu ⇒ chuỗi rỗng, không bơm khối trống làm loãng prompt', () => {
    expect(buildExemplarContext([], 'tạo preset')).toBe('');
  });

  it('mặc định chỉ gửi hồ sơ cấu trúc, không gửi nguyên văn (giữ context)', () => {
    const ctx = buildExemplarContext(exemplars, 'tạo cho tôi preset mới');
    expect(ctx).toContain('MẪU "Ako"');
    expect(ctx).toContain('11 khối');
    expect(ctx).not.toContain('CÁC KHỐI (nguyên văn)');
  });

  it('nhắc tên mẫu ⇒ gửi nguyên văn các khối của đúng mẫu đó', () => {
    const ctx = buildExemplarContext(exemplars, 'tạo preset đầy đủ như Ako');
    const akoPart = ctx.slice(ctx.indexOf('MẪU "Ako"'), ctx.indexOf('MẪU "Tawa"'));
    expect(akoPart).toContain('CÁC KHỐI (nguyên văn)');
    // Tawa không được nhắc ⇒ vẫn chỉ hồ sơ.
    expect(ctx.slice(ctx.indexOf('MẪU "Tawa"'))).not.toContain('CÁC KHỐI (nguyên văn)');
  });

  it('cấm chép nguyên văn câu chữ của mẫu — nói rõ trong ngữ cảnh', () => {
    expect(buildExemplarContext(exemplars, 'x')).toMatch(/không chép nguyên văn/i);
  });

  it('kèm kết quả đối chiếu khi có', () => {
    const gap = compareToExemplars(project('Test', [block('Đạo Diễn')]), exemplars);
    const ctx = buildExemplarContext(exemplars, 'x', gap);
    expect(ctx).toContain('ĐỐI CHIẾU PRESET ĐANG LÀM VỚI MẪU');
    expect(ctx).toContain(FEATURE_LABEL.jailbreak);
  });
});

describe('Lời nhờ dựng sẵn', () => {
  const exemplars = [fullPreset('Ako'), fullPreset('Tawa')];

  it('bổ sung: nêu đích danh nhóm thiếu + BẮT giữ nguyên khối đã có', () => {
    const gap = compareToExemplars(project('Test', [block('Đạo Diễn')]), exemplars);
    const req = buildSupplementRequest(gap);
    expect(req).toContain(FEATURE_LABEL.jailbreak);
    expect(req).toMatch(/GIỮ NGUYÊN các khối tôi đã có/);
    expect(req).toMatch(/chỉ THÊM khối mới/);
  });

  it('bổ sung khi đã đủ: chuyển sang rà chất lượng thay vì ép thêm khối', () => {
    const req = buildSupplementRequest(compareToExemplars(fullPreset('Cua toi'), exemplars));
    expect(req).toMatch(/đã đủ/);
  });

  it('tạo mới: nêu tên mẫu làm chuẩn + cấm trả về preset sơ sài', () => {
    const req = buildCloneRequest(['Ako', 'Tawa'], 'tu tiên');
    expect(req).toContain('Ako và Tawa');
    expect(req).toContain('tu tiên');
    expect(req).toMatch(/đừng trả về một preset 3 khối sơ sài/);
  });

  it('tạo mới không nêu chủ đề thì mặc định dùng chung, không để trống mơ hồ', () => {
    expect(buildCloneRequest(['Ako'], '  ')).toMatch(/dùng chung/);
  });
});
