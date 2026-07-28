/**
 * src/lib/ai/storyFileImport.ts — (bug 136) NHẬP FILE TRUYỆN cho "Tạo thẻ từ truyện".
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "cho phép kéo thả hoặc chọn trực tiếp một hay nhiều file truyện .txt, .md... thay vì
 * phải dán nội dung thủ công", giữ nguyên toàn bộ workflow cũ.
 *
 * Phần này TẤT ĐỊNH và tách khỏi UI để test được:
 *  • Nhận nhiều file (.txt/.md/.text + .epub qua parser sẵn có), đọc theo THỨ TỰ TỰ NHIÊN của
 *    tên ("chương 2" đứng trước "chương 10" — sort chuỗi thô sẽ xếp sai).
 *  • Ghép thành MỘT văn bản với mốc ranh giới ═══ [FILE: tên] ═══ — bộ quét chunk sẵn có xử lý
 *    tiếp như truyện dán tay, và AI thấy được ranh giới quyển/hồi để không nhầm ngữ cảnh.
 *  • Báo rõ file nào bị bỏ (định dạng lạ, đọc lỗi) — không nuốt im lặng.
 */

import { isEpubFile, parseEpubToText } from './epubParser';

export interface StoryFilePart {
  name: string;
  chars: number;
}

export interface StoryImportResult {
  /** Văn bản đã ghép, sẵn sàng đổ vào ô truyện. */
  text: string;
  parts: StoryFilePart[];
  /** File bị bỏ + lý do — hiện cho user. */
  skipped: Array<{ name: string; reason: string }>;
}

const TEXT_EXT_RE = /\.(txt|md|text|markdown)$/i;

export function isStoryTextFile(name: string): boolean {
  return TEXT_EXT_RE.test(name);
}

/**
 * So tên file theo THỨ TỰ TỰ NHIÊN: các cụm số so theo GIÁ TRỊ ("chương 2" < "chương 10").
 * Sort chuỗi thô xếp "chương 10" trước "chương 2" — truyện bị đảo hồi mà không ai nhận ra.
 */
export function naturalCompare(a: string, b: string): number {
  const ax = a.toLowerCase().split(/(\d+)/);
  const bx = b.toLowerCase().split(/(\d+)/);
  for (let i = 0; i < Math.max(ax.length, bx.length); i++) {
    const as = ax[i] ?? '', bs = bx[i] ?? '';
    if (as === bs) continue;
    const an = Number(as), bn = Number(bs);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
    return as < bs ? -1 : 1;
  }
  return 0;
}

/** Đọc một file văn bản thường (không phải epub). */
function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(new Error('không đọc được file'));
    r.readAsText(file);
  });
}

/** Mốc ranh giới giữa các file trong văn bản ghép. */
export function fileMarker(name: string): string {
  return `═══ [FILE: ${name}] ═══`;
}

export async function readStoryFiles(files: File[]): Promise<StoryImportResult> {
  const sorted = [...files].sort((a, b) => naturalCompare(a.name, b.name));
  const parts: StoryFilePart[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  const blocks: string[] = [];

  for (const f of sorted) {
    try {
      let text: string;
      if (isEpubFile(f)) text = await parseEpubToText(f);
      else if (isStoryTextFile(f.name)) text = await readTextFile(f);
      else { skipped.push({ name: f.name, reason: 'định dạng không hỗ trợ (chỉ .txt/.md/.text/.epub)' }); continue; }

      const clean = text.replace(/^﻿/, '').trim();
      if (!clean) { skipped.push({ name: f.name, reason: 'file rỗng' }); continue; }
      parts.push({ name: f.name, chars: clean.length });
      // Chỉ chèn mốc khi có NHIỀU file — một file thì giữ nguyên như dán tay.
      blocks.push(clean);
    } catch (e) {
      skipped.push({ name: f.name, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  const text = parts.length > 1
    ? parts.map((p, i) => `${fileMarker(p.name)}\n\n${blocks[i]}`).join('\n\n')
    : (blocks[0] ?? '');

  return { text, parts, skipped };
}
