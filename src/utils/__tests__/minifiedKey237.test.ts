/**
 * (bug 237) KHOÁ ĐỐI TƯỢNG TRONG SCRIPT MINIFY PHẢI ĐƯỢC BỌC NHÁY.
 *
 * Bằng chứng thẻ thật (bugNeedFix/237): khối <script> của màn khai mạc dài 329.091 ký tự nằm gọn
 * trên MỘT dòng. `enclosingQuoteAtEnd` đếm nháy từ đầu dòng, nên phải lội qua hàng trăm nghìn ký
 * tự code; chỉ cần một dấu nháy lẻ trong chú thích/template literal là sai từ đó về sau. Token
 * `雪之下雪乃` trong `…,laff:5e4},p={hachiman:{雪之下雪乃:{display:…` bị chấm là "đang trong chuỗi"
 * ⇒ isObjectKey=false ⇒ không bọc nháy ⇒ xuất ra `{Yukinoshita Yukino:{…}}` = SyntaxError.
 * Cả 14 khoá đối tượng Hán của thẻ đều dính; màn khai mạc chết hẳn khi nạp vào SillyTavern.
 */
import { describe, it, expect } from 'vitest';
import * as acorn from 'acorn';
import { extractCJKTokens, reinsertTranslations, enclosingQuoteAtEnd } from '../surgical';

const parses = (src: string) => {
  try { acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' }); return true; } catch { return false; }
};

describe('(bug 237) đếm nháy không được để chú thích / template literal làm lệch', () => {
  it('dấu nháy đơn trong chú thích dòng KHÔNG mở chuỗi', () => {
    expect(enclosingQuoteAtEnd("var a=1; // don't touch\nvar b=2;")).toBe(null);
  });
  it('dấu nháy đơn trong chú thích khối KHÔNG mở chuỗi', () => {
    expect(enclosingQuoteAtEnd("var a=1; /* it's fine */ var b=2;")).toBe(null);
  });
  it('template literal được theo dõi, và nháy đơn bên trong nó không mở chuỗi', () => {
    expect(enclosingQuoteAtEnd('var s=`it\'s ok`; var b=2;')).toBe(null);
    expect(enclosingQuoteAtEnd('var s=`dang mo')).toBe('`');
  });
  it('chuỗi thật vẫn được nhận đúng', () => {
    expect(enclosingQuoteAtEnd("var s='chua dong")).toBe("'");
    expect(enclosingQuoteAtEnd('var s="chua dong')).toBe('"');
  });
});

describe('(bug 237) khoá đối tượng trần trong code minify', () => {
  /** Dựng đúng hình dạng gây lỗi: một dòng dài, có dấu nháy lẻ phía trước làm hỏng phép đếm. */
  const buildMinified = () => {
    const noise = "var re=/it's|don't/g;" + 'x=1;'.repeat(4000);
    return `${noise}var p={hachiman:{雪之下雪乃:{display:'雪乃',bond:50},由比滨结衣:{display:'结衣'}}};`;
  };

  it('khoá Hán vẫn được nhận là KHOÁ và được bọc nháy — script còn parse được', () => {
    const src = buildMinified();
    expect(parses(src), 'bản gốc phải hợp lệ đã').toBe(true);
    const toks = extractCJKTokens(src);
    const map: Record<string, string> = {
      '雪之下雪乃': 'Yukinoshita Yukino', '雪乃': 'Yukino',
      '由比滨结衣': 'Yuigahama Yui', '结衣': 'Yui',
    };
    toks.forEach(t => { t.translated = map[t.text.trim()] ?? t.text; });
    const out = reinsertTranslations(src, toks);

    // Đây là bất biến: tên có DẤU CÁCH mà làm khoá thì BẮT BUỘC phải có nháy.
    expect(out).toContain("{'Yukinoshita Yukino':");
    expect(out).toContain("'Yuigahama Yui':");
    expect(out).not.toMatch(/[{,]\s*Yukinoshita Yukino\s*:/);
    // Và chốt cuối cùng, thứ mà người chơi thực sự quan tâm:
    expect(parses(out), 'script sau dịch phải còn parse được').toBe(true);
  });


  it('token chỉ là MỘT KHÚC của chuỗi dài (phía sau còn chữ) vẫn phải biết mình trong chuỗi', () => {
    // Ca đo được trên thẻ 237: mảng chuỗi mà mỗi phần tử là một câu Hán dài; bộ tách CJK cắt ra
    // nhiều khúc, khúc đầu bắt đầu ngay sau dấu nháy nhưng KHÔNG kết thúc ở dấu nháy.
    const noise = "var re=/it's|don't/g;" + 'x=1;'.repeat(3000);
    const src = `${noise}var a=['剧情：《错位的日常》','玩家视点：比企谷八幡'];`;
    expect(parses(src)).toBe(true);
    const toks = extractCJKTokens(src);
    expect(toks.length).toBeGreaterThan(0);
    for (const t of toks) expect(t.inStringQuote, JSON.stringify(t.text)).toBe("'");
    // AI trả về bản dịch có kèm sẵn dấu nháy đơn — đúng thứ đã làm vỡ script thật.
    toks.forEach(t => { t.translated = "Câu chuyện': 《Cuộc sống thường ngày sai lệch》"; });
    expect(parses(reinsertTranslations(src, toks)), 'chuỗi không được xẻ đôi').toBe(true);
  });

  it('AN TOÀN: chuỗi THẬT chứa dấu hai chấm không bị biến thành khoá', () => {
    const src = "var msg='ghi chu: 雪之下雪乃 la ban cua toi';";
    const toks = extractCJKTokens(src);
    toks.forEach(t => { t.translated = 'Yukinoshita Yukino'; });
    const out = reinsertTranslations(src, toks);
    // Nằm trong chuỗi ⇒ KHÔNG được mọc thêm nháy đơn (sẽ xẻ đôi chuỗi).
    expect(parses(out), 'chuỗi thật không được vỡ').toBe(true);
  });
});

describe('(bug 237) chuỗi trong code minify — bản dịch tự mọc dấu nháy không được xẻ đôi chuỗi', () => {
  /**
   * Ca thứ hai đo được trên thẻ 237, cùng gốc rễ với ca khoá đối tượng: token nằm TRONG chuỗi
   * `…,'剧情：《错位的日常》','玩家视点…` nhưng phép đếm nháy cả dòng không thấy, nên lưới bug 161
   * (bản dịch mọc thêm nháy đóng) không nổ. AI trả về bản dịch có kèm dấu nháy đơn ⇒ chuỗi bị xẻ
   * đôi ⇒ SyntaxError, cả khối script của màn khai mạc chết.
   * Ký tự SÁT hai bên token thì không cần đếm cũng thấy: nháy mở ngay trước, đúng loại đó ngay sau.
   */
  it('nháy ôm sát token thì token PHẢI được coi là nằm trong chuỗi', () => {
    const noise = "var re=/it's|don't/g;" + 'x=1;'.repeat(3000);
    const src = `${noise}var arr=['剧情：《错位的日常》','玩家视点'];`;
    expect(parses(src), 'bản gốc phải hợp lệ đã').toBe(true);
    const toks = extractCJKTokens(src);
    const t = toks.find(x => x.text.includes('剧情'));
    expect(t, 'phải tách được token trong chuỗi').toBeTruthy();
    expect(t!.inStringQuote, 'phải biết mình đang trong chuỗi nháy đơn').toBe("'");

    // Giả lập ĐÚNG thứ AI trả về ở lượt chạy thật: bản dịch tự kèm một dấu nháy đơn.
    toks.forEach(x => { x.translated = x.text.includes('剧情') ? "Câu chuyện': 《cuộc sống thường ngày sai lệch》" : 'Góc nhìn'; });
    const out = reinsertTranslations(src, toks);
    expect(parses(out), 'chuỗi không được xẻ đôi').toBe(true);
    expect(out).not.toContain("Câu chuyện':");     // dấu nháy đã bị vô hiệu hoá thành nháy in
  });
});
