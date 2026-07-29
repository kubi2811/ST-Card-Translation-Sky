// (bug 149) Khung xem trước bước 2: rào ```html hiện thành chữ, và "Loading..." nằm lì.
//
// "Loading..." KHÔNG phải lỗi nạp dữ liệu — nó là chỗ trống chờ trường thời gian/nơi chốn ghi
// đè. Bộ tìm cũ chỉ quét trường chuỗi/enum nên "Ngày (SC)" kiểu Number không bao giờ khớp, và
// bảng từ khoá thiếu luôn chữ "giờ" nên "Khung Giờ" cũng trượt. Không trường nào khớp thì
// chẳng có gì ghi đè, chữ đó nằm lại vĩnh viễn — trong khung xem trước LẪN trong card thật.
import { describe, it, expect } from 'vitest';
import { buildProgrammaticRegex } from '../programmaticRegexBuilder';
import { normalizeMVUZODSchema } from '../normalizeSchema';
import { toIframeHtml } from '../../ai/schemaPreviewData';
import type { MVUZODSchema } from '../../../types/mvuzod.types';

const schemaOf = (fields: unknown[]) =>
  normalizeMVUZODSchema({ version: '1.0', fields }) as MVUZODSchema;

const num = (path: string, label: string) => ({ path, label, type: 'number', defaultValue: 1, constraints: {} });
const str = (path: string, label: string) => ({ path, label, type: 'string', defaultValue: '', constraints: {} });

const build = (schema: MVUZODSchema) =>
  buildProgrammaticRegex({ schema, component: 'status_bar', themeId: 'fantasy_medieval', gameName: 'Thử' }).previewHtml;

describe('(bug 149) gỡ rào markdown cho iframe', () => {
  it('gỡ ```html ở đầu và ``` ở cuối', () => {
    expect(toIframeHtml('```html\n<p>a</p>\n```')).toBe('<p>a</p>');
  });

  it('chịu được khoảng trắng đầu dòng và xuống dòng kiểu CRLF', () => {
    expect(toIframeHtml('  ```html\r\n<p>a</p>\r\n```  ')).toBe('<p>a</p>');
  });

  it('HTML không có rào thì giữ nguyên, không cắt nhầm', () => {
    expect(toIframeHtml('<p>a</p>')).toBe('<p>a</p>');
  });
});

describe('(bug 149) chữ "Loading..." không được nằm lại', () => {
  it('trường thời gian là SỐ (Ngày) vẫn nhận ra → có ràng buộc, không kẹt', () => {
    const html = build(schemaOf([num('/Ngày', 'Ngày (SC)'), num('/Máu', 'Máu')]));
    expect(html).not.toContain('Loading...');
    expect(html, 'phải có chỗ để ghi giá trị vào').toContain('stcs-header-info');
  });

  it('"Khung Giờ" (chữ "giờ") cũng nhận ra', () => {
    const html = build(schemaOf([str('/Khung Giờ', 'Khung Giờ'), num('/Máu', 'Máu')]));
    expect(html).not.toContain('Loading...');
    expect(html).toContain('stcs-header-info');
  });

  it('KHÔNG có trường thời gian/nơi chốn nào → bỏ hẳn dòng phụ, không để chữ chờ', () => {
    const html = build(schemaOf([num('/Máu', 'Máu'), num('/Mana', 'Mana')]));
    expect(html).not.toContain('Loading...');
    expect(html, 'không có gì ghi đè thì đừng dựng chỗ trống').not.toContain('stcs-header-info');
  });
});
