/**
 * (bug 188) Tái thiết kế giao diện riêng từ phong cách học — không phải biến thể màu template.
 * ─────────────────────────────────────────────────────────────────────────────
 * Hai điều được kiểm theo đúng cách chúng được ép:
 *   1. Bản thiết kế (design brief) phải RA LỆNH tái thiết kế + cấm clone + cấm biến mẫu,
 *      và mang đủ các mặt user đòi (bố cục/component/phân cấp/spacing/typography/animation/UX);
 *   2. Chốt máy checkRedesignLeaks: script sinh ra rò tên biến mẫu là bị loại — kể cả tên Hán.
 * Kèm nối dây: modal gọi generateOrchestrated + validator, pipeline rẽ nhánh CUSTOM_UI_ID.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  styleProfileToDesignBrief, checkRedesignLeaks, nameHitsText,
} from '../styleLearner';
import { CUSTOM_UI_ID, type StyleProfile } from '../../../types/autoCreator.types';

const profile = (over: Partial<StyleProfile> = {}): StyleProfile => ({
  name: 'Tiên hiệp tím', description: 'U huyền', icon: '🔮', scope: 'all',
  fontImport: '', fontFamily: "'Noto Serif', serif", headingFont: '',
  colors: { '--bg-primary': '#1a1026', '--theme-main': '#8b5cf6' },
  extras: { '--radius-md': '12px' },
  openingForm: ['Wizard nhiều bước, mỗi bước một section'],
  statusBar: ['Chia thông tin thành tab theo nhóm'],
  decorations: ['Viền phát sáng nhẹ khi hover'],
  ux: ['Thông tin chính nổi trước, phụ thu gọn'],
  bannedVars: ['境界', '好感度', 'mana_points'],
  ...over,
});

describe('styleProfileToDesignBrief', () => {
  it('brief ra lệnh TÁI THIẾT KẾ + cấm clone + cấm biến mẫu + ưu tiên usability', () => {
    const b = styleProfileToDesignBrief(profile());
    expect(b).toContain('TÁI THIẾT KẾ');
    expect(b).toContain('KHÔNG chép lại giao diện mẫu');
    expect(b).toContain('không dùng tên biến của card mẫu');
    expect(b).toContain('KHẢ NĂNG SỬ DỤNG');
  });

  it('mang đủ các mặt user đòi: bố cục, component, phân cấp, spacing, typography, animation, UX', () => {
    const b = styleProfileToDesignBrief(profile());
    for (const t of ['bố cục', 'component', 'phân cấp', 'khoảng cách', 'Typography', 'animation', 'UX']) {
      expect(b).toContain(t);
    }
    // Ghi chú học được phải vào brief — đó là "tinh thần mẫu" mà bản mới phải mang.
    expect(b).toContain('Wizard nhiều bước');
    expect(b).toContain('tab theo nhóm');
    expect(b).toContain('--theme-main=#8b5cf6');
  });

  it('brief KHÔNG chứa tên biến cấm của mẫu (không tự tay tuồn cái mình cấm)', () => {
    const b = styleProfileToDesignBrief(profile());
    expect(b).not.toContain('境界');
    expect(b).not.toContain('mana_points');
  });
});

describe('checkRedesignLeaks — chốt máy chống clone', () => {
  it('script rò biến Hán lẫn ASCII của mẫu đều bị điểm mặt', () => {
    const leaks = checkRedesignLeaks(
      [{ findRegex: '<StatusPlaceHolderImpl/>', replaceString: '<div data-var="境界">x</div><span>{{getvar::mana_points}}</span>' }],
      profile().bannedVars,
    );
    expect(leaks).toEqual(expect.arrayContaining(['境界', 'mana_points']));
  });

  it('script sạch (chỉ dùng biến schema) → không rò; ASCII chỉ khớp theo ranh giới từ', () => {
    expect(checkRedesignLeaks(
      [{ findRegex: '<OpeningFormImpl/>', replaceString: '<div data-var="Sức khoẻ">humana_pointsx</div>' }],
      profile().bannedVars,
    )).toEqual([]);
    expect(nameHitsText('điểm mana_points ở đây', 'mana_points')).toBe(true);
    expect(nameHitsText('humana_pointsx', 'mana_points')).toBe(false);
  });

  it('không có danh sách cấm (chưa học mẫu) → không soi, không nổ', () => {
    expect(checkRedesignLeaks([{ replaceString: '境界' }], undefined)).toEqual([]);
  });
});

describe('nối dây', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

  it('modal: nút tái thiết kế gọi generateOrchestrated với brief + 2 chốt máy trước khi nhận', () => {
    const SRC = read('../../../components/autocreator/PreviewTunerModal.tsx');
    expect(SRC).toContain('generateOrchestrated({');
    expect(SRC).toContain('themeHint: styleProfileToDesignBrief(sp)');
    expect(SRC).toContain('checkRedesignLeaks(res.scripts, sp.bannedVars)');
    expect(SRC).toContain('validateRegexDraft(');
    expect(SRC).toContain('customScripts: res.scripts');
    // Danh sách cấm được persist vào profile ngay lúc học mẫu.
    expect(SRC).toContain('profile.bannedVars = [...sampleVars]');
  });

  it('pipeline: bước game_ui rẽ nhánh dùng customScripts khi themeId là CUSTOM_UI_ID', () => {
    const SRC = read('../autoCreatorPipeline.ts');
    expect(SRC).toContain(`tunedForUi?.themeId === CUSTOM_UI_ID && tunedForUi.customScripts?.length`);
    expect(CUSTOM_UI_ID).toBe('custom_redesign');
  });
});
