// ─── Pha 0 cho "Dịch Script": bảng tên riêng/thuật ngữ từ token CJK (1 lượt AI) ───
// Mục đích y hệt Pha 0 của Dịch Card: chốt MỘT bản dịch duy nhất cho mỗi tên
// (秋青子 → Thu Thanh Tử) TRƯỚC khi dịch song song, để 80 lô chạy đồng thời không
// mỗi lô dịch tên một kiểu. Kết quả là bảng EDIT ĐƯỢC trên UI trước khi chạy.
import type { CJKToken } from '../utils/surgical';
import type { GlossaryEntry, TranslationField } from '../types/card';
import {
  extractNameCandidates,
  buildNameGlossaryPrompt,
  parseNameGlossaryResponse,
} from '../utils/nameGlossary';
import { callProviderHedged, setExtraProviders, resetProviderPool } from '../utils/apiClient';
import { isTranslatableToken } from './tokenBatcher';
import type { ScriptPipelineDeps } from './types';

const SAMPLE_BUDGET = 60_000; // ký tự mẫu gửi đi phân tích tần suất — đủ phủ, không phí

/**
 * Chạy Pha 0 trên danh sách token đã extract. Trả về entries (auto=true) để UI đổ vào
 * bảng cho user sửa/xoá/thêm. Không có ứng viên → [] (không tốn lượt AI nào).
 */
export async function runScriptGlossaryPhase(
  tokens: CJKToken[],
  deps: ScriptPipelineDeps,
  signal?: AbortSignal,
): Promise<GlossaryEntry[]> {
  // Gom mẫu từ token DỊCH ĐƯỢC (bỏ object key/CSS — tên trong đó giữ nguyên, đừng dạy AI dịch).
  let sample = '';
  for (const t of tokens) {
    if (!isTranslatableToken(t)) continue;
    sample += t.text + '\n';
    if (sample.length >= SAMPLE_BUDGET) break;
  }
  if (!sample.trim()) return [];

  // Tái dùng bộ phân tích tần suất của Dịch Card qua 1 field giả — extractNameCandidates
  // chỉ đọc `original` nên field tối giản là đủ.
  const fakeField = { path: 'script', group: 'description', original: sample, status: 'pending' } as unknown as TranslationField;
  const candidates = extractNameCandidates([fakeField]);
  if (!candidates.length) return [];

  const { system, user } = buildNameGlossaryPrompt(
    candidates,
    'Tiếng Việt',
    deps.nameStyle,
    deps.fandomMode,
    deps.fandomName,
  );

  setExtraProviders(deps.providers);
  resetProviderPool();
  const response = await callProviderHedged(deps.proxy, system, user, {
    signal,
    meta: { label: 'script-pha0', charCount: user.length },
  });
  return parseNameGlossaryResponse(response, candidates).map((e) => ({ ...e, auto: true }));
}
