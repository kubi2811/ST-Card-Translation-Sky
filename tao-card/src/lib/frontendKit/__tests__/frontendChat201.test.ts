/**
 * (bug 201 + 202) KHUNG CHAT NHÚNG: lộ khối tư duy, và tràn chữ ra ngoài thẻ.
 * ─────────────────────────────────────────────────────────────────────────────
 * Cả hai đều đo được trên bàn thử `frontend-kit/harness` trước khi sửa:
 *
 *  202 — khung chat in NGUYÊN SI ba thứ: khối <tableThink> kèm chú thích HTML của tiện ích
 *        bảng trí nhớ, khối [metacognition] của preset, và bảng trạng thái HTML của chính
 *        thẻ. Bản đầu chỉ lọc năm cái tên thẻ đoán sẵn, mà rác thì đến từ preset và tiện ích
 *        của NGƯỜI DÙNG — không có cách nào đoán hết. Nên đổi luật: khung chat chỉ hiện VĂN
 *        XUÔI. Đo lại sau khi sửa: 320 khung hình trong lúc nhả chữ, không khung nào lộ.
 *
 *  201 — một cụm chữ không ngắt được (đường dẫn/liên kết dài) nong cột lưới của nhật ký ra
 *        899px trong khung 630px; trên màn 375px thì MỌI bong bóng chat bị đẩy ra ngoài thẻ
 *        590px. Vì .fe-root cắt phần thừa nên chữ không tràn cho ai thấy — nó biến mất.
 *
 * Test gọi thẳng runtime.js thật (nạp vào một `window` giả) chứ không chép tay lại logic:
 * chép tay thì chỉ kiểm được bản chép, không kiểm được thứ chạy trong quán rượu.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const KIT = path.resolve(__dirname, '../../../../..', 'frontend-kit', 'lib.mjs');
const THEME = path.resolve(__dirname, '..', 'assets', 'theme.css');

interface LogEntry { role: string; text: string; view?: string; vc?: number; at?: string }
interface Runtime {
  splitReply: (t: string) => { narrative: string; updateBlock: string; raw: string; history: string };
  stripHidden: (t: string, dropUpdate: boolean) => string;
  viewOf: (e: LogEntry) => string;
  logEntryOf: (raw: string, at?: string) => LogEntry;
  historyPrompts: () => Array<{ role: string; content: string }>;
  state: { log: LogEntry[] };
  // (bug 206)
  applyCardRegexes: (t: string) => { text: string; changed: boolean };
  renderBody: (t: string) => string;
  resetCardRegexes: () => void;
  // (bug 209)
  hasVisibleText: (html: string) => boolean;
}

let RT: Runtime;
let CFG: Record<string, unknown>;

beforeAll(async () => {
  const kit = await import(pathToFileURL(KIT).href) as { buildRuntimeOnlyJs: () => string };
  const win: Record<string, unknown> = {};
  new Function('window', kit.buildRuntimeOnlyJs())(win);
  RT = win.STFE as Runtime;
  CFG = win.STFE_CONFIG as Record<string, unknown>;
});

const narrativeOf = (raw: string) => RT.splitReply(raw).narrative;

/* ───────────────────────────── 202 · lộ thinking ───────────────────────────── */

describe('(bug 202) rác của TIỆN ÍCH không được lọt vào khung chat', () => {
  it('khối <tableThink> kèm chú thích HTML bên trong bị cắt trọn', () => {
    const raw = [
      '<tableThink>',
      '<!--',
      '0. Yêu cầu quan trọng: thao tác bảng chỉ giới hạn ở việc chèn.',
      '1. Người dùng không yêu cầu tổng kết lớn.',
      '-->',
      '</tableThink>',
      '',
      'Bạn bước qua cổng.',
    ].join('\n');
    expect(narrativeOf(raw)).toBe('Bạn bước qua cổng.');
  });

  it('khối <tableEdit> và chú thích HTML đứng một mình cũng bị cắt', () => {
    expect(narrativeOf('<tableEdit>\ninsertRow(0, {})\n</tableEdit>\nLời kể.')).toBe('Lời kể.');
    expect(narrativeOf('<!-- ghi chú kỹ thuật -->\nLời kể.')).toBe('Lời kể.');
  });
});

describe('(bug 202) rác của PRESET — nhãn ngoặc vuông, thường KHÔNG có thẻ đóng', () => {
  it('có thẻ đóng thì cắt trọn khối', () => {
    const raw = '[metacognition]\n- Ngôn ngữ: Tiếng Việt.\n[/metacognition]\nLời kể.';
    expect(narrativeOf(raw)).toBe('Lời kể.');
  });

  it('KHÔNG có thẻ đóng thì cắt hết đoạn văn chứa nó, lời kể sau dòng trống vẫn còn', () => {
    // Đúng hình dạng chụp được: một loạt dòng gạch đầu dòng liền nhau, không thẻ đóng.
    const raw = [
      '[metacognition]',
      '- Ngôn ngữ đầu ra: Tiếng Việt.',
      '- Góc nhìn: Ngôi thứ ba.',
      '1. Viết cảnh mở màn.',
      '2. Kết cảnh bằng tình huống mở.',
      '',
      'Sương Veil bám trên vai bạn.',
      '',
      '- Anh đi đâu đấy? - cô gái hỏi.',
    ].join('\n');
    expect(narrativeOf(raw)).toBe('Sương Veil bám trên vai bạn.\n\n- Anh đi đâu đấy? - cô gái hỏi.');
  });

  it('lời kể mở đầu bằng gạch đầu dòng (thoại tiếng Việt) KHÔNG bị coi là khối kỹ thuật', () => {
    const raw = '- Ai đó? - bà hỏi.\n- Tôi đây.';
    expect(narrativeOf(raw)).toBe(raw);
  });
});

describe('(bug 202) rác của CHÍNH THẺ — bảng trạng thái HTML', () => {
  it('div lồng div bị cắt trọn, không để lại thẻ đóng mồ côi', () => {
    const raw = '<div class="mvu-display-panel"><div class="row"><h3>THẾ GIỚI</h3>Ngày: <b>01/01</b></div></div>\n\nLời kể.';
    const out = narrativeOf(raw);
    expect(out).toBe('Lời kể.');
    expect(out).not.toContain('div');
  });

  it('hai bảng liền nhau thì cắt cả hai, không nuốt lời kể ở giữa', () => {
    // Chỗ bảng bị lấy đi để lại một dòng trống — tức là ngắt đoạn, chấp nhận được;
    // điều phải giữ là KHÔNG mất chữ nào của lời kể.
    const raw = '<div>A</div>\nGiữa.\n<div>B</div>\nCuối.';
    expect(narrativeOf(raw)).toBe('Giữa.\n\nCuối.');
  });

  it('thẻ HTML lẻ thì bỏ THẺ nhưng giữ CHỮ — chữ trong đó vẫn có thể là lời kể', () => {
    expect(narrativeOf('Nàng <b>quay lại</b> nhìn.')).toBe('Nàng quay lại nhìn.');
    expect(narrativeOf('Dòng một.<br>Dòng hai.')).toBe('Dòng một.\nDòng hai.');
  });
});

describe('(bug 202) lúc AI đang nhả từng chữ — trạng thái nào cũng phải sạch', () => {
  // Đây mới là chỗ rò rỉ dai nhất: mọi khối đều có lúc ở trạng thái MỞ MÀ CHƯA ĐÓNG.
  it('khối tư duy mở mà chưa đóng → cắt tới hết, không hiện ruột', () => {
    expect(narrativeOf('Lời kể.\n<thinking>ngẫm nghĩ dở dang')).toBe('Lời kể.');
  });

  it('khối cập nhật biến mở mà chưa đóng → không để JSONPatch chạy qua màn hình', () => {
    const raw = 'Lời kể.\n\n<UpdateVariable>\n<JSONPatch>\n[ { "op": "delta"';
    const out = narrativeOf(raw);
    expect(out).toBe('Lời kể.');
    expect(out).not.toContain('JSONPatch');
  });

  it('thẻ mới ra được một nửa (chưa có dấu đóng) → cắt mảnh vụn đó', () => {
    // Đo được: người chơi đọc được đúng chuỗi `<div class="mvu` rồi nó mới biến mất.
    expect(narrativeOf('Lời kể.\n<div class="mvu')).toBe('Lời kể.');
  });

  it('nhưng dấu bé hơn trong câu văn thì KHÔNG được đụng', () => {
    expect(narrativeOf('Một câu có 5 < 6 để thử.')).toBe('Một câu có 5 < 6 để thử.');
    expect(narrativeOf('So sánh: a < b')).toBe('So sánh: a < b');
  });
});

describe('(bug 202) lời kể thật phải sống nguyên vẹn', () => {
  it('markdown, thoại, dòng trích đều giữ nguyên từng ký tự', () => {
    const raw = '**Giám sát viên Lễ** đứng ở bàn.\n\n"Tên?" bà hỏi.\n\n> Phía sau, một cô gái cãi nhau với máy đo.';
    expect(narrativeOf(raw)).toBe(raw);
  });

  it('lời kể có ngoặc vuông thường (không phải nhãn kỹ thuật) vẫn còn', () => {
    expect(narrativeOf('[Ghi chú của người kể] Trời đã tối.')).toBe('[Ghi chú của người kể] Trời đã tối.');
  });

  it('đầu vào rỗng hoặc không có gì để cắt thì không ném', () => {
    expect(narrativeOf('')).toBe('');
    expect(RT.splitReply(null as unknown as string).narrative).toBe('');
  });

  it('cả trăm thẻ mở không bao giờ đóng vẫn trả về được, không treo', () => {
    const raw = 'Mở đầu.\n' + '<div>'.repeat(500);
    expect(() => narrativeOf(raw)).not.toThrow();
  });
});

describe('(bug 202) thẻ tự khai thêm khối riêng của nó', () => {
  it('CFG.hideTags nhận thêm tên thẻ ngoài danh sách dựng sẵn', () => {
    expect(narrativeOf('<mưuKế>bí mật</mưuKế>Lời kể.')).toContain('bí mật');
    CFG.hideTags = ['secretplan'];
    expect(narrativeOf('<secretplan>bí mật</secretplan>\nLời kể.')).toBe('Lời kể.');
    delete CFG.hideTags;
  });

  it('tên thẻ bậy (ký tự regex) bị bỏ qua chứ không ném và không nuốt hết bài', () => {
    CFG.hideTags = ['a(b[c', '', null, 'DIV'];
    expect(() => narrativeOf('Lời kể.')).not.toThrow();
    expect(narrativeOf('Lời kể.')).toBe('Lời kể.');
    delete CFG.hideTags;
  });
});

describe('(bug 202) nhật ký gửi lại cho AI', () => {
  const RAW = [
    '<tableThink><!-- ngẫm --></tableThink>',
    '[metacognition]',
    '- Ngôn ngữ: Tiếng Việt.',
    '',
    'Bạn bước qua cổng.',
    '',
    '<UpdateVariable>',
    '<JSONPatch>',
    '[ { "op": "delta", "path": "/Thế Giới/Phút", "value": 5 } ]',
    '</JSONPatch>',
    '</UpdateVariable>',
  ].join('\n');

  it('sạch khối tư duy — đọc lại rác của chính mình thì lượt sau nó càng nhả rác', () => {
    const h = RT.splitReply(RAW).history;
    expect(h).not.toContain('tableThink');
    expect(h).not.toContain('metacognition');
  });

  it('nhưng GIỮ khối cập nhật biến — đó là mẫu định dạng duy nhất AI có trong ngữ cảnh', () => {
    const h = RT.splitReply(RAW).history;
    expect(h).toContain('<JSONPatch>');
    expect(h).toContain('"op": "delta"');
    expect(h.startsWith('Bạn bước qua cổng.')).toBe(true);
  });

  it('historyPrompts dọn lại từ `text`, nên nhật ký lưu TRƯỚC bản vá cũng sạch', () => {
    RT.state.log = [
      { role: 'user', text: 'đi tiếp' },
      { role: 'assistant', text: RAW, view: RAW, at: '' }, // bản cũ: view còn nguyên rác
    ];
    const prompts = RT.historyPrompts();
    expect(prompts[0]).toEqual({ role: 'user', content: 'đi tiếp' });
    expect(prompts[1].content).not.toContain('metacognition');
    expect(prompts[1].content).toContain('<JSONPatch>');
    RT.state.log = [];
  });
});

describe('(bug 202) nhật ký cũ lưu trong biến chat phải tự lành', () => {
  const DIRTY = '<thinking>ngẫm</thinking>\nLời kể cũ.';

  it('mục ghi trước bản vá (không có dấu phiên bản) thì tính lại, không tin `view`', () => {
    expect(RT.viewOf({ role: 'assistant', text: DIRTY, view: DIRTY })).toBe('Lời kể cũ.');
  });

  it('mục do bản này ghi ra thì tin `view`, khỏi tính lại mỗi lần vẽ', () => {
    const e = RT.logEntryOf(DIRTY, '10:00');
    // (bug 212) 2 → 3: bộ lọc học thêm luật mới nên view cũ phải được tính lại.
    expect(e.vc).toBe(3);
    expect(e.view).toBe('Lời kể cũ.');
    expect(RT.viewOf({ ...e, view: 'ĐÃ SỬA TAY' })).toBe('ĐÃ SỬA TAY');
  });

  it('lời người chơi thì hiện đúng nguyên văn họ gõ, không lọc gì', () => {
    expect(RT.viewOf({ role: 'user', text: 'tôi nói <b>thế</b>' })).toBe('tôi nói <b>thế</b>');
  });
});

/* ───────────────────────────── 201 · tràn chữ ───────────────────────────── */

describe('(bug 201) luật CSS chặn tràn chữ — mất một luật là chữ biến mất, không có lỗi đỏ', () => {
  const css = fs.readFileSync(THEME, 'utf8');
  // Bổ CSS thành từng khối rồi so tên bộ chọn: bắt bằng một regex chạy trên cả file thì
  // chú thích đứng ngay trên luật cũng lọt vào, mà chú thích ở đây có nhắc chính các giá
  // trị đang kiểm ⇒ test xanh giả.
  const blocks = css.split('}')
    .map((chunk) => {
      const i = chunk.lastIndexOf('{');
      if (i < 0) return null;
      return { sel: chunk.slice(0, i).replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: chunk.slice(i + 1) };
    })
    .filter((b): b is { sel: string; body: string } => b !== null);
  const ruleOf = (sel: string) => blocks
    .filter((b) => b.sel.split(',').map((s) => s.trim()).includes(sel))
    .map((b) => b.body)
    .join(';');

  it('nhật ký: cột lưới phải CO ĐƯỢC — đây là chốt chặn chính', () => {
    // Lưới mặc định lấy bề rộng theo nội dung rộng nhất và không cho co, nên một dòng dài
    // trong MỘT bong bóng kéo TẤT CẢ bong bóng còn lại tràn theo (đo được: 899px / 630px).
    expect(ruleOf('.fe-log')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(ruleOf('.fe-msg')).toMatch(/min-width:\s*0/);
  });

  it('gốc thẻ đặt overflow-wrap: anywhere để cả cây con thừa kế', () => {
    // Phải là `anywhere` chứ không phải `break-word`: chỉ `anywhere` mới hạ bề rộng tối
    // thiểu của khối, tức là mới cho lưới/flex co lại thật.
    expect(ruleOf('.fe-root')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(ruleOf('.fe-root')).toMatch(/max-width:\s*100%/);
  });

  it('mọi lưới auto-fit đều dùng min() — khung hẹp hơn cột thì cột phải co theo khung', () => {
    for (const sel of ['.fe-grid', '.fe-cards', '.fe-form-grid']) {
      expect(ruleOf(sel), sel).toMatch(/minmax\(min\(\d+px,\s*100%\),\s*1fr\)/);
    }
  });

  it('chip không còn nowrap — tên khu vực dài từng chọc thẳng ra khỏi mép thẻ', () => {
    expect(ruleOf('.fe-chip')).not.toMatch(/white-space:\s*nowrap/);
    expect(ruleOf('.fe-chip')).toMatch(/max-width:\s*100%/);
  });

  it('nút hành động nhanh mang cả một câu do thẻ đặt → cho xuống dòng', () => {
    expect(ruleOf('.fe-toolbar .fe-btn')).toMatch(/white-space:\s*normal/);
  });

  it('phần tử flex co được: thanh chỉ số và ô nhập', () => {
    expect(ruleOf('.fe-bar-track')).toMatch(/min-width:\s*0/);
    expect(ruleOf('.fe-input')).toMatch(/min-width:\s*0/);
  });
});

/* ─────────────── 206 · regex hiển thị của thẻ áp lên khung chat ─────────────── */

/**
 * (bug 206) Khung chat nhúng tự vẽ lời kể, nên nó nằm ngoài đường đi của regex hiển thị
 * SillyTavern: mọi script làm đẹp người chơi đã cài chạy cho chat gốc thì được, vào tới đây
 * là mất sạch. Nay runtime tự đọc danh sách regex của thẻ và áp đúng thứ tự ấy.
 *
 * Test nạp regex giả qua đúng cái cổng mà quán rượu dùng — hàm toàn cục getTavernRegexes.
 */
describe('(bug 206) regex của thẻ chạm được vào khung chat nhúng', () => {
  const g = globalThis as Record<string, unknown>;
  const feed = (list: unknown[]) => {
    g.getTavernRegexes = () => list;
    (RT as unknown as { resetCardRegexes: () => void }).resetCardRegexes();
  };
  const script = (over: Record<string, unknown> = {}) => ({
    script_name: 'Tô màu lời thoại',
    enabled: true,
    find_regex: '/"([^"]+)"/g',
    replace_string: '<span class="thoai">$1</span>',
    source: { ai_output: true, user_input: false },
    destination: { display: true, prompt: false },
    trim_strings: [],
    ...over,
  });

  afterEach(() => { delete g.getTavernRegexes; (RT as unknown as { resetCardRegexes: () => void }).resetCardRegexes(); });

  it('nhóm bắt $1 và macro đoạn khớp đều được thay đúng', () => {
    feed([script()]);
    const out = RT.applyCardRegexes('Lão nói "đi thôi" rồi quay lưng.');
    expect(out.changed).toBe(true);
    expect(out.text).toBe('Lão nói <span class="thoai">đi thôi</span> rồi quay lưng.');

    feed([script({ replace_string: '[[{{match}}]]' })]);
    expect(RT.applyCardRegexes('Lão nói "đi thôi".').text).toBe('Lão nói [["đi thôi"]].');
  });

  it('regex sinh HTML thì hiện thẳng, không escape — đó chính là việc của script làm đẹp', () => {
    feed([script()]);
    expect(RT.renderBody('Lão nói "đi thôi".')).toContain('<span class="thoai">đi thôi</span>');
  });

  it('KHÔNG áp hai script [FE] — chúng thay cả tin nhắn, áp vào là giao diện tự nuốt chính nó', () => {
    feed([script({ script_name: '[FE] Màn Chính', find_regex: '/[\s\S]+/', replace_string: 'NUỐT' })]);
    expect(RT.applyCardRegexes('Lời kể.').text).toBe('Lời kể.');
  });

  it('bỏ qua script đã tắt, script chỉ-prompt, và script chỉ nhận lời người chơi', () => {
    for (const over of [
      { enabled: false },
      { destination: { display: false, prompt: true } },
      { source: { ai_output: false, user_input: true } },
    ]) {
      feed([script(over)]);
      expect(RT.applyCardRegexes('Lão nói "đi thôi".').changed, JSON.stringify(over)).toBe(false);
    }
  });

  it('regex hỏng cú pháp bị bỏ qua lặng lẽ — một script sai không được làm câm cả khung chat', () => {
    feed([script({ find_regex: '/([unclosed/g' }), script()]);
    expect(RT.applyCardRegexes('Lão nói "đi thôi".').text)
      .toBe('Lão nói <span class="thoai">đi thôi</span>.');
  });

  it('không có regex nào thì giữ nguyên đường cũ: markdown nhẹ, escape hết', () => {
    feed([]);
    expect(RT.renderBody('Nguy hiểm <script>alert(1)</script>')).not.toContain('<script>');
  });

  it('thẻ chạy mã bị gỡ khỏi HTML do regex sinh ra', () => {
    feed([script({ find_regex: '/BOM/g', replace_string: '<div onclick="x()">ổn</div><script>hack()</script>' })]);
    const html = RT.renderBody('BOM');
    expect(html).toContain('<div>ổn</div>');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('hack()');
  });

  it('quán rượu không cho getTavernRegexes thì khung chat vẫn chạy như cũ', () => {
    delete g.getTavernRegexes;
    (RT as unknown as { resetCardRegexes: () => void }).resetCardRegexes();
    expect(RT.renderBody('Lời kể bình thường.')).toContain('Lời kể bình thường.');
  });
});

/* ────────── 209 · lời kể biến mất ngay sau khi nhả xong chữ ────────── */

/**
 * (bug 209) Người chơi thấy lượt kể chạy từng chữ bình thường, nhả xong thì bong bóng trắng
 * bong. Chỉ có ĐÚNG MỘT khác biệt giữa hai lúc đó: lúc nhả chữ đi qua `mdLite`, lúc chốt đi
 * qua `renderBody` — tức là qua dàn regex hiển thị của thẻ, thêm ở bản 206.
 *
 * Và gần như thẻ nào có bảng giao diện riêng cũng mang một script XOÁ SẠCH LỜI KỂ ở lớp hiển
 * thị, vì lời kể đã được vẽ lại trong bảng. Bản 206 chối script ấy theo TÊN (`[FE] …`) nên
 * chỉ chối được đúng hai script do chính app sinh ra; script cùng loại của thẻ khác lọt hết.
 * Nay chối theo VIỆC NÓ LÀM.
 */
describe('(bug 209) script của thẻ không được xoá trắng khung chat nhúng', () => {
  const g = globalThis as Record<string, unknown>;
  const feed = (list: unknown[]) => {
    g.getTavernRegexes = () => list;
    RT.resetCardRegexes();
  };
  const script = (over: Record<string, unknown> = {}) => ({
    script_name: 'Ẩn lời kể (thẻ tự vẽ lại trong bảng)',
    enabled: true,
    source: { ai_output: true, user_input: false },
    destination: { display: true, prompt: false },
    trim_strings: [],
    ...over,
  });

  const KE = 'Bạn bước qua cổng đá, gió Veil rít lên từng hồi trong lòng thung lũng cạn.';

  afterEach(() => { delete g.getTavernRegexes; RT.resetCardRegexes(); });

  it('script XOÁ SẠCH lời kể bị chối, dù tên nó không phải [FE]', () => {
    feed([script({ find_regex: '/[\\s\\S]+/', replace_string: '' })]);
    const out = RT.applyCardRegexes(KE);
    expect(out.changed).toBe(false);
    expect(out.text).toBe(KE);
    expect(RT.renderBody(KE)).toContain('gió Veil');
  });

  it('script NUỐT TRỌN tin nhắn rồi nhả ra thứ khác hẳn cũng bị chối', () => {
    feed([script({ find_regex: '/^[\\s\\S]+$/', replace_string: '<div class="bang">HP 10/10</div>' })]);
    expect(RT.applyCardRegexes(KE).text).toBe(KE);
  });

  it('script nhồi CẢ MỘT TRANG HTML vào bị chối — đó là script [FE] của thẻ khác', () => {
    const trang = '<' + '!DOCTYPE html><html lang="vi"><body>' + KE + ' (đủ dài)</body></html>';
    feed([script({ script_name: 'Màn Chính của thẻ khác', find_regex: '/[\\s\\S]+/', replace_string: trang })]);
    expect(RT.applyCardRegexes(KE).text).toBe(KE);
  });

  it('nhưng script LÀM ĐẸP bọc cả bài trong một khung thì VẪN chạy — nó giữ nguyên chữ', () => {
    feed([script({
      script_name: 'Khung lời kể',
      find_regex: '/^[\\s\\S]+$/',
      replace_string: '<div class="khung">{{match}}</div>',
    })]);
    const out = RT.applyCardRegexes(KE);
    expect(out.changed).toBe(true);
    expect(out.text).toBe('<div class="khung">' + KE + '</div>');
  });

  it('chốt chặn cuối: bộ lọc thẻ nguy hiểm ăn hết nội dung thì lùi về lời kể gốc', () => {
    // Ở đây regex qua được vòng lọc (còn chữ "ổn"), nhưng sanitize gỡ TRỌN khối iframe.
    feed([script({ find_regex: '/[\\s\\S]+/', replace_string: '<iframe>ổn</iframe>' })]);
    expect(RT.renderBody(KE)).toContain('gió Veil');
  });

  it('script chỉ tô màu vài chữ vẫn giữ được chỗ ngắt đoạn', () => {
    feed([script({ script_name: 'Nhấn thuật ngữ', find_regex: '/Veil/g', replace_string: '<b>Veil</b>' })]);
    const html = RT.renderBody('Đoạn một nhắc Veil.\n\nĐoạn hai.');
    expect(html).toContain('<b>Veil</b>');
    expect(html).toMatch(/<\/p>\s*<p>/);
  });

  it('đúng ca của user: dàn regex thẻ Eldran + một script ẩn lời kể ⇒ lời kể vẫn sống', () => {
    feed([
      script({ script_name: '[AI] Loại bỏ khối UpdateVariable', find_regex: '/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/gm', replace_string: '' }),
      script({ script_name: '[AI] Ẩn lời kể', find_regex: '/^[\\s\\S]*$/', replace_string: '' }),
      script({ script_name: '[Style] Nhấn mạnh Thuật ngữ Game', find_regex: '/(Veil)/g', replace_string: '<span style="color:#c084fc;">$1</span>' }),
    ]);
    const html = RT.renderBody(KE);
    expect(RT.hasVisibleText(html)).toBe(true);
    expect(html).toContain('color:#c084fc;');
  });

  it('bong bóng trống thì hasVisibleText nói đúng sự thật', () => {
    expect(RT.hasVisibleText('<p></p>')).toBe(false);
    expect(RT.hasVisibleText('<div><span> </span></div>')).toBe(false);
    expect(RT.hasVisibleText('<p>có chữ</p>')).toBe(true);
  });
});
