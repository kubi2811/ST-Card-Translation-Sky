/**
 * src/lib/ai/lorebookAgent.ts — (Goal 102) Miền Lorebook cắm vào khung goalAgent.
 * ─────────────────────────────────────────────────────────────────────────────
 * Pha KẾ HOẠCH dùng chung khung goalAgent (user duyệt trước khi tiêu call). Pha CHẠY thì
 * KHÔNG đi qua vòng step-tuần-tự của goalAgent mà giao cho `runBatchGeneration` — engine đó
 * đã có pool đa key song song, chia luồng, dedup 3 lớp và sinh bù; ép nó vào step loop là
 * vứt hết phần song song đi.
 *
 * Chống trùng TẬN GỐC (102.2 — "title bucket trước khi sinh"): kế hoạch bắt AI liệt kê sẵn
 * DANH SÁCH TIÊU ĐỀ entry sẽ tạo (đánh số toàn cục). Danh sách này được nhúng vào topicPrompt
 * thành "DANH SÁCH THỰC THỂ BẮT BUỘC PHỦ" — đúng cái danh sách mà chỉ thị chia-phần-luồng
 * trong batchGenerator modulo lên. Trước đây các luồng song song không có danh sách chung nên
 * cùng chọn nhân vật "nổi bật nhất" → trùng + máy móc như game; giờ mỗi luồng nhận phần
 * tiêu đề riêng ngay từ prompt.
 *
 * Bám schema (102.3 — nợ #48): entry NHÂN VẬT/NPC khi card có MVUZOD schema phải gán giá trị
 * cho chỉ số trong schema. Validator ở đây kiểm ĐÚNG các entry thuộc bucket NPC/nhân vật
 * (biết chính xác nhờ kế hoạch, không đoán mò) + vòng sửa AI hội tụ theo luật #42.
 */
import type { ChatMessage, LorebookEntry, CharacterCardV3 } from '../../types';
import type { MVUZODSchema } from '../../types/mvuzod.types';
import type { AgentCallFn, AgentIssue, AgentPlan, AgentStepSpec } from './goalAgent';
import { buildSchemaContextForBatch } from '../mvuzod/schemaContextBuilder';
import { sanitizeAiKeys } from '../worldbook/keyInput';

// ═══ Kiểu dữ liệu ═════════════════════════════════════════════════════════

export interface LorebookBucket {
  /** Nhóm nội dung: 'worldview' | 'region' | 'character' | 'npc' | 'scene' | 'other'… */
  group: string;
  /** Nhãn hiển thị tiếng Việt của nhóm. */
  label: string;
  /** Tiêu đề entry SẼ tạo — xương sống chống trùng. */
  titles: string[];
}

export interface LorebookRunConfig {
  totalEntries: number;
  minEntries: number;
  entriesPerBatch: number;
  tokensPerEntry: number;
  cardType: 'single' | 'multi';
  useWebSearch: boolean;
}

/** Kế hoạch lorebook = AgentPlan (hiển thị/duyệt) + phần ruột để chạy engine. */
export interface LorebookPlan extends AgentPlan {
  buckets: LorebookBucket[];
  config: LorebookRunConfig;
}

export interface LorebookAgentContext {
  card: CharacterCardV3;
  schema: MVUZODSchema | null;
  /** Tài liệu user dán (tuỳ chọn) — agent tự quyết trích gì từ đây. */
  docText?: string;
}

// ═══ Giới hạn an toàn ═════════════════════════════════════════════════════

// (bug 196) User: "ít nhất phải 100 entries". 200 vẫn đủ trần, nhưng lời nhắc cũ bảo AI "thường
// 10-60" nên nó không bao giờ tự đề xuất tới 100 — trần rộng mà hướng dẫn hẹp thì cũng như không.
const MAX_TOTAL_ENTRIES = 300;
const MAX_DOC_CHARS_PLAN = 24000;   // pha kế hoạch đọc được nhiều hơn
const MAX_DOC_CHARS_RUN = 12000;    // pha chạy nhúng vào MỖI batch nên phải gọn

// ═══ Prompt kế hoạch ══════════════════════════════════════════════════════

const LOREBOOK_PLAN_SYSTEM = `Bạn là kiến trúc sư Lorebook (World Info) cho SillyTavern. Nhận YÊU CẦU
của user (+ tài liệu nguồn nếu có), hãy TỰ QUYẾT toàn bộ thông số và LIỆT KÊ SẴN TIÊU ĐỀ từng entry.

VÌ SAO PHẢI LIỆT KÊ TIÊU ĐỀ TRƯỚC: các entry sẽ được sinh bởi NHIỀU luồng AI chạy song song không
nhìn thấy nhau — không chia danh sách trước thì các luồng cùng viết về một thực thể, ra lorebook
trùng lặp máy móc. Danh sách của bạn là bản phân công duy nhất.

QUY TẮC LẬP DANH SÁCH:
- Mỗi tiêu đề = MỘT thực thể/chủ đề cụ thể, đủ rõ để viết entry độc lập ("Trưởng lão Hàn Nguyệt",
  không phải "Các trưởng lão").
- Có tài liệu nguồn → ưu tiên trích THỰC THỂ CÓ THẬT trong tài liệu (tên riêng, địa danh, thế lực,
  sự kiện); chỉ bịa thêm khi user yêu cầu mở rộng.
- Cân đối nhóm: thế giới quan/bối cảnh ít mà chất (1-4), nhân vật/NPC và địa danh/sự kiện là phần
  đông. Không tạo entry vô dụng chỉ để đủ số.
- Tổng số entry: tự quyết theo độ giàu của yêu cầu/tài liệu (tối đa ${MAX_TOTAL_ENTRIES}).
  Chủ đề lớn (thần thoại, lịch sử, thế giới nhiều phe phái) thì ĐỪNG ngại đề xuất 100+ entry —
  thà nhiều entry gọn gàng còn hơn ít entry ôm đồm. Nếu user đã nêu con số thì PHẢI theo đúng.

TỰ QUYẾT THÔNG SỐ (user không phải chỉnh gì):
- tokensPerEntry: theo độ sâu user muốn. 150-400 cho lorebook tra cứu nhanh; 800-1500 cho entry
  có chiều sâu; 3000-5000 khi user đòi CHI TIẾT ĐẦY ĐỦ (tiểu sử, biên niên, hồ sơ thế lực).
  User đã nêu con số thì PHẢI theo đúng, không tự hạ xuống cho "an toàn".
- cardType: 'single' nếu lorebook xoay quanh 1 nhân vật chính của thẻ, 'multi' nếu quần tượng.
- entriesPerBatch: 4-8 (lô nhỏ chất lượng đều hơn).

Trả về DUY NHẤT JSON:
{
  "scope": "2-4 câu tiếng Việt: bạn hiểu yêu cầu thế nào, lấy nguồn từ đâu, định phủ những mảng gì",
  "config": { "totalEntries": n, "minEntries": n, "entriesPerBatch": n, "tokensPerEntry": n,
              "cardType": "single|multi", "useWebSearch": false },
  "buckets": [
    { "group": "worldview|region|character|npc|scene|other", "label": "nhãn tiếng Việt",
      "titles": ["tiêu đề 1", "tiêu đề 2"] }
  ],
  "notes": ["lưu ý cho user nếu có"]
}
Tổng số titles PHẢI khớp config.totalEntries.`;

function cardContextBlock(card: CharacterCardV3): string {
  const entries = card.data.character_book?.entries ?? [];
  const existing = entries.slice(0, 60).map((e) => `- ${e.comment}`).join('\n');
  return [
    `Nhân vật: ${card.data.name || '(chưa đặt tên)'}`,
    `Mô tả: ${(card.data.description || '').slice(0, 800)}`,
    `Bối cảnh: ${(card.data.scenario || '').slice(0, 400)}`,
    entries.length
      ? `\nLorebook ĐÃ CÓ ${entries.length} entry (KHÔNG đưa lại các tiêu đề này):\n${existing}${entries.length > 60 ? `\n… và ${entries.length - 60} entry nữa` : ''}`
      : '\nLorebook hiện trống.',
  ].join('\n');
}

// ═══ Plan: build + parse ══════════════════════════════════════════════════

export function buildLorebookPlanMessages(goal: string, ctx: LorebookAgentContext): ChatMessage[] {
  const parts: string[] = [`═══ NGỮ CẢNH THẺ ═══\n${cardContextBlock(ctx.card)}`];
  if (ctx.schema?.fields?.length) {
    parts.push(`═══ SCHEMA BIẾN MVUZOD (entry nhân vật/NPC sẽ phải gán giá trị các chỉ số này) ═══\n${buildSchemaContextForBatch(ctx.schema)}`);
  }
  if (ctx.docText?.trim()) {
    const doc = ctx.docText.slice(0, MAX_DOC_CHARS_PLAN);
    parts.push(`═══ TÀI LIỆU NGUỒN (user dán, ${ctx.docText.length.toLocaleString()} ký tự${ctx.docText.length > MAX_DOC_CHARS_PLAN ? ', đã cắt để đọc' : ''}) ═══\n${doc}`);
  }
  parts.push(`═══ YÊU CẦU CỦA USER ═══\n${goal.trim() || '(user không ghi gì — tự đề xuất lorebook phủ tài liệu/thẻ ở trên)'}`);
  return [
    { role: 'system', content: LOREBOOK_PLAN_SYSTEM },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

const GROUP_LABELS: Record<string, string> = {
  worldview: 'Thế giới quan', region: 'Khu vực/Địa lý', character: 'Nhân vật chính',
  npc: 'NPC', scene: 'Cảnh vật/Sự kiện', other: 'Khác',
};

export function parseLorebookPlan(raw: string): LorebookPlan {
  const m = raw.replace(/```json|```/gi, '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI không trả về JSON kế hoạch — thử diễn đạt yêu cầu rõ hơn.');
  const p = JSON.parse(m[0]) as {
    scope?: string; notes?: string[];
    config?: Partial<LorebookRunConfig>;
    buckets?: Array<{ group?: string; label?: string; titles?: unknown[] }>;
  };

  const buckets: LorebookBucket[] = (p.buckets ?? [])
    .map((b) => ({
      group: String(b.group || 'other'),
      label: String(b.label || GROUP_LABELS[String(b.group || 'other')] || 'Khác'),
      titles: (Array.isArray(b.titles) ? b.titles : []).map(String).map((t) => t.trim()).filter(Boolean),
    }))
    .filter((b) => b.titles.length > 0);
  const titleCount = buckets.reduce((s, b) => s + b.titles.length, 0);
  if (titleCount === 0) throw new Error('Kế hoạch không có tiêu đề entry nào — thử lại với yêu cầu cụ thể hơn.');

  // Thông số AI trả về được KẸP vào biên an toàn — AI tự quyết nhưng không tự phá.
  const clamp = (v: unknown, lo: number, hi: number, dflt: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : dflt;
  };
  const totalEntries = clamp(p.config?.totalEntries, 1, MAX_TOTAL_ENTRIES, titleCount);
  const config: LorebookRunConfig = {
    // Số entry chạy theo DANH SÁCH thật, không theo con số AI hứa suông.
    totalEntries: Math.min(Math.max(totalEntries, titleCount), MAX_TOTAL_ENTRIES),
    // (User 2026) Mặc định 0 = KHÔNG ép sàn. Mặc định cũ 80% số tiêu đề biến mọi lượt AI trả
    // thiếu thành các batch bù nối nhau — user chỉnh tay trên bảng kế hoạch nếu thật sự cần sàn.
    minEntries: clamp(p.config?.minEntries, 0, titleCount, 0),
    entriesPerBatch: clamp(p.config?.entriesPerBatch, 1, 10, 6),
    // (bug 196) Trần cũ 800 chặn thẳng yêu cầu 3000-5000 token/entry của user: nhập bao nhiêu cũng
    // bị kẹp về 800, nên "đặt số token" trên giao diện gần như vô nghĩa với entry chi tiết.
    tokensPerEntry: clamp(p.config?.tokensPerEntry, 80, 6000, 250),
    cardType: p.config?.cardType === 'multi' ? 'multi' : 'single',
    useWebSearch: p.config?.useWebSearch === true,
  };

  // steps chỉ để HIỂN THỊ cho user duyệt — mỗi nhóm bucket một dòng.
  const steps: AgentStepSpec[] = buckets.map((b, i) => ({
    id: `bucket-${i}`,
    title: `${b.label} (${b.titles.length} entry)`,
    detail: b.titles.slice(0, 5).join(' · ') + (b.titles.length > 5 ? ` · … +${b.titles.length - 5}` : ''),
    requirement: b.titles.join('; '),
  }));

  return {
    scope: p.scope || '(AI không mô tả phạm vi)',
    steps,
    estCalls: 1 + Math.ceil(config.totalEntries / config.entriesPerBatch),
    notes: Array.isArray(p.notes) ? p.notes.filter(Boolean).map(String) : undefined,
    buckets,
    config,
  };
}

// ═══ Bucket list → topicPrompt cho engine ═════════════════════════════════

/**
 * Nhúng danh sách tiêu đề (đánh số TOÀN CỤC) vào topicPrompt. Chỉ thị chia-phần-luồng có sẵn
 * trong batchGenerator ("lấy các mục số i, i+n, i+2n…") sẽ modulo lên đúng danh sách này.
 */
export function buildBucketTopicPrompt(goal: string, plan: LorebookPlan, docText?: string): string {
  const lines: string[] = [];
  let n = 0;
  for (const b of plan.buckets) {
    for (const t of b.titles) {
      n++;
      lines.push(`${n}. [${b.label}] ${t}`);
    }
  }
  const parts = [
    goal.trim() || 'Tạo lorebook phủ danh sách thực thể dưới đây.',
    `### 📌 DANH SÁCH THỰC THỂ BẮT BUỘC PHỦ (đánh số toàn cục — ${n} mục)
${lines.join('\n')}

LUẬT: mỗi entry sinh ra PHẢI nhận ĐÚNG MỘT mục trong danh sách trên (comment đặt theo/tương đương
tiêu đề mục đó). KHÔNG sinh thực thể ngoài danh sách khi phần của bạn chưa phủ hết. Mục nào đã có
trong "Entries đã có" thì bỏ qua, lấy mục kế tiếp trong phần của mình.`,
  ];
  if (docText?.trim()) {
    parts.push(`### 📄 TÀI LIỆU NGUỒN (bám sát dữ kiện trong này, không bịa mâu thuẫn)
${docText.slice(0, MAX_DOC_CHARS_RUN)}${docText.length > MAX_DOC_CHARS_RUN ? '\n…(tài liệu đã cắt bớt)' : ''}`);
  }
  return parts.join('\n\n');
}

// ═══ Validator sau khi chạy (102.3 — #48) ═════════════════════════════════

/** Tên các biến LÁ trong schema (để dò entry nhân vật có gán chỉ số hay không). */
export function collectSchemaLeafNames(schema: MVUZODSchema | null): string[] {
  if (!schema?.fields) return [];
  const out: string[] = [];
  const walk = (fields: MVUZODSchema['fields']) => {
    for (const f of fields) {
      if (f.children?.length) walk(f.children);
      else out.push((f.path.split('/').pop() ?? '').trim());
    }
  };
  walk(schema.fields);
  return out.filter(Boolean);
}

export interface LorebookValidateInput {
  /** Entry MỚI tạo trong lần chạy này. */
  newEntries: LorebookEntry[];
  schema: MVUZODSchema | null;
  plan: LorebookPlan;
}

/**
 * Kiểm tất định sau khi engine chạy xong. Chỉ soi entry thuộc bucket nhân vật/NPC (biết chính
 * xác từ kế hoạch — không đoán mò từ heuristic) cho luật bám schema.
 */
export function validateLorebookRun(input: LorebookValidateInput): AgentIssue[] {
  const issues: AgentIssue[] = [];
  const { newEntries, schema, plan } = input;

  // Tập tiêu đề bucket nhóm nhân vật — đối chiếu lỏng (chứa nhau) vì AI có thể thêm tiền tố.
  const personTitles = plan.buckets
    .filter((b) => b.group === 'npc' || b.group === 'character')
    .flatMap((b) => b.titles.map((t) => t.toLowerCase()));
  const isPersonEntry = (e: LorebookEntry) => {
    const c = e.comment.toLowerCase();
    return personTitles.some((t) => c.includes(t) || t.includes(c));
  };

  const leafNames = collectSchemaLeafNames(schema);

  for (const e of newEntries) {
    // Key dính _ / - nối chữ: người chơi gõ có khoảng trắng nên key kiểu đó không bao giờ khớp.
    const badKeys = e.keys.filter((k) => /\p{L}[_-]\p{L}/u.test(k));
    if (badKeys.length) {
      issues.push({ level: 'error', code: 'lb-key-style',
        message: `Key nối chữ bằng _/-: ${badKeys.slice(0, 3).join(', ')} — không bao giờ khớp khi người chơi gõ có khoảng trắng.`,
        where: e.comment });
    }
    // Bám schema (#48): entry nhân vật/NPC phải gán ÍT NHẤT MỘT chỉ số trong schema.
    if (leafNames.length && isPersonEntry(e)) {
      const mentions = leafNames.some((name) => e.content.includes(name));
      if (!mentions) {
        issues.push({ level: 'error', code: 'lb-schema-miss',
          message: `Entry nhân vật không gán chỉ số nào trong schema (${leafNames.slice(0, 5).join(', ')}…) — card MVU cần số liệu để biến vận hành.`,
          where: e.comment });
      }
    }
  }
  return issues;
}

/** Sửa máy móc miễn phí: dọn key _/- bằng sanitizeAiKeys (đã test kỹ ở app chính). */
export function autofixLorebookKeys(entries: LorebookEntry[], issues: AgentIssue[]): {
  patches: Array<{ id: number; keys: string[] }>;
  fixed: string[];
} {
  const bad = new Set(issues.filter((i) => i.code === 'lb-key-style').map((i) => i.where));
  const patches: Array<{ id: number; keys: string[] }> = [];
  const fixed: string[] = [];
  for (const e of entries) {
    if (!bad.has(e.comment)) continue;
    const clean = sanitizeAiKeys(e.keys);
    if (JSON.stringify(clean) !== JSON.stringify(e.keys)) {
      patches.push({ id: e.id, keys: clean });
      fixed.push(`dọn key "${e.comment}": ${e.keys.join(',')} → ${clean.join(',')}`);
    }
  }
  return { patches, fixed };
}

// ═══ Vòng sửa AI cho lb-schema-miss (hội tụ, chặn nở lỗi) ═════════════════

const FIX_SCHEMA_SYSTEM = `Bạn là biên tập viên Lorebook. Nhận MỘT entry nhân vật/NPC và schema biến
MVU của card, hãy VIẾT LẠI content: giữ nguyên toàn bộ thông tin đã có, BỔ SUNG phần gán giá trị
cụ thể cho các chỉ số phù hợp trong schema (ghi số liệu bằng ngôn ngữ tự nhiên dạng database,
vd "Võ lực: 87"). KHÔNG bịa biến ngoài schema, KHÔNG viết code/getvar.
Trả về DUY NHẤT JSON: {"content": "nội dung mới"}`;

export async function fixSchemaMissEntries(
  entries: LorebookEntry[],
  issues: AgentIssue[],
  schema: MVUZODSchema,
  call: AgentCallFn,
  opts: { maxEntries?: number; signal?: AbortSignal; log?: (s: string) => void } = {},
): Promise<Array<{ id: number; content: string }>> {
  const { maxEntries = 8, signal, log } = opts;
  const targets = issues.filter((i) => i.code === 'lb-schema-miss').map((i) => i.where);
  const schemaCtx = buildSchemaContextForBatch(schema);
  const leafNames = collectSchemaLeafNames(schema);
  const patches: Array<{ id: number; content: string }> = [];

  let done = 0;
  for (const e of entries) {
    if (done >= maxEntries) break;
    if (!targets.includes(e.comment)) continue;
    if (signal?.aborted) break;
    done++;
    try {
      const raw = await call([
        { role: 'system', content: FIX_SCHEMA_SYSTEM },
        { role: 'user', content: `### Schema biến\n${schemaCtx}\n\n### Entry cần bổ sung chỉ số\nTên: ${e.comment}\nContent hiện tại:\n${e.content}` },
      ], { temperature: 0.3, label: `Lorebook: bổ sung chỉ số "${e.comment}"` });
      const m = raw.replace(/```json|```/gi, '').match(/\{[\s\S]*\}/);
      if (!m) continue;
      const next = String((JSON.parse(m[0]) as { content?: unknown }).content ?? '');
      // Hội tụ kiểu #42: bản sửa phải THÊM chỉ số schema và KHÔNG ngắn đi quá 20% — không thì bỏ.
      const gainsStat = leafNames.some((name) => next.includes(name));
      if (gainsStat && next.length >= e.content.length * 0.8) {
        patches.push({ id: e.id, content: next });
        log?.(`🔧 Bổ sung chỉ số schema cho "${e.comment}"`);
      } else {
        log?.(`↩️ Bản sửa "${e.comment}" không đạt (thiếu chỉ số/mất nội dung) — giữ bản gốc.`);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') break;
      log?.(`⚠️ Sửa "${e.comment}" lỗi: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return patches;
}
