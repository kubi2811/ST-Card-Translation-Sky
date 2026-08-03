/**
 * (bug 192) BỘ FRONT-END CHO CARD: hai luật của `replaceString` + thứ tự chuỗi regex.
 * ─────────────────────────────────────────────────────────────────────────────
 * Hai lớp lỗi ở đây đều hỏng ÂM THẦM — giao diện vẫn hiện ra, không có lỗi đỏ nào,
 * chỉ là vài ký tự bốc hơi giữa một hàm JS hoặc màn hình chính không bao giờ xuất hiện.
 * Vì thế phải kiểm bằng máy chứ không thể "mở ra nhìn thấy ổn".
 *
 *  1. SillyTavern xử lý `replaceString` qua `replaceAll(/\$(\d+)|\$<([^>]+)>/g, …)` rồi
 *     `substituteParams(...)` (regex/engine.js:419-444). Nên dấu đô-la + chữ số, dấu
 *     đô-la + dấu bé hơn, và macro hai ngoặc nhọn đều bị NUỐT trước khi tới trình duyệt.
 *
 *  2. Card Eldran vốn đã có script xoá khối cập nhật biến ở luồng hiển thị. ST áp regex
 *     lần lượt trên CÙNG một chuỗi, nên nếu script xoá đó chạy trước "[FE] Màn Chính"
 *     thì tới lượt nó chẳng còn `</UpdateVariable>` nào để bắt ⇒ không có giao diện.
 *     Đây đúng là bệnh của bug 175, lần này chặn từ khâu dựng.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyDisplayChain, runsOnDisplay, stRegexFromString, type StRegexScript } from '../stRegexChain';

const KIT = path.resolve(__dirname, '../../../../..', 'frontend-kit', 'lib.mjs');

type Kit = {
  scanPayload: (html: string, label?: string) => string[];
  scanTriggers: (html: string, triggers: string[], label?: string) => string[];
  buildEldranPayloads: () => { opening: string; main: string };
  buildEldranScripts: () => StRegexScript[];
  buildRuntimeOnlyJs: () => string;
  simulateStDelivery: (mes: string) => string;
  fence: (html: string) => string;
  ELDRAN: { bootTag: string; updateTag: string };
  ELDRAN_TRIGGERS: string[];
};

let kit: Kit;
let payloads: { opening: string; main: string };
let feScripts: StRegexScript[];

beforeAll(async () => {
  kit = (await import(pathToFileURL(KIT).href)) as unknown as Kit;
  payloads = kit.buildEldranPayloads();
  feScripts = kit.buildEldranScripts();
});

/** Các script hiển thị có sẵn trong card Eldran, giữ nguyên cấu hình thật của chúng. */
const CARD_SCRIPTS: StRegexScript[] = [
  {
    scriptName: '[AI] Loại bỏ khối UpdateVariable',
    findRegex: '/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/gm',
    replaceString: '', placement: [2], markdownOnly: true, promptOnly: true,
  },
  {
    scriptName: '[Dialog] Làm nổi bật Lời Quản Trò',
    findRegex: '/(^>\\s*\\*Quản Trò(.*?)?\\*:?)/gm',
    replaceString: '<span class="gm-line">$1</span>', placement: [1], markdownOnly: true, promptOnly: false,
  },
];

describe('(bug 192) payload phải sống sót qua replaceString của SillyTavern', () => {
  it('màn khởi tạo không dính ký tự bị nuốt', () => {
    expect(kit.scanPayload(payloads.opening, 'opening')).toEqual([]);
  });

  it('màn chính không dính ký tự bị nuốt', () => {
    expect(kit.scanPayload(payloads.main, 'main')).toEqual([]);
  });

  it('không payload nào chứa nguyên văn thẻ mồi của script [FE] kia', () => {
    // Lỗi có thật lúc dựng bộ này: docblock của opening.js nhắc tên thẻ đóng khối cập nhật
    // biến ⇒ "[FE] Màn Chính" khớp ngay vào chú thích đó và nhồi cả màn hình chính vào giữa
    // màn khởi tạo. Không lỗi đỏ, chỉ hai màn hình chồng nhau và JS vỡ.
    expect(kit.scanTriggers(payloads.opening, kit.ELDRAN_TRIGGERS, 'opening')).toEqual([]);
    expect(kit.scanTriggers(payloads.main, kit.ELDRAN_TRIGGERS, 'main')).toEqual([]);
  });

  it('bộ quét thẻ mồi thật sự bắt được', () => {
    expect(kit.scanTriggers('bla </UpdateVariable> bla', kit.ELDRAN_TRIGGERS, 'x').length).toBe(1);
  });

  it('bộ quét thật sự bắt được, không phải luôn trả rỗng', () => {
    expect(kit.scanPayload("s.replace(re, '<b>$1</b>')", 'x').length).toBeGreaterThan(0);
    expect(kit.scanPayload('const a = 1; // {{random:1,2}}', 'x').length).toBeGreaterThan(0);
    expect(kit.scanPayload('xin chào {{user}}', 'x')).toEqual([]);
  });
});

describe('(bug 192) payload phải sống nguyên vẹn qua đường giao hàng của SillyTavern', () => {
  // Đây là phép kiểm ĐẮT NHẤT của bộ này. Lần chạy thật đầu tiên giao diện trắng trơn, không
  // một lỗi đỏ nào ở tầng SillyTavern; phải lấy lại đoạn script trong iframe rồi so từng dòng
  // với bản dựng mới thấy quán rượu đã sửa hai chỗ. Nay mô phỏng lại đúng hai chỗ đó.
  const scriptOf = (html: string) => (html.match(/<script>([\s\S]*?)<\/script>/) || ['', ''])[1];

  it('màn khởi tạo: đoạn script tới trình duyệt y hệt bản dựng, và biên dịch được', () => {
    const delivered = kit.simulateStDelivery(kit.fence(payloads.opening));
    expect(scriptOf(delivered)).toBe(scriptOf(payloads.opening));
    expect(() => new Function(scriptOf(delivered))).not.toThrow();
  });

  it('màn chính: đoạn script tới trình duyệt y hệt bản dựng, và biên dịch được', () => {
    const delivered = kit.simulateStDelivery(kit.fence(payloads.main));
    expect(scriptOf(delivered)).toBe(scriptOf(payloads.main));
    expect(() => new Function(scriptOf(delivered))).not.toThrow();
  });

  it('bộ mô phỏng thật sự tái hiện được hai lỗi đã gặp', () => {
    // Lỗi 1: thực thể HTML viết thẳng thì bị giải mã — đúng thứ đã giết hàm esc().
    const entity = kit.simulateStDelivery('```\nvar x = ' + "'&#39;'" + ';\n```');
    expect(entity).toContain("var x = '''");

    // Lỗi 2: cụm ba dấu huyền thứ hai đóng sớm khối che, phần sau bị bọc <q>.
    const fenceBug = kit.simulateStDelivery('```\na = 1;\n```\nsau đó "bị bọc"\n');
    expect(fenceBug).toContain('<q>"bị bọc"</q>');
  });
});

describe('(bug 192) trợ thủ Tavern phải nhận ra đây là giao diện', () => {
  it('có dấu hiệu mà isFrontend() thật sự dò (html> / <head> / <body)', () => {
    // src/util/is_frontend.ts của JS-Slash-Runner chỉ dò đúng 3 chuỗi này.
    for (const html of [payloads.opening, payloads.main]) {
      expect(['html>', '<head>', '<body'].some((t) => html.includes(t))).toBe(true);
    }
  });

  it('mỗi trang chỉ có một khối script, và khối đó biên dịch được', () => {
    for (const html of [payloads.opening, payloads.main]) {
      const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      expect(blocks).toHaveLength(1);
      expect(() => new Function(blocks[0])).not.toThrow();
    }
  });
});

describe('(bug 192) hai script [FE] chỉ được đụng vào hiển thị', () => {
  it('markdownOnly bật, promptOnly tắt — đống HTML không bao giờ đi ngược vào prompt', () => {
    for (const s of feScripts) {
      expect(s.markdownOnly, s.scriptName).toBe(true);
      expect(s.promptOnly, s.scriptName).toBe(false);
      expect(s.placement).toEqual([2]);
      expect(runsOnDisplay(s), s.scriptName).toBe(true);
    }
  });

  it('findRegex của cả hai đều dịch được thành RegExp hợp lệ', () => {
    for (const s of feScripts) expect(stRegexFromString(s.findRegex), s.scriptName).toBeInstanceOf(RegExp);
  });
});

describe('(bug 192) chuỗi hiển thị phải ra ĐÚNG màn hình', () => {
  const chain = () => [...feScripts, ...CARD_SCRIPTS];

  it('first_mes chỉ có thẻ mở màn → ra màn KHỞI TẠO, không ra màn chính', () => {
    const out = applyDisplayChain(`<${kit.ELDRAN.bootTag}/>`, chain()).text;
    expect(out).toContain('Khởi tạo — Hành Tinh Eldran');
    expect(out).not.toContain('<title>Hành Tinh Eldran</title>');
    expect(out).toContain('id="fe-app"');
  });

  it('lượt AI có khối cập nhật biến → ra màn CHÍNH', () => {
    const reply = 'Sương Veil bám trên vai bạn.\n\n<UpdateVariable>\n<JSONPatch>\n[]\n</JSONPatch>\n</UpdateVariable>';
    const out = applyDisplayChain(reply, chain()).text;
    expect(out).toContain('<title>Hành Tinh Eldran</title>');
    expect(out).toContain('id="fe-app"');
    expect(out).not.toContain('Khởi tạo — Hành Tinh Eldran');
  });

  it('CHỐT THỨ TỰ: script xoá khối biến mà chạy TRƯỚC thì màn chính biến mất', () => {
    // Đúng bệnh bug 175. Đây là lý do build.mjs chèn 2 script [FE] lên ĐẦU mảng.
    const reply = 'Lời kể.\n\n<UpdateVariable>\n<JSONPatch>\n[]\n</JSONPatch>\n</UpdateVariable>';
    const saiThuTu = [...CARD_SCRIPTS, ...feScripts];
    expect(applyDisplayChain(reply, saiThuTu).text).not.toContain('id="fe-app"');
    expect(applyDisplayChain(reply, chain()).text).toContain('id="fe-app"');
  });

  it('lời kể thô của AI vẫn bị dọn khỏi màn hình, không lộ ra cạnh giao diện', () => {
    const reply = 'Lời kể.\n\n<UpdateVariable>\n<JSONPatch>\n[{"op":"delta","path":"/a","value":1}]\n</JSONPatch>\n</UpdateVariable>';
    const out = applyDisplayChain(reply, chain()).text;
    expect(out).not.toContain('"op":"delta"');
  });
});

describe('(bug 192) vá khối cập nhật biến khi AI xuất sai định dạng', () => {
  /**
   * Đo được ở lượt chạy thật đầu tiên với Gemini: khối cập nhật sai CÙNG LÚC ba chỗ —
   * thiếu hẳn cặp thẻ JSONPatch, dùng op "add" thay vì "insert", và viết "/Kho đồ/0"
   * trong khi biến tên là "Kho Đồ". MVU bỏ qua sạch, không một lời phàn nàn: giao diện
   * lên đẹp, chỉ có điều vật phẩm/kỹ năng/quan hệ khởi đầu biến mất hết.
   */
  const STAT = {
    'Thế Giới': { 'Bối Cảnh': '', 'Phút': 0 },
    'Kho Đồ': [] as unknown[],
    'Kỹ Năng': [] as unknown[],
    'Nhân Vật': { 'VP': { 'Hiện Tại': 100 } },
  };

  // Nạp CHÍNH runtime.js vào một `window` giả rồi gọi hàm thật — không chép tay logic,
  // vì test chép tay thì chỉ kiểm được bản chép chứ không kiểm được thứ chạy trong quán rượu.
  type Norm = { normalizeUpdateBlock: (t: string, s: unknown) => { text: string; fixes: string[] } };
  let RT: Norm;
  beforeAll(() => {
    const win: Record<string, unknown> = {};
    new Function('window', kit.buildRuntimeOnlyJs())(win);
    RT = win.STFE as Norm;
  });
  const normalize = (text: string, stat: Record<string, unknown>) => RT.normalizeUpdateBlock(text, stat);

  it('thiếu thẻ JSONPatch + op "add" + sai hoa/thường đường dẫn → vá được cả ba', () => {
    const bad = '<UpdateVariable>\n[\n {"op":"add","path":"/Kho đồ/0","value":{"Tên":"Kiếm"}},\n'
      + ' {"op":"set","path":"/Thế Giới/Bối Cảnh","value":"x"}\n]\n</UpdateVariable>';
    const r = normalize(bad, STAT);
    expect(r.fixes.length).toBeGreaterThan(0);
    expect(r.text).toContain('<JSONPatch>');
    expect(r.text).toContain('"insert"');
    expect(r.text).toContain('"replace"');
    expect(r.text).toContain('/Kho Đồ/-');
    expect(r.text).not.toContain('/Kho đồ/0');
  });

  it('khối đã đúng chuẩn thì KHÔNG đụng vào', () => {
    const good = '<UpdateVariable>\n<JSONPatch>\n[{"op":"delta","path":"/Nhân Vật/VP/Hiện Tại","value":-5}]\n'
      + '</JSONPatch>\n</UpdateVariable>';
    const r = normalize(good, STAT);
    expect(r.fixes).toEqual([]);
    expect(r.text).toBe(good);
  });

  it('không có khối nào thì trả về nguyên văn, không ném', () => {
    const r = normalize('chỉ có lời kể', STAT);
    expect(r.text).toBe('chỉ có lời kể');
    expect(r.fixes).toEqual([]);
  });

  it('chỉ số vượt quá độ dài mảng → chuyển thành nối vào cuối', () => {
    const bad = '<UpdateVariable>\n<JSONPatch>\n[{"op":"insert","path":"/Kỹ Năng/7","value":{"Tên":"A"}}]\n'
      + '</JSONPatch>\n</UpdateVariable>';
    const r = normalize(bad, STAT);
    expect(r.text).toContain('/Kỹ Năng/-');
  });
});

describe('(bug 192) tách lời kể / khối biến — logic runtime dùng lại được', () => {
  // Trước đây chỗ này chép tay lại splitReply. Bản chép đứng im trong khi bản thật đổi
  // (bug 202 viết lại toàn bộ bộ lọc), nên test xanh mà quán rượu vẫn lộ khối tư duy.
  // Nay gọi thẳng hàm thật trong runtime.js.
  type Split = { splitReply: (t: string) => { narrative: string; updateBlock: string } };
  let RT: Split;
  beforeAll(() => {
    const win: Record<string, unknown> = {};
    new Function('window', kit.buildRuntimeOnlyJs())(win);
    RT = win.STFE as Split;
  });
  const splitReply = (raw: string) => RT.splitReply(raw);

  it('bóc đúng khối biến và không để sót chữ nào của nó trong lời kể', () => {
    const raw = '<thinking>ngẫm</thinking>\nBạn bước vào.\n<UpdateVariable>\n<Analysis>x</Analysis>\n<JSONPatch>\n[]\n</JSONPatch>\n</UpdateVariable>';
    const r = splitReply(raw);
    expect(r.narrative).toBe('Bạn bước vào.');
    expect(r.updateBlock).toContain('JSONPatch');
  });

  it('AI quên khối biến thì lời kể vẫn nguyên vẹn', () => {
    const r = splitReply('Chỉ có lời kể thôi.');
    expect(r.narrative).toBe('Chỉ có lời kể thôi.');
    expect(r.updateBlock).toBe('');
  });
});
