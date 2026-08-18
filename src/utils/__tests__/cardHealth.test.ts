import { describe, it, expect } from 'vitest';
import { scanFieldsHealth, buildTranslationReport } from '../cardHealth';
import type { TranslationField } from '../../types/card';

/** Dựng 1 TranslationField tối thiểu cho test (chỉ đặt field cần thiết). */
function mk(o: Partial<TranslationField>): TranslationField {
  return {
    path: 'p', label: 'L', group: 'basic', original: '', translated: '', status: 'done', retries: 0,
    ...o,
  } as unknown as TranslationField;
}

describe('scanFieldsHealth', () => {
  it('thẻ lành → ok, không issue', () => {
    const r = scanFieldsHealth([
      mk({ original: '你好', translated: 'Xin chào', status: 'done' }),
    ]);
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
    expect(r.counts.done).toBe(1);
  });

  it('trường lỗi → issue error, ok=false', () => {
    const r = scanFieldsHealth([mk({ status: 'error', error: 'timeout' })]);
    expect(r.ok).toBe(false);
    expect(r.counts.error).toBe(1);
    expect(r.issues[0]).toMatchObject({ severity: 'error', kind: 'field_error' });
  });

  it('trường chưa xong → warning nhưng vẫn ok (không phải error)', () => {
    const r = scanFieldsHealth([mk({ status: 'pending' })]);
    expect(r.ok).toBe(true);
    expect(r.counts.pending).toBe(1);
    expect(r.issues[0]).toMatchObject({ severity: 'warning', kind: 'field_pending' });
  });

  it('<script> gốc lành mà bản dịch VỠ → broken_script, ok=false', () => {
    const r = scanFieldsHealth([mk({
      original: "<script>var a = '你好';</script>",
      translated: "<script>var a = 'Xin' 'chào';</script>",  // 2 chuỗi liền → SyntaxError
      status: 'done',
    })]);
    expect(r.counts.brokenScripts).toBe(1);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.kind === 'broken_script')).toBe(true);
  });

  it('<script> bản dịch vẫn lành → KHÔNG báo vỡ', () => {
    const r = scanFieldsHealth([mk({
      original: "<script>var a = '你好';</script>",
      translated: "<script>var a = 'Xin chào';</script>",
      status: 'done',
    })]);
    expect(r.counts.brokenScripts).toBe(0);
    expect(r.ok).toBe(true);
  });

  it('chữ Hán còn trong field CODE (json_patch) → residual_cjk_code, ok=false', () => {
    const r = scanFieldsHealth([mk({
      entryType: 'json_patch', translated: 'x = "还有中文";', status: 'done',
    })]);
    expect(r.counts.residualCjkCode).toBe(1);
    expect(r.ok).toBe(false);
  });

  it('JSON Patch gốc lành nhưng bản dịch vỡ → chặn xuất', () => {
    const r = scanFieldsHealth([mk({
      path: 'book[0].content', entryType: 'json_patch',
      original: '[{"op":"replace","path":"/状态","value":1}]',
      translated: '[{"op":"replace","path":"/Trạng Thái","value":1,}]', status: 'done',
    })]);
    expect(r.counts.brokenJson).toBe(1);
    expect(r.issues.some(i => i.kind === 'broken_json')).toBe(true);
    expect(r.ok).toBe(false);
  });

  it('findRegex hỏng sau dịch → chặn xuất', () => {
    const r = scanFieldsHealth([mk({
      path: 'data.extensions.regex_scripts[0].findRegex', label: 'regex[0].findRegex',
      original: '/<状态>([\\s\\S]*?)<\\/状态>/g', translated: '/[Trạng Thái/g', status: 'done',
    })]);
    expect(r.counts.invalidRegex).toBe(1);
    expect(r.issues.some(i => i.kind === 'invalid_find_regex')).toBe(true);
    expect(r.ok).toBe(false);
  });

  /**
   * (bug 234) HỢP ĐỒNG ĐỔI: 'info' → 'warning'.
   * User: "Vẫn còn tiếng trung chưa dịch hết nhưng vẫn để là dịch xong."
   * Banner sức khoẻ thẻ ở ExportPanel chỉ đếm severity==='error', nên mức 'info' làm một thẻ
   * 80 entry còn nguyên tiếng Trung vẫn được đóng dấu XANH "An toàn để xuất". Nâng lên 'warning'
   * để chốt xuất thẻ nhìn thấy được — nhưng vẫn KHÔNG phải 'error' vì chữ Hán trong văn xuôi có
   * thể là tên riêng người dùng cố ý giữ, không đáng chặn cứng.
   */
  it('(bug 234) chữ Hán sót trong VĂN BẢN done → warning, ok vẫn true (không phải lỗi nặng)', () => {
    const r = scanFieldsHealth([mk({ translated: '主角是李明和王芳', status: 'done' })]);
    expect(r.counts.residualCjkText).toBe(1);
    expect(r.ok).toBe(true); // warning không phải error ⇒ không chặn cứng
    expect(r.issues[0].severity).toBe('warning');
  });

  it('(bug 234) field bị TỰ ĐỘNG BỎ QUA cũng phải bị soi — trước đây chỉ soi status done', () => {
    // prepareFields gán translated = original khi bỏ qua ⇒ "bản dịch" chính là nguyên văn tiếng Trung.
    const r = scanFieldsHealth([mk({ original: '主角是李明', translated: '主角是李明', status: 'skipped' })]);
    expect(r.counts.residualCjkText).toBe(1);
    expect(r.issues[0].detail).toMatch(/TỰ ĐỘNG BỎ QUA/);
  });

  it('(bug 234) sót ĐÚNG 2 chữ Hán vẫn phải báo — ngưỡng cũ là 3 nên "<道具>" lọt', () => {
    const r = scanFieldsHealth([mk({ translated: '<道具> Danh sách vật phẩm của nhân vật', status: 'done' })]);
    expect(r.counts.residualCjkText).toBe(1);
  });
});

describe('scanFieldsHealth — kiểm áp Từ điển thuật ngữ', () => {
  const glossary = [
    { source: '李明', target: 'Lý Minh' },
    { source: '王芳', target: 'Vương Phương' },
  ];

  it('bản dịch CÒN nguyên tên gốc trong Từ điển → warning glossary_unapplied', () => {
    const r = scanFieldsHealth(
      [mk({ translated: 'Nhân vật chính là 李明 và Vương Phương.', status: 'done' })],
      glossary,
    );
    expect(r.counts.glossaryUnapplied).toBe(1);
    expect(r.issues.some((i) => i.kind === 'glossary_unapplied')).toBe(true);
    expect(r.ok).toBe(true); // warning, không chặn xuất
  });

  it('bản dịch đã áp đúng mọi thuật ngữ → không cảnh báo', () => {
    const r = scanFieldsHealth(
      [mk({ translated: 'Nhân vật chính là Lý Minh và Vương Phương.', status: 'done' })],
      glossary,
    );
    expect(r.counts.glossaryUnapplied).toBe(0);
  });

  it('không truyền Từ điển → bỏ qua kiểm áp thuật ngữ', () => {
    const r = scanFieldsHealth([mk({ translated: '李明', status: 'done' })]);
    expect(r.counts.glossaryUnapplied).toBe(0);
  });

  it('bỏ qua mục từ điển source===target hoặc quá ngắn', () => {
    const r = scanFieldsHealth(
      [mk({ translated: 'X 李明', status: 'done' })],
      [{ source: '李', target: '李' }, { source: 'A', target: 'B' }],
    );
    expect(r.counts.glossaryUnapplied).toBe(0);
  });
});

describe('buildTranslationReport', () => {
  it('gồm tổng quan + phần lỗi khi có script vỡ', () => {
    const fields = [
      mk({ label: 'Mô tả', original: "<script>var a='你';</script>", translated: "<script>var a='x' 'y';</script>", status: 'done' }),
      mk({ label: 'Tên', status: 'error', error: 'timeout' }),
    ];
    const md = buildTranslationReport(fields, 'the-test.json');
    expect(md).toContain('# Báo cáo dịch — the-test.json');
    expect(md).toContain('Script vỡ cú pháp');
    expect(md).toContain('nên sửa trước khi xuất');
  });
});
