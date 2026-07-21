# Bộ nhớ cho Copilot (Tạo Card) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nối `memoryStore` (đang là dead code) vào Copilot của tao-card để nó nhớ được thói quen user / thông tin thẻ / mạch chat dài, với cơ chế AI đề xuất → user duyệt mới ghi.

**Architecture:** Truy hồi ký ức bằng `searchMemory()` rồi chèn thành khối tách bạch vào system prompt tại `agentLoop.ts`. AI đề xuất qua tool `propose_memory`, tool gọi `ctx.showActionCard()` (cơ chế duyệt CÓ SẴN) và chỉ `addMemory()` khi user bấm Apply. Panel riêng cho sửa tay.

**Tech Stack:** React + TypeScript, Zustand (`memoryStore` dùng `persist` + MiniSearch), vitest.

---

## Sai lệch so với spec (đã kiểm chứng khi lập kế hoạch)

Spec dự kiến 4 file mới gồm `MemoryProposalCard.tsx`. **Bỏ file này** — `CopilotContext` đã có
`showActionCard(action): Promise<'apply' | 'skip'>` và CopilotPanel đã render thẻ Apply/Skip cho mọi
`AIAction`. Chỉ cần thêm 1 biến thể `AIAction` là dùng lại được toàn bộ. Ít code hơn, đồng nhất UI.

## File Structure

| File | Trách nhiệm | Loại |
|---|---|---|
| `src/lib/ai/memoryContext.ts` | Truy hồi + dựng khối prompt. Thuần hàm, không UI, không gọi AI | **mới** |
| `src/lib/ai/memorySummarizer.ts` | Nén chat dài → 1 chuỗi tóm lược. Gọi AI, không đụng store | **mới** |
| `src/components/copilot/MemoryPanel.tsx` | Panel CRUD + tắt/bật ký ức | **mới** |
| `src/lib/ai/copilotTypes.ts` | Thêm biến thể `save_memory` vào `AIAction` | sửa |
| `src/lib/toolsEngine.ts` | Thêm tool `propose_memory` | sửa |
| `src/lib/ai/agentLoop.ts` | Chèn khối ký ức vào system prompt | sửa |
| `src/components/copilot/CopilotPanel.tsx` | Nhãn cho `save_memory` + nút mở MemoryPanel | sửa |
| `src/i18n/{en,vi,zh}.ts` | Key i18n mới | sửa |

`src/store/memoryStore.ts` **KHÔNG đổi**.

---

## Task 1: `memoryContext.ts` — truy hồi & dựng khối prompt

**Files:**
- Create: `tao-card/src/lib/ai/memoryContext.ts`
- Test: `tao-card/src/lib/ai/__tests__/memoryContext.test.ts`

- [ ] **Step 1: Viết test thất bại**

Tạo `tao-card/src/lib/ai/__tests__/memoryContext.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildMemoryBlock } from '../memoryContext';
import type { MemoryEntry } from '../../../store/memoryStore';

function mem(p: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: p.id ?? 'x', scope: p.scope ?? 'global', key: p.key ?? 'k', value: p.value ?? 'v',
    projectId: p.projectId, sessionId: p.sessionId,
    createdAt: 0, updatedAt: 0, disabled: p.disabled ?? false,
  };
}

describe('buildMemoryBlock', () => {
  it('kho rỗng → chuỗi rỗng (không tốn token thừa)', () => {
    expect(buildMemoryBlock([])).toBe('');
  });

  it('mục disabled bị loại', () => {
    const out = buildMemoryBlock([mem({ key: 'A', value: 'giữ' }), mem({ key: 'B', value: 'bỏ', disabled: true })]);
    expect(out).toContain('giữ');
    expect(out).not.toContain('bỏ');
  });

  it('nhóm đúng 3 scope với nhãn riêng', () => {
    const out = buildMemoryBlock([
      mem({ scope: 'global', key: 'g', value: 'thói quen' }),
      mem({ scope: 'project', key: 'p', value: 'về thẻ' }),
      mem({ scope: 'session', key: 's', value: 'trong phiên' }),
    ]);
    expect(out).toContain('Thói quen của user');
    expect(out).toContain('Về thẻ đang làm');
    expect(out).toContain('Trong phiên này');
    expect(out.indexOf('thói quen')).toBeLessThan(out.indexOf('về thẻ'));
  });

  it('cắt còn top-N khi quá nhiều', () => {
    const many = Array.from({ length: 30 }, (_, i) => mem({ id: String(i), key: `k${i}`, value: `v${i}` }));
    const out = buildMemoryBlock(many, 5);
    expect(out.match(/^- /gm)?.length).toBe(5);
  });

  it('tất cả mục đều disabled → chuỗi rỗng', () => {
    expect(buildMemoryBlock([mem({ disabled: true })])).toBe('');
  });
});
```

- [ ] **Step 2: Chạy test cho thấy nó fail**

Run: `cd tao-card && npx vitest run src/lib/ai/__tests__/memoryContext.test.ts`
Expected: FAIL — `Failed to resolve import "../memoryContext"`

- [ ] **Step 3: Viết implementation tối thiểu**

Tạo `tao-card/src/lib/ai/memoryContext.ts`:

```ts
import type { MemoryEntry, MemoryScope } from '../../store/memoryStore';

const SCOPE_LABEL: Record<MemoryScope, string> = {
  global: 'Thói quen của user (áp dụng cho mọi thẻ)',
  project: 'Về thẻ đang làm',
  session: 'Trong phiên này',
};

const SCOPE_ORDER: MemoryScope[] = ['global', 'project', 'session'];

/**
 * Dựng khối "ĐIỀU ĐÃ BIẾT" để chèn vào system prompt.
 * Tách bạch theo scope để truy vết được câu trả lời chịu ảnh hưởng của ký ức nào.
 * Trả chuỗi RỖNG khi không có gì — tránh tốn token cho khối trống.
 */
export function buildMemoryBlock(memories: MemoryEntry[], topN = 12): string {
  const active = memories.filter((m) => !m.disabled).slice(0, topN);
  if (active.length === 0) return '';

  const lines: string[] = ['=== ĐIỀU ĐÃ BIẾT (ký ức đã được user duyệt) ==='];
  for (const scope of SCOPE_ORDER) {
    const group = active.filter((m) => m.scope === scope);
    if (group.length === 0) continue;
    lines.push(`\n[${SCOPE_LABEL[scope]}]`);
    for (const m of group) lines.push(`- ${m.key}: ${m.value}`);
  }
  lines.push('\nDùng thông tin trên khi liên quan. Nếu mâu thuẫn với điều user vừa nói, ƯU TIÊN điều user vừa nói.');
  return lines.join('\n');
}
```

- [ ] **Step 4: Chạy test cho thấy pass**

Run: `cd tao-card && npx vitest run src/lib/ai/__tests__/memoryContext.test.ts`
Expected: PASS — 5 passed

- [ ] **Step 5: Commit**

```bash
git add tao-card/src/lib/ai/memoryContext.ts tao-card/src/lib/ai/__tests__/memoryContext.test.ts
git commit -m "feat(tao-card): memoryContext — dung khoi ky uc cho system prompt"
```

---

## Task 2: Thêm biến thể `save_memory` vào `AIAction`

**Files:**
- Modify: `tao-card/src/lib/ai/copilotTypes.ts`

- [ ] **Step 1: Thêm biến thể**

Trong `tao-card/src/lib/ai/copilotTypes.ts`, tìm dòng:

```ts
  | { type: 'tool_call'; data: { tool: string; args: Record<string, unknown> } };
```

Sửa thành (thêm 1 dòng NGAY TRƯỚC dòng `tool_call`):

```ts
  | { type: 'save_memory'; data: { scope: 'global' | 'project' | 'session'; key: string; value: string } }
  | { type: 'tool_call'; data: { tool: string; args: Record<string, unknown> } };
```

- [ ] **Step 2: Kiểm typecheck**

Run: `cd tao-card && npx tsc --noEmit`
Expected: exit 0, không lỗi

- [ ] **Step 3: Commit**

```bash
git add tao-card/src/lib/ai/copilotTypes.ts
git commit -m "feat(tao-card): them AIAction save_memory"
```

---

## Task 3: Tool `propose_memory` — AI đề xuất, user duyệt mới ghi

**Files:**
- Modify: `tao-card/src/lib/toolsEngine.ts`

- [ ] **Step 1: Thêm import**

Ở đầu `tao-card/src/lib/toolsEngine.ts`, sau dòng `import { cascadeSearch } from './ai/webScraper';`, thêm:

```ts
import { useMemoryStore } from '../store/memoryStore';
import { useCardStore } from '../store/cardStore';
```

- [ ] **Step 2: Thêm tool vào `toolsEngine`**

Trong object `toolsEngine`, thêm entry MỚI ngay sau `web_search: { ... },` (trước dấu `};` đóng object):

```ts
  propose_memory: {
    name: 'propose_memory',
    description: 'Đề xuất ghi nhớ một thông tin để dùng lại sau. KHÔNG ghi thẳng — hệ thống sẽ hỏi user duyệt. Dùng khi user nói ra sở thích/quy ước lặp lại (scope=global), thông tin cố định của thẻ đang làm (scope=project), hoặc quyết định quan trọng trong phiên (scope=session).',
    parameters: {
      scope: "string - 'global' (thói quen user, áp mọi thẻ) | 'project' (về thẻ đang làm) | 'session' (trong phiên này)",
      key: 'string - Tiêu đề ngắn, vd "Văn phong ưa thích"',
      value: 'string - Nội dung cần nhớ, viết gọn 1-2 câu',
    },
    execute: async (args, ctx) => {
      const scope = String(args.scope || '') as 'global' | 'project' | 'session';
      const key = String(args.key || '').trim();
      const value = String(args.value || '').trim();

      if (!['global', 'project', 'session'].includes(scope)) {
        return `Lỗi: scope "${scope}" không hợp lệ. Chỉ dùng global | project | session.`;
      }
      if (!key || !value) return 'Lỗi: thiếu key hoặc value.';

      const projectId = useCardStore.getState().currentProjectId ?? undefined;
      // Ca biên: dự án chưa lưu thì không có id ổn định để gắn ký ức project.
      if (scope === 'project' && !projectId) {
        return 'Không lưu được ký ức phạm vi "project" vì dự án chưa được lưu (chưa có id). Hãy nhắc user lưu dự án trước, hoặc dùng scope "session".';
      }

      // Cơ chế duyệt CÓ SẴN: hiện thẻ Apply/Skip, chờ user quyết.
      const decision = await ctx.showActionCard({ type: 'save_memory', data: { scope, key, value } });
      if (decision !== 'apply') return `User đã từ chối ghi nhớ "${key}". Đừng đề xuất lại mục này.`;

      useMemoryStore.getState().addMemory({
        scope,
        key,
        value,
        projectId: scope === 'project' ? projectId : undefined,
        sessionId: scope === 'session' ? 'current' : undefined,
      });
      return `Đã ghi nhớ "${key}" (phạm vi ${scope}).`;
    },
  },
```

- [ ] **Step 3: Kiểm typecheck**

Run: `cd tao-card && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 4: Kiểm tool xuất hiện trong prompt**

Run: `cd tao-card && node -e "const s=require('fs').readFileSync('src/lib/toolsEngine.ts','utf8'); console.log(s.includes('propose_memory') ? 'OK: tool da them' : 'THIEU')"`
Expected: `OK: tool da them`

- [ ] **Step 5: Commit**

```bash
git add tao-card/src/lib/toolsEngine.ts
git commit -m "feat(tao-card): tool propose_memory — AI de xuat, user duyet moi ghi"
```

---

## Task 4: Chèn khối ký ức vào system prompt

**Files:**
- Modify: `tao-card/src/lib/ai/agentLoop.ts`

- [ ] **Step 1: Thêm import**

Ở đầu `tao-card/src/lib/ai/agentLoop.ts`, sau dòng `import { buildCopilotSystemPrompt } from './copilotPrompts';`, thêm:

```ts
import { buildMemoryBlock } from './memoryContext';
import { useMemoryStore } from '../../store/memoryStore';
import { useCardStore } from '../../store/cardStore';
```

- [ ] **Step 2: Chèn khối ký ức**

Tìm đoạn trong `runCopilotLoop` (khoảng dòng 62):

```ts
  const systemPrompt = buildCopilotSystemPrompt(ctx.mode, ctx.getCard(), ctx.contextChip) + 
    (isPipelineMode ? '\n\n' + CRITICAL_ABSOLUTE_COMPLETENESS_PROTOCOL : '');
```

Thay bằng:

```ts
  // ─── Truy hồi ký ức liên quan tới câu user vừa hỏi ───
  // Lỗi ở đây KHÔNG được làm hỏng chat: nuốt lỗi, coi như không có ký ức.
  let memoryBlock = '';
  try {
    const projectId = useCardStore.getState().currentProjectId ?? undefined;
    const found = useMemoryStore.getState().searchMemory(userMessage, { projectId, sessionId: 'current' });
    memoryBlock = buildMemoryBlock(found);
  } catch (e) {
    console.warn('[memory] truy hồi lỗi, bỏ qua:', e);
  }

  const systemPrompt = buildCopilotSystemPrompt(ctx.mode, ctx.getCard(), ctx.contextChip) +
    (memoryBlock ? '\n\n' + memoryBlock : '') +
    (isPipelineMode ? '\n\n' + CRITICAL_ABSOLUTE_COMPLETENESS_PROTOCOL : '');
```

- [ ] **Step 3: Kiểm typecheck**

Run: `cd tao-card && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 4: Chạy toàn bộ test cũ để chắc không vỡ gì**

Run: `cd tao-card && npx vitest run`
Expected: PASS — tất cả test pass (74 test: 69 cũ + 5 mới của Task 1)

- [ ] **Step 5: Commit**

```bash
git add tao-card/src/lib/ai/agentLoop.ts
git commit -m "feat(tao-card): chen khoi ky uc vao system prompt Copilot"
```

---

## Task 5: i18n + nhãn thẻ duyệt cho `save_memory`

**Files:**
- Modify: `tao-card/src/i18n/en.ts`, `tao-card/src/i18n/vi.ts`, `tao-card/src/i18n/zh.ts`
- Modify: `tao-card/src/components/copilot/CopilotPanel.tsx`

- [ ] **Step 1: Thêm key i18n**

Trong `tao-card/src/i18n/en.ts`, tìm dòng `cpActGameUi: 'Create a game UI',` và thêm NGAY SAU:

```ts
  cpActSaveMemory: 'Remember this',
  cpMemoryPanelTitle: 'Memory',
  cpMemoryEmpty: 'No memories yet. The assistant will ask before saving anything.',
  cpMemoryScopeGlobal: 'Your habits (all cards)',
  cpMemoryScopeProject: 'This card',
  cpMemoryScopeSession: 'This session',
  cpMemoryAdd: 'Add',
  cpMemoryDelete: 'Delete',
  cpMemoryToggle: 'Enable/disable',
```

Trong `tao-card/src/i18n/vi.ts`, tìm `cpActGameUi: 'Tạo game UI',` và thêm NGAY SAU:

```ts
  cpActSaveMemory: 'Ghi nhớ điều này',
  cpMemoryPanelTitle: 'Bộ nhớ',
  cpMemoryEmpty: 'Chưa có ký ức nào. Trợ lý sẽ hỏi bạn trước khi lưu bất cứ gì.',
  cpMemoryScopeGlobal: 'Thói quen của bạn (mọi thẻ)',
  cpMemoryScopeProject: 'Thẻ này',
  cpMemoryScopeSession: 'Phiên này',
  cpMemoryAdd: 'Thêm',
  cpMemoryDelete: 'Xoá',
  cpMemoryToggle: 'Bật/tắt',
```

Trong `tao-card/src/i18n/zh.ts`, tìm `cpActGameUi: '生成游戏 UI',` và thêm NGAY SAU:

```ts
  cpActSaveMemory: '记住这个',
  cpMemoryPanelTitle: '记忆',
  cpMemoryEmpty: '暂无记忆。助手保存前会先询问你。',
  cpMemoryScopeGlobal: '你的习惯（所有卡）',
  cpMemoryScopeProject: '此卡',
  cpMemoryScopeSession: '本次会话',
  cpMemoryAdd: '添加',
  cpMemoryDelete: '删除',
  cpMemoryToggle: '启用/停用',
```

- [ ] **Step 2: Thêm nhãn vào thẻ duyệt**

Trong `tao-card/src/components/copilot/CopilotPanel.tsx`, tìm dòng:

```ts
    generate_game_ui: { icon: '🎮', label: ui.cpActGameUi, color: 'text-cyan-400' },
```

Thêm NGAY SAU:

```ts
    save_memory: { icon: '🧠', label: ui.cpActSaveMemory, color: 'text-amber-400' },
```

- [ ] **Step 3: Thêm dòng tóm tắt cho thẻ**

Trong cùng file, tìm chuỗi ternary tính `summary` (bắt đầu bằng `const summary = action.type === 'create_entry'`). Thêm nhánh MỚI ngay sau `const summary =`:

```ts
  const summary = action.type === 'save_memory' ? `[${(action.data as Record<string, unknown>).scope}] "${(action.data as Record<string, unknown>).key}": ${(action.data as Record<string, unknown>).value}`
    : action.type === 'create_entry' ? `"${(action.data as Record<string, unknown>).comment}"`
```

(giữ nguyên toàn bộ các nhánh còn lại phía dưới)

- [ ] **Step 4: Kiểm typecheck**

Run: `cd tao-card && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add tao-card/src/i18n tao-card/src/components/copilot/CopilotPanel.tsx
git commit -m "feat(tao-card): i18n + nhan the duyet cho save_memory"
```

---

## Task 6: `memorySummarizer.ts` — nén chat dài thành ký ức session

**Files:**
- Create: `tao-card/src/lib/ai/memorySummarizer.ts`
- Test: `tao-card/src/lib/ai/__tests__/memorySummarizer.test.ts`

- [ ] **Step 1: Viết test thất bại**

Tạo `tao-card/src/lib/ai/__tests__/memorySummarizer.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { shouldSummarize, summarizeHistory, SUMMARIZE_THRESHOLD, KEEP_RECENT } from '../memorySummarizer';
import type { ChatMessage } from '../../../types';

const msgs = (n: number): ChatMessage[] =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `tin ${i}` } as ChatMessage));

describe('shouldSummarize', () => {
  it('dưới ngưỡng → không nén', () => {
    expect(shouldSummarize(msgs(SUMMARIZE_THRESHOLD - 1))).toBe(false);
  });
  it('đạt ngưỡng → nén', () => {
    expect(shouldSummarize(msgs(SUMMARIZE_THRESHOLD))).toBe(true);
  });
});

describe('summarizeHistory', () => {
  it('nén phần cũ, giữ N lượt gần nhất', async () => {
    const callAI = vi.fn().mockResolvedValue('TÓM LƯỢC');
    const r = await summarizeHistory(msgs(30), callAI);
    expect(r).not.toBeNull();
    expect(r!.summary).toBe('TÓM LƯỢC');
    expect(r!.kept).toHaveLength(KEEP_RECENT);
    expect(r!.kept[KEEP_RECENT - 1].content).toBe('tin 29');
  });

  it('AI lỗi → trả null, KHÔNG ném ra ngoài (chat vẫn chạy)', async () => {
    const callAI = vi.fn().mockRejectedValue(new Error('API sập'));
    await expect(summarizeHistory(msgs(30), callAI)).resolves.toBeNull();
  });

  it('dưới ngưỡng → trả null, không gọi AI', async () => {
    const callAI = vi.fn();
    expect(await summarizeHistory(msgs(3), callAI)).toBeNull();
    expect(callAI).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Chạy test cho thấy fail**

Run: `cd tao-card && npx vitest run src/lib/ai/__tests__/memorySummarizer.test.ts`
Expected: FAIL — `Failed to resolve import "../memorySummarizer"`

- [ ] **Step 3: Viết implementation**

Tạo `tao-card/src/lib/ai/memorySummarizer.ts`:

```ts
import type { ChatMessage } from '../../types';

/** Số lượt chat vượt mức này thì nén phần cũ lại. */
export const SUMMARIZE_THRESHOLD = 20;
/** Số lượt gần nhất luôn giữ nguyên văn (không nén). */
export const KEEP_RECENT = 6;

export interface SummarizeResult {
  summary: string;
  kept: ChatMessage[];
}

export function shouldSummarize(history: ChatMessage[]): boolean {
  return history.length >= SUMMARIZE_THRESHOLD;
}

/**
 * Nén phần đầu của lịch sử chat thành 1 đoạn tóm lược, giữ nguyên KEEP_RECENT lượt cuối.
 * Trả null khi chưa cần nén HOẶC khi gọi AI lỗi — người gọi cứ dùng lịch sử gốc, chat không đứt.
 */
export async function summarizeHistory(
  history: ChatMessage[],
  callAI: (prompt: string) => Promise<string>,
): Promise<SummarizeResult | null> {
  if (!shouldSummarize(history)) return null;

  const old = history.slice(0, history.length - KEEP_RECENT);
  const kept = history.slice(history.length - KEEP_RECENT);
  const transcript = old.map((m) => `${m.role}: ${m.content}`).join('\n');

  const prompt = `Tóm lược đoạn hội thoại sau thành 5-10 gạch đầu dòng ngắn, GIỮ LẠI: quyết định đã chốt, tên riêng, ràng buộc user đặt ra. BỎ: lời chào, câu xã giao, nội dung đã bị thay thế.\n\n${transcript}`;

  try {
    const summary = (await callAI(prompt)).trim();
    if (!summary) return null;
    return { summary, kept };
  } catch (e) {
    console.warn('[memory] nén chat lỗi, giữ nguyên lịch sử:', e);
    return null;
  }
}
```

- [ ] **Step 4: Chạy test cho thấy pass**

Run: `cd tao-card && npx vitest run src/lib/ai/__tests__/memorySummarizer.test.ts`
Expected: PASS — 5 passed

- [ ] **Step 5: Commit**

```bash
git add tao-card/src/lib/ai/memorySummarizer.ts tao-card/src/lib/ai/__tests__/memorySummarizer.test.ts
git commit -m "feat(tao-card): memorySummarizer — nen chat dai thanh ky uc session"
```

---

## Task 7: `MemoryPanel.tsx` — panel sửa tay

**Files:**
- Create: `tao-card/src/components/copilot/MemoryPanel.tsx`
- Modify: `tao-card/src/components/copilot/CopilotPanel.tsx`

- [ ] **Step 1: Tạo panel**

Tạo `tao-card/src/components/copilot/MemoryPanel.tsx`:

```tsx
import { useState } from 'react';
import { useMemoryStore, type MemoryScope } from '../../store/memoryStore';
import { useCardStore } from '../../store/cardStore';
import { useUi } from '../../i18n';

const SCOPES: MemoryScope[] = ['global', 'project', 'session'];

/** Panel quản lý ký ức: xem / thêm / xoá / tắt-bật từng mục.
 *  Tắt-bật quan trọng hơn xoá: ký ức global sai sẽ âm thầm bẻ mọi thẻ, tắt tạm để
 *  khoanh vùng thủ phạm mà không mất dữ liệu. */
export function MemoryPanel({ onClose }: { onClose: () => void }) {
  const ui = useUi();
  const memories = useMemoryStore((s) => s.memories);
  const addMemory = useMemoryStore((s) => s.addMemory);
  const deleteMemory = useMemoryStore((s) => s.deleteMemory);
  const toggleMemory = useMemoryStore((s) => s.toggleMemory);
  const projectId = useCardStore((s) => s.currentProjectId);

  const [scope, setScope] = useState<MemoryScope>('global');
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');

  const label: Record<MemoryScope, string> = {
    global: ui.cpMemoryScopeGlobal,
    project: ui.cpMemoryScopeProject,
    session: ui.cpMemoryScopeSession,
  };

  const add = () => {
    if (!key.trim() || !value.trim()) return;
    addMemory({
      scope, key: key.trim(), value: value.trim(),
      projectId: scope === 'project' ? (projectId ?? undefined) : undefined,
      sessionId: scope === 'session' ? 'current' : undefined,
    });
    setKey(''); setValue('');
  };

  return (
    <div className="flex flex-col gap-3 p-3 border rounded-md bg-background">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">🧠 {ui.cpMemoryPanelTitle}</h3>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
      </div>

      <div className="flex flex-col gap-1">
        <select value={scope} onChange={(e) => setScope(e.target.value as MemoryScope)} className="text-xs p-1 rounded border bg-background">
          {SCOPES.map((s) => <option key={s} value={s}>{label[s]}</option>)}
        </select>
        {scope === 'project' && !projectId && (
          <span className="text-[0.65rem] text-amber-400">Dự án chưa lưu — lưu dự án trước để gắn ký ức cho thẻ này.</span>
        )}
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Tiêu đề" className="text-xs p-1 rounded border bg-background" />
        <textarea value={value} onChange={(e) => setValue(e.target.value)} placeholder="Nội dung cần nhớ" rows={2} className="text-xs p-1 rounded border bg-background" />
        <button onClick={add} disabled={scope === 'project' && !projectId} className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground disabled:opacity-40">
          {ui.cpMemoryAdd}
        </button>
      </div>

      <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
        {memories.length === 0 && <p className="text-xs text-muted-foreground">{ui.cpMemoryEmpty}</p>}
        {memories.map((m) => (
          <div key={m.id} className={`flex items-start gap-2 text-xs p-2 rounded border ${m.disabled ? 'opacity-40' : ''}`}>
            <input type="checkbox" checked={!m.disabled} onChange={() => toggleMemory(m.id)} title={ui.cpMemoryToggle} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">{m.key}</div>
              <div className="text-muted-foreground break-words">{m.value}</div>
              <div className="text-[0.6rem] text-muted-foreground">{label[m.scope]}</div>
            </div>
            <button onClick={() => deleteMemory(m.id)} title={ui.cpMemoryDelete} className="text-destructive">🗑</button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Kiểm tên export của memoryStore khớp**

Run: `cd tao-card && node -e "const s=require('fs').readFileSync('src/store/memoryStore.ts','utf8'); for (const n of ['memories','addMemory','deleteMemory','toggleMemory','MemoryScope']) console.log(n, s.includes(n) ? 'OK' : 'THIEU')"`
Expected: tất cả `OK`. Nếu có `THIEU`, mở `src/store/memoryStore.ts` đọc tên thật rồi sửa lại panel cho khớp.

- [ ] **Step 3: Gắn nút mở panel vào CopilotPanel**

Trong `tao-card/src/components/copilot/CopilotPanel.tsx`, thêm import ở đầu file:

```tsx
import { MemoryPanel } from './MemoryPanel';
```

Thêm state (đặt cạnh các `useState` khác trong component, vd sau `const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);`):

```tsx
  const [showMemory, setShowMemory] = useState(false);
```

Trong JSX, ngay TRƯỚC khối `{/* Preview pending attachments */}`, thêm:

```tsx
      {showMemory && <MemoryPanel onClose={() => setShowMemory(false)} />}
```

Và thêm nút mở panel cạnh nút đính kèm file (trong hàng nút gần ô nhập):

```tsx
      <button type="button" onClick={() => setShowMemory((v) => !v)} title={ui.cpMemoryPanelTitle} className="text-sm px-2">🧠</button>
```

- [ ] **Step 4: Kiểm typecheck + build**

Run: `cd tao-card && npx tsc --noEmit && npx vite build`
Expected: exit 0, build thành công

- [ ] **Step 5: Chạy toàn bộ test**

Run: `cd tao-card && npx vitest run`
Expected: PASS — 78 test (69 cũ + 5 Task 1 + 5 Task 6, trừ chênh lệch nhỏ nếu có)

- [ ] **Step 6: Commit**

```bash
git add tao-card/src/components/copilot/MemoryPanel.tsx tao-card/src/components/copilot/CopilotPanel.tsx
git commit -m "feat(tao-card): MemoryPanel — xem/them/xoa/tat-bat ky uc"
```

---

## Task 8: Kiểm tay end-to-end + bump version

**Files:**
- Modify: `tao-card/src/version.ts` (nếu tồn tại — nếu không, bỏ qua bước bump)

- [ ] **Step 1: Chạy app**

Run: `cd tao-card && npm run dev`

- [ ] **Step 2: Kiểm 5 hành vi cốt lõi**

1. Mở Copilot → bấm 🧠 → panel hiện, báo "chưa có ký ức nào"
2. Tự thêm 1 ký ức `global`: key "Văn phong", value "thích văn hiện đại, tránh Hán-Việt nặng" → xuất hiện trong danh sách
3. Hỏi Copilot một câu liên quan văn phong → câu trả lời phải bám ký ức vừa thêm
4. Nói với Copilot: "nhớ giúp tôi là thẻ này lấy bối cảnh Nhật hiện đại" → phải hiện **thẻ duyệt 🧠 Ghi nhớ điều này** (KHÔNG tự lưu). Bấm Skip → panel vẫn không có mục mới. Làm lại, bấm Apply → mục mới xuất hiện
5. Tắt (bỏ tick) ký ức ở bước 2 → hỏi lại câu ở bước 3 → câu trả lời không còn bám ký ức đó nữa

- [ ] **Step 3: Kiểm ca biên dự án chưa lưu**

Tạo dự án mới chưa lưu → yêu cầu Copilot nhớ điều gì đó về thẻ → nó phải báo cần lưu dự án trước, KHÔNG được crash.

- [ ] **Step 4: Bump version (nếu có `tao-card/src/version.ts`)**

Tăng patch và cập nhật ghi chú:

```ts
export const APP_VERSION_NOTE = 'Copilot co bo nho: nho thoi quen user / thong tin the / mach chat dai. AI de xuat, ban duyet moi luu.';
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(tao-card): bump version — Copilot memory"
```

---

## Self-Review

**Spec coverage:**

| Yêu cầu trong spec | Task |
|---|---|
| Truy hồi + chèn khối "ĐIỀU ĐÃ BIẾT" | Task 1, 4 |
| Tool `propose_memory`, AI không ghi thẳng | Task 3 |
| Thẻ duyệt trong chat | Task 2, 5 (dùng lại `showActionCard` có sẵn) |
| Panel CRUD + tắt/bật | Task 7 |
| Nén chat dài (session) | Task 6 |
| `projectId` = `currentProjectId` | Task 3, 7 |
| Ca biên `currentProjectId === null` | Task 3 (Step 2), Task 7 (Step 1), Task 8 (Step 3) |
| Nuốt lỗi khi `searchMemory` hỏng | Task 4 (Step 2) |
| Kho rỗng → không chèn khối | Task 1 (test 1) |
| Tắt/bật thay vì chỉ xoá | Task 7 |
| Test theo spec mục 7 | Task 1, 6 |

Không có mục nào trong spec thiếu task.

**Ghi chú sai lệch có chủ ý:** spec liệt kê `MemoryProposalCard.tsx` — bỏ, vì `showActionCard` +
ActionCard có sẵn làm đúng việc đó. Ít code hơn, UI đồng nhất với các action khác.

**Type consistency:** `MemoryEntry`/`MemoryScope` import từ `../../store/memoryStore` ở cả Task 1 và 7.
`save_memory` có cùng shape `{scope, key, value}` ở Task 2 (định nghĩa), Task 3 (tạo), Task 5 (hiển thị).
`SUMMARIZE_THRESHOLD`/`KEEP_RECENT` export ở Task 6 và dùng đúng tên trong test cùng task.

**Rủi ro đã chốt trong plan:** Task 7 Step 2 bắt kiểm tên export thật của `memoryStore` trước khi tin —
tránh trường hợp panel gọi sai tên field rồi crash lúc chạy.
