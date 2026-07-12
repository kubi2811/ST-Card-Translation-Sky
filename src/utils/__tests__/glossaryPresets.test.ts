import { describe, it, expect } from 'vitest';
import { GLOSSARY_PRESETS } from '../glossaryPresets';
import { mergeGlossary } from '../nameGlossary';

describe('GLOSSARY_PRESETS', () => {
  it('mọi bộ: source Hán duy nhất, target Việt sạch (không rỗng, không còn Hán, khác source)', () => {
    for (const preset of GLOSSARY_PRESETS) {
      const seen = new Set<string>();
      for (const e of preset.entries) {
        expect(e.source.trim().length, `source rỗng trong ${preset.id}`).toBeGreaterThan(0);
        expect(/^\p{Script=Han}+$/u.test(e.source), `source không thuần Hán: ${e.source}`).toBe(true);
        expect(e.target.trim().length, `target rỗng cho ${e.source}`).toBeGreaterThan(0);
        expect(/\p{Script=Han}/u.test(e.target), `target còn Hán: ${e.source}→${e.target}`).toBe(false);
        expect(seen.has(e.source), `source trùng lặp: ${e.source}`).toBe(false);
        seen.add(e.source);
      }
      expect(preset.entries.length).toBeGreaterThanOrEqual(40);
    }
  });

  it('nạp bộ qua mergeGlossary: mục user đã có luôn thắng', () => {
    const preset = GLOSSARY_PRESETS[0];
    const userGlossary = [{ source: '金丹', target: 'Golden Core (user tự chọn)' }];
    const { merged, added } = mergeGlossary(userGlossary, preset.entries);
    expect(added).toBe(preset.entries.length - 1);
    expect(merged.find(g => g.source === '金丹')?.target).toBe('Golden Core (user tự chọn)');
  });
});
