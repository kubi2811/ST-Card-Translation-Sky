/**
 * src/lib/ai/goalAgent.ts — (Goal 101.1) KHUNG AGENT DÙNG CHUNG: yêu cầu → kế hoạch → duyệt
 * → chạy → validate → tự sửa HỘI TỤ → báo cáo.
 * ─────────────────────────────────────────────────────────────────────────────
 * Triết lý (đã chốt với user): AI-tự-quyết là mặc định — user chỉ đưa YÊU CẦU, agent tự
 * phán đoán quy mô/số lượt rồi TRÌNH KẾ HOẠCH cho user duyệt trước khi tiêu call AI.
 *
 * Khung này domain-agnostic: EJS (101), Lorebook (102), Regex (103), Auto (104) chỉ việc
 * cắm một `GoalAgentDomain` — prompt + parse + validator của riêng miền đó. Mọi call AI
 * đi qua `AgentCallFn` bơm từ ngoài nên test được bằng mock, không đốt API thật.
 *
 * Bài học nợ #42 được khắc vào luật ở đây: vòng tự sửa phải HỘI TỤ —
 *   1. sửa xong RE-validate bằng CHÍNH validator đó;
 *   2. số lỗi không giảm ⇒ HOÀN NGUYÊN về bản trước và dừng (không bao giờ lấy bản
 *      tệ hơn làm nền cho vòng sau — đó chính là cách 3 lỗi nở thành 500).
 */
import type { ChatMessage } from '../../types';

// ═══ Kiểu chung ═══════════════════════════════════════════════════════════

export interface AgentIssue {
  level: 'error' | 'warning';
  /** Mã ổn định để autofix nhắm đúng lỗi (cùng triết lý validateMvuCard). */
  code: string;
  message: string;
  /** Khoá item chứa lỗi — phải khớp `domain.itemKey(item)` thì autofix mới biết sửa ai. */
  where?: string;
}

export interface AgentStepSpec {
  id: string;
  /** Tên bước hiển thị cho user trong kế hoạch. */
  title: string;
  detail?: string;
  /** Yêu cầu cụ thể AI phải thực hiện ở bước này (đưa vào prompt bước). */
  requirement: string;
}

export interface AgentPlan {
  /** AI tóm tắt nó hiểu yêu cầu thế nào + định làm gì — user đọc cái này để duyệt. */
  scope: string;
  steps: AgentStepSpec[];
  /** Ước lượng số call AI (kế hoạch + các bước; chưa tính vòng sửa). */
  estCalls: number;
  notes?: string[];
}

/** Mọi call AI của khung đi qua đây — UI bơm callAI thật, test bơm mock. */
export type AgentCallFn = (
  messages: ChatMessage[],
  opts?: { temperature?: number; label?: string },
) => Promise<string>;

export interface GoalAgentDomain<TItem> {
  name: string;
  buildPlanMessages(goal: string): ChatMessage[];
  parsePlan(raw: string): AgentPlan;
  buildStepMessages(step: AgentStepSpec, done: TItem[]): ChatMessage[];
  parseStepOutput(raw: string, step: AgentStepSpec): TItem;
  /** Validator TẤT ĐỊNH (không AI) — chạy trên TOÀN BỘ items để bắt cả lỗi chéo (trùng tên…). */
  validate(items: TItem[]): AgentIssue[];
  /**
   * Sửa máy móc KHÔNG tốn call AI (thiếu directive, trùng tên…) — chạy TRƯỚC vòng sửa AI.
   * Trả về items mới + danh sách mô tả đã sửa gì (cho log). Không bắt buộc.
   */
  autofixDeterministic?(items: TItem[], issues: AgentIssue[]): { items: TItem[]; fixed: string[] };
  /**
   * (bug 162 phần 1) `attempt` để prompt sửa BIẾT nó là lần thử thứ mấy và lần trước đã fail ra sao.
   * Bản cũ mỗi vòng gửi lại prompt y hệt → model trả lại y hệt → vòng 2 không bao giờ khá hơn vòng
   * 1, nên khung phải dừng sớm và đẩy danh sách lỗi kỹ thuật cho user tự sửa. Có phản hồi thì mới
   * gọi là "tự sửa".
   */
  buildFixMessages(item: TItem, issues: AgentIssue[], attempt?: FixAttemptInfo): ChatMessage[];
  parseFixOutput(raw: string, item: TItem): TItem;
  itemKey(item: TItem): string;
  /**
   * (bug 162 phần 1) Mục vẫn lỗi sau khi thử hết cách thì có được BỎ đi không.
   * Với EJS thì có: thà áp 11/12 khối chạy được còn hơn đưa cho user (nhất là người mới) một danh
   * sách lỗi kỹ thuật kèm câu "tự sửa tay đi" — họ sửa mò là hỏng cả card.
   */
  canDropItems?: boolean;
}

/** (bug 162 phần 1) Bối cảnh một lần thử sửa — để prompt thích nghi thay vì lặp lại. */
export interface FixAttemptInfo {
  /** Lần thử thứ mấy (1-based). */
  round: number;
  /** Tổng số lần sẽ thử. */
  maxRounds: number;
  /** Code/nội dung của lần thử TRƯỚC (đã fail) — null ở lần đầu. */
  previousAttempt?: string;
  /** Lỗi VẪN CÒN sau lần thử trước. */
  stillFailing?: AgentIssue[];
}

export interface GoalRunEvent {
  phase: 'step' | 'validating' | 'fixing' | 'reverted' | 'done';
  text: string;
}

export interface GoalRunResult<TItem> {
  /** true khi không còn issue mức error. */
  ok: boolean;
  items: TItem[];
  /** Issue còn lại sau mọi vòng sửa (cả warning). */
  issues: AgentIssue[];
  fixRounds: number;
  log: string[];
  /** (bug 162 phần 1) Mục đã BỎ vì không tự sửa được — user cần biết đã mất gì, nhưng không phải sửa. */
  dropped?: string[];
}

export interface GoalRunOptions {
  maxFixRounds?: number;
  onProgress?: (ev: GoalRunEvent) => void;
  signal?: AbortSignal;
}

// ═══ Helpers ══════════════════════════════════════════════════════════════

const countErrors = (issues: AgentIssue[]) => issues.filter((i) => i.level === 'error').length;

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Người dùng đã dừng', 'AbortError');
}

/** Call AI có retry: lần 2 hạ temperature cho ổn định (parse fail thường do output loạn). */
async function callWithRetry(
  call: AgentCallFn,
  messages: ChatMessage[],
  label: string,
  signal?: AbortSignal,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    assertNotAborted(signal);
    try {
      return await call(messages, { temperature: attempt > 1 ? 0.3 : undefined, label });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ═══ Pha 1: Lên kế hoạch (1 call AI) ══════════════════════════════════════

export async function planGoal<TItem>(
  goal: string,
  domain: GoalAgentDomain<TItem>,
  call: AgentCallFn,
  signal?: AbortSignal,
): Promise<AgentPlan> {
  const raw = await callWithRetry(call, domain.buildPlanMessages(goal), `${domain.name}: lên kế hoạch`, signal);
  const plan = domain.parsePlan(raw);
  if (!plan.steps.length) throw new Error('Kế hoạch AI trả về không có bước nào — thử diễn đạt yêu cầu cụ thể hơn.');
  return plan;
}

// ═══ Pha 2: Chạy kế hoạch (sau khi user duyệt) ════════════════════════════

export async function executeGoalPlan<TItem>(
  plan: AgentPlan,
  domain: GoalAgentDomain<TItem>,
  call: AgentCallFn,
  opts: GoalRunOptions = {},
): Promise<GoalRunResult<TItem>> {
  const { maxFixRounds = 3, onProgress, signal } = opts;
  const log: string[] = [];
  const say = (phase: GoalRunEvent['phase'], text: string) => {
    log.push(text);
    onProgress?.({ phase, text });
  };

  // ─── Chạy từng bước ───
  let items: TItem[] = [];
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    assertNotAborted(signal);
    say('step', `Bước ${i + 1}/${plan.steps.length}: ${step.title}…`);
    const raw = await callWithRetry(call, domain.buildStepMessages(step, items), `${domain.name}: ${step.title}`, signal);
    items = [...items, domain.parseStepOutput(raw, step)];
  }

  // ─── Validate + sửa máy móc trước (miễn phí) ───
  say('validating', 'Kiểm tự động toàn bộ kết quả…');
  let issues = domain.validate(items);
  if (countErrors(issues) > 0 && domain.autofixDeterministic) {
    const det = domain.autofixDeterministic(items, issues);
    if (det.fixed.length) {
      items = det.items;
      issues = domain.validate(items);
      for (const f of det.fixed) say('fixing', `🔧 Sửa máy móc: ${f}`);
    }
  }

  // ─── Vòng sửa AI hội tụ (luật #42: không tiến bộ ⇒ hoàn nguyên + dừng) ───
  let fixRounds = 0;
  /** (bug 162 phần 1) Bản đã thử của từng mục — đưa vào prompt lần sau làm phản hồi. */
  const prevAttempt = new Map<string, string>();
  const errsOf = (list: AgentIssue[], key: string) => list.filter((x) => x.level === 'error' && x.where === key);
  let errCount = countErrors(issues);
  while (errCount > 0 && fixRounds < maxFixRounds) {
    assertNotAborted(signal);
    fixRounds++;
    say('fixing', `Vòng sửa ${fixRounds}/${maxFixRounds}: còn ${errCount} lỗi…`);

    const nextItems = [...items];
    for (let i = 0; i < nextItems.length; i++) {
      const key = domain.itemKey(nextItems[i]);
      const itemIssues = issues.filter((x) => x.level === 'error' && x.where === key);
      if (!itemIssues.length) continue;
      assertNotAborted(signal);
      // (bug 162 phần 1) Gửi kèm bản đã thử lần trước + lỗi VẪN CÒN. Bản cũ mỗi vòng gửi lại prompt
      // y hệt nên model trả lại y hệt, vòng 2 không bao giờ khá hơn vòng 1 — đó chính là lý do
      // khung phải dừng sớm rồi đẩy danh sách lỗi cho user tự sửa.
      const raw = await callWithRetry(
        call,
        domain.buildFixMessages(nextItems[i], itemIssues, {
          round: fixRounds, maxRounds: maxFixRounds,
          previousAttempt: prevAttempt.get(key), stillFailing: itemIssues,
        }),
        `${domain.name}: sửa ${key} (vòng ${fixRounds})`, signal,
      );
      prevAttempt.set(key, JSON.stringify(nextItems[i]));
      nextItems[i] = domain.parseFixOutput(raw, nextItems[i]);
    }
    // Lỗi không gắn item cụ thể (where rỗng) thì AI không có chỗ sửa — thoát sớm cho đỡ tốn call.
    const orphan = issues.filter((x) => x.level === 'error' && !nextItems.some((it) => domain.itemKey(it) === x.where));
    const nextIssues = domain.validate(nextItems);
    const nextErr = countErrors(nextIssues);

    if (nextErr < errCount) {
      items = nextItems;
      issues = nextIssues;
      errCount = nextErr;
    } else if (nextErr === errCount) {
      // (bug 162 phần 1) BẰNG NHAU KHÔNG CÒN LÀ LÝ DO ĐỂ DỪNG.
      // Bản cũ gộp "bằng" với "nở ra" rồi dừng cả hai. Nhưng vòng 2 mới là vòng ĐẦU TIÊN có phản
      // hồi (bản đã thử + lỗi vẫn còn) — dừng ở đó là chặn đúng lúc nó bắt đầu có cơ hội khá lên,
      // và đó chính là lý do tính năng này luôn kết thúc bằng "còn N lỗi, tự sửa đi".
      // Nay chỉ dừng khi model trả về Y NGUYÊN bản cũ cho MỌI mục còn lỗi — lúc đó thử thêm mới
      // thật sự là vô ích. Còn "khác nhưng chưa hết lỗi" thì vẫn cho đi tiếp.
      const failing = nextItems.filter((it) => errsOf(nextIssues, domain.itemKey(it)).length > 0);
      const allIdentical = failing.length > 0 && failing.every((it) => {
        const before = items.find((o) => domain.itemKey(o) === domain.itemKey(it));
        return before !== undefined && JSON.stringify(before) === JSON.stringify(it);
      });
      if (allIdentical) {
        say('reverted', `↩️ Vòng sửa trả về đúng bản cũ cho mọi mục còn lỗi (${errCount} lỗi) — thử thêm cũng vô ích, dừng tự sửa.`);
        break;
      }
      items = nextItems;
      issues = nextIssues;
      say('fixing', `Tổng lỗi giữ nguyên (${errCount}) nhưng bản mới khác bản cũ — tiếp tục thử cách khác.`);
    } else {
      // NỞ RA ⇒ giữ bản cũ, dừng — chốt chống "3 lỗi thành 500", giữ nguyên từ bản cũ.
      say('reverted', `↩️ Vòng sửa làm lỗi NỞ từ ${errCount} lên ${nextErr} — hoàn nguyên bản trước và dừng tự sửa.`);
      break;
    }
    if (orphan.length === issues.filter((x) => x.level === 'error').length && orphan.length > 0) break;
  }

  // ─── (bug 162 phần 1) CÒN LỖI THÌ BỎ MỤC LỖI, ĐỪNG TRAO VIỆC SỬA CODE CHO USER ───
  // User nói thẳng: "với người mới, không phải ai cũng biết cách sửa, dễ làm hỏng cả Card khi cố tự
  // sửa mà không hiểu rõ". Nên thà áp 11/12 khối chạy được và nói rõ đã bỏ cái nào, còn hơn đưa ra
  // một danh sách lỗi kỹ thuật kèm hàm ý "tự lo".
  const dropped: string[] = [];
  if (countErrors(issues) > 0 && domain.canDropItems) {
    const bad = new Set(issues.filter((x) => x.level === 'error').map((x) => x.where).filter(Boolean));
    const keep = items.filter((it) => !bad.has(domain.itemKey(it)));
    if (keep.length < items.length) {
      for (const it of items) if (bad.has(domain.itemKey(it))) dropped.push(domain.itemKey(it));
      items = keep;
      issues = domain.validate(items);
      say('fixing', `🗑️ Đã bỏ ${dropped.length} mục không tự sửa được sau ${fixRounds} vòng: ${dropped.join(', ')}. Phần còn lại vẫn dùng được bình thường.`);
    }
  }

  const ok = countErrors(issues) === 0;
  say('done', ok
    ? `✅ Xong: ${items.length} kết quả qua kiểm tự động`
      + `${dropped.length ? ` (đã bỏ ${dropped.length} mục không tự sửa được — bạn không phải sửa gì bằng tay)` : ''}`
      + `${issues.length ? ` (${issues.length} cảnh báo nhẹ)` : ''}.`
    : `⚠️ Còn ${countErrors(issues)} lỗi sau ${fixRounds} vòng tự sửa — xem chi tiết bên dưới.`);

  return { ok, items, issues, fixRounds, log, dropped };
}
