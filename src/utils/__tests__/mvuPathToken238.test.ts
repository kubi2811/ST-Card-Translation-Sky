/**
 * (bug 238) "Đã có từ điển MVU rồi mà thay vào thẻ vẫn không đúng y chang"
 * ─────────────────────────────────────────────────────────────────────────────
 * User gửi hai bản báo lỗi trên chính thẻ của họ:
 *
 *   NHÓM 3 — KHÔNG TÔN TRỌNG TITLE CASE: từ điển/Zod chốt `Thời Gian Hiện Tại`, nhưng trong entry
 *   quy tắc biến ấy được gọi bằng ĐƯỜNG DẪN và gõ thường lộn xộn: `[Thế giới.Thời gian hiện tại]`.
 *   12 cặp sai/đúng trong ảnh — chạy qua bộ ép tên biến: sửa được 0/12.
 *
 *   NHÓM 2 — SAI TÊN THUỘC TÍNH: `Sổ Ghi Nhớ` lẽ ra là `Bản Ghi Nhớ`, `Tiền bạc` → `Tiền Tài`…
 *   Biến thể loại này nằm trong khối InitVar và rải rác trong các Rule, tức cũng ở dạng path.
 *
 * GỐC RỄ (tái hiện được, tất định — xem từng describe dưới):
 *   1. Token path `[A.B]` trong văn quy tắc không nằm trong nháy, không phải khoá YAML một đoạn,
 *      không phải node HTML ⇒ KHÔNG pass nào của `enforceVariableCasing` chạm tới.
 *   2. Ngược lại, `applyMvuToText` thì chạm — chạm sai: chốt dot→bracket chỉ đòi một ký tự `\w`
 *      trước dấu chấm, mà chữ Việt có dấu vẫn kết thúc bằng ký tự ASCII ("Giới" → `i`), nên nó xẻ
 *      token path thành biểu thức JS: `[Thế Giới['Thời Gian Hiện Tại']]`. AI trong game copy hình
 *      dạng đó vào lệnh cập nhật ⇒ nháy đơn lồng nháy đơn ⇒ vỡ. Đây là ca "gây lỗi json".
 *   3. Pass macro tra NGUYÊN chuỗi nên path nhiều đoạn không bao giờ khớp một mục từ điển.
 *   4. Khoảng trắng sau dấu chấm sống sót (`[Nhân mạch. AI tiếp quản]`): tra khoá thì `trim()`,
 *      ghi lại thì không ⇒ `_.get` tra khoá `' AI Tiếp Quản'` và trả undefined.
 */
import { describe, it, expect } from 'vitest';
import {
  applyMvuToText,
  bracketizeDotAccess,
  enforceDictVariants,
  enforceInitvarCovariance,
  enforceVariableCasing,
  recanonicalizeMvuInCard,
} from '../mvuSync';
import type { CharacterCard } from '../../types/card';

/** Từ điển dựng lại từ chính thẻ user gửi (Zod chốt Title Case). */
const DICT: Record<string, string> = {
  '世界': 'Thế Giới',
  '当前时间': 'Thời Gian Hiện Tại',
  '当前地点': 'Địa Điểm Hiện Tại',
  '主角': 'Nhân Vật Chính',
  '职业': 'Nghề Nghiệp',
  '身体状态': 'Trạng Thái Cơ Thể',
  '外貌': 'Ngoại Hình',
  '专业评价': 'Đánh Giá Chuyên Môn',
  '当前地位': 'Vị Thế Hiện Tại',
  '业务能力': 'Năng Lực Nghiệp Vụ',
  '价值分析': 'Phân Tích Giá Trị',
  '合约状态': 'Trạng Thái Hợp Đồng',
  '投资项目': 'Dự Án Đầu Tư',
  '广告代言': 'Đại Diện Quảng Cáo',
  '代表作': 'Tác Phẩm Tiêu Biểu',
  '影视作品': 'Tác Phẩm Phim Ảnh',
  '人脉': 'Nhân Mạch',
  'AI接管': 'AI Tiếp Quản',
};

/** Nguyên văn 12 cặp trong ảnh NHÓM 3 của user. */
const NHOM_3: [string, string][] = [
  ['[Thế giới.Thời gian hiện tại]', '[Thế Giới.Thời Gian Hiện Tại]'],
  ['[Thế giới.Địa điểm hiện tại]', '[Thế Giới.Địa Điểm Hiện Tại]'],
  ['[Nhân vật chính.Nghề nghiệp]', '[Nhân Vật Chính.Nghề Nghiệp]'],
  ['[Nhân vật chính.Trạng thái cơ thể]', '[Nhân Vật Chính.Trạng Thái Cơ Thể]'],
  ['[Nhân vật chính.Ngoại hình]', '[Nhân Vật Chính.Ngoại Hình]'],
  ['[Đánh giá chuyên môn.Vị thế hiện tại]', '[Đánh Giá Chuyên Môn.Vị Thế Hiện Tại]'],
  ['[Đánh giá chuyên môn.Năng lực nghiệp vụ]', '[Đánh Giá Chuyên Môn.Năng Lực Nghiệp Vụ]'],
  ['[Phân tích giá trị.Trạng thái hợp đồng]', '[Phân Tích Giá Trị.Trạng Thái Hợp Đồng]'],
  ['[Phân tích giá trị.Dự án đầu tư]', '[Phân Tích Giá Trị.Dự Án Đầu Tư]'],
  ['[Phân tích giá trị.Đại diện quảng cáo]', '[Phân Tích Giá Trị.Đại Diện Quảng Cáo]'],
  ['[Tác phẩm tiêu biểu.Tác phẩm phim ảnh]', '[Tác Phẩm Tiêu Biểu.Tác Phẩm Phim Ảnh]'],
  // Ca nặng nhất: thừa khoảng trắng SAU dấu chấm — sửa hoa/thường mà giữ khoảng trắng là vẫn hỏng.
  ['[Nhân mạch. AI tiếp quản]', '[Nhân Mạch.AI Tiếp Quản]'],
];

describe('(bug 238) NHÓM 3 — token path trong entry quy tắc', () => {
  for (const [bad, good] of NHOM_3) {
    it(`ép về Title Case: ${bad}`, () => {
      const line = `- \`${bad}\`: cập nhật mỗi lượt`;
      const out = enforceVariableCasing(line, DICT).text;
      expect(out).toContain(good);
      expect(out).not.toContain(bad);
    });
  }

  it('sửa cả 12 ca trong MỘT entry quy tắc, không sót ca nào', () => {
    const entry = NHOM_3.map(([bad], i) => `${i + 1}. \`${bad}\` — mô tả biến`).join('\n');
    const out = enforceVariableCasing(entry, DICT).text;
    for (const [bad, good] of NHOM_3) {
      expect(out, `còn sót ${bad}`).toContain(good);
    }
  });

  it('macro có path cũng được tách theo dấu chấm (trước đây tra nguyên chuỗi nên trượt hết)', () => {
    expect(enforceVariableCasing('{{getvar::Thế giới.Thời gian hiện tại}}', DICT).text)
      .toBe('{{getvar::Thế Giới.Thời Gian Hiện Tại}}');
    expect(enforceVariableCasing('{{setvar::Nhân vật chính.Nghề nghiệp::Ca sĩ}}', DICT).text)
      .toBe('{{setvar::Nhân Vật Chính.Nghề Nghiệp::Ca sĩ}}');
  });

  it('dòng quy tắc viết dạng khoá YAML là path', () => {
    expect(enforceVariableCasing('Thế giới.Thời gian hiện tại: buổi sáng', DICT).text)
      .toBe('Thế Giới.Thời Gian Hiện Tại: buổi sáng');
    expect(enforceVariableCasing('- Nhân vật chính.Ngoại hình: tả ngoại hình', DICT).text)
      .toBe('- Nhân Vật Chính.Ngoại Hình: tả ngoại hình');
  });

  it('khoảng trắng quanh dấu chấm bị BỎ, kể cả khi chính tả đã đúng', () => {
    // Không đoạn nào lệch hoa/thường — cái sai duy nhất là khoảng trắng, và nó cũng đủ giết path.
    expect(enforceVariableCasing(`_.get(sd, 'Nhân Mạch. AI Tiếp Quản')`, DICT).text)
      .toBe(`_.get(sd, 'Nhân Mạch.AI Tiếp Quản')`);
    expect(enforceVariableCasing('[Nhân Mạch . AI Tiếp Quản]', DICT).text)
      .toBe('[Nhân Mạch.AI Tiếp Quản]');
  });

  it('KHÔNG đụng biểu thức JS trong ngoặc vuông — mọi ca `[a.b]` có thật trong samples/', () => {
    const js = [
      `html += \`<b>\${rows[userData.name]}</b>\`;`,
      `const t = talent.thresholds[talent.thresholds.length - 1];`,
      `z.union([z.string(), z.number()])`,
      `el.querySelectorAll('[data-zone="' + zone + '"]')`,
      `arr[userData.situation.year] = 1;`,
      `const c = [0,1];`,
    ].join('\n');
    expect(enforceVariableCasing(js, DICT).text).toBe(js);
  });

  it('văn xuôi có chứa tên biến giữa câu vẫn không bị đụng', () => {
    const prose = 'Thế giới này rộng lớn, thời gian hiện tại chẳng ai đếm.';
    expect(enforceVariableCasing(prose, DICT).text).toBe(prose);
  });
});

describe('(bug 238) CA GIẾT THẺ — token path bị xẻ thành biểu thức JS', () => {
  it('token path trong entry quy tắc phải NGUYÊN VẸN sau khi áp từ điển', () => {
    const rule = '- `[Thế Giới.Thời Gian Hiện Tại]`: giờ trong game';
    const out = applyMvuToText(rule, DICT, true);
    expect(out).toBe(rule);
    // Đây là hình dạng vỡ mà bản cũ sinh ra — và là nguồn của `_.set('A['B']', …)` lồng nháy.
    expect(out).not.toContain(`['Thời Gian Hiện Tại']`);
  });

  it('bản CJK dịch sang Việt cũng ra token path, không ra bracket', () => {
    expect(applyMvuToText('- `[世界.当前时间]`: 游戏时间', DICT, true))
      .toBe('- `[Thế Giới.Thời Gian Hiện Tại]`: 游戏时间');
  });

  it('path nửa dịch nửa gốc vẫn ra token path', () => {
    expect(applyMvuToText('`[Nhân Vật Chính.职业]`', DICT, true))
      .toBe('`[Nhân Vật Chính.Nghề Nghiệp]`');
  });

  it('mẫu tìm của regex script không bị ăn mất dấu escape', () => {
    const find = String.raw`\[Thế Giới\.Thời Gian Hiện Tại\]`;
    expect(applyMvuToText(find, DICT, true)).toBe(find);
  });

  it('ĐỐI CHỨNG — dot-access JS THẬT vẫn phải thành bracket (việc 119 không được hồi quy)', () => {
    const out = applyMvuToText(`el.text(\`\${base.当前时间 || ''}\`);`, DICT, true);
    expect(out).toContain(`base['Thời Gian Hiện Tại']`);
    expect(() => new Function(out)).not.toThrow();
  });

  it('dot-access NHIỀU TẦNG: tầng sau chỉ hợp lệ sau khi tầng trước thành bracket', () => {
    // Thứ tự vòng lặp từ điển theo độ dài tên GỐC, nên bản cũ có card rơi vào đúng thứ tự sai.
    for (const src of [
      'const v = stat_data.世界.当前时间;',
      'const v = stat_data.Thế Giới.Thời Gian Hiện Tại;',
      'const v = stat_data.世界.Thời Gian Hiện Tại;',
    ]) {
      const out = applyMvuToText(src, DICT, true);
      expect(out, src).toContain(`stat_data['Thế Giới']['Thời Gian Hiện Tại']`);
      expect(() => new Function(out), src).not.toThrow();
    }
  });

  it('bracketizeDotAccess: bộ nhận phải là định danh JS thật, không phải đuôi một từ Việt', () => {
    const names = ['Thời Gian Hiện Tại', 'Thế Giới'];
    // `Giới` kết thúc bằng `i` (một ký tự \w) — chốt cũ nhận nhầm đây là định danh.
    expect(bracketizeDotAccess('[Thế Giới.Thời Gian Hiện Tại]', names)).toBe('[Thế Giới.Thời Gian Hiện Tại]');
    // Bộ nhận thật: định danh ASCII trọn vẹn, `]`, `)`.
    expect(bracketizeDotAccess('base.Thế Giới', names)).toBe(`base['Thế Giới']`);
    expect(bracketizeDotAccess('arr[0].Thế Giới', names)).toBe(`arr[0]['Thế Giới']`);
    expect(bracketizeDotAccess('fn().Thế Giới', names)).toBe(`fn()['Thế Giới']`);
    expect(bracketizeDotAccess('wd?.Thế Giới', names)).toBe(`wd?.['Thế Giới']`);
  });
});

describe('(bug 238) NHÓM 2 — biến thể sai tên thuộc tính, ở dạng path', () => {
  /** Khoá đã chuẩn hoá (đúng cách `buildDictVariantAliases` sinh ra). */
  const ALIASES: Record<string, string> = {
    'sổ ghi nhớ': 'Bản Ghi Nhớ',
    'tuổi': 'Tuổi Tác',
    'sinh nhật': 'Ngày Sinh',
    'tiền bạc': 'Tiền Tài',
    'công ty ký hợp đồng': 'Công Ty Quản Lý',
    'danh bạ quan hệ': 'Sổ Quan Hệ',
    'ai điều khiển': 'AI Tiếp Quản',
    'danh sách xóa bỏ': 'Danh Sách Đã Xóa',
    'dư luận truyền thông': 'Xu Hướng Truyền Thông',
    'chương trình tạp kỹ': 'Tác Phẩm Tạp Kỹ',
  };

  it('biến thể nằm trong token path (rải rác trong các Rule)', () => {
    expect(enforceDictVariants('`[Nhân Vật Chính.Sổ Ghi Nhớ]`', ALIASES).text)
      .toBe('`[Nhân Vật Chính.Bản Ghi Nhớ]`');
    expect(enforceDictVariants('- `[Nhân Mạch.AI Điều Khiển]`: ai đang cầm', ALIASES).text)
      .toBe('- `[Nhân Mạch.AI Tiếp Quản]`: ai đang cầm');
  });

  it('biến thể trong macro có path', () => {
    expect(enforceDictVariants('{{getvar::Phân Tích Giá Trị.Tiền bạc}}', ALIASES).text)
      .toBe('{{getvar::Phân Tích Giá Trị.Tiền Tài}}');
  });

  it('biến thể là khoá InitVar (đã chạy từ trước — chốt lại cho khỏi hồi quy)', () => {
    expect(enforceDictVariants('  Sinh nhật: "1998-04-02"\n', ALIASES).text)
      .toBe('  Ngày Sinh: "1998-04-02"\n');
  });

  it('khoảng trắng sau dấu chấm cũng bị bỏ khi ép biến thể', () => {
    expect(enforceDictVariants(`_.get(sd, 'Tài Chính. Tiền bạc')`, ALIASES).text)
      .toBe(`_.get(sd, 'Tài Chính.Tiền Tài')`);
  });

  it('KHÔNG đụng biểu thức JS', () => {
    const js = `const n = rows[item.name]; const m = [z.string()];`;
    expect(enforceDictVariants(js, ALIASES).text).toBe(js);
  });
});

describe('(bug 238) macro có path không còn bị fuzzy ăn mất đoạn cha', () => {
  it('path nhiều đoạn được tra theo TỪNG đoạn, giữ nguyên đoạn cha', () => {
    // `Ngày.Thời Gian Hiện Tại` so chuỗi-con với "Thời Gian Hiện Tại" cho tỉ lệ > 0.85 ⇒ bản cũ
    // thay NGUYÊN path bằng một tên, ăn mất đoạn `Ngày`.
    const out = enforceInitvarCovariance('{{getvar::Ngày.Thời Gian Hiện Tại}}', DICT).text;
    expect(out).toContain('Ngày.');
    expect(out).toBe('{{getvar::Ngày.Thời Gian Hiện Tại}}');
  });
});

describe('(bug 238) mẫu tìm của regex script cũng phải theo từ điển', () => {
  // Bản cũ chỉ ép `replaceString`; `findRegex` bị bỏ trắng khỏi lượt ép hoa/thường — nên mẫu tìm
  // và giao diện nói hai tên khác nhau, regex không khớp gì, bảng trạng thái trắng trơn.
  //
  // Phạm vi ép trên mẫu tìm là ĐÚNG những ngữ cảnh tên biến đã có chốt an toàn (data-var, chuỗi
  // trong nháy, token path, macro). KHÔNG ép tên trần đứng lẫn trong cú pháp regex: ở đó không có
  // gì phân biệt "tên biến" với "chữ cần khớp", đoán là phá mẫu.
  const card = {
    spec: 'chara_card_v2',
    data: {
      name: 'T',
      extensions: {
        regex_scripts: [{
          scriptName: 'Bảng trạng thái',
          findRegex: '/<div data-var="Thời gian hiện tại">([\\s\\S]*?)<\\/div>/g',
          replaceString: '<div data-var="Thời gian hiện tại"></div>',
        }],
      },
    },
  } as unknown as CharacterCard;

  it('findRegex được ép hoa/thường như replaceString', () => {
    const res = recanonicalizeMvuInCard(card, DICT);
    const script = res.card.data!.extensions!.regex_scripts![0] as { findRegex: string; replaceString: string };
    expect(script.findRegex).toContain('data-var="Thời Gian Hiện Tại"');
    expect(script.replaceString).toContain('data-var="Thời Gian Hiện Tại"');
  });

  it('không đụng phần cú pháp regex (cờ, escape, nhóm)', () => {
    const res = recanonicalizeMvuInCard(card, DICT);
    const script = res.card.data!.extensions!.regex_scripts![0] as { findRegex: string };
    expect(script.findRegex).toBe('/<div data-var="Thời Gian Hiện Tại">([\\s\\S]*?)<\\/div>/g');
  });

  it('marker prose trong mẫu tìm KHÔNG bị coi là path (ca thật trong samples/)', () => {
    // `\[khởi tạo\]`, `\[Mùa Thu Tĩnh Lặng\]` — token một đoạn, là chữ cần khớp chứ không phải biến.
    for (const pattern of [String.raw`\[khởi tạo\]`, String.raw`\[Mùa Thu Tĩnh Lặng\]`, '【开场】']) {
      expect(enforceVariableCasing(pattern, DICT).text).toBe(pattern);
    }
  });
});
