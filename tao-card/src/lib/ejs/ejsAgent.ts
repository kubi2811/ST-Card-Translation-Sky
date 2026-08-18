/**
 * src/lib/ejs/ejsAgent.ts — (Goal 101.2) Miền EJS cắm vào khung goalAgent.
 * ─────────────────────────────────────────────────────────────────────────────
 * User chỉ đưa YÊU CẦU ("làm bộ điều khiển bật entry theo cảnh giới…") — agent tự phán đoán
 * cần viết mấy khối EJS, đặt entry nào, rồi trình kế hoạch. Sau khi duyệt, từng bước sinh
 * code qua EJS_SYSTEM_PROMPT có sẵn, và MỌI code phải qua validator tất định.
 *
 * ═══ (bug 126) ĐẠI TU PHẦN "AI TỰ QUYẾT" ═══
 * User test và báo: kế hoạch "khá sơ sài và không thực hiện được tất cả yêu cầu". Đọc lại bản
 * cũ thì đúng — nó chỉ đòi AI trả `scope` (vài câu văn xuôi) + danh sách bước tự do, KHÔNG chỗ
 * nào bắt AI nói sẽ đụng vào entry nào, entry đó đang kích hoạt kiểu gì, đổi sang kiểu gì, vì
 * sao. User chỉ có thể duyệt cả cục. Những thay đổi ở đây:
 *
 *  1. Kế hoạch giờ là BẢNG VIỆC (EjsPlanRow): mỗi dòng một đối tượng, có hiện trạng — do MÁY
 *     đo từ card chứ không tin AI khai — đề xuất và lý do. UI duyệt/từ chối từng dòng.
 *  2. Trần 6 bước bỏ đi. User muốn làm cả card trong một lần lên kế hoạch.
 *  3. Prompt được bơm sẵn BẢNG NỀN máy tự dựng: hiện trạng kích hoạt từng entry + gợi ý
 *     chuyển Constant sang từ khoá/điều kiện + cảnh báo card đã có thanh trạng thái. AI không
 *     phải đoán những thứ đo được, và kể cả khi AI trả lời sơ sài, user vẫn thấy đề xuất.
 *  4. Character Definition nằm trong tầm với (target='character').
 *  5. Validate thêm soát XUNG ĐỘT giữa các khối EJS (kể cả với khối đã có sẵn trong card),
 *     và tự vá được thì vá tất định — xem lib/ejs/ejsCollision.ts.
 */
import type { ChatMessage, LorebookEntry } from '../../types';
import type { MVUZODSchema } from '../../types/mvuzod.types';
import type { AgentIssue, AgentPlan, AgentStepSpec, GoalAgentDomain, AgentCallFn, FixAttemptInfo } from '../ai/goalAgent';
import { EJS_SYSTEM_PROMPT, parseEjsResponse, type EJSEntryAction, type EjsStrategy } from '../../prompts/ejsPrompt';
import { validateEJSEntry } from './ejsParser';
import { STPT_API_PROMPT_BLOCK } from './stptApi';
import {
  detectActivationMode, estimateEntryTokens, suggestReclassification, detectExistingStatusUi,
  ACTIVATION_LABEL, isMvuCriticalEntry, estimateRowTokensDelta,
  type ActivationMode, type EjsPlanRow, type EjsRichPlan, type PlanAction, type PlanTarget, type SplitPart,
} from './ejsPlanModel';
import { findCollisions, autopatchCollisions, findActivationOverlaps, scanKeywordOverlap, type EjsBlock } from './ejsCollision';
import { checkEjsSemantics, readInitVarTruth } from './ejsSemanticGuard';
import { extractRequestedPresets, buildPresetCoverage } from './ejsPresetCoverage';
import { QUICK_PRESETS, activatableRegexNames } from './ejsQuickPresets';

// ═══ Kiểu dữ liệu ═════════════════════════════════════════════════════════

export interface EjsAgentContext {
  schema: MVUZODSchema | null;
  entries: LorebookEntry[];
  characterName: string;
  /** (bug 126) Các trường Character Definition để AI xử lý được cả phần này. */
  characterFields?: Partial<Record<'description' | 'personality' | 'scenario' | 'first_mes', string>>;
  /** (bug 126) Dấu vết UI có sẵn — regex script + script TavernHelper của card. */
  regexScripts?: Array<{ scriptName?: string; replaceString?: string }>;
  tavernScripts?: Array<{ name?: string; content?: string }>;
}

/** Một khối EJS đã sinh — item của goalAgent. */
export interface EjsDraft {
  stepId: string;
  entryComment: string;
  code: string;
  strategy: EjsStrategy;
  entryActions: EJSEntryAction[];
  explanation: string;
}

// ═══ Tóm tắt context cho prompt ═══════════════════════════════════════════

function schemaLeafNames(schema: MVUZODSchema | null): string[] {
  const out: string[] = [];
  const walk = (fields: MVUZODSchema['fields']) => {
    for (const f of fields) {
      out.push(f.path.split('/').pop() ?? f.path);
      if (f.children?.length) walk(f.children);
    }
  };
  if (schema?.fields?.length) walk(schema.fields);
  return out;
}

function schemaSummary(schema: MVUZODSchema | null): string {
  if (!schema?.fields?.length) return '(card CHƯA có MVUZOD schema — không được bịa getvar stat_data.*)';
  const lines: string[] = [];
  const walk = (fields: MVUZODSchema['fields'], depth: number) => {
    for (const f of fields) {
      const name = f.path.split('/').pop() ?? f.path;
      lines.push(`${'  '.repeat(depth)}- ${name} (${f.type})`);
      if (f.children?.length) walk(f.children, depth + 1);
    }
  };
  walk(schema.fields, 0);
  return lines.slice(0, 200).join('\n');
}

/**
 * (bug 126) Bảng entry KÈM hiện trạng kích hoạt và token — thay cho danh sách "[BẬT] tên" cũ.
 * Trần nâng từ 80 lên 300: user muốn ra kế hoạch cho CẢ card trong một lần, mà 80 thì
 * card lớn bị cắt mất phần đuôi và AI không bao giờ biết chúng tồn tại.
 */
function entriesSummary(entries: LorebookEntry[]): string {
  if (!entries.length) return '(worldbook trống)';
  const list = entries.slice(0, 300).map((e) => {
    const mode = detectActivationMode(e);
    const keys = (e.keys ?? []).filter(Boolean).slice(0, 4).join(', ');
    return `- "${e.comment || `#${e.id}`}" | ${ACTIVATION_LABEL[mode]} | ~${estimateEntryTokens(e)} token${keys ? ` | keys: ${keys}` : ''}`;
  });
  if (entries.length > 300) list.push(`… và ${entries.length - 300} entry nữa (quá nhiều để liệt kê hết)`);
  return list.join('\n');
}

function characterSummary(ctx: EjsAgentContext): string {
  const f = ctx.characterFields ?? {};
  const rows = (['description', 'personality', 'scenario', 'first_mes'] as const)
    .filter(k => (f[k] ?? '').trim())
    .map(k => `- ${k}: ~${Math.round((f[k] ?? '').length / 4)} token`);
  return rows.length ? rows.join('\n') : '(không đọc được Character Definition)';
}

export function buildContextBlock(ctx: EjsAgentContext): string {
  const ui = detectExistingStatusUi(ctx.entries, ctx.regexScripts ?? [], ctx.tavernScripts ?? []);
  const suggestions = suggestReclassification(ctx.entries, schemaLeafNames(ctx.schema));

  const parts = [
    `═══ NGỮ CẢNH CARD ═══`,
    `Nhân vật: ${ctx.characterName}`,
    ``,
    `MVUZOD schema (cây biến trong stat_data — CHỈ được getvar các biến này):`,
    schemaSummary(ctx.schema),
    ``,
    `Character Definition (bạn ĐƯỢC PHÉP đề xuất sửa những trường này, không chỉ lorebook):`,
    characterSummary(ctx),
    ``,
    `Worldbook: ${ctx.entries.length} entry — kèm chế độ kích hoạt HIỆN TẠI (máy đo, không phải bạn đoán):`,
    entriesSummary(ctx.entries),
  ];

  // Cảnh báo UI có sẵn — chống việc AI đẻ thêm một thanh trạng thái chồng lên cái user tự làm.
  if (ui.hasStatusUi) {
    parts.push(
      ``,
      `⚠️ CARD ĐÃ CÓ GIAO DIỆN THANH TRẠNG THÁI RỒI, tìm thấy ở:`,
      ...ui.places.map(p => `  - ${p}`),
      `KHÔNG được tạo thêm thanh trạng thái/bảng hiển thị biến mới. Nếu user muốn cải thiện phần`,
      `hiển thị thì SỬA cái đang có hoặc bổ sung vào nó, và nói rõ trong lý do rằng bạn đang sửa`,
      `cái sẵn có chứ không tạo mới.`,
    );
  }

  // Bảng nền máy tự dựng — AI chỉ cần soát lại/bổ sung, khỏi bịa hiện trạng.
  if (suggestions.length) {
    const top = suggestions.slice(0, 60);
    parts.push(
      ``,
      `═══ MÁY ĐÃ RÀ SẴN: entry đang Constant có thể hạ cấp để tiết kiệm token ═══`,
      `(Bạn hãy soát lại danh sách này, giữ/sửa/bổ sung theo hiểu biết về nội dung card.)`,
      ...top.map(s => `- "${s.name}" | đang ${ACTIVATION_LABEL[s.currentMode]} → đề xuất ${ACTIVATION_LABEL[s.suggested]} | ~${s.tokensSaved} token/lượt | ${s.reason}`),
      suggestions.length > top.length ? `… và ${suggestions.length - top.length} entry nữa cùng dạng` : '',
    );
  }

  // ═══ (bugNeedFix/168 mục 4) GIÁ TRỊ KHỞI TẠO THẬT ═══
  // Gốc sâu nhất của lỗi "defaults lệch": AI CHƯA BAO GIỜ được cho xem [initvar], nên nó đoán
  // giá trị mặc định từ trí nhớ. Card Eldran v3 lộ rõ: cùng biến Phả Hệ, một entry đoán trúng
  // ("Chưa thức tỉnh"), entry khác đoán trượt ("Chưa rõ"); rồi lại đem chính giá trị của Phả Hệ
  // làm default cho Cảnh Giới (thật ra là "Chưa bề"). Đưa bảng sự thật vào ngữ cảnh thì AI viết
  // đúng NGAY TỪ ĐẦU — rẻ hơn nhiều so với để bộ kiểm bắt rồi chạy vòng tự sửa.
  const truth = readInitVarTruth(ctx.entries);
  const truthKeys = Object.keys(truth);
  if (truthKeys.length) {
    parts.push(
      ``,
      `═══ GIÁ TRỊ KHỞI TẠO THẬT (đọc từ entry [initvar] — ĐÂY LÀ SỰ THẬT DUY NHẤT) ═══`,
      `Mọi getvar(..., { defaults: X }) bạn viết PHẢI dùng ĐÚNG giá trị dưới đây cho biến đó.`,
      `Sai một chữ là mọi phép so sánh chạy sai ngay từ lượt chơi đầu tiên.`,
      ...truthKeys.slice(0, 80).map(k => {
        const v = truth[k];
        return `- ${k} = ${typeof v === 'string' ? `'${v}'` : String(v)}`;
      }),
      truthKeys.length > 80 ? `… và ${truthKeys.length - 80} biến nữa` : '',
    );
  }

  return parts.filter(Boolean).join('\n');
}

// ═══ Parse chung ══════════════════════════════════════════════════════════

function extractJson(raw: string): string {
  const m = raw.replace(/```json|```/gi, '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI không trả về JSON — thử lại hoặc diễn đạt yêu cầu rõ hơn.');
  return m[0];
}

// ═══ Prompt lên kế hoạch ══════════════════════════════════════════════════

const PLAN_SYSTEM = `Bạn là kiến trúc sư EJS cho SillyTavern (extension ST-Prompt-template).
Nhận YÊU CẦU của user + ngữ cảnh card, hãy TỰ QUYẾT phải làm những gì, rồi trình BẢNG VIỆC.

${STPT_API_PROMPT_BLOCK}

═══ NGUYÊN TẮC LẬP KẾ HOẠCH ═══
1. MỖI VIỆC LÀ MỘT DÒNG RIÊNG, nêu đích danh đối tượng. Cấm gộp kiểu "tối ưu các entry" —
   phải liệt kê từng entry một, kèm tên chính xác như trong ngữ cảnh.
2. Mỗi dòng BẮT BUỘC có "reason" nói vì sao NÊN làm. User đọc lý do để bấm Đồng ý/Từ chối
   từng dòng, nên lý do chung chung là kế hoạch hỏng.
3. Bám YÊU CẦU của user trước hết. User đòi gì làm nấy, kể cả việc không có trong gợi ý sẵn.
   Nếu yêu cầu bao trùm cả card thì cứ ra đủ dòng cho cả card, KHÔNG tự giới hạn số lượng.
4. Phân loại chế độ kích hoạt theo đúng ba nhóm:
   - Entry AI buộc phải biết MỌI LƯỢT (quy tắc xưng hô, thiết lập thế giới cố định) → giữ "constant".
   - Entry chỉ đúng khi MỘT BIẾN MVU đạt điều kiện (giai đoạn quan hệ, cảnh giới, khu vực…)
     → "conditional": entry để TẮT sẵn, controller EJS bật bằng await activewi(tên, true).
   - Entry chỉ liên quan khi hội thoại NHẮC TỚI (nhân vật phụ, địa điểm, vật phẩm), không gắn
     biến nào → "keyword": bỏ constant, đặt keys.
5. Được phép đụng cả Character Definition (target "character", name là tên trường).
6. Nếu ngữ cảnh báo card ĐÃ CÓ thanh trạng thái thì TUYỆT ĐỐI không tạo thanh mới.
7. Các khối EJS bạn tạo KHÔNG ĐƯỢC ĐỤNG NHAU: mỗi khối một tên entry riêng; biến đọc từ hai
   đường dẫn khác nhau thì PHẢI đặt hai tên khác nhau (mọi khối chạy chung một context).
8. KHÔNG áp "tiết kiệm token" vào entry thuộc BỘ MÁY MVU ([initvar], quy tắc cập nhật biến,
   danh sách biến, khối EJS sẵn có, entry dạy <UpdateVariable>): không reclassify, không tắt,
   không hạ cấp chúng — đổi chế độ kích hoạt của chúng là phá hệ biến của card.
9. TÁCH ENTRY GỘP (action "split_entry"): entry nhồi nhiều phần có ĐIỀU KIỆN KÍCH HOẠT KHÁC
   NHAU và ĐỘC LẬP (vd 15 sự kiện của 12 tháng chung một entry) thì đề xuất tách, khai rõ
   "splitInto": từng entry con + chế độ + điều kiện kích hoạt của nó. KHÔNG tách nội dung
   luôn đi cùng nhau. Việc tách chỉ được thực hiện sau khi user duyệt dòng này — tham chiếu
   getwi tới entry gốc sẽ được máy tự vá theo các entry mới.
10. NHÃN PRESET — BẮT BUỘC KHAI, KHÔNG ĐƯỢC BỎ TRỐNG. Yêu cầu do "Preset nhanh" dựng sẽ có
   dấu [preset: mã] ở đầu mỗi mục (vd "━━ 3. TÁCH ENTRY GỘP [preset: split-bloated] ━━").
   Mỗi dòng bạn sinh ra PHẢI khai "presetId" đúng mã của mục đã đẻ ra nó. Dòng do bạn tự nghĩ
   thêm, không thuộc mục nào, thì để "presetId": null — KHÔNG được đoán bừa.
11. PHỦ ĐỦ MỌI MỤC. Mỗi dấu [preset: mã] trong yêu cầu phải cho ra ÍT NHẤT MỘT dòng mang mã đó.
   Nếu card không có gì để làm cho một mục (vd đòi tách entry gộp nhưng card không có entry nào
   bị gộp), thì KHÔNG được im lặng bỏ qua: thêm một câu vào "notes" theo đúng khuôn
   "[preset: mã] bỏ vì <lý do cụ thể dựa trên card>". Thiếu dòng mà không có câu giải thích là
   kế hoạch hỏng — máy sẽ báo đỏ cho user.

Trả về DUY NHẤT JSON:
{
  "scope": "2-4 câu tiếng Việt: bạn hiểu yêu cầu thế nào + toàn bộ kế hoạch",
  "rows": [
    {
      "id": "r1",
      "action": "create_ejs" | "reclassify" | "edit_content" | "edit_character" | "split_entry",
      "target": "lorebook" | "character",
      "presetId": "mã trong dấu [preset: …] của mục đã đẻ ra dòng này, hoặc null nếu dòng tự nghĩ thêm",
      "name": "TÊN CHÍNH XÁC của entry/trường",
      "proposedMode": "constant" | "keyword" | "conditional" | "disabled" | null,
      "proposal": "một câu: sẽ làm gì với dòng này",
      "reason": "vì sao nên làm — cụ thể, dựa vào nội dung/biến thật của card",
      "requirement": "chỉ dẫn CỤ THỂ cho bước sinh code: khối EJS làm gì, đọc biến nào, bật entry nào",
      "varsUsed": ["stat_data.đường.dẫn"],
      "splitInto": [
        { "name": "Tên entry con", "mode": "keyword" | "conditional" | "constant", "criterion": "điều kiện/thời điểm kích hoạt của phần này" }
      ]
    }
  ],
  "notes": ["lưu ý cho user nếu có"]
}
Dòng chỉ đổi chế độ kích hoạt (action "reclassify") thì "requirement" để chuỗi rỗng.
"splitInto" CHỈ dùng cho action "split_entry" (≥ 2 phần); action khác bỏ key này.
"notes" là nơi ghi các câu "[preset: mã] bỏ vì …" của nguyên tắc 11.`;

// ═══ Kế hoạch chi tiết ════════════════════════════════════════════════════

const presetTitleOf = (id: string): string => QUICK_PRESETS.find(p => p.id === id)?.title ?? id;

const ACTIONS: PlanAction[] = ['create_ejs', 'reclassify', 'edit_content', 'edit_character', 'split_entry'];
const MODES: ActivationMode[] = ['constant', 'keyword', 'conditional', 'disabled'];

function parseRichPlan(raw: string, ctx: EjsAgentContext, goal = ''): EjsRichPlan {
  const p = JSON.parse(extractJson(raw)) as {
    scope?: string;
    rows?: Array<Record<string, unknown>>;
    notes?: string[];
  };

  const byName = new Map<string, LorebookEntry>();
  for (const e of ctx.entries) byName.set(String(e.comment || `#${e.id}`).trim().toLowerCase(), e);
  const warnings: string[] = [];
  // (bug 168 mục 2+3) Những preset mà YÊU CẦU đã đặt hàng — dùng để (a) chỉ nhận mã có thật,
  // (b) cuối hàm đối chiếu xem kế hoạch có bỏ sót mục nào không.
  const requestedPresets = extractRequestedPresets(goal);

  const rows: EjsPlanRow[] = (p.rows ?? [])
    .filter(r => r && String(r.name ?? '').trim())
    .map((r, i) => {
      const name = String(r.name).trim();
      const target: PlanTarget = r.target === 'character' ? 'character' : 'lorebook';
      const action = ACTIONS.includes(r.action as PlanAction) ? (r.action as PlanAction) : 'create_ejs';
      const existing = target === 'lorebook' ? byName.get(name.toLowerCase()) : undefined;
      const proposed = MODES.includes(r.proposedMode as ActivationMode) ? (r.proposedMode as ActivationMode) : null;
      // Hiện trạng lấy từ CARD, không lấy từ lời AI khai — AI hay nói sai chỗ này.
      const currentMode = existing ? detectActivationMode(existing) : null;

      // (Goal 28/07) splitInto — chỉ có nghĩa cho split_entry, và phải ≥ 2 phần có tên.
      const splitInto: SplitPart[] | undefined = action === 'split_entry'
        ? (Array.isArray(r.splitInto) ? r.splitInto : [])
            .filter((x): x is Record<string, unknown> => !!x && !!String((x as Record<string, unknown>).name ?? '').trim())
            .map(x => ({
              name: String(x.name).trim(),
              mode: MODES.includes(x.mode as ActivationMode) ? (x.mode as ActivationMode) : 'keyword',
              criterion: String(x.criterion ?? '').trim() || '(AI không nêu điều kiện)',
            }))
        : undefined;

      // (bug 168 mục 2) Nhãn preset: ưu tiên lời AI KHAI (nó biết mục nào đẻ ra dòng nào),
      // và chỉ nhận mã có thật trong yêu cầu — AI bịa mã thì bỏ, để bước suy luận lo tiếp.
      const claimed = String(r.presetId ?? '').trim().toLowerCase();
      const presetId = claimed && requestedPresets.includes(claimed) ? claimed : undefined;

      const row: EjsPlanRow = {
        id: String(r.id || `r${i + 1}`),
        action, target, name,
        presetId,
        presetTitle: presetId ? presetTitleOf(presetId) : undefined,
        currentMode,
        proposedMode: proposed,
        proposal: String(r.proposal ?? '').trim() || '(AI không mô tả)',
        reason: String(r.reason ?? '').trim() || '(AI không nêu lý do)',
        requirement: String(r.requirement ?? '').trim(),
        varsUsed: Array.isArray(r.varsUsed) ? r.varsUsed.map(String) : undefined,
        tokensSaved:
          existing && currentMode === 'constant' && proposed && proposed !== 'constant'
            ? estimateEntryTokens(existing)
            : undefined,
        splitInto,
      };
      // Dòng tách hiện đúng khuôn user yêu cầu: "sẽ tách Entry X thành N Entry: tên 1, tên 2…"
      if (action === 'split_entry' && splitInto?.length) {
        row.proposal = `Sẽ tách "${name}" thành ${splitInto.length} entry: ${splitInto.map(s => s.name).join(', ')}.`;
      }
      row.tokensDelta = estimateRowTokensDelta(row, existing);
      return row;
    })
    // (Goal 28/07) "Tiết kiệm Token" KHÔNG áp vào entry MVU: dòng reclassify/tắt trỏ vào entry
    // thuộc bộ máy MVU bị LOẠI khỏi kế hoạch, kèm cảnh báo nói rõ — không âm thầm.
    .filter(row => {
      if (row.target !== 'lorebook' || (row.action !== 'reclassify' && row.action !== 'split_entry')) return true;
      const existing = byName.get(row.name.trim().toLowerCase());
      if (existing && isMvuCriticalEntry(existing)) {
        warnings.push(`Đã loại mục "${row.name}": entry thuộc bộ máy MVU ([initvar]/quy tắc cập nhật/khối EJS…) — không áp Tiết kiệm Token hay tách vào đây.`);
        return false;
      }
      // split_entry đòi ≥ 2 phần mới có nghĩa.
      if (row.action === 'split_entry' && (row.splitInto?.length ?? 0) < 2) {
        warnings.push(`Đã loại mục tách "${row.name}": AI không khai đủ ≥ 2 entry con trong splitInto.`);
        return false;
      }
      if (row.action === 'split_entry' && !existing) {
        warnings.push(`Đã loại mục tách "${row.name}": không tìm thấy entry này trong card.`);
        return false;
      }
      return true;
    });

  // Cảnh báo do MÁY phát hiện — độc lập với việc AI có nói hay không.
  const ui = detectExistingStatusUi(ctx.entries, ctx.regexScripts ?? [], ctx.tavernScripts ?? []);
  if (ui.hasStatusUi) {
    warnings.push(`Card đã có thanh trạng thái sẵn (${ui.places.slice(0, 3).join('; ')}) — kế hoạch không nên tạo thêm cái mới.`);
  }
  if (!ctx.schema?.fields?.length) {
    warnings.push('Card chưa có MVUZOD schema — không kiểm chéo được biến EJS đọc, dễ sinh biến không tồn tại.');
  }
  // Dòng trỏ tới entry không có thật là dấu hiệu AI bịa tên.
  for (const r of rows) {
    if (r.target === 'lorebook' && r.action !== 'create_ejs' && !byName.has(r.name.toLowerCase())) {
      warnings.push(`Không tìm thấy entry "${r.name}" trong card — dòng này có thể do AI bịa tên, kiểm lại trước khi duyệt.`);
    }
  }
  // (bug 127) Cảnh báo SỚM: chuyển sang "theo điều kiện" nghĩa là TẮT entry và giao cho một
  // controller EJS bật lại. Kế hoạch đòi tắt mà không có dòng nào tạo controller thì chạy xong
  // là mất trắng ngần ấy lore — im lặng, không lỗi đỏ.
  const wantConditional = rows.filter(r => r.target === 'lorebook' && r.proposedMode === 'conditional');
  const hasController = rows.some(r => r.action === 'create_ejs' && r.requirement);
  if (wantConditional.length > 0 && !hasController) {
    warnings.push(
      `${wantConditional.length} entry sẽ bị tắt để "kích hoạt theo điều kiện" nhưng kế hoạch KHÔNG có mục nào ` +
      `tạo khối EJS bật chúng lên — chạy như vậy là mất hẳn số lore đó. Hãy yêu cầu AI kèm bộ điều khiển, ` +
      `hoặc từ chối các mục chuyển sang điều kiện.`,
    );
  }

  // (Goal 28/07) Rà từ khoá trùng/bao nhau giữa các entry keyword của card — có thì báo,
  // sạch thì thôi (không nặn lỗi để có cái vá).
  warnings.push(...scanKeywordOverlap(ctx.entries));

  const notes = Array.isArray(p.notes) ? p.notes.filter(Boolean).map(String) : [];

  // (bug 168 mục 3) ĐỐI CHIẾU PHỦ PRESET. Trước đây không có bước này: gói tổng đặt hàng 19 mục,
  // AI trả về bao nhiêu thì lấy bấy nhiêu, thiếu 6 mục vẫn hiện "kế hoạch xong" — đúng cảnh user
  // gặp. Giờ mọi mục vắng mặt đều phải có chữ giải thích, không thì báo đỏ.
  const presetCoverage = buildPresetCoverage(goal, rows, notes);
  warnings.push(...presetCoverage.warnings);

  const codeRows = rows.filter(r => r.action !== 'split_entry' && r.requirement).length;
  const splitRows = rows.filter(r => r.action === 'split_entry').length;
  return {
    scope: p.scope || '(AI không mô tả phạm vi)',
    rows,
    notes,
    warnings,
    presetCoverage,
    estCalls: 1 + codeRows + splitRows,
  };
}

/** Lên kế hoạch chi tiết (bảng việc) — đường mà EJS Studio dùng. */
export async function planEjsRich(
  goal: string,
  ctx: EjsAgentContext,
  call: AgentCallFn,
  signal?: AbortSignal,
): Promise<EjsRichPlan> {
  if (!goal.trim()) throw new Error('Chưa nhập yêu cầu.');
  const raw = await call(
    [
      { role: 'system', content: PLAN_SYSTEM },
      { role: 'user', content: `${buildContextBlock(ctx)}\n\n═══ YÊU CẦU CỦA USER ═══\n${goal.trim()}` },
    ],
    { temperature: 0.4, label: 'EJS Plan' },
  );
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return parseRichPlan(raw, ctx, goal);
}

/**
 * Chuyển các dòng ĐÃ ĐƯỢC DUYỆT thành AgentPlan để khung goalAgent chạy.
 * Chỉ dòng có `requirement` mới cần sinh code; dòng "reclassify" thuần là thao tác cấu hình,
 * panel tự áp, không tốn call AI nào.
 */
export function buildAgentPlanFromRows(plan: EjsRichPlan, acceptedIds: Set<string>): AgentPlan {
  const steps: AgentStepSpec[] = plan.rows
    // split_entry đi đường thực thi riêng (ejsSplit) — không phải bước sinh code EJS.
    .filter(r => acceptedIds.has(r.id) && r.requirement && r.action !== 'split_entry')
    .map(r => ({
      id: r.id,
      title: r.name,
      detail: r.proposal,
      requirement: r.requirement,
    }));
  return { scope: plan.scope, steps, estCalls: steps.length, notes: plan.notes };
}

// ═══ Domain ═══════════════════════════════════════════════════════════════

export function createEjsDomain(ctx: EjsAgentContext): GoalAgentDomain<EjsDraft> {
  return {
    name: 'EJS Agent',

    buildPlanMessages(goal: string): ChatMessage[] {
      return [
        { role: 'system', content: PLAN_SYSTEM },
        { role: 'user', content: `${buildContextBlock(ctx)}\n\n═══ YÊU CẦU CỦA USER ═══\n${goal}` },
      ];
    },

    parsePlan(raw: string): AgentPlan {
      const rich = parseRichPlan(raw, ctx);
      return buildAgentPlanFromRows(rich, new Set(rich.rows.map(r => r.id)));
    },

    buildStepMessages(step: AgentStepSpec, done: EjsDraft[]): ChatMessage[] {
      // Khối đã có SẴN trong card cũng phải kể ra — bản cũ chỉ kể khối vừa sinh, nên AI vô tư
      // đặt trùng tên biến với entry EJS có từ trước và gây xung đột im lặng.
      const existingEjs = ctx.entries
        .filter(e => String(e.content ?? '').includes('<%'))
        .slice(0, 40)
        .map(e => `- ${e.comment || `#${e.id}`}`);
      const doneNote = done.length
        ? `\n\nCác entry EJS ĐÃ tạo ở bước trước (KHÔNG trùng tên, KHÔNG lặp lại logic):\n${done.map((d) => `- ${d.entryComment}: ${d.explanation || '(không mô tả)'}`).join('\n')}`
        : '';
      const existingNote = existingEjs.length
        ? `\n\nCard đã có sẵn các entry EJS sau — tên entry và tên biến của bạn KHÔNG được trùng với chúng:\n${existingEjs.join('\n')}`
        : '';
      return [
        { role: 'system', content: EJS_SYSTEM_PROMPT },
        { role: 'user', content: `${buildContextBlock(ctx)}${existingNote}${doneNote}\n\n═══ NHIỆM VỤ BƯỚC NÀY ═══\n${step.requirement}` },
      ];
    },

    parseStepOutput(raw: string, step: AgentStepSpec): EjsDraft {
      const r = parseEjsResponse(raw);
      return {
        stepId: step.id,
        entryComment: r.entryComment,
        code: r.code,
        strategy: r.strategy,
        entryActions: r.entryActions,
        explanation: r.explanation,
      };
    },

    validate(items: EjsDraft[]): AgentIssue[] {
      const issues: AgentIssue[] = [];
      for (const d of items) {
        const where = d.entryComment;
        if (!d.code.trim()) {
          issues.push({ level: 'error', code: 'ejs-empty', message: 'Bước không sinh ra code nào.', where });
          continue;
        }
        if (!d.code.trimStart().startsWith('@@preprocessing')) {
          issues.push({ level: 'error', code: 'ejs-missing-directive',
            message: 'Thiếu @@preprocessing ở dòng đầu — TavernHelper sẽ không chạy khối này như EJS.', where });
        }
        const v = validateEJSEntry(d.code, ctx.schema ?? undefined);
        for (const e of v.errors) {
          issues.push({ level: 'error', code: 'ejs-syntax', message: e, where });
        }
        for (const w of v.warnings) {
          // Biến lệch schema là LỖI với chúng ta (đồng biến Phase 100), không phải cảnh báo.
          if (w.includes('không tìm thấy trong schema')) {
            issues.push({ level: 'error', code: 'ejs-var-unknown', message: w, where });
          } else if (!w.includes('@@preprocessing')) {
            issues.push({ level: 'warning', code: 'ejs-warn', message: w, where });
          }
        }

        // (bug 173) activateRegex() trỏ vào regex KHÔNG BẬT ĐƯỢC → lỗi đỏ ở MỌI lượt chat.
        // Ảnh user gửi: bốn thẻ "EJS Error … Basic mode regexes must have a string replace value",
        // sinh từ `activateRegex('Format Fixer')`. SillyTavern chặn regex chế độ cơ bản mà
        // replaceString rỗng, và tên bịa thì càng chắc chắn hỏng. Dặn AI trong prompt là chưa đủ —
        // đây là thứ kiểm được TẤT ĐỊNH nên phải kiểm, để vòng tự sửa còn vá được.
        const okRegex = activatableRegexNames(ctx.regexScripts);
        const okSet = new Set(okRegex.map((n) => n.toLowerCase()));
        for (const call of d.code.matchAll(/\bactivateRegex\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
          const name = call[1].trim();
          if (okSet.has(name.toLowerCase())) continue;
          issues.push({
            level: 'error', code: 'ejs-regex-not-activatable', where,
            message: okRegex.length
              ? `activateRegex('${name}') — thẻ không có regex nào tên như vậy ĐANG BẬT ĐƯỢC. `
                + `Chỉ được dùng: ${okRegex.map((n) => `'${n}'`).join(', ')}. `
                + 'Gọi sai tên (hoặc regex chưa có replaceString) sẽ ném lỗi đỏ ở mọi lượt chat.'
              : `activateRegex('${name}') — thẻ này KHÔNG có regex nào bật được (regex chế độ cơ bản `
                + 'phải có replaceString). Bỏ hẳn lời gọi activateRegex khỏi khối này.',
          });
        }
      }

      // (bug 126) Soát xung đột trên TOÀN CẢNH: khối mới + khối EJS đã có sẵn trong card.
      // Bản cũ chỉ so tên giữa các bước mới nên bỏ lọt cả hai ca nguy hiểm nhất: trùng tên với
      // entry cũ, và trùng tên biến mà khác nguồn getvar (hỏng im lặng khi chơi).
      const blocks: EjsBlock[] = [
        ...ctx.entries
          .filter(e => String(e.content ?? '').includes('<%'))
          .map(e => ({ name: e.comment || `#${e.id}`, code: String(e.content ?? '') })),
        ...items.map(d => ({ name: d.entryComment, code: d.code })),
      ];
      for (const c of findCollisions(blocks)) {
        issues.push({ level: 'error', code: c.code, message: c.message, where: c.where });
      }
      // (Goal 28/07) Hai khối cùng BẬT một entry — có thể cố ý nên chỉ CẢNH BÁO, không chặn.
      for (const c of findActivationOverlaps(blocks)) {
        issues.push({ level: 'warning', code: c.code, message: c.message, where: c.where });
      }

      // ═══ (bugNeedFix/168 mục 4) KIỂM NGỮ NGHĨA — đối chiếu code với DỮ LIỆU THẬT của thẻ ═══
      // Mọi phép kiểm ở trên chỉ soi cú pháp và API: code parse được không, gọi hàm có thật
      // không, biến có trong schema không. Chúng KHÔNG biết code chạy ra kết quả đúng hay sai.
      // Card Eldran v3 là bằng chứng: entry 43 hợp lệ hoàn hảo nhưng xếp nhân vật mới thành
      // "Cao thủ" vì `"chưa bề".includes('a')`; entry 41 lấy defaults 'Chưa rõ' trong khi
      // [initvar] ghi "Chưa thức tỉnh" nên điều kiện luôn đúng. Chỉ đối chiếu với [initvar] và
      // enum thật mới bắt được. Mức 'error' để lọt vào vòng TỰ SỬA, không chỉ báo suông —
      // message đã kèm sẵn câu sửa nên AI biết phải làm gì.
      const semanticIssues = checkEjsSemantics({
        blocks: items.map(d => ({ name: d.entryComment, code: d.code })),
        entries: ctx.entries,
        schema: ctx.schema ?? null,
      });
      for (const si of semanticIssues) {
        issues.push({
          level: si.level,
          code: `ejs-semantic-${si.kind}`,
          message: `${si.message} → ${si.fix}`,
          where: si.entry ?? si.path,
        });
      }

      return issues;
    },

    // Lỗi máy sửa được thì sửa ngay, khỏi tốn call AI (triết lý "Pha 0 tất định").
    autofixDeterministic(items: EjsDraft[], issues: AgentIssue[]) {
      const fixed: string[] = [];
      let out = items;
      if (issues.some((i) => i.code === 'ejs-missing-directive')) {
        out = out.map((d) =>
          d.code.trim() && !d.code.trimStart().startsWith('@@preprocessing')
            ? (fixed.push(`thêm @@preprocessing vào "${d.entryComment}"`),
               { ...d, code: `@@preprocessing\n${d.code.replace(/^\s*\n/, '')}` })
            : d,
        );
      }

      // Bóc cặp [giá_trị, "mô tả"] cho mọi getvar chưa bọc. MVU lưu biến theo cả hai dạng
      // (trần và cặp), getvar trả về NGUYÊN thứ đang nằm trong stat_data — thẻ nhập từ ngoài
      // hay dùng cặp nên Number(cặp) ra NaN và mọi so sánh số trượt IM LẶNG.
      // Sửa máy móc được nên không tốn một lượt gọi AI nào.
      if (issues.some((i) => /chưa bóc cặp/.test(i.message))) {
        const wrap = /(?<!\[\]\.concat\()getvar\(\s*('[^']*'|"[^"]*")\s*(,\s*\{[^}]*\})?\s*\)/g;
        out = out.map((d) => {
          if (!wrap.test(d.code)) return d;
          wrap.lastIndex = 0;
          const code = d.code.replace(wrap, (_m, p, opts) => `[].concat(getvar(${p}${opts ?? ''}))[0]`);
          if (code === d.code) return d;
          fixed.push(`bóc cặp [giá trị, "mô tả"] cho getvar trong "${d.entryComment}"`);
          return { ...d, code };
        });
      }

      // (bug 126) Tự vá xung đột. Khối cũ trong card đưa vào để làm mốc nhưng KHÔNG bị sửa —
      // ta chỉ được đụng vào thứ mình vừa sinh, không đi sửa entry sẵn có của user.
      if (issues.some((i) => i.code === 'ejs-var-conflict' || i.code === 'ejs-name-conflict')) {
        const existing: EjsBlock[] = ctx.entries
          .filter(e => String(e.content ?? '').includes('<%'))
          .map(e => ({ name: e.comment || `#${e.id}`, code: String(e.content ?? '') }));
        const merged = [...existing, ...out.map(d => ({ name: d.entryComment, code: d.code }))];
        const { blocks, fixed: patched } = autopatchCollisions(merged);
        const mine = blocks.slice(existing.length);
        out = out.map((d, i) => ({ ...d, entryComment: mine[i].name, code: mine[i].code }));
        fixed.push(...patched);
      }

      return { items: out, fixed };
    },

    // (bug 162 phần 1) Cho phép khung BỎ khối không tự sửa được, thay vì bắt user sửa code.
    canDropItems: true,

    buildFixMessages(item: EjsDraft, issues: AgentIssue[], attempt?: FixAttemptInfo): ChatMessage[] {
      // (bug 162 phần 1) Lần thử thứ 2 trở đi thì ĐỔI CÁCH, không gửi lại y nguyên prompt cũ:
      // nói rõ lần trước đã sửa mà VẪN sai, kèm bản đã thử, và siết dần yêu cầu. Đây là chỗ biến
      // "thử lại" thành "thích nghi" — thiếu nó thì vòng 2 chỉ là bản sao của vòng 1.
      const escalate: string[] = [];
      if (attempt && attempt.round > 1) {
        escalate.push(
          '',
          `⚠️ ĐÂY LÀ LẦN THỬ ${attempt.round}/${attempt.maxRounds}. Lần trước bạn đã sửa nhưng bộ kiểm VẪN báo đúng những lỗi trên.`,
          'Đừng sửa lại theo cùng một cách. Hãy làm khác đi:',
          '- Đọc lại đúng nghĩa của từng mã lỗi, đừng đoán;',
          '- Nếu một đoạn logic là nguồn lỗi mà không chắc sửa đúng, hãy VIẾT LẠI đoạn đó cho đơn giản hơn (ít nhánh, ít biến trung gian) — thà đơn giản mà chạy;',
          '- Nếu lỗi do trùng tên/trùng biến, hãy đổi hẳn sang tên khác thay vì chỉnh nhẹ.',
        );
        if (attempt.round >= attempt.maxRounds) {
          escalate.push(
            `- ĐÂY LÀ LẦN CUỐI: hãy trả về bản TỐI GIẢN NHẤT còn giữ được mục đích chính, cắt hết phần phụ. Bản đơn giản mà sạch lỗi có giá trị hơn bản đầy đủ mà vỡ.`,
          );
        }
      }
      if (attempt?.previousAttempt) {
        escalate.push('', 'Bản bạn đã thử ở lần trước (vẫn còn lỗi — đừng lặp lại nó):', '```', attempt.previousAttempt.slice(0, 3000), '```');
      }
      return [
        { role: 'system', content: EJS_SYSTEM_PROMPT },
        { role: 'user', content: [
          buildContextBlock(ctx),
          '',
          `Code EJS sau bị KIỂM TỰ ĐỘNG báo lỗi. Hãy SỬA ĐÚNG các lỗi được nêu, giữ nguyên logic đúng,`,
          `rồi trả lại JSON đúng định dạng (controller + entryActions). KHÔNG viết lại từ đầu.`,
          '',
          `Entry: ${item.entryComment}`,
          '```',
          item.code,
          '```',
          'Lỗi cần sửa:',
          ...issues.map((i) => `- [${i.code}] ${i.message}`),
          ...escalate,
        ].join('\n') },
      ];
    },

    parseFixOutput(raw: string, item: EjsDraft): EjsDraft {
      const r = parseEjsResponse(raw);
      // Giữ stepId + tên entry cũ (đổi tên khi sửa lỗi sẽ phá liên kết getwi/undo).
      return { ...item, code: r.code, strategy: r.strategy, entryActions: r.entryActions, explanation: r.explanation || item.explanation };
    },

    itemKey(item: EjsDraft): string {
      return item.entryComment;
    },
  };
}
