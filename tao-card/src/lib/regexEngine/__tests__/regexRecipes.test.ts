// (Goal 103b) Thư viện công thức regex đa dạng — audio theo diễn biến, mini game…
// Mọi công thức là TĨNH nên phải luôn qua được CHÍNH luật sắt của Phase 103.
import { describe, it, expect } from 'vitest';
import { REGEX_RECIPES, buildRecipeScripts, buildRecipeCatalogForPrompt, getRecipe } from '../regexRecipes';
import { applyRegex, validateRegex } from '../applyRegex';
import { validateReplaceString } from '../regexValidator';
import type { RegexScript } from '../../../types';

const FENCE = '`'.repeat(3);

describe('REGEX_RECIPES — mọi công thức phải qua luật sắt 103', () => {
  for (const r of REGEX_RECIPES) {
    it(`"${r.label}": compile OK + replaceString không vỡ + fence đóng đủ cặp`, () => {
      const scripts = buildRecipeScripts(r.id);
      expect(scripts.length).toBeGreaterThan(0);
      for (const s of scripts) {
        // 1. compile
        expect(validateRegex(s.findRegex).valid).toBe(true);
        // 2. replaceString không có lỗi cứng
        const rv = validateReplaceString(s.replaceString);
        expect([...rv.jsIssues, ...rv.htmlIssues].filter(i => i.type === 'error')).toEqual([]);
        // 3. fence phải đóng đủ cặp (lẻ = nuốt phần sau tin nhắn)
        const n = (s.replaceString.match(new RegExp(FENCE, 'g')) || []).length;
        expect(n % 2).toBe(0);
        // 4. chuẩn ST: findRegex viết dạng /pattern/flags
        expect(s.findRegex.startsWith('/')).toBe(true);
      }
    });

    it(`"${r.label}": marker mẫu KHỚP THẬT (chạy thử trên sample)`, () => {
      const scripts = buildRecipeScripts(r.id);
      const render = scripts[0];
      const res = applyRegex({ ...render, id: 'x' } as RegexScript, r.sample);
      expect(res.error).toBeUndefined();
      expect(res.matchCount).toBeGreaterThan(0);
      expect(res.result).not.toBe(r.sample);   // phải thật sự thay thế
    });
  }
});

describe('REGEX_RECIPES — hành vi từng công thức', () => {
  it('audio_scene bắt tên cảnh và đưa vào data-scene', () => {
    const [render] = buildRecipeScripts('audio_scene');
    const out = applyRegex({ ...render, id: 'x' } as RegexScript, 'Trận chiến nổ ra. [audio:chien-truong]');
    expect(out.result).toContain('data-scene="chien-truong"');
    expect(out.result).toContain('<audio');
  });

  it('audio_scene có VẾ ẨN KHỎI PROMPT (marker không lọt vào context mỗi lượt)', () => {
    const scripts = buildRecipeScripts('audio_scene');
    const hide = scripts.find(s => s.promptOnly && !s.markdownOnly);
    expect(hide).toBeDefined();
    expect(hide!.replaceString).toBe('');
  });

  it('dice_roll đọc đúng số xúc xắc/mặt/cộng thêm', () => {
    const [render] = buildRecipeScripts('dice_roll');
    const out = applyRegex({ ...render, id: 'x' } as RegexScript, 'Thử vận: [roll:2d6+3]');
    expect(out.result).toContain('data-n="2"');
    expect(out.result).toContain('data-f="6"');
    expect(out.result).toContain('data-mod="+3"');
  });

  it('choice_buttons tách được nhiều lựa chọn', () => {
    const [render] = buildRecipeScripts('choice_buttons');
    const out = applyRegex({ ...render, id: 'x' } as RegexScript, '[choice:Đi tiếp|Quay lại|Nghỉ ngơi]');
    expect(out.result).toContain('data-opts="Đi tiếp|Quay lại|Nghỉ ngơi"');
  });

  it('progress_bar lấy đúng nhãn + hiện tại/tối đa', () => {
    const [render] = buildRecipeScripts('progress_bar');
    const out = applyRegex({ ...render, id: 'x' } as RegexScript, '[bar:Máu:70/100]');
    expect(out.result).toContain('data-cur="70"');
    expect(out.result).toContain('data-max="100"');
    expect(out.result).toContain('Máu');
  });

  it('collapsible giữ nguyên nội dung bên trong khối gấp', () => {
    const [render] = buildRecipeScripts('collapsible');
    const out = applyRegex({ ...render, id: 'x' } as RegexScript, '[fold:Nhật ký]\nHôm nay trời mưa.\n[/fold]');
    expect(out.result).toContain('<details');
    expect(out.result).toContain('Hôm nay trời mưa.');
  });

  it('hide_block CHỈ ẩn ở hiển thị, KHÔNG đụng tin nhắn thô (MVU vẫn đọc được)', () => {
    const [render] = buildRecipeScripts('hide_block');
    expect(render.markdownOnly).toBe(true);
    expect(render.promptOnly).toBe(false);
    const out = applyRegex({ ...render, id: 'x' } as RegexScript, 'a<thinking>nội bộ</thinking>b');
    expect(out.result).toBe('ab');
  });

  it('widget dùng addEventListener chứ không onclick= trong module (chuẩn ST, nút bấm chạy được)', () => {
    for (const id of ['dice_roll', 'choice_buttons'] as const) {
      const [render] = buildRecipeScripts(id);
      expect(/<script[^>]*type\s*=\s*["']module["']/i.test(render.replaceString)).toBe(false);
      expect(render.replaceString).toContain('addEventListener');
    }
  });

  it('marker tuỳ biến được (đổi marker vẫn compile + khớp)', () => {
    const [render] = buildRecipeScripts('dice_roll', { marker: 'gieo', scriptName: 'Xúc xắc VN' });
    expect(render.scriptName).toBe('Xúc xắc VN');
    expect(validateRegex(render.findRegex).valid).toBe(true);
    const out = applyRegex({ ...render, id: 'x' } as RegexScript, '[gieo:1d20]');
    expect(out.matchCount).toBe(1);
  });
});

describe('catalog cho prompt AI', () => {
  it('liệt kê đủ công thức kèm marker mẫu để agent khỏi viết lại từ đầu', () => {
    const cat = buildRecipeCatalogForPrompt();
    for (const r of REGEX_RECIPES) expect(cat).toContain(r.id);
    expect(cat).toContain('[audio:');
    expect(cat).toContain('[roll:');
  });

  it('getRecipe id sai → undefined, buildRecipeScripts id sai → ném lỗi rõ', () => {
    expect(getRecipe('khong_co' as never)).toBeUndefined();
    expect(() => buildRecipeScripts('khong_co' as never)).toThrow(/công thức/);
  });
});
