/**
 * Nút đếm trạng thái trong TranslationProgress là lối tắt tới đúng entry trong FieldEditor.
 * Đây là test hợp đồng mã nguồn vì test runner của repo dùng Node và không cài DOM renderer.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readSrc = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf-8').replace(/\r\n/g, '\n');
const PROGRESS = readSrc('../../TranslationProgress.tsx');
const EDITOR = readSrc('../../FieldEditor.tsx');

describe('(bug 240) bấm Bỏ qua / Lỗi để tìm entry', () => {
  it('hai badge có handler đi tuần tự theo đúng trạng thái', () => {
    expect(PROGRESS).toContain("onClick={() => jumpToNextStatus('skipped')}");
    expect(PROGRESS).toContain("onClick={errorFields > 0 ? () => jumpToNextStatus('error') : undefined}");
    expect(PROGRESS).toMatch(/fields\.filter\(\(f\) => f\.status === status\)/);
    expect(PROGRESS).toContain('(currentIndex + 1) % matches.length');
    expect(PROGRESS).toContain('setJumpToFieldPath(target.path)');
  });

  it('FieldEditor lọc đúng trạng thái và vẫn highlight entry đích', () => {
    expect(EDITOR).toContain("target.status === 'skipped' || target.status === 'error'");
    expect(EDITOR).toContain("setActiveTab(jumpStatus ? 'all'");
    expect(EDITOR).toContain("setStatusFilter(jumpStatus || 'all')");
    expect(EDITOR).toContain('setJumpPath(jumpToFieldPath)');
    expect(EDITOR).toContain('scrollToPath={jumpPath}');
    expect(EDITOR).toContain('highlightPath={jumpPath}');
  });

  it('ngay trong danh sách lọc có nút đi xuống entry kế và tự quay vòng', () => {
    expect(EDITOR).toContain('jumpToNextFilteredStatus');
    expect(EDITOR).toContain('(statusCursorIndex + 1) % filteredFields.length');
    expect(EDITOR).toContain('ui.feNextStatusEntry');
  });
});
