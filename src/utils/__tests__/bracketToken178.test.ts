/**
 * (bugNeedFix/178) "dịch còn ăn bớt" — 【消费监测】 dịch ra 【】 RỖNG ở rất nhiều chỗ.
 * ─────────────────────────────────────────────────────────────────────────────
 * GỐC LỖI (đã tái hiện được, tất định): ngoặc toàn giác nằm trong bảng JOINER của bộ gom token
 * CJK — cố ý, để câu dài không bị băm ở mỗi dấu câu. Nhưng token bắt buộc BẮT ĐẦU bằng chữ Hán,
 * nên với `【消费监测】支出` thì `【` nằm NGOÀI token còn `】` bị NUỐT VÀO. Token gửi đi dịch là
 * `消费监测】支出` — một cụm mang nửa cặp ngoặc mồ côi.
 *
 * Chạy thật qua API user cung cấp (gcli-gemini-3-pro):
 *   gửi `消费监测】支出`  → model trả `Theo dõi tiêu dùng】Chi tiêu`  (ngoặc lạc vào giữa bản dịch)
 *   gửi `消费监测` + `支出` → model trả `Giám sát tiêu dùng` + `Chi tiêu`  (sạch, đúng nghĩa)
 * Ghép bản đầu trở lại giữa 【 và phần sau ⇒ ngoặc nhân đôi / nhãn rơi mất — đúng ảnh user gửi.
 *
 * Test dưới đây canh phần TẤT ĐỊNH: token phải cân ngoặc trước khi rời khỏi máy.
 */
import { describe, it, expect } from 'vitest';
import { firstUnbalancedBracket, extractCJKTokens, reinsertTranslations } from '../surgical';
import { countEmptiedBrackets, scanFieldsHealth } from '../cardHealth';
import type { TranslationField } from '../../types/card';

/** Nguyên văn dòng thẻ user gửi trong bugNeedFix/178. */
const REAL_LINE = '- 模板: 【消费监测】支出{金额}元（{消费对象/类型}），有效返利{返现倍数}倍到账{返现金额}元。当前余额: {新余额}元。';

describe('firstUnbalancedBracket — tìm nửa cặp ngoặc mồ côi', () => {
  it('cụm cân ngoặc thì không cắt', () => {
    expect(firstUnbalancedBracket('消费监测')).toBe(-1);
    expect(firstUnbalancedBracket('前缀【内容】后缀')).toBe(-1);
    expect(firstUnbalancedBracket('甲（乙）丙')).toBe(-1);
  });

  it('dấu ĐÓNG mồ côi ⇒ cắt ngay trước nó (ca của user)', () => {
    expect(firstUnbalancedBracket('消费监测】支出')).toBe(4);
  });

  it('dấu MỞ chưa đóng ⇒ cắt ngay trước nó', () => {
    expect(firstUnbalancedBracket('支出（金额')).toBe(2);
  });

  it('lồng nhau vẫn tính đúng', () => {
    expect(firstUnbalancedBracket('甲【乙《丙》丁】戊')).toBe(-1);
    expect(firstUnbalancedBracket('甲【乙》丙')).toBe(3);   // 》 không khớp 【
  });

  it('nháy cong cũng là cặp — chúng cũng nằm trong bảng joiner', () => {
    expect(firstUnbalancedBracket('甲“乙”丙')).toBe(-1);
    expect(firstUnbalancedBracket('乙”丙')).toBe(1);
  });

  it('dấu câu KHÔNG có cặp thì không đụng tới — 、。，… vẫn nối câu như cũ', () => {
    expect(firstUnbalancedBracket('元。当前余额')).toBe(-1);
    expect(firstUnbalancedBracket('甲、乙，丙')).toBe(-1);
  });
});

describe('Bộ gom token trên đúng dòng thẻ user gửi', () => {
  const tokens = extractCJKTokens(REAL_LINE).map(t => t.text);

  it('KHÔNG còn token nào mang ngoặc lẻ', () => {
    for (const t of tokens) {
      expect(firstUnbalancedBracket(t), `token "${t}" còn ngoặc lẻ`).toBe(-1);
    }
  });

  it('nhãn trong ngoặc tách ra thành token riêng, sạch', () => {
    expect(tokens).toContain('消费监测');
    expect(tokens).toContain('支出');
    // Và tuyệt đối không còn cụm dính ngoặc kiểu cũ.
    expect(tokens).not.toContain('消费监测】支出');
  });

  it('không mất chữ: mọi token vẫn nằm trong dòng gốc', () => {
    for (const t of tokens) expect(REAL_LINE).toContain(t);
  });
});

describe('Ghép lại: hai dấu ngoặc luôn ôm đúng nội dung', () => {
  /** Bản dịch THẬT mà model trả về cho từng token sạch (đã chạy qua API). */
  const REAL_VI: Record<string, string> = {
    模板: 'Mẫu',
    消费监测: 'Giám sát tiêu dùng',
    支出: 'Chi tiêu',
    金额: 'Số tiền',
    元: 'tệ',
    消费对象: 'Đối tượng tiêu dùng',
    类型: 'Loại hình',
    有效返利: 'Hoàn tiền hiệu quả',
    返现倍数: 'Bội số hoàn tiền',
    倍到账: 'lần nhận được',
    返现金额: 'Số tiền hoàn lại',
    '元。当前余额': 'tệ. Số dư hiện tại',
    新余额: 'Số dư mới',
  };

  it('bản ghép KHÔNG còn 【】 rỗng, và nhãn nằm đúng trong ngoặc', () => {
    const toks = extractCJKTokens(REAL_LINE);
    for (const t of toks) t.translated = REAL_VI[t.text] ?? t.text;
    const out = reinsertTranslations(REAL_LINE, toks);

    expect(out).not.toContain('【】');
    expect(out).toContain('【Giám sát tiêu dùng】');
    // Phần sau ngoặc vẫn còn nguyên, không bị nuốt theo.
    expect(out).toContain('Chi tiêu');
  });

  it('số dấu ngoặc giữ nguyên như bản gốc — không thêm không bớt', () => {
    const toks = extractCJKTokens(REAL_LINE);
    for (const t of toks) t.translated = REAL_VI[t.text] ?? t.text;
    const out = reinsertTranslations(REAL_LINE, toks);
    const count = (s: string, ch: string) => s.split(ch).length - 1;
    for (const ch of ['【', '】', '（', '）', '{', '}']) {
      expect(count(out, ch), `lệch số dấu ${ch}`).toBe(count(REAL_LINE, ch));
    }
  });

  it('ĐỐI CHỨNG: token có ngoặc lẻ thì kết quả phụ thuộc may rủi của model', () => {
    // Chạy thật qua API, token lỗi `消费监测】支出` cho ra `Theo dõi tiêu dùng】Chi tiêu` — lần đó
    // model tình cờ GIỮ được dấu ngoặc nên ghép lại vẫn nhìn ổn. Nhưng nó cũng thường xuyên NUỐT
    // phần trước ngoặc, và đó chính là cái user chụp được: 【】 rỗng.
    // Điểm mấu chốt: cả hai kết cục đều là may rủi, vì ta đưa cho model một chuỗi hỏng.
    // Ca user chụp được: model GIỮ dấu ngoặc nhưng LÀM RƠI phần nhãn đứng trước nó.
    const dropsLabel = '】 chi tiêu';
    const keepsBracket = 'Theo dõi tiêu dùng】Chi tiêu';  // ca chạy thật hôm nay: giữ được

    // Ghép lại đúng ra `【】 chi tiêu {Số tiền} tệ` — trùng khít ảnh user gửi, kể cả dấu cách.
    const damaged = REAL_LINE.replace('消费监测】支出', dropsLabel);
    expect(damaged).toContain('【】 chi tiêu');
    expect(REAL_LINE.replace('消费监测】支出', keepsBracket)).not.toContain('【】');

    // Sau khi sửa, kết cục xấu đó KHÔNG THỂ xảy ra nữa: `】` không bao giờ nằm trong token gửi đi,
    // nên dù model trả về gì cho phần chữ, hai dấu ngoặc vẫn do máy giữ nguyên tại chỗ.
    const toks = extractCJKTokens(REAL_LINE);
    const inBracketToken = toks.find(t => t.text === '消费监测');
    expect(inBracketToken).toBeTruthy();
    expect(inBracketToken!.text).not.toContain('】');
    for (const t of toks) expect(t.text).not.toMatch(/[】）》」』〕〗〙〛]/);
  });
});

describe('Chốt chặn: Sức khoẻ thẻ bắt được ngoặc rỗng ruột', () => {
  it('gốc có chữ trong ngoặc, bản dịch rỗng ⇒ báo, kèm nhãn gốc làm bằng chứng', () => {
    const found = countEmptiedBrackets(
      '模板: 【消费监测】支出',
      'Mẫu: 【】 chi tiêu',
    );
    expect(found).toEqual(['【消费监测】']);
  });

  it('bản dịch đúng thì im lặng', () => {
    expect(countEmptiedBrackets('【消费监测】支出', '【Giám sát tiêu dùng】Chi tiêu')).toEqual([]);
  });

  it('KHÔNG báo oan khi chính BẢN GỐC vốn đã có ngoặc rỗng (thẻ dùng làm ô điền)', () => {
    expect(countEmptiedBrackets('điền vào 【】 nhé', 'điền vào 【】 nhé')).toEqual([]);
    // gốc 1 cặp rỗng, dịch cũng 1 cặp rỗng ⇒ không phải do dịch.
    expect(countEmptiedBrackets('【】 và 【标签】', '【】 và 【Nhãn】')).toEqual([]);
  });

  it('nhiều chỗ rỗng thì đếm đủ', () => {
    const found = countEmptiedBrackets('【甲】x【乙】y【丙】', '【】x【】y【】');
    expect(found).toHaveLength(3);
  });

  it('bắt cả các loại ngoặc khác, không chỉ 【】', () => {
    expect(countEmptiedBrackets('（备注）', '（）')).toEqual(['（备注）']);
    expect(countEmptiedBrackets('《书名》', '《》')).toEqual(['《书名》']);
  });

  it('vào tới báo cáo Sức khoẻ thẻ ở mức LỖI (không cho xuất thẻ im lặng)', () => {
    const fields: TranslationField[] = [{
      path: 'data.character_book.entries[3].content', label: 'Giao thức thông báo',
      group: 'lorebook', status: 'done', retries: 0,
      original: '- 模板: 【消费监测】支出{金额}元。',
      translated: '- Mẫu: 【】 chi tiêu {Số tiền} tệ.',
    } as TranslationField];

    const rep = scanFieldsHealth(fields);
    expect(rep.counts.emptyBrackets).toBe(1);
    const iss = rep.issues.find(i => i.kind === 'empty_bracket');
    expect(iss).toBeTruthy();
    expect(iss!.severity).toBe('error');
    expect(iss!.detail).toContain('【消费监测】');
    expect(rep.ok).toBe(false);
  });
});
