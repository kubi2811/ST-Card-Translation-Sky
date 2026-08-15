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

  it('AN TOÀN: chuỗi THẬT chứa dấu hai chấm không bị biến thành khoá', () => {
    const src = "var msg='ghi chu: 雪之下雪乃 la ban cua toi';";
    const toks = extractCJKTokens(src);
    toks.forEach(t => { t.translated = 'Yukinoshita Yukino'; });
    const out = reinsertTranslations(src, toks);
    // Nằm trong chuỗi ⇒ KHÔNG được mọc thêm nháy đơn (sẽ xẻ đôi chuỗi).
    expect(parses(out), 'chuỗi thật không được vỡ').toBe(true);
  });
});
