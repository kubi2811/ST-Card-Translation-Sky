/**
 * (bug 232 — lượt 2) "Cậu chỉ sửa cho case tiền tài/tiền bạc. Phải có rule hay logic nào fix triệt
 * để bug này chứ, lần sau card khác không còn bị bug kiểu này nữa."
 *
 * User nói đúng. Đo lại trên THẺ THẬT của user (bug/232, cặp PNG gốc + JSON đã dịch), bản vá lượt 1
 * hụt ở hai chỗ, và cả hai đều là lỗ hổng NGUYÊN TẮC chứ không phải thiếu một ca:
 *
 *   1. BỎ NGUYÊN TRƯỜNG KHI SỐ TÊN LỆCH. Bản vá lượt 1 chỉ ghép vị trí khi số chuỗi hai bên bằng
 *      nhau. Đo được: 31/71 trường (44%) có số tên lệch — AI thêm/bớt một chuỗi là cả trường mất
 *      trắng cơ hội được sửa. Đúng những trường to nhất lại hay lệch nhất.
 *
 *   2. CHỈ KHỚP KHI CẢ TÊN ĐÚNG BẰNG MỤC TỪ ĐIỂN. Thực tế thuật ngữ nằm LỒNG trong tên dài hơn:
 *        模块二_蝴蝶效应   →  "Mô đun 2_Hiệu ứng cánh bướm"     (từ điển: 蝴蝶效应 → Hiệu Ứng Hồ Điệp)
 *        业务能力曲线      →  "Đường cong năng lực nghiệp vụ"    (từ điển: 业务能力 → Năng Lực Nghiệp Vụ)
 *      Tra cả-tên thì không thấy gì, nên không sửa được chỗ nào.
 *
 * NGUYÊN TẮC CHUNG thay cho việc vá từng ca: **từ điển là chân lý, và bản dịch của một cái TÊN
 * phải SUY RA ĐƯỢC từ bản gốc + từ điển** — không phụ thuộc trí nhớ của mô hình. Tên gốc chứa
 * thuật ngữ nào thì bản dịch phải mang đúng bản dịch của thuật ngữ ấy, dù nó nằm giữa tên.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { enforceDictOnAlignedNames, recanonicalizeMvuInFields } from '../mvuSync';

const field = (o: Record<string, unknown>) => ({
  path: 'p', label: 'l', group: 'tavern_helper', status: 'done',
  original: '', translated: '', ...o,
}) as never;

describe('(bug 232 lượt 2) thuật ngữ LỒNG trong tên dài hơn', () => {
  const DICT = { '蝴蝶效应': 'Hiệu Ứng Hồ Điệp', '业务能力': 'Năng Lực Nghiệp Vụ' };

  it('ca thật của thẻ: 模块二_蝴蝶效应 → phải thành "Mô đun 2_Hiệu Ứng Hồ Điệp"', () => {
    const o = '模块二_蝴蝶效应:\n  文抄判定: x\n';
    const t = 'Mô đun 2_Hiệu ứng cánh bướm:\n  Phán định sao chép: x\n';
    const r = enforceDictOnAlignedNames(o, t, DICT);
    expect(r.text).toContain('Mô đun 2_Hiệu Ứng Hồ Điệp');
    expect(r.text, 'phần KHÔNG có trong từ điển phải giữ nguyên bản dịch của AI')
      .toContain('Phán định sao chép');
  });

  it('ca thật thứ hai: 业务能力曲线 — tiếng Việt đảo trật tự từ nên KHÔNG đoán chỗ chèn, nhưng vẫn gom đúng HOA/THƯỜNG', () => {
    const o = "'业务能力曲线': z.string(),";
    const t = "'Đường cong năng lực nghiệp vụ': z.string(),";
    const r = enforceDictOnAlignedNames(o, t, DICT);
    // Bản dịch của thuật ngữ đã nằm sẵn trong tên, chỉ lệch kiểu chữ → gom về đúng dạng từ điển.
    expect(r.text).toBe("'Đường cong Năng Lực Nghiệp Vụ': z.string(),");
  });

  it('AN TOÀN: từ điển phủ một phần mà bản dịch dùng HẲN TỪ KHÁC thì KHÔNG đoán chỗ chèn', () => {
    const o = "'业务能力曲线': z.string(),";
    const t = "'Đường cong khả năng kinh doanh': z.string(),";
    expect(enforceDictOnAlignedNames(o, t, DICT).text).toBe(t);
  });

  it('cả tên đúng bằng mục từ điển vẫn chạy như cũ', () => {
    const r = enforceDictOnAlignedNames("'钱财': 1,", "'Tiền bạc': 1,", { '钱财': 'Tiền Tài' });
    expect(r.text).toBe("'Tiền Tài': 1,");
  });

  it('khớp DÀI NHẤT trước — 关系簿 thắng 关系', () => {
    const dict = { '关系': 'Quan Hệ', '关系簿': 'Sổ Quan Hệ' };
    const r = enforceDictOnAlignedNames("'关系簿': 1,", "'Bản đồ quan hệ': 1,", dict);
    expect(r.text).toBe("'Sổ Quan Hệ': 1,");
  });
});

describe('(bug 232 lượt 2) số tên LỆCH thì vẫn phải sửa được phần chắc chắn', () => {
  const DICT = { '钱财': 'Tiền Tài', '合约状态': 'Trạng Thái Hợp Đồng', '投资项目': 'Dự Án Đầu Tư' };

  it('AI THÊM một khoá lạ → vẫn ép được các khoá còn lại (trước đây bỏ cả trường)', () => {
    const o = "z.object({ '合约状态': a, '钱财': b, '投资项目': c })";
    const t = "z.object({ 'Trạng Thái Hợp Đồng': a, 'Ghi chú thêm': z, 'Tiền bạc': b, 'Dự Án Đầu Tư': c })";
    const r = enforceDictOnAlignedNames(o, t, DICT);
    expect(r.text).toContain("'Tiền Tài'");
    expect(r.text, 'khoá AI tự thêm thì không được đụng').toContain("'Ghi chú thêm'");
    expect(r.text).toContain("'Dự Án Đầu Tư'");
  });

  it('AI BỚT một khoá → phần còn lại vẫn được ép đúng', () => {
    const o = "z.object({ '合约状态': a, '钱财': b, '投资项目': c })";
    const t = "z.object({ 'Trạng Thái Hợp Đồng': a, 'Tiền bạc': b })";
    const r = enforceDictOnAlignedNames(o, t, DICT);
    expect(r.text).toContain("'Tiền Tài'");
  });
});

describe('(bug 232 lượt 2) AN TOÀN — không có căn cứ thì không đụng', () => {
  const DICT = { '钱财': 'Tiền Tài' };

  it('tên gốc KHÔNG chứa thuật ngữ nào → giữ nguyên tuyệt đối', () => {
    const o = "z.object({ 'foo': a, 'bar': b })";
    const t = "z.object({ 'Cái này': a, 'Cái kia': b })";
    expect(enforceDictOnAlignedNames(o, t, DICT).text).toBe(t);
  });

  it('từ điển rỗng → giữ nguyên tuyệt đối', () => {
    const t = "z.object({ 'Tiền bạc': b })";
    expect(enforceDictOnAlignedNames("z.object({ '钱财': b })", t, {}).text).toBe(t);
  });

  it('không ghép được vị trí (lệch quá nhiều, không có mỏ neo) → thà bỏ còn hơn đoán bừa', () => {
    const o = "'钱财': a";
    const t = "'x': 1, 'y': 2, 'z': 3, 'w': 4, 'v': 5, 'u': 6";
    expect(enforceDictOnAlignedNames(o, t, DICT).text).toBe(t);
  });

  it('bản dịch ĐÃ ĐÚNG thì không sinh sửa đổi thừa', () => {
    const r = enforceDictOnAlignedNames("'钱财': a", "'Tiền Tài': a", DICT);
    expect(r.fixes).toHaveLength(0);
  });
});

describe('(bug 232 lượt 2) nối vào nút "Đồng nhất tên biến MVU"', () => {
  it('ép theo bản gốc + từ điển cho MỌI field code, kể cả khi số tên lệch', () => {
    const DICT = { '蝴蝶效应': 'Hiệu Ứng Hồ Điệp', '钱财': 'Tiền Tài' };
    const fields = [
      field({
        path: 'data.character_book.entries[4].content', group: 'lorebook', entryType: 'initvar',
        original: '模块二_蝴蝶效应:\n  钱财: 5000\n',
        translated: 'Mô đun 2_Hiệu ứng cánh bướm:\n  Tiền bạc: 5000\n  Ghi chú: x\n',
      }),
    ];
    const out = (recanonicalizeMvuInFields(fields, DICT).fields as unknown as { translated: string }[])[0].translated;
    expect(out).toContain('Mô đun 2_Hiệu Ứng Hồ Điệp');
    expect(out).toContain('Tiền Tài: 5000');
  });

  it('field VĂN XUÔI không bị đụng', () => {
    const DICT = { '钱财': 'Tiền Tài' };
    const fields = [
      field({
        path: 'data.character_book.entries[9].content', group: 'lorebook',
        original: '他有很多钱财。', translated: 'Hắn có rất nhiều tiền bạc.',
      }),
    ];
    const out = (recanonicalizeMvuInFields(fields, DICT, undefined, true).fields as unknown as { translated: string }[])[0].translated;
    expect(out).toBe('Hắn có rất nhiều tiền bạc.');
  });
});

/**
 * ĐỐI CHỨNG TRÊN THẺ THẬT của user (bug/232 — cặp PNG gốc + JSON đã dịch).
 * Thư mục bug/ nằm trong .gitignore nên test tự bỏ qua ở máy không có file, đúng kiểu gated
 * fixture repo đang dùng. Đây là phép đo quan trọng nhất: luật mới phải bắt được đúng những chỗ
 * user chụp màn hình gửi tới, và KHÔNG được đụng vào bất cứ thứ gì khác.
 */
const REAL_DIR = path.resolve(__dirname, '../../../bug/232');
function readPngCard(file: string): Record<string, unknown> | null {
  try {
    const buf = fs.readFileSync(file);
    let off = 8;
    while (off < buf.length) {
      const len = buf.readUInt32BE(off);
      const type = buf.toString('ascii', off + 4, off + 8);
      const data = buf.subarray(off + 8, off + 8 + len);
      if (type === 'tEXt') {
        const z = data.indexOf(0);
        if (['chara', 'ccv3'].includes(data.toString('latin1', 0, z))) {
          return JSON.parse(Buffer.from(data.toString('latin1', z + 1), 'base64').toString('utf8'));
        }
      }
      off += 12 + len;
    }
  } catch { /* không có file */ }
  return null;
}
const REAL_ORIG = readPngCard(path.join(REAL_DIR, 'Giai_Tri_TQ_XP3.8_raw.png'));
let REAL_TRANS: Record<string, unknown> | null = null;
try { REAL_TRANS = JSON.parse(fs.readFileSync(path.join(REAL_DIR, 'Giai Tri TQ XP3.8 raw.png_vi.json'), 'utf8')); } catch { /* bỏ qua */ }

/** Từ điển đọc được từ ảnh user gửi. */
const REAL_DICT: Record<string, string> = {
  '合约状态': 'Trạng Thái Hợp Đồng', '投资项目': 'Dự Án Đầu Tư', '关系簿': 'Sổ Quan Hệ',
  '蝴蝶效应': 'Hiệu Ứng Hồ Điệp', '钱财': 'Tiền Tài', '社交版图': 'Mạng Lưới Xã Hội',
  '媒体风向': 'Xu Hướng Truyền Thông', '业务能力': 'Năng Lực Nghiệp Vụ',
  '社会风评': 'Dư Luận Xã Hội', '广告代言': 'Đại Diện Quảng Cáo',
};

const codeTexts = (card: Record<string, unknown> | null): Array<[string, string]> => {
  const out: Array<[string, string]> = [];
  const d = ((card as { data?: Record<string, unknown> })?.data ?? card ?? {}) as Record<string, never>;
  const ext = (d.extensions ?? {}) as Record<string, never>;
  ((ext.TavernHelper_scripts as Array<{ content?: string }>) || []).forEach((s, i) => out.push([`th[${i}]`, s?.content || '']));
  ((ext.regex_scripts as Array<{ replaceString?: string }>) || []).forEach((s, i) => out.push([`rx[${i}]`, s?.replaceString || '']));
  (((d.character_book as { entries?: Array<{ content?: string }> })?.entries) || []).forEach((e, i) => out.push([`lb[${i}]`, e?.content || '']));
  return out;
};

describe('(bug 232 lượt 2) đối chứng trên THẺ THẬT của user', () => {
  const skip = !REAL_ORIG || !REAL_TRANS;

  it.skipIf(skip)('bắt được đúng những chỗ user chụp màn hình gửi tới', () => {
    const O = codeTexts(REAL_ORIG), T = codeTexts(REAL_TRANS);
    const all: string[] = [];
    for (let i = 0; i < Math.min(O.length, T.length); i++) {
      if (O[i][0] !== T[i][0] || !O[i][1] || !T[i][1]) continue;
      for (const f of enforceDictOnAlignedNames(O[i][1], T[i][1], REAL_DICT).fixes) {
        all.push(`${f.found} → ${f.replaced}`);
      }
    }
    const joined = all.join('\n');
    // Đúng các ca trong ảnh.
    expect(joined).toContain('Tiền bạc → Tiền Tài');
    expect(joined).toContain('Hiệu ứng cánh bướm → Hiệu Ứng Hồ Điệp');
    expect(joined).toContain('Năng lực chuyên môn → Năng Lực Nghiệp Vụ');
    expect(joined).toContain('Đánh giá xã hội → Dư Luận Xã Hội');
    expect(all.length, `chỉ sửa được ${all.length} chỗ`).toBeGreaterThanOrEqual(10);
  });

  it.skipIf(skip)('AN TOÀN: ngoài đúng những chỗ báo sửa thì không đụng một ký tự nào', () => {
    const O = codeTexts(REAL_ORIG), T = codeTexts(REAL_TRANS);
    for (let i = 0; i < Math.min(O.length, T.length); i++) {
      if (O[i][0] !== T[i][0] || !O[i][1] || !T[i][1]) continue;
      const r = enforceDictOnAlignedNames(O[i][1], T[i][1], REAL_DICT);
      const delta = r.fixes.reduce((a, f) => a + (f.replaced.length - f.found.length), 0);
      expect(r.text.length, `${O[i][0]}: độ dài đổi khác tổng các chỗ đã báo`).toBe(T[i][1].length + delta);
    }
  });

  it.skipIf(skip)('chạy hai lần ra kết quả y hệt — ép xong là ổn định, không dao động', () => {
    const O = codeTexts(REAL_ORIG), T = codeTexts(REAL_TRANS);
    for (let i = 0; i < Math.min(O.length, T.length); i++) {
      if (O[i][0] !== T[i][0] || !O[i][1] || !T[i][1]) continue;
      const once = enforceDictOnAlignedNames(O[i][1], T[i][1], REAL_DICT).text;
      const twice = enforceDictOnAlignedNames(O[i][1], once, REAL_DICT);
      expect(twice.fixes, `${O[i][0]}: lượt hai còn sửa tiếp`).toHaveLength(0);
    }
  });
});
