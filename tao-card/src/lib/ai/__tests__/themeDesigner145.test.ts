/**
 * (bugNeedFix/145) "Nhờ AI tạo giao diện" ở Bước 2 — AI chỉ được quyết BẢNG MÀU, khung HTML
 * vẫn do máy dựng. Test khoá đúng ranh giới đó: giá trị rác bị loại, bố cục không bao giờ bị
 * AI chạm tới, và chữ chìm vào nền thì phải cảnh báo trước khi user chốt.
 */
import { describe, it, expect } from 'vitest';
import {
  parseThemeSpec, specToThemePreset, checkThemeReadability, contrastRatio,
  buildThemeDesignMessages, AI_THEME_ID,
} from '../themeDesigner';
import { THEME_PRESETS, DEFAULT_THEME_ID } from '../../mvuzod/gameHtmlTemplates';

const GOOD = JSON.stringify({
  name: 'Tiên hiệp thanh nhã', description: 'Xanh ngọc trên nền tối', icon: '🌿',
  fontImport: 'https://fonts.googleapis.com/css2?family=Noto+Serif&display=swap',
  fontFamily: "'Noto Serif', serif", headingFont: "'Noto Serif', serif",
  colors: {
    '--bg-primary': '#0f1412', '--bg-card': '#18201d', '--bg-section': 'rgba(255,255,255,0.04)',
    '--bg-input': '#1e2724', '--bg-hover': 'rgba(120,200,170,0.1)',
    '--theme-main': '#4fa88a', '--theme-light': '#7fd4b4', '--theme-dark': '#2f7a62',
    '--text-primary': '#e4ece8', '--text-secondary': '#a9b8b2', '--text-heading': '#d8e8e0',
    '--border-main': '#2c3a35', '--positive-color': '#4caf50', '--negative-color': '#e05a5a',
  },
});

describe('parse — chỉ nhận màu hợp lệ', () => {
  it('đọc được spec đầy đủ', () => {
    const s = parseThemeSpec(GOOD);
    expect(s.name).toBe('Tiên hiệp thanh nhã');
    expect(s.colors['--theme-main']).toBe('#4fa88a');
  });

  it('loại khoá lạ và giá trị không phải màu', () => {
    const raw = JSON.stringify({
      ...JSON.parse(GOOD),
      colors: { ...JSON.parse(GOOD).colors, '--hack': '#fff', '--text-muted': 'red', '--border-light': 'javascript:alert(1)' },
    });
    const s = parseThemeSpec(raw);
    expect(s.colors['--hack']).toBeUndefined();       // khoá ngoài danh sách
    expect(s.colors['--text-muted']).toBeUndefined(); // tên màu CSS, không phải mã
    expect(s.colors['--border-light']).toBeUndefined();
  });

  it('quá ít màu hợp lệ thì báo lỗi thay vì trả theme hỏng', () => {
    expect(() => parseThemeSpec('{"colors":{"--bg-card":"#111"}}')).toThrow();
  });

  it('fontImport không phải Google Fonts thì rơi về font mặc định', () => {
    const raw = JSON.stringify({ ...JSON.parse(GOOD), fontImport: 'https://evil.example.com/x.css' });
    expect(parseThemeSpec(raw).fontImport).toBe(THEME_PRESETS[DEFAULT_THEME_ID].fontImport);
  });
});

describe('ghép theme — AI không chạm được vào bố cục', () => {
  it('mọi biến KHÔNG phải màu đều kế thừa nguyên từ theme nền', () => {
    const preset = specToThemePreset(parseThemeSpec(GOOD));
    const base = THEME_PRESETS[DEFAULT_THEME_ID].cssVars;
    for (const [k, v] of Object.entries(base)) {
      if (k.startsWith('--fs-') || k.startsWith('--transition-') || k.includes('radius') || k.includes('space')) {
        expect(preset.cssVars[k], k).toBe(v);
      }
    }
    expect(preset.id).toBe(AI_THEME_ID);
    expect(preset.cssVars['--theme-main']).toBe('#4fa88a');  // màu thì của AI
  });
});

describe('kiểm đọc được — chữ không được chìm vào nền', () => {
  it('tương phản tính đúng ở hai đầu mút', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#888888', '#888888')).toBeCloseTo(1, 1);
  });

  it('bảng màu tốt thì không cảnh báo', () => {
    expect(checkThemeReadability(parseThemeSpec(GOOD))).toEqual([]);
  });

  it('chữ xám trên nền xám bị bắt', () => {
    const raw = JSON.stringify({
      ...JSON.parse(GOOD),
      colors: { ...JSON.parse(GOOD).colors, '--text-primary': '#4a4a4a', '--bg-card': '#3a3a3a' },
    });
    const w = checkThemeReadability(parseThemeSpec(raw));
    expect(w.length).toBeGreaterThan(0);
    expect(w.join(' ')).toContain('tương phản');
  });
});

describe('chỉnh lại — AI phải thấy bản nó vừa làm', () => {
  it('lượt đầu: 2 message, không kèm spec', () => {
    expect(buildThemeDesignMessages('tông xanh', 'Thẻ A')).toHaveLength(2);
  });

  it('lượt chỉnh: gửi lại NGUYÊN spec hiện tại để AI sửa đúng chỗ', () => {
    const cur = parseThemeSpec(GOOD);
    const msgs = buildThemeDesignMessages('nền tối hơn', 'Thẻ A', cur);
    expect(msgs).toHaveLength(4);
    expect(msgs[2].role).toBe("assistant");
    expect(msgs[2].content).toContain('#4fa88a');       // bảng màu cũ có mặt
    expect(msgs[3].content).toContain('GIỮ NGUYÊN');
  });
});
