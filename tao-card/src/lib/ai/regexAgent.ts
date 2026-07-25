/**
 * src/lib/ai/regexAgent.ts — (Goal 103.1) Miền Regex cắm TRỌN khung goalAgent.
 * ─────────────────────────────────────────────────────────────────────────────
 * RegexLab trước giờ CHỈ xem/sửa tay — không có đường sinh AI nào. Miền này thêm luồng:
 * user mô tả nhu cầu ("ẩn khối thinking", "render bảng trạng thái"…) → agent lên kế hoạch
 * (mỗi bước = MỘT regex script) → duyệt → sinh → và LUẬT SẮT của phase này:
 *
 *   MỌI regex sinh ra phải qua kiểm TẤT ĐỊNH trước khi vào card:
 *     1. `new RegExp(findRegex)` phải compile (validateRegex — engine thật của app);
 *     2. replaceString qua validateReplaceString (JS/HTML không vỡ);
 *     3. CHẠY THỬ trên sample text bằng applyRegex — không khớp gì thì cảnh báo đích danh.
 *
 * Sinh tĩnh từ schema (status bar/opening form — programmaticRegexBuilder của Phase 100)
 * vẫn là đường ƯU TIÊN cho phần chuẩn hoá (103.2, nút riêng trong RegexLab); agent này lo
 * phần TỰ DO mà builder tĩnh không phủ được.
 */
import type { ChatMessage, RegexScript } from '../../types';
import type { MVUZODSchema } from '../../types/mvuzod.types';
import type { AgentIssue, AgentPlan, AgentStepSpec, GoalAgentDomain } from './goalAgent';
import { applyRegex, validateRegex } from '../regexEngine/applyRegex';
import { validateReplaceString } from '../regexEngine/regexValidator';
import { buildSchemaContextForBatch } from '../mvuzod/schemaContextBuilder';

// ═══ Kiểu dữ liệu ═════════════════════════════════════════════════════════

/** Một regex script AI sinh — item của goalAgent (chưa có id, UI cấp khi lưu). */
export interface RegexDraft {
  stepId: string;
  script: Omit<RegexScript, 'id'>;
  explanation: string;
}

export interface RegexAgentContext {
  schema: MVUZODSchema | null;
  /** Script ĐÃ có trong card — cấm trùng tên, cho AI biết để phối hợp. */
  existingScripts: Array<Pick<RegexScript, 'scriptName' | 'findRegex'>>;
  /** Sample để CHẠY THỬ mọi regex sinh ra (mặc định = sample AI output của RegexLab). */
  sampleText: string;
}

// ═══ Prompt ═══════════════════════════════════════════════════════════════

const PLAN_SYSTEM = `Bạn là kiến trúc sư Regex Script cho SillyTavern. Nhận YÊU CẦU của user,
hãy TỰ QUYẾT cần mấy regex script và mỗi cái làm gì. Mỗi bước = MỘT script trọn vẹn.
Thường 1-3 script là đủ, tối đa 5 — đừng chẻ vụn một việc thành nhiều script.

Trả về DUY NHẤT JSON:
{
  "scope": "1-3 câu tiếng Việt: bạn hiểu yêu cầu thế nào + định tạo những script gì",
  "steps": [
    { "id": "r1", "title": "tên ngắn", "detail": "user đọc hiểu ngay script này làm gì",
      "requirement": "chỉ dẫn CỤ THỂ: bắt pattern gì (nêu ví dụ text đầu vào), thay bằng gì, chạy ở đâu (AI output / user input / prompt)" }
  ],
  "notes": ["lưu ý nếu có"]
}`;

const STEP_SYSTEM = `Bạn là chuyên gia viết Regex Script cho SillyTavern. Sinh MỘT script hoàn chỉnh.

═══ HỢP ĐỒNG REGEX SCRIPT SILLYTAVERN ═══
- findRegex: regex JAVASCRIPT dạng "/pattern/flags" — NÊN dùng "/…/gs" khi bắt khối nhiều dòng
  và muốn thay TOÀN CỤC (không có g thì SillyTavern chỉ thay lần khớp đầu). Escape đúng:
  trong JSON chuỗi "\\\\n" là newline của regex, "\\\\d" là digit.
- replaceString: chuỗi thay thế. Dùng $1..$9 hoặc {{match}} cho capture group. Muốn ẨN nội dung
  thì thay bằng chuỗi rỗng "". Muốn RENDER giao diện thì trả HTML (được phép <style>, KHÔNG cần
  <script> trừ khi thật sự cần).
- placement (mảng số): 1=user input, 2=AI output, 3=slash command, 4=prompt, 5=world info.
  Phổ biến nhất là [2].
- markdownOnly=true: chỉ áp khi RENDER hiển thị (giữ nguyên text gửi cho model) — dùng cho
  script trang trí/render. promptOnly=true: ngược lại, chỉ sửa prompt gửi model.
- QUY TẮC AN TOÀN: pattern phải KHÔNG tham lam khi bắt khối (dùng [\\\\s\\\\S]*? thay vì .* cho
  nhiều dòng), neo bằng thẻ mở/đóng cụ thể; TUYỆT ĐỐI không viết pattern nuốt cả tin nhắn.

Trả về DUY NHẤT JSON:
{
  "scriptName": "tên rõ nghĩa tiếng Việt",
  "findRegex": "pattern",
  "replaceString": "chuỗi thay thế",
  "placement": [2],
  "markdownOnly": true/false,
  "promptOnly": true/false,
  "trimStrings": [],
  "explanation": "1-2 câu: script làm gì, vì sao pattern an toàn"
}`;

function contextBlock(ctx: RegexAgentContext): string {
  const parts: string[] = [];
  if (ctx.existingScripts.length) {
    parts.push(`Script ĐÃ có trong card (KHÔNG trùng tên, không làm lại việc của chúng):\n${ctx.existingScripts.map((s) => `- ${s.scriptName}: /${s.findRegex.slice(0, 60)}/`).join('\n')}`);
  }
  if (ctx.schema?.fields?.length) {
    parts.push(`Card có MVUZOD schema (script render trạng thái phải dùng ĐÚNG tên biến này):\n${buildSchemaContextForBatch(ctx.schema)}`);
  }
  parts.push(`SAMPLE TEXT (regex của bạn sẽ được CHẠY THỬ trên chính đoạn này — nếu nhắm AI output thì phải khớp được ở đây):\n<<<\n${ctx.sampleText.slice(0, 3000)}\n>>>`);
  return parts.join('\n\n');
}

// ═══ Parse ════════════════════════════════════════════════════════════════

function extractJson(raw: string): string {
  const m = raw.replace(/```json|```/gi, '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI không trả về JSON — thử lại hoặc mô tả yêu cầu rõ hơn.');
  return m[0];
}

const VALID_PLACEMENTS = new Set([1, 2, 3, 4, 5]);

// ═══ Domain ═══════════════════════════════════════════════════════════════

export function createRegexDomain(ctx: RegexAgentContext): GoalAgentDomain<RegexDraft> {
  return {
    name: 'Regex Agent',

    buildPlanMessages(goal: string): ChatMessage[] {
      return [
        { role: 'system', content: PLAN_SYSTEM },
        { role: 'user', content: `${contextBlock(ctx)}\n\n═══ YÊU CẦU CỦA USER ═══\n${goal}` },
      ];
    },

    parsePlan(raw: string): AgentPlan {
      const p = JSON.parse(extractJson(raw)) as {
        scope?: string; steps?: Array<Partial<AgentStepSpec>>; notes?: string[];
      };
      const steps: AgentStepSpec[] = (p.steps ?? [])
        .filter((s) => s?.requirement)
        .slice(0, 5)
        .map((s, i) => ({
          id: s.id || `r${i + 1}`,
          title: s.title || `Script ${i + 1}`,
          detail: s.detail,
          requirement: String(s.requirement),
        }));
      return {
        scope: p.scope || '(AI không mô tả phạm vi)',
        steps,
        estCalls: 1 + steps.length,
        notes: Array.isArray(p.notes) ? p.notes.filter(Boolean).map(String) : undefined,
      };
    },

    buildStepMessages(step: AgentStepSpec, done: RegexDraft[]): ChatMessage[] {
      const doneNote = done.length
        ? `\n\nScript ĐÃ tạo ở bước trước (không trùng tên/không lặp việc):\n${done.map((d) => `- ${d.script.scriptName}`).join('\n')}`
        : '';
      return [
        { role: 'system', content: STEP_SYSTEM },
        { role: 'user', content: `${contextBlock(ctx)}${doneNote}\n\n═══ NHIỆM VỤ BƯỚC NÀY ═══\n${step.requirement}` },
      ];
    },

    parseStepOutput(raw: string, step: AgentStepSpec): RegexDraft {
      const p = JSON.parse(extractJson(raw)) as Record<string, unknown>;
      const placement = (Array.isArray(p.placement) ? p.placement : [2])
        .map(Number).filter((n) => VALID_PLACEMENTS.has(n)) as RegexScript['placement'];
      return {
        stepId: step.id,
        explanation: String(p.explanation ?? ''),
        script: {
          scriptName: String(p.scriptName ?? step.title),
          findRegex: String(p.findRegex ?? ''),
          replaceString: String(p.replaceString ?? ''),
          trimStrings: Array.isArray(p.trimStrings) ? p.trimStrings.map(String) : [],
          placement: placement.length ? placement : [2],
          disabled: false,
          markdownOnly: p.markdownOnly === true,
          promptOnly: p.promptOnly === true,
          runOnEdit: false,
          substituteRegex: 0,
          minDepth: null,
          maxDepth: null,
        },
      };
    },

    // LUẬT SẮT 103: compile + kiểm replaceString + CHẠY THỬ trên sample — toàn bộ tất định.
    validate(items: RegexDraft[]): AgentIssue[] {
      const issues: AgentIssue[] = [];
      const seen = new Set(ctx.existingScripts.map((s) => s.scriptName));
      for (const d of items) {
        const where = d.script.scriptName;
        if (!d.script.findRegex.trim()) {
          issues.push({ level: 'error', code: 'rx-empty', message: 'findRegex rỗng.', where });
          continue;
        }
        // 1. Compile bằng chính engine của app
        const v = validateRegex(d.script.findRegex);
        if (!v.valid) {
          issues.push({ level: 'error', code: 'rx-compile',
            message: `Regex không compile: ${v.error}`, where });
          continue; // không compile thì các kiểm sau vô nghĩa
        }
        // 2. replaceString không được vỡ JS/HTML
        if (d.script.replaceString) {
          const rv = validateReplaceString(d.script.replaceString);
          for (const iss of [...rv.jsIssues, ...rv.htmlIssues]) {
            issues.push({ level: iss.type === 'error' ? 'error' : 'warning',
              code: 'rx-replace', message: iss.message, where });
          }
        }
        // 3. Chạy thử thật trên sample
        const run = applyRegex({ ...d.script, id: 'draft' } as RegexScript, ctx.sampleText);
        if (run.error) {
          issues.push({ level: 'error', code: 'rx-run', message: `Chạy thử lỗi: ${run.error}`, where });
        } else if (run.matchCount === 0 && d.script.placement.includes(2)) {
          // Nhắm AI output mà không khớp gì trên sample AI output → gần như chắc pattern sai.
          issues.push({ level: 'error', code: 'rx-no-match',
            message: 'Regex nhắm AI output nhưng KHÔNG khớp gì trên sample — pattern sai hoặc escape sai.', where });
        }
        // 4. Trùng tên
        if (seen.has(where)) {
          issues.push({ level: 'error', code: 'rx-dup-name',
            message: `Tên script "${where}" đã tồn tại.`, where });
        }
        seen.add(where);
      }
      return issues;
    },

    // Trùng tên sửa máy móc, khỏi tốn call AI.
    autofixDeterministic(items: RegexDraft[], issues: AgentIssue[]) {
      const fixed: string[] = [];
      let out = items;
      if (issues.some((i) => i.code === 'rx-dup-name')) {
        const used = new Set(ctx.existingScripts.map((s) => s.scriptName));
        out = out.map((d) => {
          let name = d.script.scriptName;
          let k = 2;
          while (used.has(name)) name = `${d.script.scriptName} (${k++})`;
          used.add(name);
          if (name !== d.script.scriptName) {
            fixed.push(`đổi tên trùng thành "${name}"`);
            return { ...d, script: { ...d.script, scriptName: name } };
          }
          return d;
        });
      }
      return { items: out, fixed };
    },

    buildFixMessages(item: RegexDraft, issues: AgentIssue[]): ChatMessage[] {
      return [
        { role: 'system', content: STEP_SYSTEM },
        { role: 'user', content: [
          contextBlock(ctx),
          '',
          'Script sau bị KIỂM TỰ ĐỘNG (compile + chạy thử thật) báo lỗi. Sửa ĐÚNG lỗi được nêu,',
          'giữ nguyên ý đồ, trả lại JSON đúng định dạng.',
          '',
          `scriptName: ${item.script.scriptName}`,
          `findRegex: ${item.script.findRegex}`,
          `replaceString: ${item.script.replaceString.slice(0, 1500)}`,
          '',
          'Lỗi cần sửa:',
          ...issues.map((i) => `- [${i.code}] ${i.message}`),
        ].join('\n') },
      ];
    },

    parseFixOutput(raw: string, item: RegexDraft): RegexDraft {
      const next = this.parseStepOutput(raw, { id: item.stepId, title: item.script.scriptName, requirement: '' });
      // Giữ tên cũ — đổi tên khi sửa sẽ phá khoá đối chiếu issue↔item của vòng hội tụ.
      return { ...next, script: { ...next.script, scriptName: item.script.scriptName } };
    },

    itemKey(item: RegexDraft): string {
      return item.script.scriptName;
    },
  };
}
