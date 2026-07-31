/**
 * (bug 171 mục 2) SELECTOR CSS VỠ VÌ DỊCH — mất màu mà KHÔNG sập script.
 * ─────────────────────────────────────────────────────────────────────────────
 * Bằng chứng user: `.q-普通 { … }` dịch thành `.q-Phổ Thông { … }`. Trình duyệt đọc thành hai
 * selector rời (`.q-Phổ` rồi hậu duệ `Thông`) nên luật không bao giờ khớp — toàn bộ màu phẩm chất
 * biến mất. Script vẫn chạy, không lỗi đỏ nào, nên user chỉ biết là "tự nhiên mất màu".
 *
 * Chốt cũ (css_class_sync) chỉ so thuộc tính class="…" giữa gốc và bản dịch, KHÔNG soi selector
 * trong khối CSS — nên ca này lọt hẳn.
 */
import { describe, it, expect } from 'vitest';
import { verifyFields } from '../aiVerify';
import type { TranslationField } from '../../types/card';

const field = (original: string, translated: string): TranslationField => ({
  path: 'data.extensions.regex_scripts[0].replaceString',
  label: 'regex[0].replaceString',
  group: 'regex',
  original, translated, status: 'done', retries: 0,
} as unknown as TranslationField);

const cssIssues = (orig: string, trans: string) =>
  verifyFields([field(orig, trans)]).filter((i) => i.category === 'css_class_sync');

describe('(bug 171 mục 2) bắt selector CSS bị vỡ', () => {
  it('ca thật: .q-普通 → .q-Phổ Thông phải bị báo lỗi', () => {
    const found = cssIssues('<style>.q-普通 { color: red; }</style>', '<style>.q-Phổ Thông { color: red; }</style>');
    expect(found.length, 'mất màu mà không ai báo là đúng loại lỗi im lặng tệ nhất').toBeGreaterThan(0);
    expect(found[0].description).toMatch(/MẤT MÀU|dấu cách/);
  });

  it('lời khuyên phải nói rõ cần sửa CẢ BA chỗ, không chỉ CSS', () => {
    // Class được ghép lúc chạy: class="q-${q}" với q lấy từ stat_data. Sửa mỗi selector là vẫn
    // không khớp — người đọc cần biết điều đó ngay, kẻo sửa một chỗ rồi tưởng xong.
    const found = cssIssues('<style>.q-普通{}</style>', '<style>.q-Phổ Thông{}</style>');
    expect(found[0].suggestion).toMatch(/stat_data/);
    expect(found[0].suggestion).toMatch(/slug/i);
  });

  it('selector giữ nguyên (không dịch) → KHÔNG báo oan', () => {
    expect(cssIssues('<style>.q-普通 { color: red; }</style>', '<style>.q-普通 { color: red; }</style>')).toEqual([]);
  });

  it('selector ASCII bình thường có hậu duệ hợp lệ → KHÔNG báo oan', () => {
    // `.card .title` là selector hậu duệ hợp lệ và CÓ SẴN trong bản gốc.
    const src = '<style>.card .title { color: red; }</style>';
    expect(cssIssues(src, src)).toEqual([]);
  });

  it('slug hoá đúng cách → không còn bị báo', () => {
    const found = cssIssues('<style>.q-普通{}</style>', '<style>.q-pho-thong{}</style>');
    expect(found).toEqual([]);
  });
});
