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
  type NameCandidate,
} from '../utils/nameGlossary';
import { callProviderHedged, setExtraProviders, resetProviderPool } from '../utils/apiClient';
import { isTranslatableToken } from './tokenBatcher';
import type { ScriptPipelineDeps } from './types';

const SAMPLE_BUDGET = 60_000; // ký tự mẫu gửi đi phân tích tần suất — đủ phủ, không phí

/**
 * Dựng danh sách ứng viên cho từ điển. TÁCH RA làm hàm thuần để test được — đây là phần
 * quyết định chất lượng từ điển, không nên trốn sau một lượt gọi AI.
 */
export function buildScriptGlossaryCandidates(tokens: CJKToken[]): NameCandidate[] {
  // ═══ (bug 154) KHOÁ DỮ LIỆU LÀ ỨNG VIÊN HÀNG ĐẦU, KHÔNG PHẢI THỨ BỊ LOẠI ═══
  // Bản cũ bỏ hẳn object key / dot-notation ra khỏi mẫu, kèm lý do "tên trong đó giữ nguyên,
  // đừng dạy AI dịch". Điều đó ĐÚNG cho tới bug 151 — hồi đó khoá không bao giờ được đổi tên.
  // Nhưng nay TỪ ĐIỂN CHÍNH LÀ cơ chế đổi khoá, nên loại chúng ra tức là pha 0 không bao giờ
  // đề xuất nổi thứ user cần nhất; còn lại vài tên riêng trong văn xuôi ⇒ đúng cảnh user báo:
  // "chỉ quét và tạo được tối đa 2~5 thuật ngữ".
  //
  // Khoá thì ĐẾM ĐƯỢC TRỰC TIẾP, không cần lọc tần suất: mỗi tên khoá riêng biệt đều đáng vào
  // từ điển dù chỉ xuất hiện một lần, vì bỏ sót một cái là chỗ đọc/ghi lệch nhau.
  const keyCount = new Map<string, number>();
  let sample = '';
  for (const t of tokens) {
    if (isTranslatableToken(t)) {
      if (sample.length < SAMPLE_BUDGET) sample += t.text + '\n';
      continue;
    }
    // Bỏ phần ASCII dính kèm (`_开场标识` → `开场标识`): user nhập tên biến bằng chữ Hán thuần,
    // và reinsert sẽ tự ghép tiền tố lại vào trong nháy/bracket.
    const core = t.text.replace(/^[\w$]+/, '').replace(/[\w$]+$/, '');
    if (!/[一-鿿㐀-䶿぀-ヿ가-힯]/.test(core) || Array.from(core).length > 12) continue;
    keyCount.set(core, (keyCount.get(core) ?? 0) + 1);
  }

  // Tái dùng bộ phân tích tần suất của Dịch Card qua 1 field giả — extractNameCandidates
  // chỉ đọc `original` nên field tối giản là đủ.
  const fakeField = { path: 'script', group: 'description', original: sample, status: 'pending' } as unknown as TranslationField;
  const prose = sample.trim() ? extractNameCandidates([fakeField]) : [];

  // Khoá đứng TRƯỚC (fromKeys = ưu tiên, không cần đủ tần suất), rồi tới tên riêng văn xuôi.
  const seen = new Set<string>();
  const candidates: NameCandidate[] = [];
  for (const [term, count] of [...keyCount.entries()].sort((a, b) => b[1] - a[1])) {
    seen.add(term);
    candidates.push({ term, count, fromKeys: true });
  }
  for (const c of prose) {
    if (seen.has(c.term)) continue;
    seen.add(c.term);
    candidates.push(c);
  }
  return candidates;
}

/**
 * Chạy Pha 0 trên danh sách token đã extract. Trả về entries (auto=true) để UI đổ vào
 * bảng cho user sửa/xoá/thêm. Không có ứng viên → [] (không tốn lượt AI nào).
 */
export async function runScriptGlossaryPhase(
  tokens: CJKToken[],
  deps: ScriptPipelineDeps,
  signal?: AbortSignal,
): Promise<GlossaryEntry[]> {
  const candidates = buildScriptGlossaryCandidates(tokens);
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
