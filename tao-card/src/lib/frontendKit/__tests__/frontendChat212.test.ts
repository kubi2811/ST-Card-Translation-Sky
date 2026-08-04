/**
 * (bug 212) FRONT-END PHẢI SỐNG ĐƯỢC VỚI PRESET LẠ TẢI TỪ DIỄN ĐÀN.
 * ─────────────────────────────────────────────────────────────────────────────
 * Bằng chứng bug/212/message.txt (preset diễn đàn, KHÔNG phải 2 preset đi kèm) phơi ra:
 *   - preset mồi sẵn `<thinking>` trong lượt assistant ⇒ văn bản về CHỈ có `</thinking>` mồ
 *     côi ⇒ 47 dòng "kế hoạch viết" hiện nguyên văn trong khung chat;
 *   - dòng trạng thái bọc ba dấu huyền CÓ RUỘT trên MỘT dòng ⇒ hiện nguyên cả dấu huyền;
 *   - `<theater>`, `<choice>`, các marker `<world_logic>`… là thẻ lạ ngoài mọi danh sách ⇒
 *     hiện nguyên văn.
 * Yêu cầu user: regex CỦA PRESET phải được bắt thẻ trước (muốn dựng giao diện hay ẩn là việc
 * của regex); phần regex không xử lý thì tool tự dọn — không hiện nguyên văn nữa.
 *
 * Test nạp runtime THẬT qua buildRuntimeOnlyJs — không chép tay logic.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const KIT = path.resolve(__dirname, '../../../../..', 'frontend-kit', 'lib.mjs');
const EVIDENCE = path.resolve(__dirname, '../../../../..', 'bug', '212', 'message.txt');

interface Choice { send: string; label: string }
interface Runtime {
  splitReply: (t: string) => { narrative: string; updateBlock: string; raw: string; history: string; choices: Choice[] };
  stripHidden: (t: string, dropUpdate: boolean) => string;
  stripCore: (t: string, mode: 'plain' | 'html' | 'history') => string;
  extractChoices: (t: string) => Choice[];
  renderBody: (t: string) => string;
  applyCardRegexes: (t: string) => { text: string; changed: boolean };
  resetCardRegexes: () => void;
  hasVisibleText: (h: string) => boolean;
}

let RT: Runtime;

beforeAll(async () => {
  const kit = await import(pathToFileURL(KIT).href) as { buildRuntimeOnlyJs: () => string };
  const win: Record<string, unknown> = {};
  new Function('window', kit.buildRuntimeOnlyJs())(win);
  RT = win.STFE as Runtime;
});

/** Bản RÚT GỌN trung thành của bug/212/message.txt — đủ cả 3 lỗ, không phụ thuộc file gitignore. */
const REPLY_212 = [
  '- Xác nhận ngôn ngữ đầu ra là: Tiếng Việt.',
  '- Không gian: Trạm trung chuyển là điểm cố định. <spacetime_logic>',
  '- Linh đã xong việc với Vô Danh. <character_autonomy>',
  '- Sử dụng từ ngữ vật lý, thô ráp nhưng chân thực. <narrative_voice>',
  '</thinking>',
  '```Trạm Trung Chuyển Luminaris·Ngày 1 tháng 1 năm 3000 SC·Thứ tư·08:05```',
  '',
  'Ánh nắng sớm của Eldran không hề dịu dàng. Vô Danh dừng lại ở bậc thềm đá xám.',
  '',
  'Một nhóm thợ săn Trấn Minh vừa bước ra từ tòa nhà đó, giáp Shard-infused nửa thân.',
  '',
  '<theater>',
  '',
  '</theater>',
  '',
  '<choice>',
  '1. Thúc đẩy cốt truyện bình thường - Tiến về phía tòa nhà Đồng Đàn.',
  '2. Thúc đẩy cốt truyện vô lý - Ghé vào dãy máy bán hàng tự động.',
  '3. Thúc đẩy cốt truyện sắc tình - Tiếp cận Linh lần nữa.',
  '4. Chế độ tra khảo - Phân tích tính logic của lượt kể.',
  '</choice>',
].join('\n');

describe('(bug 212) ba lỗ đo được từ bằng chứng — khi preset KHÔNG kèm regex', () => {
  it('khối mở từ prefill (chỉ có </thinking> mồ côi) bị cắt trọn khỏi lời kể', () => {
    const n = RT.splitReply(REPLY_212).narrative;
    expect(n).not.toContain('Xác nhận ngôn ngữ');
    expect(n).not.toContain('spacetime_logic');
    expect(n).not.toContain('/thinking');
    expect(n).toContain('Ánh nắng sớm của Eldran');
  });

  it('fence trạng thái một dòng: giữ ruột, bỏ dấu huyền', () => {
    const n = RT.splitReply(REPLY_212).narrative;
    expect(n).toContain('Trạm Trung Chuyển Luminaris·Ngày 1 tháng 1 năm 3000 SC');
    expect(n).not.toContain('```');
  });

  it('thẻ lạ <theater>/<choice> không hiện nguyên văn trong lời kể', () => {
    const n = RT.splitReply(REPLY_212).narrative;
    expect(n).not.toContain('<theater>');
    expect(n).not.toContain('<choice>');
    expect(n).not.toContain('Thúc đẩy cốt truyện');   // menu thành nút, không nằm trong lời kể
    expect(n).toContain('thợ săn Trấn Minh');
  });

  it('menu <choice> thành danh sách nút: dòng đánh số gửi ĐÚNG con số', () => {
    const chs = RT.extractChoices(REPLY_212);
    expect(chs).toHaveLength(4);
    expect(chs.map(c => c.send)).toEqual(['1', '2', '3', '4']);
    expect(chs[0].label).toContain('Thúc đẩy cốt truyện bình thường');
  });

  it('renderBody trên NGUYÊN VĂN vẫn ra lời kể sạch (đường không regex)', () => {
    RT.resetCardRegexes();
    const html = RT.renderBody(REPLY_212);
    expect(html).toContain('Ánh nắng sớm');
    expect(html).not.toContain('spacetime_logic');
    expect(html).not.toContain('```');
  });
});

describe('(bug 212) nhật ký gửi lại AI — giữ ĐỦ định dạng của preset, chỉ cắt tư duy', () => {
  it('kế hoạch viết bị cắt, nhưng menu + fence trạng thái được GIỮ cho AI giữ mạch', () => {
    const h = RT.splitReply(REPLY_212).history;
    expect(h).not.toContain('Xác nhận ngôn ngữ');
    expect(h).toContain('<choice>');
    expect(h).toContain('```Trạm Trung Chuyển');
    expect(h).toContain('Ánh nắng sớm');
  });

  it('khối cập nhật biến vẫn nằm trong nhật ký', () => {
    const raw = REPLY_212 + '\n<UpdateVariable>\n<JSONPatch>\n[]\n</JSONPatch>\n</UpdateVariable>';
    const h = RT.splitReply(raw).history;
    expect(h).toContain('<UpdateVariable>');
    expect(RT.splitReply(raw).narrative).not.toContain('UpdateVariable');
  });
});

describe('(bug 212) preset CÓ regex — regex phải thấy nguyên văn và thắng bộ lọc', () => {
  const g = globalThis as Record<string, unknown>;
  const feed = (list: unknown[]) => { g.getTavernRegexes = () => list; RT.resetCardRegexes(); };
  const script = (over: Record<string, unknown>) => ({
    script_name: 'regex của preset', enabled: true,
    source: { ai_output: true, user_input: false },
    destination: { display: true, prompt: false }, trim_strings: [],
    ...over,
  });
  afterEach(() => { delete g.getTavernRegexes; RT.resetCardRegexes(); });

  it('regex dựng menu <choice> thành giao diện ⇒ HTML của nó được GIỮ, không bị lưới lọc cắt', () => {
    feed([script({
      find_regex: '/<choice>([\\s\\S]*?)<\\/choice>/',
      replace_string: '<div class="menu-preset">$1</div>',
    })]);
    const html = RT.renderBody(REPLY_212);
    expect(html).toContain('class="menu-preset"');
    expect(html).toContain('Thúc đẩy cốt truyện bình thường');
  });

  it('regex ẩn khối tư duy prefill (bắt từ đầu tới </thinking>) chạy được — mồi còn nguyên', () => {
    feed([script({ find_regex: '/^[\\s\\S]*?<\\/thinking>/', replace_string: '' })]);
    const r = RT.applyCardRegexes(REPLY_212);
    expect(r.changed).toBe(true);
    expect(r.text).not.toContain('Xác nhận ngôn ngữ');
    expect(r.text).toContain('Ánh nắng sớm');
  });

  it('regex đổi fence trạng thái thành span màu — thấy được vì fence chưa bị bóc', () => {
    feed([script({
      find_regex: '/```([^\\n]+?)```/',
      replace_string: '<span class="statusline">$1</span>',
    })]);
    const html = RT.renderBody(REPLY_212);
    expect(html).toContain('class="statusline"');
    expect(html).toContain('Trạm Trung Chuyển Luminaris');
  });
});

describe('(bug 212) lưới an toàn không ăn nhầm lời kể', () => {
  it('vỏ bọc văn bản quen tên (<gametxt>) — bỏ thẻ giữ trọn ruột', () => {
    const n = RT.stripCore('<gametxt>Lời kể nằm trọn trong vỏ.</gametxt>', 'plain');
    expect(n).toBe('Lời kể nằm trọn trong vỏ.');
  });

  it('vỏ bọc LẠ TÊN bọc cả lời kể — cắt thử thấy trống trơn thì bóc vỏ giữ ruột', () => {
    const raw = '<undiscovered_wrap>\nLời kể dài nằm hết trong một thẻ lạ mà không danh sách nào biết trước.\n</undiscovered_wrap>';
    const n = RT.stripCore(raw, 'plain');
    expect(n).toContain('Lời kể dài nằm hết');
    expect(n).not.toContain('undiscovered_wrap');
  });

  it('thẻ tên ngoài ASCII không bị đoán bừa thành thẻ kỹ thuật', () => {
    const n = RT.stripCore('<mưuKế>bí mật</mưuKế> Lời kể.', 'plain');
    expect(n).toContain('bí mật');
    expect(n).toContain('Lời kể.');
  });

  it('"5 < 6" và toán tử so sánh sống sót', () => {
    expect(RT.stripCore('Chỉ số 5 < 6 nên thua.', 'plain')).toBe('Chỉ số 5 < 6 nên thua.');
  });

  it('marker lẻ không cặp (<world_logic> giữa dòng) bị nhấc đi, chữ quanh nó còn nguyên', () => {
    const n = RT.stripCore('Trấn Minh có thợ săn đi ngang. <world_logic> Hết.', 'plain');
    expect(n).not.toContain('world_logic');
    expect(n).toContain('Trấn Minh có thợ săn đi ngang.');
    expect(n).toContain('Hết.');
  });
});

/* Chạy trên CHÍNH file bằng chứng khi có mặt (bug/ nằm ngoài git — máy khác thì bỏ qua). */
describe.skipIf(!fs.existsSync(EVIDENCE))('(bug 212) file bằng chứng thật', () => {
  it('toàn bộ 47 dòng kế hoạch + thẻ kỹ thuật biến mất, lời kể + 4 lựa chọn còn đủ', () => {
    const raw = fs.readFileSync(EVIDENCE, 'utf8');
    const parts = RT.splitReply(raw);
    expect(parts.narrative).not.toContain('Xác nhận ngôn ngữ đầu ra');
    expect(parts.narrative).not.toContain('<choice>');
    expect(parts.narrative).not.toContain('```');
    expect(parts.narrative).toContain('Ánh nắng sớm của Eldran');
    expect(parts.narrative).toContain('Trạm Trung Chuyển Luminaris·Ngày 1');
    expect(parts.choices).toHaveLength(4);
    expect(parts.choices.map(c => c.send)).toEqual(['1', '2', '3', '4']);
  });
});
