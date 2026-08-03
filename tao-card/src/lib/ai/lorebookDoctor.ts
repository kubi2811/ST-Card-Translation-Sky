/**
 * lorebookDoctor.ts — (bug 191) HỢP NHẤT "Phân tích" + "Phân tích & Chất lượng" thành MỘT bác
 * sĩ lorebook: máy quét trước (nhanh, miễn phí), AI đọc hiểu sau (bắt lỗi máy không thấy),
 * và MỖI LỖI CÓ ĐƯỜNG SỬA BẰNG AI — không bắt user đọc báo cáo rồi tự đi sửa tay từng entry.
 *
 * Vì sao gộp: hai tab cũ chồng lấn (đều "phân tích") mà mỗi tab một nửa sự thật — tab Phân
 * tích thuần máy offline, tab Chất lượng có AI nhưng CHỈ báo không sửa. User phải tự chạy cả
 * hai, tự đối chiếu, tự sửa. Gộp thành một luồng: Quét → Báo cáo (máy + AI chung một danh
 * sách) → Sửa bằng AI từng lỗi hoặc cả loạt.
 */
import type { ProxyProfile, GenerationParams, LorebookEntry } from '../../types';
import { callAI, computePoolConcurrency } from './client';
import { runPool } from './storyToCard';
import { parseScanIssues } from './aiQualityScan';
import { checkWorldbookHealth } from '../worldbook/worldbookHealthCheck';
import { runQualityCheck } from '../validation/qualityChecker';
import { categorizeAllEntries } from '../worldbook/lorebookCategorizer';
import type { CardType } from '../worldbook/worldbookConfig';

export type DoctorSeverity = 'error' | 'warning' | 'info';

export interface DoctorIssue {
  /** Khoá duy nhất cho UI (theo dõi trạng thái đã sửa). */
  key: string;
  /** id entry liên quan — null khi là nhận xét toàn cục. */
  entryId: number | null;
  comment: string;
  source: 'machine' | 'ai';
  severity: DoctorSeverity;
  issue: string;
  suggestion?: string;
}

const normTitle = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// ─────────────────────────── 1) MÁY QUÉT TRƯỚC ───────────────────────────

/**
 * Gom cả 3 bộ kiểm máy cũ (health check + quality checker + categorizer) về MỘT danh sách
 * chuẩn hoá. Máy quét miễn phí và tất định — chạy trước để AI đỡ phải lặp lại việc máy làm được.
 */
export async function collectMachineFindings(
  entries: LorebookEntry[],
  cardType: CardType,
): Promise<DoctorIssue[]> {
  const out: DoctorIssue[] = [];
  let n = 0;
  const push = (i: Omit<DoctorIssue, 'key'>) => out.push({ ...i, key: `m${n++}` });

  try {
    const health = await checkWorldbookHealth(entries, cardType);
    for (const w of health.items) {
      push({ entryId: w.entryId, comment: w.comment, source: 'machine', severity: w.level, issue: w.message, suggestion: w.autoFixable ? 'Có thể sửa bằng AI.' : undefined });
    }
  } catch { /* bộ kiểm hỏng không được chặn các bộ còn lại */ }

  try {
    const quality = runQualityCheck(entries);
    for (const q of quality.issues) {
      push({
        entryId: q.entryId ?? null, comment: q.entryComment ?? '', source: 'machine',
        severity: q.level, issue: q.message, suggestion: q.suggestion,
      });
    }
  } catch { /* như trên */ }

  try {
    const cats = categorizeAllEntries(entries);
    for (const it of cats.issues) {
      for (const msg of it.issues) {
        push({ entryId: it.entryId, comment: it.comment, source: 'machine', severity: 'warning', issue: msg });
      }
    }
    for (const g of cats.overlapGroups.slice(0, 20)) {
      const names = g.entries.map(id => entries.find(e => e.id === id)?.comment ?? `#${id}`);
      push({
        entryId: g.entries[0] ?? null, comment: names[0] ?? '', source: 'machine', severity: 'info',
        issue: `Các entry [${names.join(', ')}] dùng chung key [${g.sharedKeys.slice(0, 5).join(', ')}] — dễ kích hoạt chồng nhau.`,
      });
    }
  } catch { /* như trên */ }

  // Khử trùng: cùng entry + cùng nội dung lỗi thì giữ một.
  const seen = new Set<string>();
  return out.filter(i => {
    const k = `${i.entryId}|${normTitle(i.issue)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ─────────────────────────── 2) AI ĐỌC HIỂU SAU ───────────────────────────

const AI_SCAN_SYSTEM = `Bạn là chuyên gia kiểm định chất lượng Lorebook (World Info) cho thẻ nhân vật SillyTavern.
Người dùng gửi một LÔ entry (comment + keys + content) kèm DANH SÁCH TIÊU ĐỀ toàn bộ lorebook để đối chiếu.
Nhiệm vụ: TÌM LỖI mà công cụ tự động khó thấy:
- MÂU THUẪN nội dung giữa các entry (một chỗ nói X, chỗ khác nói ngược lại).
- Thông tin PHI LOGIC / sai lệch bối cảnh.
- Entry SƠ SÀI, tóm tắt hời hợt, thiếu chi tiết đáng lẽ phải có.
- KEYS không khớp / không đại diện cho nội dung (kích hoạt sai) hoặc thiếu cách gọi quan trọng.
- Trùng lặp ý nghĩa giữa các entry.
QUY TẮC:
1. CHỈ báo lỗi THỰC SỰ đáng sửa. Không bịa, không báo lỗi vụn vặt. Entry tốt thì bỏ qua.
2. Mỗi lỗi gắn "comment" = comment của entry liên quan (chép ĐÚNG nguyên văn, chỉ entry trong LÔ này).
3. Các lỗi máy đã bắt được liệt kê sẵn — KHÔNG lặp lại chúng.
4. severity: "error" (hỏng/mâu thuẫn nặng), "warning" (nên sửa), "info" (gợi ý).
5. Viết "issue" và "suggestion" bằng tiếng Việt, ngắn gọn, cụ thể (nêu đích danh chỗ sai).
6. CHỈ trả về MẢNG JSON thuần, KHÔNG markdown:
[{"comment":"...","severity":"warning","issue":"...","suggestion":"..."}]
Không tìm thấy lỗi nào: trả về [].`;

export interface DoctorScanOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** Số entry mỗi lượt AI (mặc định 20 — đủ ngữ cảnh chéo mà không tràn context sách lớn). */
  chunkSize?: number;
}

/**
 * AI quét theo LÔ song song qua pool — sách 500 entry không thể nhét một lượt (hệ cũ làm vậy
 * nên sách lớn là tràn context hoặc AI đọc lướt). Mỗi lô kèm danh sách tiêu đề TOÀN BỘ để vẫn
 * bắt được mâu thuẫn chéo lô.
 */
export async function runDoctorAiScan(
  entries: LorebookEntry[],
  machineFindings: DoctorIssue[],
  profile: ProxyProfile,
  params: GenerationParams,
  opts: DoctorScanOptions = {},
): Promise<DoctorIssue[]> {
  if (entries.length === 0) return [];
  const size = Math.max(5, opts.chunkSize ?? 20);
  const chunks: LorebookEntry[][] = [];
  for (let i = 0; i < entries.length; i += size) chunks.push(entries.slice(i, i + size));

  const allTitles = entries.map(e => e.comment).filter(Boolean);
  const byTitle = new Map(entries.map(e => [normTitle(e.comment), e] as const));
  const machineByEntry = new Map<number, string[]>();
  for (const m of machineFindings) {
    if (m.entryId == null) continue;
    const list = machineByEntry.get(m.entryId) ?? [];
    list.push(m.issue);
    machineByEntry.set(m.entryId, list);
  }

  const out: DoctorIssue[] = [];
  let done = 0;
  let n = 0;
  const conc = Math.max(1, Math.min(computePoolConcurrency(profile), chunks.length));
  await runPool(chunks, conc, async (chunk, ci) => {
    const body = chunk.map((e, i) => {
      const machine = (machineByEntry.get(e.id) ?? []).slice(0, 4);
      return `### Entry ${i + 1}\ncomment: ${e.comment}\nkeys: ${(e.keys || []).join(', ')}\n${machine.length ? `lỗi máy đã bắt (đừng lặp lại): ${machine.join(' | ')}\n` : ''}content: ${(e.content || '').slice(0, 800)}`;
    }).join('\n\n');
    const user = `【TIÊU ĐỀ TOÀN BỘ LOREBOOK — để đối chiếu mâu thuẫn/trùng lặp】\n${allTitles.join(' · ').slice(0, 4000)}\n\nKiểm tra LÔ ${ci + 1}/${chunks.length} gồm ${chunk.length} entry dưới đây:\n\n${body}`;
    const raw = await callAI({
      profile, params: { ...params, useJsonResponseFormat: false },
      messages: [{ role: 'system', content: AI_SCAN_SYSTEM }, { role: 'user', content: user }],
      signal: opts.signal, label: `Quét chất lượng AI (lô ${ci + 1}/${chunks.length})`,
    });
    for (const it of parseScanIssues(raw.text)) {
      const entry = byTitle.get(normTitle(it.comment));
      out.push({
        key: `a${n++}`, entryId: entry?.id ?? null, comment: it.comment,
        source: 'ai', severity: it.severity, issue: it.issue, suggestion: it.suggestion,
      });
    }
    done++;
    opts.onProgress?.(done, chunks.length);
  });
  return out;
}

// ─────────────────────────── 3) SỬA BẰNG AI ───────────────────────────

const FIX_SYSTEM = `Bạn là chuyên gia biên tập Lorebook SillyTavern. Người dùng gửi MỘT entry kèm danh sách lỗi đã phát hiện.
Nhiệm vụ: SỬA entry để hết các lỗi đó, GIỮ NGUYÊN toàn bộ ý nghĩa/thông tin gốc không liên quan tới lỗi.
QUY TẮC:
1. Chỉ sửa đúng phần bị lỗi (bổ sung chi tiết nếu lỗi là "sơ sài", sửa keys nếu lỗi về keys, gỡ mâu thuẫn theo suggestion…).
2. KHÔNG thêm thông tin bịa mới ngoài phạm vi sửa lỗi; KHÔNG đổi giọng văn database khách quan.
3. KHÔNG rút ngắn nội dung trừ khi lỗi yêu cầu; các trường không cần sửa thì CHÉP LẠI NGUYÊN VĂN.
4. CHỈ trả về MỘT JSON object thuần (không markdown):
{"comment":"...","keys":["..."],"secondary_keys":["..."],"content":"..."}`;

export interface EntryFixPatch {
  comment: string;
  keys: string[];
  secondary_keys?: string[];
  content: string;
}

/** Bóc JSON object đầu tiên khỏi text (chịu được code fence + rác bao quanh). */
export function parseFixPatch(text: string, original: LorebookEntry): EntryFixPatch | null {
  const t = (text || '').trim();
  const candidates: string[] = [];
  const fence = t.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fence) candidates.push(fence[1].trim());
  candidates.push(t);
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a !== -1 && b > a) candidates.push(t.substring(a, b + 1));
  for (const c of candidates) {
    try {
      const o = JSON.parse(c) as Record<string, unknown>;
      if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
      const content = typeof o.content === 'string' ? o.content.trim() : '';
      // Chốt an toàn: bản sửa rỗng/teo còn dưới 30% bản gốc là hỏng — thà không áp còn hơn phá entry.
      if (!content || content.length < Math.min(50, (original.content || '').length) || content.length < (original.content || '').length * 0.3) continue;
      const keys = Array.isArray(o.keys) ? o.keys.map(String).filter(Boolean) : original.keys;
      return {
        comment: typeof o.comment === 'string' && o.comment.trim() ? o.comment.trim() : original.comment,
        keys: keys.length ? keys : original.keys,
        secondary_keys: Array.isArray(o.secondary_keys) ? o.secondary_keys.map(String).filter(Boolean) : undefined,
        content,
      };
    } catch { /* thử ứng viên kế */ }
  }
  return null;
}

/** Sửa MỘT entry theo danh sách lỗi của nó. Trả null khi bản sửa không qua được chốt an toàn. */
export async function aiFixEntry(
  entry: LorebookEntry,
  issues: DoctorIssue[],
  profile: ProxyProfile,
  params: GenerationParams,
  signal?: AbortSignal,
): Promise<EntryFixPatch | null> {
  const issueList = issues.map((i, k) =>
    `${k + 1}. [${i.severity}] ${i.issue}${i.suggestion ? ` — gợi ý: ${i.suggestion}` : ''}`).join('\n');
  const user = `【ENTRY CẦN SỬA】\ncomment: ${entry.comment}\nkeys: ${(entry.keys || []).join(', ')}\nsecondary_keys: ${(entry.secondary_keys || []).join(', ')}\ncontent:\n${entry.content}\n\n【LỖI PHẢI SỬA】\n${issueList}`;
  const raw = await callAI({
    profile, params: { ...params, useJsonResponseFormat: false },
    messages: [{ role: 'system', content: FIX_SYSTEM }, { role: 'user', content: user }],
    signal, label: `Sửa entry: ${entry.comment}`,
  });
  return parseFixPatch(raw.text, entry);
}
