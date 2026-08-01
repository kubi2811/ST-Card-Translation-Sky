/**
 * (bugNeedFix/186) 🎨 Học Phong Cách Giao Diện từ card mẫu.
 * ─────────────────────────────────────────────────────────────────────────────
 * Hai luật sắt của yêu cầu được test theo đúng cách chúng được ép:
 *   1. "không nhại biến/lore/logic của mẫu" — collectSampleVarNames bóc danh sách cấm,
 *      sanitizeStyleProfile lọc bằng máy (kể cả biến chữ Hán);
 *   2. "giao diện chạy trên schema Bước 1" — phần thị giác chỉ được thành ThemePreset
 *      (khoá màu whitelist + extras whitelist), KHÔNG có đường nào cho HTML của mẫu đi vào.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  uiScore, extractUiFromCard, collectSampleVarNames, buildStyleLearnMessages,
  parseStyleProfile, sanitizeStyleProfile, styleProfileToThemeSpec,
  styleNotesToRulesBlock, applyStyleRules, STYLE_SCOPES,
} from '../styleLearner';
import type { StyleProfile } from '../../../types/autoCreator.types';

/* ───────────── Card mẫu dựng cảnh: status bar tu tiên có biến Hán ───────────── */
const SAMPLE_UI = `
<style>
  .panel { border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,.5); background:#1a1026; }
  .tab:hover { background:#2d1b4e; transition: all .3s ease; }
  @keyframes glow { from { opacity:.6 } to { opacity:1 } }
</style>
<div class="panel">
  <div class="tab" data-var="修为">修为: <progress></progress></div>
  <div class="tab">好感度: <span data-var="好感度"></span></div>
  <button onclick="_.set(stat_data, '灵石.value', 0)">reset 灵石</button>
</div>`;

const sampleCard = () => ({
  spec: 'chara_card_v2',
  data: {
    name: 'Mẫu', first_mes: 'Chào.',
    extensions: {
      regex_scripts: [
        { scriptName: 'Status Bar đẹp', findRegex: '/x/', replaceString: SAMPLE_UI + SAMPLE_UI },
        { scriptName: 'regex chữ', findRegex: '/y/', replaceString: 'chỉ là chữ thường không giao diện gì' },
      ],
    },
    character_book: { entries: [{ comment: 'lore', content: 'Truyện kể rằng…'.repeat(30) }] },
  },
});

const profile = (over: Partial<StyleProfile> = {}): StyleProfile => ({
  name: 'Tiên hiệp tím', description: 'U huyền', icon: '🔮', scope: 'all',
  fontImport: '', fontFamily: '', headingFont: '',
  colors: { '--bg-primary': '#1a1026', '--bg-card': '#241436', '--theme-main': '#8b5cf6', '--text-primary': '#f3e8ff' },
  extras: { '--radius-md': '12px' },
  openingForm: [], statusBar: [], decorations: [], ux: [], ...over,
});

describe('bóc UI từ card mẫu', () => {
  it('khối HTML/CSS đậm được chấm điểm cao hơn văn xuôi', () => {
    expect(uiScore(SAMPLE_UI)).toBeGreaterThan(20);
    expect(uiScore('một đoạn truyện dài không có giao diện gì hết')).toBe(0);
  });

  it('chỉ nhặt khối giao diện, bỏ văn xuôi và lore', () => {
    const { chunks } = extractUiFromCard(sampleCard());
    expect(chunks.length).toBe(1);
    expect(chunks[0].source).toContain('Status Bar đẹp');
  });

  it('card không có giao diện thì trả rỗng — UI sẽ báo thẳng thay vì gửi rác cho AI', () => {
    const { chunks } = extractUiFromCard({ data: { name: 'x', first_mes: 'chào' } });
    expect(chunks).toEqual([]);
  });
});

describe('luật sắt 1 — danh sách biến cấm + lọc bằng máy', () => {
  it('bóc đủ tên biến của mẫu, kể cả chữ Hán qua data-var/_.set', () => {
    const vars = collectSampleVarNames(SAMPLE_UI);
    expect(vars.has('修为')).toBe(true);
    expect(vars.has('好感度')).toBe(true);
    expect(vars.has('灵石')).toBe(true);
  });

  it('ghi chú nhại biến mẫu bị LOẠI và nói rõ vì sao; ghi chú hình thức thì giữ', () => {
    const vars = collectSampleVarNames(SAMPLE_UI);
    const p = profile({
      statusBar: [
        'Chia thông tin thành tab theo nhóm, thanh tiến trình cho chỉ số chính',   // hình thức — giữ
        'Hiện 修为 bằng progress bar ở tab đầu',                                     // nhại biến — loại
      ],
      ux: ['Nút reset 灵石 đặt cuối panel'],                                          // nhại biến — loại
    });
    const { profile: clean, removed } = sanitizeStyleProfile(p, vars);
    expect(clean.statusBar).toEqual(['Chia thông tin thành tab theo nhóm, thanh tiến trình cho chỉ số chính']);
    expect(clean.ux).toEqual([]);
    expect(removed).toHaveLength(2);
    expect(removed[0]).toContain('修为');
  });

  it('không bắt oan: tên biến ASCII chỉ khớp theo ranh giới từ', () => {
    const vars = new Set(['hp']);
    const p = profile({ ux: ['Nhịp chuyển cảnh nhanh'] });   // "nhanh" chứa "nh" chứ không chứa từ "hp"
    const { removed } = sanitizeStyleProfile(p, vars);
    expect(removed).toEqual([]);
  });
});

describe('prompt', () => {
  it('system cấm nhại biến + đòi JSON; user kèm nhãn schema HIỆN TẠI để đối chiếu', () => {
    const msgs = buildStyleLearnMessages(
      [{ source: 'regex[0]', text: SAMPLE_UI, score: 30 }], 'all', ['Sức khoẻ', 'Danh vọng'],
    );
    expect(msgs[0].content).toContain('KHÔNG nhắc lại tên biến');
    expect(msgs[0].content).toContain('"openingForm"');
    expect(msgs[1].content).toContain('Sức khoẻ, Danh vọng');
    expect(msgs[1].content).toContain('CODE GIAO DIỆN CỦA CARD MẪU');
  });

  it('mỗi phạm vi học có chỉ dẫn riêng — 4 lựa chọn đúng như user yêu cầu', () => {
    expect(STYLE_SCOPES.map(s => s.id)).toEqual(['all', 'opening_form', 'status_bar', 'visual']);
    expect(buildStyleLearnMessages([], 'status_bar', [])[1].content).toContain('CHỈ tập trung Status Bar');
    expect(buildStyleLearnMessages([], 'visual', [])[1].content).toContain('CHỈ tập trung phong cách thị giác');
  });
});

describe('parse + whitelist', () => {
  const raw = JSON.stringify({
    name: 'Tiên hiệp', description: 'U huyền', icon: '🔮',
    visual: {
      fontImport: 'https://fonts.googleapis.com/css2?family=Noto+Serif&display=swap',
      fontFamily: "'Noto Serif', serif", headingFont: "'Ma Shan Zheng', cursive",
      colors: {
        '--bg-primary': '#1a1026', '--bg-card': '#241436', '--theme-main': '#8b5cf6',
        '--text-primary': '#f3e8ff',
        '--bg-evil': '#000',                 // khoá lạ — phải bị bỏ
        '--text-secondary': 'đỏ đô',         // giá trị rác — phải bị bỏ
      },
      extras: {
        '--radius-md': '12px', '--shadow-md': '0 4px 20px rgba(0,0,0,.5)',
        '--transition-base': '0.3s ease',
        '--radius-evil': 'url(javascript:x)', // url() — phải bị bỏ
        '--width-hack': '9px',                // prefix lạ — phải bị bỏ
      },
    },
    openingForm: ['Wizard nhiều bước, mỗi bước một section'],
    statusBar: ['Tab theo nhóm'], decorations: ['Viền phát sáng nhẹ'], ux: ['Thông tin chính nổi trước'],
  });

  it('giữ đúng khoá hợp lệ, vứt khoá lạ / giá trị rác / url()', () => {
    const p = parseStyleProfile(raw, 'all');
    expect(Object.keys(p.colors).sort()).toEqual(['--bg-card', '--bg-primary', '--text-primary', '--theme-main']);
    expect(Object.keys(p.extras).sort()).toEqual(['--radius-md', '--shadow-md', '--transition-base']);
    expect(p.openingForm).toHaveLength(1);
  });

  it('AI trả về không có gì dùng được thì ném lỗi thay vì im lặng', () => {
    expect(() => parseStyleProfile('{"name":"x","visual":{"colors":{}}}', 'all')).toThrow();
    expect(() => parseStyleProfile('không phải json', 'all')).toThrow();
  });
});

describe('luật sắt 2 — áp qua theme, không qua HTML', () => {
  it('profile → AiThemeSpec: extras đi cùng colors vào cssVars, font thiếu thì kế thừa nền', () => {
    const spec = styleProfileToThemeSpec(profile());
    expect(spec.colors['--bg-primary']).toBe('#1a1026');
    expect(spec.colors['--radius-md']).toBe('12px');
    expect(spec.fontFamily.length).toBeGreaterThan(0);   // fallback từ theme nền
  });

  it('ghi chú bố cục → khối đánh dấu trong userRules; học mẫu mới là THAY khối cũ', () => {
    const p1 = profile({ statusBar: ['Tab theo nhóm'] });
    const b1 = styleNotesToRulesBlock(p1);
    expect(b1).toContain('Tab theo nhóm');
    expect(b1).toContain('Dữ liệu, biến, lore vẫn theo card hiện tại');

    const rules1 = applyStyleRules('- Không NSFW', b1);
    expect(rules1).toContain('- Không NSFW');
    expect(rules1).toContain('Tab theo nhóm');

    const b2 = styleNotesToRulesBlock(profile({ name: 'Mẫu 2', ux: ['Grid 2 cột'] }));
    const rules2 = applyStyleRules(rules1, b2);
    expect(rules2).toContain('- Không NSFW');
    expect(rules2).toContain('Grid 2 cột');
    expect(rules2).not.toContain('Tab theo nhóm');   // khối cũ đã bị thay, không chồng đống
  });

  it('không có ghi chú nào thì không sinh khối rỗng', () => {
    expect(styleNotesToRulesBlock(profile())).toBe('');
  });
});

describe('nối dây vào Xem trước & Tinh chỉnh', () => {
  const SRC = readFileSync(
    new URL('../../../components/autocreator/PreviewTunerModal.tsx', import.meta.url), 'utf8',
  ).replace(/\r\n/g, '\n');

  it('khu 🎨 nằm ở Bước 2, nhận .json/.png, có 4 phạm vi học', () => {
    expect(SRC).toContain('Học Phong Cách Giao Diện');
    expect(SRC).toContain('accept=".json,.png"');
    expect(SRC).toContain('STYLE_SCOPES.map');
  });
  it('kết quả đi qua sanitize (lọc biến mẫu) và profile persist vào tuning', () => {
    expect(SRC).toContain('sanitizeStyleProfile(parsed, sampleVars)');
    expect(SRC).toContain('styleProfile: profile');
    // F5 xong theme in-memory mất — phải dựng lại từ profile đã persist.
    expect(SRC).toContain('registerAiTheme(styleProfileToThemeSpec(styleProfile))');
  });
});
