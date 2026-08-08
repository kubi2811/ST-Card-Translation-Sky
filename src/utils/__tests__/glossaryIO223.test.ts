/**
 * (bug 223) "Từ điển thuật ngữ bình thường hình như xuất không được nhỉ."
 * ─────────────────────────────────────────────────────────────────────────────
 * Hai đầu cùng hỏng, và cả hai đều hỏng LẶNG LẼ — nên user chỉ có thể nói "hình như":
 *
 *  XUẤT — `URL.revokeObjectURL(url)` viết ngay dưới `a.click()`. Click mới chỉ ĐẶT lệnh tải;
 *         trình duyệt đọc blob ở vòng lặp sự kiện sau. Đo trong tab thật: `fetch(url)` liền
 *         sau revoke đã trả "Failed to fetch". Ai thắng cuộc đua tuỳ máy và tuỳ cỡ file.
 *
 *  NHẬP — `JSON.parse` thẳng rồi `catch { }` BỎ TRỐNG, lại chỉ nhận đúng một bố cục mảng.
 *         File xuất từ tab Dịch Script (bọc trong khoá `glossary`), bảng chép từ Excel, hay
 *         file thừa một dấu phẩy: tất cả rơi vào im lặng tuyệt đối.
 *
 * Test khoá cả hành vi mới lẫn LUẬT trong mã nguồn — vì bệnh cũ là kiểu chỉ cần một người
 * viết lại `revokeObjectURL(url)` sau `click()` là quay về nguyên trạng mà chẳng test nào đỏ.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  parseGlossaryText, parseGlossaryDelimited, glossaryToCsv, glossaryToJson, mergeGlossaries,
} from '../glossaryIO';
import { safeFileName, stampSuffix } from '../downloadFile';

describe('(bug 223) nhập từ điển: nhận mọi thứ user thật sự có trong tay', () => {
  it('JSON chuẩn của tool', () => {
    const out = parseGlossaryText('[{"source":"秋青子","target":"Thu Thanh Tử"}]');
    expect(out).toEqual([{ source: '秋青子', target: 'Thu Thanh Tử' }]);
  });

  it('JSON bọc trong khoá glossary (bản xuất của tab Dịch Script)', () => {
    const out = parseGlossaryText('{"glossary":[{"zh":"魔力","vi":"Ma lực"}]}');
    expect(out).toEqual([{ source: '魔力', target: 'Ma lực' }]);
  });

  it('JSON object phẳng — kiểu nhiều người gõ tay nhất', () => {
    expect(parseGlossaryText('{"魔力":"Ma lực","丹田":"Đan điền"}')).toEqual([
      { source: '魔力', target: 'Ma lực' },
      { source: '丹田', target: 'Đan điền' },
    ]);
  });

  it('CSV xuất từ Excel, có dòng tiêu đề', () => {
    const out = parseGlossaryText('source,target\n秋青子,Thu Thanh Tử\n魔力,Ma lực');
    expect(out).toEqual([
      { source: '秋青子', target: 'Thu Thanh Tử' },
      { source: '魔力', target: 'Ma lực' },
    ]);
  });

  it('TSV dán thẳng từ Google Sheets (không tiêu đề)', () => {
    expect(parseGlossaryText('秋青子\tThu Thanh Tử')).toEqual([{ source: '秋青子', target: 'Thu Thanh Tử' }]);
  });

  it('thuật ngữ CÓ dấu phẩy bên trong không làm vỡ dòng', () => {
    const out = parseGlossaryDelimited('"Thanh Vân môn, chi nhánh Nam",Nam chi Thanh Vân');
    expect(out).toEqual([{ source: 'Thanh Vân môn, chi nhánh Nam', target: 'Nam chi Thanh Vân' }]);
  });

  it('chữ "source" ở GIỮA file là dữ liệu, không phải tiêu đề', () => {
    const out = parseGlossaryDelimited('秋青子,Thu Thanh Tử\nsource,target');
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ source: 'source', target: 'target' });
  });

  it('file rác thì NÉM lỗi phân biệt được, để UI nói đúng lý do', () => {
    expect(() => parseGlossaryText('{')).toThrow();
    expect(() => parseGlossaryText('[]')).toThrow('NO_ENTRIES');
    expect(() => parseGlossaryText('   \n  \n')).toThrow();
  });

  it('nhập KHÔNG đè mục user đã sửa tay — chỉ đếm xung đột', () => {
    const base = [{ source: '魔力', target: 'Ma lực (đã sửa)' }];
    const r = mergeGlossaries(base, [
      { source: '魔力', target: 'Ma lực' },
      { source: '丹田', target: 'Đan điền' },
    ]);
    expect(r.added).toBe(1);
    expect(r.conflicts).toBe(1);
    expect(r.merged.find(g => g.source === '魔力')?.target).toBe('Ma lực (đã sửa)');
  });
});

describe('(bug 223) xuất từ điển: quay vòng lại được', () => {
  const list = [{ source: '秋青子', target: 'Thu Thanh Tử' }, { source: 'A,B', target: 'C"D' }];

  it('JSON xuất ra nhập lại ĐÚNG như cũ', () => {
    expect(parseGlossaryText(glossaryToJson(list))).toEqual(list);
  });

  it('CSV xuất ra nhập lại ĐÚNG như cũ, kể cả ô có dấu phẩy và nháy kép', () => {
    expect(parseGlossaryText(glossaryToCsv(list))).toEqual(list);
  });

  it('CSV có BOM để Excel không đọc sai tiếng Việt', () => {
    expect(glossaryToCsv(list).charCodeAt(0)).toBe(0xfeff);
  });
});

describe('(bug 223) tên file xuất', () => {
  it('bỏ ký tự Windows cấm, không để tên rỗng', () => {
    expect(safeFileName('thẻ: A/B*C?')).toBe('thẻ- A-B-C-');
    expect(safeFileName('   ', 'glossary')).toBe('glossary');
  });

  it('hậu tố ngày-giờ để xuất nhiều lần không đè nhau', () => {
    expect(stampSuffix(new Date(2026, 7, 9, 3, 7))).toBe('20260809-0307');
  });
});

/* ── LUẬT MÃ NGUỒN: không ai được viết lại kiểu cũ ───────────────────────────── */

describe('(bug 223) không chỗ nào thu hồi blob URL ngay sau khi bấm tải', () => {
  const SRC = path.resolve(__dirname, '../..');

  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap(e => (e.isDirectory()
      ? (e.name === '__tests__' || e.name === 'node_modules' ? [] : walk(path.join(dir, e.name)))
      : (/\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : [])));

  it('mọi revokeObjectURL đều nằm trong setTimeout hoặc là revokeSoon/helper', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const src = readFileSync(file, 'utf-8').replace(/\r\n/g, '\n');
      if (file.endsWith(path.join('utils', 'downloadFile.ts'))) continue;   // chính nơi định nghĩa
      if (file.endsWith('version.ts')) continue;                            // ghi chú bản phát hành, không phải mã
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (!line.includes('revokeObjectURL')) return;
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;             // chú thích kể lại bệnh cũ
        if (line.includes('setTimeout')) return;                 // đã hoãn ngay trên dòng
        // Thu hồi URL CŨ khi thay ảnh (store.ts) là việc khác hẳn — nhận diện bằng biến `prev`.
        if (/revokeObjectURL\(prev/.test(line)) return;
        offenders.push(`${path.relative(SRC, file)}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(offenders, 'thu hồi ngay sau click ⇒ file tải bị hụt (bug 223)').toEqual([]);
  });
});
