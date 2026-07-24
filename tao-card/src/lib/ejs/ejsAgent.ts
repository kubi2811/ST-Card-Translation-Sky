/**
 * src/lib/ejs/ejsAgent.ts — (Goal 101.2) Miền EJS cắm vào khung goalAgent.
 * ─────────────────────────────────────────────────────────────────────────────
 * User chỉ đưa YÊU CẦU ("làm bộ điều khiển bật entry theo cảnh giới…") — agent tự phán đoán
 * cần viết mấy khối EJS, đặt entry nào, rồi trình kế hoạch. Sau khi duyệt, từng bước sinh
 * code qua EJS_SYSTEM_PROMPT có sẵn, và MỌI code phải qua validator tất định:
 *   - cú pháp EJS (tag cân, không this.variables) — từ ejsParser có sẵn;
 *   - biến đọc PHẢI tồn tại trong MVUZOD schema (đồng biến với Phase 100);
 *   - không trùng tên entry giữa các bước.
 * Lỗi máy sửa được (thiếu @@preprocessing, trùng tên) sửa NGAY không tốn call AI;
 * phần còn lại đi vòng sửa AI hội tụ của goalAgent.
 */
import type { ChatMessage, LorebookEntry } from '../../types';
import type { MVUZODSchema } from '../../types/mvuzod.types';
import type { AgentIssue, AgentPlan, AgentStepSpec, GoalAgentDomain } from '../ai/goalAgent';
import { EJS_SYSTEM_PROMPT, parseEjsResponse, type EJSEntryAction, type EjsStrategy } from '../../prompts/ejsPrompt';
import { validateEJSEntry } from './ejsParser';

// ═══ Kiểu dữ liệu ═════════════════════════════════════════════════════════

export interface EjsAgentContext {
  schema: MVUZODSchema | null;
  entries: LorebookEntry[];
  characterName: string;
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
  return lines.slice(0, 120).join('\n');
}

function entriesSummary(entries: LorebookEntry[]): string {
  if (!entries.length) return '(worldbook trống)';
  const list = entries.slice(0, 80).map((e) => `- [${e.enabled ? 'BẬT' : 'tắt'}] ${e.comment || `#${e.id}`}`);
  if (entries.length > 80) list.push(`… và ${entries.length - 80} entry nữa`);
  return list.join('\n');
}

function contextBlock(ctx: EjsAgentContext): string {
  return [
    `═══ NGỮ CẢNH CARD ═══`,
    `Nhân vật: ${ctx.characterName}`,
    `MVUZOD schema (cây biến trong stat_data — CHỈ được getvar các biến này):`,
    schemaSummary(ctx.schema),
    ``,
    `Worldbook hiện có ${ctx.entries.length} entry:`,
    entriesSummary(ctx.entries),
  ].join('\n');
}

// ═══ Parse chung ══════════════════════════════════════════════════════════

function extractJson(raw: string): string {
  const m = raw.replace(/```json|```/gi, '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI không trả về JSON — thử lại hoặc diễn đạt yêu cầu rõ hơn.');
  return m[0];
}

// ═══ Domain ═══════════════════════════════════════════════════════════════

const PLAN_SYSTEM = `Bạn là kiến trúc sư EJS cho SillyTavern TavernHelper. Nhận YÊU CẦU của user
và ngữ cảnh card, hãy TỰ QUYẾT quy mô: cần viết mấy khối EJS (@@preprocessing), mỗi khối làm gì.
Nguyên tắc chia bước: mỗi bước = MỘT worldbook entry EJS trọn vẹn; logic phức tạp chia nhiều
entry nhỏ thay vì một khối khổng lồ; thường 1-3 bước là đủ, tối đa 6.

Trả về DUY NHẤT JSON:
{
  "scope": "1-3 câu tiếng Việt: bạn hiểu yêu cầu thế nào + định làm gì",
  "steps": [
    { "id": "s1", "title": "tên bước ngắn", "detail": "user đọc hiểu ngay bước này tạo gì",
      "requirement": "chỉ dẫn CỤ THỂ cho AI sinh code ở bước này: khối EJS làm gì, đọc biến nào, bật/tắt entry nào" }
  ],
  "notes": ["lưu ý cho user nếu có (thiếu schema, thiếu entry…)"]
}`;

export function createEjsDomain(ctx: EjsAgentContext): GoalAgentDomain<EjsDraft> {
  return {
    name: 'EJS Agent',

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
        .slice(0, 6)
        .map((s, i) => ({
          id: s.id || `s${i + 1}`,
          title: s.title || `Bước ${i + 1}`,
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

    buildStepMessages(step: AgentStepSpec, done: EjsDraft[]): ChatMessage[] {
      const doneNote = done.length
        ? `\n\nCác entry EJS ĐÃ tạo ở bước trước (KHÔNG trùng tên, KHÔNG lặp lại logic):\n${done.map((d) => `- ${d.entryComment}: ${d.explanation || '(không mô tả)'}`).join('\n')}`
        : '';
      return [
        { role: 'system', content: EJS_SYSTEM_PROMPT },
        { role: 'user', content: `${contextBlock(ctx)}${doneNote}\n\n═══ NHIỆM VỤ BƯỚC NÀY ═══\n${step.requirement}` },
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
      const seen = new Map<string, number>();
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
        // Trùng tên entry giữa các bước → khi lưu sẽ đè/loạn getwi.
        const n = (seen.get(where) ?? 0) + 1;
        seen.set(where, n);
        if (n === 2) {
          issues.push({ level: 'error', code: 'ejs-dup-comment',
            message: `Tên entry "${where}" bị dùng ở nhiều bước — mỗi khối EJS phải một tên riêng.`, where });
        }
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
      if (issues.some((i) => i.code === 'ejs-dup-comment')) {
        const used = new Set<string>();
        out = out.map((d) => {
          let name = d.entryComment;
          let k = 2;
          while (used.has(name)) name = `${d.entryComment} (${k++})`;
          used.add(name);
          if (name !== d.entryComment) fixed.push(`đổi tên entry trùng thành "${name}"`);
          return name === d.entryComment ? d : { ...d, entryComment: name };
        });
      }
      return { items: out, fixed };
    },

    buildFixMessages(item: EjsDraft, issues: AgentIssue[]): ChatMessage[] {
      return [
        { role: 'system', content: EJS_SYSTEM_PROMPT },
        { role: 'user', content: [
          contextBlock(ctx),
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
