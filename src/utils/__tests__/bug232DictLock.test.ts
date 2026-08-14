/**
 * (bug 232) "Khoá từ điển MVU bị lỗi, không đồng nhất khi bấm áp dụng. Trong từ điển để là
 * 'Tiền Tài', nhưng khi dịch ra lại sót rất nhiều như 'Tiền bạc', 'Tiền tài'. Bấm áp dụng thì
 * chỉ tầm 50~70% được sửa."
 *
 * Đo trước khi vá trên đúng sáu chuỗi trong ảnh user gửi: `enforceVariableCasing` sửa được ĐÚNG
 * 2/6 — khớp y con số user cảm nhận. Hai nhóm nguyên nhân TÁCH BIỆT:
 *
 *  A. SAI HOA/THƯỜNG ở ngữ cảnh không nằm trong danh sách pass. Bộ ép casing là một danh sách
 *     TRẮNG các ngữ cảnh cú pháp (macro, obj['k'], getvar(), ===, khoá YAML, lodash…). Thẻ thật
 *     gọi qua hàm CỦA RIÊNG THẺ — `getVal(sd, 'Tài chính.Tiền tài', 0)` — và dùng tên biến làm
 *     GIÁ TRỊ chuỗi — `{k:'Tiền tài'}`. Không pass nào phủ, nên hai chỗ đó không bao giờ được vá.
 *
 *  B. SAI HẲN TỪ ("Tiền bạc"). Cái này ép casing KHÔNG cứu được về nguyên tắc: nó chỉ chuẩn hoá
 *     hoa/thường và dấu nối. Muốn biết "Tiền bạc" là bản dịch lệch của 钱财 thì phải đối chiếu
 *     với BẢN GỐC — mà bộ học ánh xạ đã có sẵn (`extractMappingFromTranslatedInitvar`) lại chỉ
 *     soi initvar/controller/mvu_logic, đúng lúc chứng cứ của user nằm ở tavernHelper.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { enforceVariableCasing, recanonicalizeMvuInFields } from '../mvuSync';

/** Từ điển user đã chốt (ảnh bug/232). */
const DICT = { '财务': 'Tài Chính', '钱财': 'Tiền Tài' };

const field = (o: Partial<Record<string, unknown>>) => ({
  path: 'p', label: 'l', group: 'tavern_helper', status: 'done',
  original: '', translated: '', ...o,
}) as never;

describe('(bug 232-A) ép hoa/thường phải với tới ngữ cảnh thẻ thật dùng', () => {
  it('hàm RIÊNG của thẻ với path có dấu chấm: getVal(sd, "Tài chính.Tiền tài", 0)', () => {
    const src = "const money = getVal(sd, 'Tài chính.Tiền tài', 0);";
    const r = enforceVariableCasing(src, DICT);
    expect(r.text).toContain("'Tài Chính.Tiền Tài'");
  });

  it('tên biến làm GIÁ TRỊ chuỗi: rows.push({k: "Tiền tài", …})', () => {
    const src = "rows.push({k: 'Tiền tài', v: '¥ ' + fmtMoney(money), hl: true});";
    const r = enforceVariableCasing(src, DICT);
    expect(r.text).toContain("k: 'Tiền Tài'");
    expect(r.text, 'chuỗi không phải tên biến thì đừng đụng').toContain("'¥ '");
  });

  it('hai ca vốn đã chạy được thì vẫn chạy (không phá đường cũ)', () => {
    expect(enforceVariableCasing("const m = sd['Tài chính']['Tiền tài'];", DICT).text)
      .toBe("const m = sd['Tài Chính']['Tiền Tài'];");
    expect(enforceVariableCasing("if (key === 'Tiền tài') return 1;", DICT).text)
      .toBe("if (key === 'Tiền Tài') return 1;");
  });

  it('từ điển chốt theo DẠNG PATH ("财务.钱财" → "Tài Chính.Tiền Tài") cũng ép được', () => {
    const pathDict = { '财务.钱财': 'Tài Chính.Tiền Tài' };
    const src = "const money = getVal(sd, 'Tài chính.Tiền tài', 0);";
    expect(enforceVariableCasing(src, pathDict).text).toContain("'Tài Chính.Tiền Tài'");
  });

  it('AN TOÀN: câu văn có CHỨA tên biến giữa chừng thì KHÔNG đụng', () => {
    const src = "const msg = 'Số Tiền tài của ngươi đã cạn rồi';";
    expect(enforceVariableCasing(src, DICT).text).toBe(src);
  });

  it('AN TOÀN: chuỗi không liên quan giữ nguyên tuyệt đối', () => {
    const src = "el.style.color = 'red'; const unit = 'px'; log('Tien tai chinh');";
    expect(enforceVariableCasing(src, DICT).text).toBe(src);
  });
});

describe('(bug 232-B) sai hẳn TỪ — đối chiếu bản gốc mới biết "Tiền bạc" là 钱财', () => {
  it('học từ tavernHelper rồi ép cho MỌI field: "Tiền bạc" → "Tiền Tài"', () => {
    const fields = [
      // Field này giữ chứng cứ: vị trí thứ 2 trong bản gốc là 钱财, bản dịch ghi "Tiền bạc".
      field({
        path: 'data.extensions.TavernHelper_scripts[2].content', group: 'tavern_helper',
        original: "const S = z.object({ '财务': z.object({ '钱财': z.coerce.number(), '应收应付': z.record(z.string()) }) });",
        translated: "const S = z.object({ 'Tài Chính': z.object({ 'Tiền bạc': z.coerce.number(), 'Khoản Thu Chi': z.record(z.string()) }) });",
      }),
      // Field khác cũng dính "Tiền bạc" nhưng bản gốc của nó KHÔNG có 钱财 để tự suy ra.
      field({
        path: 'data.extensions.regex_scripts[4].replaceString', group: 'regex',
        original: "rows.push({k: '钱财', v: fmt(v)});",
        translated: "rows.push({k: 'Tiền bạc', v: fmt(v)});",
      }),
    ];
    const r = recanonicalizeMvuInFields(fields, DICT);
    const out = (r.fields as unknown as { translated: string }[]).map(f => f.translated);

    expect(out[0], 'khoá zod vẫn là bản dịch lệch').toContain("'Tiền Tài'");
    expect(out[0]).not.toContain('Tiền bạc');
    expect(out[1], 'field thứ hai phải được ép theo biến thể đã học').toContain("'Tiền Tài'");
    expect(out[1]).not.toContain('Tiền bạc');
  });

  it('khoá YAML initvar không nháy cũng được ép', () => {
    const fields = [
      field({
        path: 'data.character_book.entries[49].content', group: 'lorebook', entryType: 'initvar',
        original: "财务:\n  钱财: 5000\n  应收应付: {}",
        translated: "Tài Chính:\n  Tiền bạc: 5000\n  Khoản Thu Chi: {}",
      }),
    ];
    const r = recanonicalizeMvuInFields(fields, DICT);
    expect((r.fields as unknown as { translated: string }[])[0].translated).toContain('Tiền Tài: 5000');
  });

  it('AN TOÀN: biến thể học được KHÔNG đụng vào field VĂN XUÔI', () => {
    const fields = [
      field({
        path: 'data.extensions.TavernHelper_scripts[0].content', group: 'tavern_helper',
        original: "const k = '钱财';", translated: "const k = 'Tiền bạc';",
      }),
      field({
        path: 'data.character_book.entries[3].content', group: 'lorebook',
        original: '他很有钱财，家里堆满金子。',
        translated: 'Hắn rất nhiều Tiền bạc, trong nhà chất đầy vàng.',
      }),
    ];
    const r = recanonicalizeMvuInFields(fields, DICT, undefined, true);
    const out = (r.fields as unknown as { translated: string }[]).map(f => f.translated);
    expect(out[0]).toContain("'Tiền Tài'");
    expect(out[1], 'văn xuôi phải được để yên khi skipNarrative').toContain('Tiền bạc');
  });

  it('KHOÁ dict: ép bằng ĐÚNG dict thô của user, không tự chuẩn hoá lại dấu _', () => {
    // User cố ý giữ `_` trong từ điển. Chuẩn hoá hộ là làm bản dịch lệch khỏi chính dict họ chốt.
    const raw = { '钱财': 'Tiền_Tài' };
    const fields = [field({ original: "const a = '钱财';", translated: "const a = 'Tiền bạc';" })];
    const r = recanonicalizeMvuInFields(fields, raw, undefined, false, /* normalizeDict */ false);
    expect(r.dictionary).toEqual(raw);
  });

  it('AN TOÀN: số lượng chuỗi hai bên LỆCH thì không đoán bừa', () => {
    const fields = [
      field({
        original: "const a = '钱财';",
        // AI thêm hẳn một chuỗi mới → không còn căn cứ vị trí, tuyệt đối không được đoán.
        translated: "const a = 'Tiền bạc'; const note = 'ghi chú thêm';",
      }),
    ];
    const r = recanonicalizeMvuInFields(fields, DICT);
    expect((r.fields as unknown as { translated: string }[])[0].translated).toContain('Tiền bạc');
  });
});

/**
 * (bug 232-C) GỐC NẶNG NHẤT, và nó nằm ở chính cái công tắc user bật.
 *
 * Lượt sweep cuối pipeline viết:
 *     if (writeMvuDictAuto(fixedDict, '…') && fixCount > 0) { store.setFields(sweptFields); … }
 * mà `writeMvuDictAuto` trả FALSE khi từ điển đang KHOÁ. Nên bật 🔒 là toàn bộ lượt ép từ điển
 * lên bản dịch KHÔNG BAO GIỜ được ghi xuống — đúng tính năng sinh ra để "mọi nơi dùng dict của
 * tôi" lại là thứ tắt mất bộ ép nó. Đó là vì sao "khi dịch ra lại sót rất nhiều".
 *
 * Khoá nghĩa là "đừng SỬA từ điển của tôi", KHÔNG phải "đừng ÁP từ điển của tôi".
 */
describe('(bug 232-C) khoá từ điển không được tắt bộ ép từ điển', () => {
  const SRC = fs.readFileSync(path.resolve(__dirname, '../../hooks/useTranslation.ts'), 'utf8');

  it('setFields của lượt sweep KHÔNG còn bị chặn bởi giá trị trả về của writeMvuDictAuto', () => {
    expect(SRC).not.toContain("if (writeMvuDictAuto(fixedDict, 'sweep chuẩn hoá dict (_/- → space)') && fixCount > 0)");
    // Ghi dict vẫn phải đi qua cửa tôn trọng khoá — không được bỏ luôn.
    expect(SRC).toContain("writeMvuDictAuto(fixedDict, 'sweep chuẩn hoá dict (_/- → space)')");
  });

  it('khi khoá thì sweep truyền normalizeDict = false (giữ nguyên dạng user chốt)', () => {
    expect(SRC).toMatch(/const locked = useStore\.getState\(\)\.translationConfig\.mvuDictLocked;/);
    expect(SRC).toMatch(/store\.translationConfig\.fandomMode,\s*\n\s*!locked,/);
  });
});
