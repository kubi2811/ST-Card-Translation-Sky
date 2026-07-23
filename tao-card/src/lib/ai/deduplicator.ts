/**
 * src/lib/ai/deduplicator.ts — 3-Layer Anti-Duplication System
 * Spec Phần 7H.1: Key overlap, content fingerprint (Jaccard bigrams), RAG semantic
 */

import type { LorebookEntry, AIGeneratedEntry, ChatMessage } from '../../types';
import { TFIDFIndex } from '../rag/tfidfIndexer';

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 0: Trùng DANH TÍNH — tên entry / tên riêng
// ═══════════════════════════════════════════════════════════════════════════

/**
 * (User 23/07 — việc 90) "Một nhân vật lại được tạo tới 3 entry có nội dung y hệt nhau."
 *
 * Các batch chạy SONG SONG đều nhận cùng ngữ cảnh thẻ (trạng thái TRƯỚC vòng) nên không batch
 * nào biết anh em đang viết gì — ba batch cùng chọn một nhân vật là chuyện thường. Bộ lọc trùng
 * là chốt chặn duy nhất, mà nó lại THIẾU HẲN phép so hiển nhiên nhất: TÊN ENTRY.
 *
 * Ca lọt lưới (test tái hiện được): hai entry cùng tên "Lý Tiêu Dao", key lệch nhẹ
 * (['Lý Tiêu Dao'] vs ['Lý Tiêu Dao','Tiêu Dao']), nội dung viết lại bằng chữ khác:
 *   - lớp key   : ratio 1/2 = 0.5 < 0.8 ⇒ thoát;
 *   - lớp nội dung: viết lại nên bigram khác nhau ⇒ thoát;
 *   - lớp ngữ nghĩa: ngưỡng 0.92 quá cao cho văn viết lại ⇒ thoát.
 * Kết quả: cùng một nhân vật nằm 3 entry.
 */

/** Chuẩn hoá tên để so danh tính: bỏ dấu câu/khoảng trắng thừa, hạ chữ thường. */
export function normalizeIdentity(s: string): string {
  return String(s || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[[\]()（）【】「」『』:：,，.。\-–—_/\\|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Bỏ tiền tố phân loại mà AI hay thêm ("Nhân vật: X", "[NPC] X") để so đúng phần TÊN. */
function stripCategoryPrefix(s: string): string {
  return normalizeIdentity(s).replace(
    /^(nhân vật|npc|character|địa danh|location|thế lực|phe phái|faction|vật phẩm|item|sự kiện|event|khái niệm|concept)\s+/,
    '',
  );
}

export function checkIdentityDuplicate(
  newEntry: AIGeneratedEntry,
  existingEntries: LorebookEntry[],
): { isDuplicate: boolean; conflictWith?: string; matchedOn?: string } {
  const newTitle = stripCategoryPrefix(newEntry.comment || '');
  const newKeys = (newEntry.keys ?? []).map(normalizeIdentity).filter(Boolean);
  if (!newTitle && newKeys.length === 0) return { isDuplicate: false };

  for (const e of existingEntries) {
    const oldTitle = stripCategoryPrefix(e.comment || '');
    const oldKeys = (e.keys ?? []).map(normalizeIdentity).filter(Boolean);

    // a) Trùng TÊN ENTRY — bằng chứng mạnh nhất, đây chính là chỗ trước giờ bỏ sót.
    if (newTitle && oldTitle && newTitle === oldTitle) {
      return { isDuplicate: true, conflictWith: e.comment, matchedOn: `tên entry "${e.comment}"` };
    }
    // b) Tên entry bên này chính là một KEY bên kia (và ngược lại) — cùng thực thể, khác cách gọi.
    //    Chỉ tính khi tên đủ dài để là tên riêng, tránh dính key chung chung như "vật phẩm".
    if (newTitle.length >= 4 && oldKeys.includes(newTitle)) {
      return { isDuplicate: true, conflictWith: e.comment, matchedOn: `tên "${newEntry.comment}" là từ khoá của entry đã có` };
    }
    if (oldTitle.length >= 4 && newKeys.includes(oldTitle)) {
      return { isDuplicate: true, conflictWith: e.comment, matchedOn: `entry đã có tên "${e.comment}" nằm trong từ khoá mới` };
    }
  }
  return { isDuplicate: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 1: Key Overlap (O(n), real-time)
// ═══════════════════════════════════════════════════════════════════════════

export function checkKeyOverlap(
  newKeys: string[],
  existingEntries: LorebookEntry[],
  // (User 21/07 — bug 71) Ngưỡng cũ 0.5 quá gắt: entry 2 key chỉ cần TRÙNG 1 key với entry
  // đã có là bị loại. Thế giới nhiều phe phái/NPC hay dùng chung một tên riêng (vd cùng nhắc
  // "Thiên Kiếm Tông") ⇒ rơi hàng loạt, kế hoạch 20 entry còn 6-10. Nâng lên 0.8 = phải trùng
  // gần hết key mới coi là một.
  threshold = 0.8,
): { isDuplicate: boolean; conflictWith?: string; overlapRatio: number } {
  const newSet = new Set(newKeys.map(k => k.toLowerCase().trim()));
  if (newSet.size === 0) return { isDuplicate: false, overlapRatio: 0 };

  for (const entry of existingEntries) {
    const existSet = new Set(entry.keys.map(k => k.toLowerCase().trim()));
    const intersection = [...newSet].filter(k => existSet.has(k));
    const ratio = intersection.length / Math.max(newSet.size, existSet.size, 1);
    // Hai bên đều ÍT key mà chỉ chạm nhau 1 key → chưa đủ bằng chứng là trùng thực thể...
    // ...TRỪ KHI trùng trọn vẹn (ratio = 1, vd cả hai chỉ có đúng 1 key giống hệt) — lúc đó
    // là một thực thể thật. (Ca này do test bắt được, guard ban đầu làm lọt entry trùng.)
    if (Math.min(newSet.size, existSet.size) <= 2 && intersection.length < 2 && ratio < 1) continue;
    if (ratio >= threshold) {
      return { isDuplicate: true, conflictWith: entry.comment, overlapRatio: ratio };
    }
  }
  return { isDuplicate: false, overlapRatio: 0 };
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 2: Content Fingerprint — Jaccard bigrams (O(n), real-time)
// ═══════════════════════════════════════════════════════════════════════════

function getBigrams(text: string): Set<string> {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const bigrams = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.add(`${words[i]}|${words[i + 1]}`);
  }
  return bigrams;
}

export function checkContentSimilarity(
  newContent: string,
  existingEntries: LorebookEntry[],
  threshold = 0.6,
): { isDuplicate: boolean; conflictWith?: string; similarity: number } {
  const newBigrams = getBigrams(newContent);
  if (newBigrams.size === 0) return { isDuplicate: false, similarity: 0 };

  for (const entry of existingEntries) {
    const existBigrams = getBigrams(entry.content);
    if (existBigrams.size === 0) continue;
    const intersection = [...newBigrams].filter(bg => existBigrams.has(bg));
    const union = new Set([...newBigrams, ...existBigrams]);
    const similarity = union.size > 0 ? intersection.length / union.size : 0;
    if (similarity >= threshold) {
      return { isDuplicate: true, conflictWith: entry.comment, similarity };
    }
  }
  return { isDuplicate: false, similarity: 0 };
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 3: RAG Semantic (O(1) after index)
// ═══════════════════════════════════════════════════════════════════════════

export function checkSemanticSimilarity(
  newEntry: AIGeneratedEntry,
  ragIndex: TFIDFIndex,
  threshold = 0.85,
): { isDuplicate: boolean; conflictWith?: string; similarity: number } {
  const results = ragIndex.search(newEntry.comment + ' ' + newEntry.content, { topK: 1 });
  if (results.length > 0 && results[0].score >= threshold) {
    return { isDuplicate: true, conflictWith: results[0].entry.comment, similarity: results[0].score };
  }
  return { isDuplicate: false, similarity: results[0]?.score ?? 0 };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMBINED CHECK — 3 layers
// ═══════════════════════════════════════════════════════════════════════════

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  reason?: 'identity' | 'key_overlap' | 'content_similarity' | 'semantic_similarity';
  conflictWith?: string;
  details?: {
    matchedOn?: string;
    keyOverlapRatio?: number;
    contentSimilarity?: number;
    semanticSimilarity?: number;
  };
}

export function isDuplicateEntry(
  newEntry: AIGeneratedEntry,
  existingEntries: LorebookEntry[],
  ragIndex?: TFIDFIndex,
): DuplicateCheckResult {
  // Layer 0: trùng DANH TÍNH (tên entry) — chốt chặn cho ca nhiều luồng cùng viết một nhân vật.
  const ident = checkIdentityDuplicate(newEntry, existingEntries);
  if (ident.isDuplicate) {
    return {
      isDuplicate: true,
      reason: 'identity',
      conflictWith: ident.conflictWith,
      details: { matchedOn: ident.matchedOn },
    };
  }

  // Layer 1: Key overlap
  const k = checkKeyOverlap(newEntry.keys ?? [], existingEntries);
  if (k.isDuplicate) {
    return {
      isDuplicate: true,
      reason: 'key_overlap',
      conflictWith: k.conflictWith,
      details: { keyOverlapRatio: k.overlapRatio },
    };
  }

  // Layer 2: Content fingerprint
  const c = checkContentSimilarity(newEntry.content, existingEntries);
  if (c.isDuplicate) {
    return {
      isDuplicate: true,
      reason: 'content_similarity',
      conflictWith: c.conflictWith,
      details: { contentSimilarity: c.similarity },
    };
  }

  // Layer 3: RAG semantic
  if (ragIndex) {
    // (bug 71) 0.85 loại nhầm nhiều entry cùng CHỦ ĐỀ nhưng khác THỰC THỂ (các môn phái
    // trong cùng một thế giới viết văn phong giống nhau) → nâng lên 0.92.
    const s = checkSemanticSimilarity(newEntry, ragIndex, 0.92);
    if (s.isDuplicate) {
      return {
        isDuplicate: true,
        reason: 'semantic_similarity',
        conflictWith: s.conflictWith,
        details: { semanticSimilarity: s.similarity },
      };
    }
  }

  return { isDuplicate: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// SEMANTIC DEDUPLICATION RUNNER (Flash model-assisted)
// ═══════════════════════════════════════════════════════════════════════════

import type { ProxyProfile, GenerationParams } from '../../types';
import { callAI } from './client';

const DEDUPLICATE_SYSTEM_PROMPT = `Bạn là chuyên gia phân tích dữ liệu và quản lý bối cảnh Lorebook.
Nhiệm vụ của bạn là xem xét các CẶP Lorebook entries nghi ngờ trùng lặp ngữ nghĩa, xác định xem chúng có thực sự nói về cùng một thực thể/chủ đề và có thể gộp lại hay không.

QUY TẮC QUYẾT ĐỊNH:
1. TRÙNG LẶP: Hai entry được coi là trùng lặp nếu chúng mô tả cùng một đối tượng (nhân vật, địa danh, bang hội, khái niệm...) và có thông tin chồng lấn lớn.
2. KHÔNG TRÙNG LẶP: Nếu chúng là hai thực thể khác nhau (ví dụ: hai nhân vật khác nhau, hai địa danh khác nhau dù tên gần giống), đặt "action" là "KEEP_BOTH".
3. GỘP (MERGE): Nếu trùng lặp, hãy chọn một entry làm "target" (thường là entry chi tiết hơn) và một entry làm "source" (để gộp vào và xóa đi). Tạo ra thông tin gộp hoàn chỉnh:
   - comment: Tên tối ưu nhất.
   - keys: Gộp tất cả các từ khóa kích hoạt độc bản của cả hai, viết thường, ngăn cách bằng dấu phẩy.
   - content: Gộp toàn bộ chi tiết quan trọng của cả hai, loại bỏ thông tin thừa/trùng lắp, viết khách quan ở ngôi thứ ba.

CHỈ trả về một MẢNG JSON các quyết định gộp có cấu trúc như sau:
[
  {
    "pairIndex": <số thứ tự cặp từ yêu cầu, bắt đầu từ 0>,
    "action": "MERGE" hoặc "KEEP_BOTH",
    "mergeDetails": {
      "targetId": "<id của target entry>",
      "sourceId": "<id của source entry>",
      "comment": "<tên gộp mới>",
      "keys": ["<từ khóa 1>", "<từ khóa 2>"],
      "content": "<nội dung gộp mới>"
    }
  },
  ...
]
KHÔNG thêm lời giải thích nào khác ngoài mảng JSON. KHÔNG dùng markdown. KHÔNG dùng code block.`;

export interface DeduplicateResult {
  mergedEntries: LorebookEntry[];
  deletedIds: number[];
  logMessages: string[];
}

export async function runSemanticDeduplication(
  entries: LorebookEntry[],
  profile: ProxyProfile,
  params: GenerationParams,
  log: (msg: string) => void,
): Promise<DeduplicateResult> {
  const index = new TFIDFIndex();
  index.indexWithSource(entries);

  const candidatePairsMap = new Map<string, [LorebookEntry, LorebookEntry]>();
  for (const E1 of entries) {
    const searchResults = index.search(E1.comment + ' ' + E1.content, { topK: 5 });
    for (const res of searchResults) {
      if (res.entry.id === E1.id) continue;
      // Filter out low similarity or match
      if (res.score < 0.35) continue;
      
      const E2 = res.entry as unknown as LorebookEntry;
      const key = E1.id < E2.id ? `${E1.id}_${E2.id}` : `${E2.id}_${E1.id}`;
      if (!candidatePairsMap.has(key)) {
        candidatePairsMap.set(key, E1.id < E2.id ? [E1, E2] : [E2, E1]);
      }
    }
  }

  const candidatePairs = Array.from(candidatePairsMap.values());
  log(`🔍 Phát hiện ${candidatePairs.length} cặp entries có tiềm năng trùng lặp bối cảnh.`);

  const logMessages: string[] = [];
  const finalEntries = [...entries];
  const deletedIds = new Set<number>();

  if (candidatePairs.length === 0) {
    log('✅ Không tìm thấy cặp entries nào nghi ngờ trùng lặp ngữ nghĩa.');
    return { mergedEntries: finalEntries, deletedIds: [], logMessages };
  }

  function tryExtractDeduplicateJson(text: string): Array<{
    pairIndex: number;
    action: 'MERGE' | 'KEEP_BOTH';
    mergeDetails?: {
      targetId: string | number;
      sourceId: string | number;
      comment: string;
      keys: string[];
      content: string;
    };
  }> | null {
    const cleanText = text.trim();
    try {
      const parsed = JSON.parse(cleanText);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* continue */ }

    const fenceMatch = cleanText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
      try {
        const parsed = JSON.parse(fenceMatch[1].trim());
        if (Array.isArray(parsed)) return parsed;
      } catch { /* continue */ }
    }

    const arrayMatch = cleanText.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsed)) return parsed;
      } catch { /* continue */ }
    }
    return null;
  }

  const BATCH_SIZE = 5;
  for (let idx = 0; idx < candidatePairs.length; idx += BATCH_SIZE) {
    const currentBatch = candidatePairs.slice(idx, idx + BATCH_SIZE);
    const activeBatch = currentBatch.filter(([E1, E2]) => !deletedIds.has(E1.id) && !deletedIds.has(E2.id));
    if (activeBatch.length === 0) continue;

    const pairsPrompt = activeBatch.map((pair, pIdx) => {
      const [E1, E2] = pair;
      return `CẶP SỐ ${pIdx}:
- Entry A (ID: ${E1.id}):
  Comment: ${E1.comment}
  Keys: [${E1.keys.join(', ')}]
  Content: ${E1.content}
- Entry B (ID: ${E2.id}):
  Comment: ${E2.comment}
  Keys: [${E2.keys.join(', ')}]
  Content: ${E2.content}`;
    }).join('\n\n=====================\n\n');

    const userMessage = `Dưới đây là danh sách các cặp Lorebook entries nghi ngờ trùng lặp. Hãy xem xét và quyết định có gộp hay không:\n\n${pairsPrompt}`;

    const messages: ChatMessage[] = [
      { role: 'system', content: DEDUPLICATE_SYSTEM_PROMPT },
      { role: 'user', content: userMessage }
    ];

    try {
      log(`📡 Đang gửi ${activeBatch.length} cặp sang AI (model phụ) để phân tích trùng lặp...`);
      const response = await callAI({
        profile,
        params,
        messages,
        useSecondary: true
      });

      const decisions = tryExtractDeduplicateJson(response.text);
      if (!decisions) {
        log(`⚠️ Không thể phân tích phản hồi JSON từ AI cho loạt cặp thứ ${idx / BATCH_SIZE + 1}. Bỏ qua.`);
        continue;
      }

      for (const dec of decisions) {
        const pIdx = dec.pairIndex;
        if (pIdx < 0 || pIdx >= activeBatch.length) continue;

        const [E1, E2] = activeBatch[pIdx];

        if (dec.action === 'MERGE' && dec.mergeDetails) {
          const targetId = Number(dec.mergeDetails.targetId);
          const sourceId = Number(dec.mergeDetails.sourceId);

          if ((targetId === E1.id && sourceId === E2.id) || (targetId === E2.id && sourceId === E1.id)) {
            if (deletedIds.has(sourceId) || deletedIds.has(targetId)) {
              continue;
            }

            const targetIdx = finalEntries.findIndex(e => e.id === targetId);
            if (targetIdx !== -1) {
              const prevComment = finalEntries[targetIdx].comment;
              const sourceEntry = finalEntries.find(e => e.id === sourceId);
              const sourceComment = sourceEntry ? sourceEntry.comment : String(sourceId);

              finalEntries[targetIdx] = {
                ...finalEntries[targetIdx],
                comment: dec.mergeDetails.comment || finalEntries[targetIdx].comment,
                keys: Array.isArray(dec.mergeDetails.keys) ? dec.mergeDetails.keys : finalEntries[targetIdx].keys,
                content: dec.mergeDetails.content || finalEntries[targetIdx].content,
              };

              deletedIds.add(sourceId);
              const msg = `✅ Đã gộp "${sourceComment}" (ID: ${sourceId}) vào "${prevComment}" (ID: ${targetId}) thành "${finalEntries[targetIdx].comment}".`;
              log(msg);
              logMessages.push(msg);
            }
          }
        } else {
          log(`⏭️ Giữ nguyên cặp: "${E1.comment}" & "${E2.comment}".`);
        }
      }
    } catch (error) {
      log(`⚠️ Lỗi khi xử lý trùng lặp loạt cặp thứ ${idx / BATCH_SIZE + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const filteredEntries = finalEntries.filter(e => !deletedIds.has(e.id));
  return {
    mergedEntries: filteredEntries,
    deletedIds: Array.from(deletedIds),
    logMessages,
  };
}
