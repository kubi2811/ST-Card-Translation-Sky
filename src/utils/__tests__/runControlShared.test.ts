/**
 * Dò lại project sau đợt bug 238-251 — ba lỗi tiềm ẩn cùng họ bug 239.
 *  A. Tạm dừng / Huỷ mất tác dụng sau khi mở-đóng Regex Manager toàn màn hình: abortRef/pauseRef/
 *     runIdRef/runningRef là ref RIÊNG từng component, khung Dịch thuật bị gỡ rồi dựng lại.
 *  B. Kênh báo key/provider hỏng (bug 229c) bị TẮT mỗi khi một component dùng useTranslation()
 *     unmount — chuyển tab Field/Kiểm tra/Xuất là đủ.
 *  C. Field "Dịch link ngoài" (hứa "cơ chế dịch như Regex") đi nhầm đường dịch THƯỜNG vì engine
 *     chọn đường theo TÊN field.
 * Hook React không chạy được trong vitest node ⇒ A/B khoá bằng mã nguồn (cùng cách chunkResume227).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const hookSrc = readFileSync(fileURLToPath(new URL('../../hooks/useTranslation.ts', import.meta.url)), 'utf8');

describe('(A) điều khiển vòng dịch dùng chung cho mọi component', () => {
  it.each(['abortRef', 'pauseRef', 'runningRef', 'runIdRef', 'lastRunModeRef'])('%s không còn là useRef riêng', (name) => {
    expect(hookSrc).not.toMatch(new RegExp(`const ${name} = useRef`));
    expect(hookSrc).toMatch(new RegExp(`const ${name} = SHARED_RUN\\.`));
  });
  it('SHARED_RUN khai ở cấp module (ngoài hook)', () => {
    expect(hookSrc.indexOf('const SHARED_RUN = {')).toBeLessThan(hookSrc.indexOf('export function useTranslation()'));
  });
});

describe('(B) kênh báo lane cắm một lần, không bao giờ bị component gỡ', () => {
  it('không còn setLaneIssueReporter(null) trong code chạy, và được cắm ở cấp module', () => {
    const code = hookSrc.split('\n').filter(l => !/^\s*(\*|\/\/)/.test(l)).join('\n');
    expect(code).not.toContain('setLaneIssueReporter(null)');
    expect(code).toContain('setLaneIssueReporter(reportLaneIssueToUser);');
    expect(hookSrc.indexOf('setLaneIssueReporter(reportLaneIssueToUser);')).toBeLessThan(hookSrc.indexOf('export function useTranslation()'));
  });
});

describe('(C) field link ngoài đi đường SURGICAL như regex', () => {
  it('engineFieldName gắn dấu replaceString cho field regex/replaceString có nhãn không chứa nó', async () => {
    vi.resetModules();
    const { engineFieldName } = await import('../../hooks/useTranslation');
    expect(engineFieldName({ label: 'Dịch link ngoài', group: 'regex', entryType: 'replaceString' })).toBe('Dịch link ngoài · replaceString');
    // Field regex thật đã có sẵn ⇒ giữ nguyên; field khác ⇒ giữ nguyên.
    expect(engineFieldName({ label: 'regex[3].replaceString (Tô màu)', group: 'regex', entryType: 'replaceString' })).toBe('regex[3].replaceString (Tô màu)');
    expect(engineFieldName({ label: 'Mô tả', group: 'description' })).toBe('Mô tả');
  });
  it('retranslateField gửi engineFieldName(field), không gửi nhãn trần', () => {
    const fn = hookSrc.slice(hookSrc.indexOf('const retranslateField = useCallback'));
    const call = fn.slice(fn.indexOf('let translated = await translateText('), fn.indexOf('let translated = await translateText(') + 120);
    expect(call).toContain('engineFieldName(field)');
  });
});
