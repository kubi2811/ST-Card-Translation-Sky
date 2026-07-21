/**
 * GameUiStudio — "Game UI" mới: CHAT với AI để tạo/chỉnh Regex-UI (thay GameFrontendPreview cũ).
 * ──────────────────────────────────────────────────────────────────────────────
 * Trái: hội thoại (user / AI / system-note kiểm tự động).  Phải: Preview live + Regex + Sample.
 * Cơ chế "regex xịn": mỗi lượt AI ghi code → validateRegexDraft CHỨNG MINH findRegex match sample
 * → lỗi thì AI tự sửa (tối đa 3 vòng) — xem gameUiAgent.ts. Nút phụ "⚡ Tạo nhanh" = programmatic $0.
 */
import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import {
  Gamepad2, Send, Square, RefreshCw, Zap, Check, Eye, Code2, FileText,
  Loader2, CheckCircle2, AlertTriangle, Info, Sparkles,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import type { MVUZODSchema, InitVarConfig } from '../../types/mvuzod.types';
import type { RegexScript } from '../../types';
import { useCardStore } from '../../store/cardStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useGameStudioStore } from '../../store/gameStudioStore';
import { runGameUiTurn } from '../../lib/mvuzod/gameUiAgent';
import { buildRenderableHtml } from '../../lib/mvuzod/gameUiValidator';
import { buildProgrammaticRegex, isProgrammaticComponent, formatBytes } from '../../lib/mvuzod/programmaticRegexBuilder';
import { DEFAULT_THEME_ID } from '../../lib/mvuzod/gameHtmlTemplates';

interface Props { schema: MVUZODSchema | null; initVarConfig?: InitVarConfig | null; }

type ProductTab = 'preview' | 'regex' | 'sample';

const QUICK_PROMPTS = [
  'Tạo status bar RPG bám schema (HP, level, vàng…) — đẹp, gọn.',
  'Tạo form mở đầu game để người chơi chọn tên + xuất thân.',
  'Tạo bộ đầy đủ: màn hình game chính + status + inventory.',
];

export function GameUiStudio({ schema, initVarConfig }: Props) {
  const updateCard = useCardStore((s) => s.updateCard);

  // ─── store phiên (giữ khi đổi tab) ───
  const messages = useGameStudioStore((s) => s.messages);
  const components = useGameStudioStore((s) => s.components);
  const regexDraft = useGameStudioStore((s) => s.regexDraft);
  const sampleOutput = useGameStudioStore((s) => s.sampleOutput);
  const validation = useGameStudioStore((s) => s.validation);
  const phase = useGameStudioStore((s) => s.phase);
  const status = useGameStudioStore((s) => s.status);

  const [input, setInput] = useState('');
  const [tab, setTab] = useState<ProductTab>('preview');
  const [manualPreview, setManualPreview] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const busy = phase === 'thinking' || phase === 'validating';

  // Auto-scroll chat xuống đáy khi có message mới / status đổi
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, status]);

  // ─── Preview: ưu tiên bản render từ regex+sample; fallback component thô / bản ⚡ ───
  const previewHtml = useMemo(() => {
    for (const script of regexDraft) {
      const h = buildRenderableHtml(script, sampleOutput);
      if (h) return h;
    }
    if (manualPreview) return manualPreview;
    const comps = Object.values(components);
    return comps.length ? comps[comps.length - 1].html : '';
  }, [regexDraft, sampleOutput, components, manualPreview]);

  const validationOk = !!validation && validation.ok;
  const errorCount = validation ? validation.issues.filter((i) => i.level === 'error').length : 0;
  const canApply = regexDraft.length > 0 && validationOk;

  // ─── Gửi 1 lượt chat ───
  const send = useCallback(async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    const store = useGameStudioStore.getState();

    const profile = useSettingsStore.getState().getActiveProfile();
    const params = useSettingsStore.getState().generationParams;
    if (!profile?.apiKey) {
      store.appendMessage({ id: uuidv4(), role: 'system-note', content: '⚠️ Chưa cấu hình API AI. Vào Cài đặt để thêm key rồi thử lại.', tone: 'error' });
      return;
    }

    setInput('');
    setManualPreview(null);
    setApplied(false);
    const ac = store.beginTurn();
    try {
      await runGameUiTurn(text, { schema, initVarConfig, profile, params, signal: ac.signal });
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        store.appendMessage({ id: uuidv4(), role: 'system-note', content: `❌ Lỗi: ${(e as Error)?.message || e}`, tone: 'error' });
      }
    }
  }, [input, busy, schema]);

  const stop = useCallback(() => useGameStudioStore.getState().stop(), []);

  const newSession = useCallback(() => {
    if (busy) useGameStudioStore.getState().stop();
    useGameStudioStore.getState().resetSession();
    setManualPreview(null);
    setApplied(false);
    setInput('');
  }, [busy]);

  // ─── ⚡ Tạo nhanh (programmatic, $0, không AI) ───
  const quickBuild = useCallback(() => {
    if (!schema) return;
    const component = isProgrammaticComponent('full_set') ? 'full_set' : 'status_bar';
    const result = buildProgrammaticRegex({ schema, component, themeId: DEFAULT_THEME_ID });
    const store = useGameStudioStore.getState();
    store.setRegexDraft(result.scripts);
    result.scripts.forEach((s, i) => store.upsertComponent(`quick_${i}`, s.scriptName || `Widget ${i + 1}`, s.replaceString));
    setManualPreview(result.previewHtml);
    store.setValidation(null);
    store.appendMessage({
      id: uuidv4(), role: 'system-note', tone: 'info',
      content: `⚡ Đã tạo nhanh ${result.scripts.length} script (${formatBytes(result.totalSize)}, ${result.fieldsRendered} biến) bằng template — $0, không tốn API. Nhắn AI để chỉnh tiếp cho đẹp/đúng ý.`,
    });
    setApplied(false);
    setTab('preview');
  }, [schema]);

  // ─── Apply regexDraft vào thẻ ───
  const apply = useCallback(() => {
    if (regexDraft.length === 0) return;
    const withIds: RegexScript[] = regexDraft.map((s) => ({ ...s, id: uuidv4() }));
    updateCard((c) => { c.data.extensions.regex_scripts.push(...withIds); });
    setApplied(true);
    useGameStudioStore.getState().appendMessage({
      id: uuidv4(), role: 'system-note', tone: 'ok',
      content: `✅ Đã thêm ${withIds.length} regex script vào thẻ. Kiểm tra ở khu Regex Scripts.`,
    });
  }, [regexDraft, updateCard]);

  const empty = messages.length === 0;

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-210px)] min-h-[540px]">
      {/* ═══ CỘT TRÁI — CHAT ═══ */}
      <div className="flex flex-col flex-1 min-w-0 rounded-xl border border-border bg-card/40 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/60">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Gamepad2 className="w-4 h-4 text-primary" /> Game UI Studio
            <span className="text-[11px] font-normal text-muted-foreground">chat với AI để tạo/chỉnh</span>
          </div>
          <button onClick={newSession} className="flex items-center gap-1 text-xs px-2 py-1 rounded-md hover:bg-muted text-muted-foreground" title="Xoá phiên, bắt đầu lại">
            <RefreshCw className="w-3.5 h-3.5" /> Phiên mới
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
          {empty ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-4 px-4">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-primary" />
              </div>
              <div>
                <div className="font-semibold text-sm">Mô tả UI game bạn muốn</div>
                <div className="text-xs text-muted-foreground mt-1 max-w-sm">
                  AI sẽ viết Regex Script biến format AI xuất ra thành widget đẹp, và <b>tự chứng minh regex match thật</b> trước khi giao.
                </div>
              </div>
              <div className="flex flex-col gap-2 w-full max-w-sm">
                {QUICK_PROMPTS.map((q) => (
                  <button key={q} onClick={() => send(q)} disabled={busy}
                    className="text-left text-xs px-3 py-2 rounded-lg border border-border hover:border-primary hover:bg-primary/5 disabled:opacity-50">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} msg={m} />)
          )}

          {busy && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground pl-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {status || 'Đang xử lý…'}
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-border p-2.5 bg-card/60">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              rows={2}
              placeholder="Vd: làm status bar hiện HP dạng thanh máu đỏ, thêm ô vàng… (Enter gửi, Shift+Enter xuống dòng)"
              className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm scrollbar-thin focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {busy ? (
              <button onClick={stop} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium shrink-0">
                <Square className="w-4 h-4" fill="currentColor" /> Dừng
              </button>
            ) : (
              <button onClick={() => send()} disabled={!input.trim()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium shrink-0 disabled:opacity-40">
                <Send className="w-4 h-4" /> Gửi
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ═══ CỘT PHẢI — SẢN PHẨM ═══ */}
      <div className="flex flex-col w-full lg:w-[46%] lg:max-w-[560px] rounded-xl border border-border bg-card/40 overflow-hidden">
        {/* Tabs */}
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-card/60">
          <TabBtn active={tab === 'preview'} onClick={() => setTab('preview')} icon={Eye} label="Preview" />
          <TabBtn active={tab === 'regex'} onClick={() => setTab('regex')} icon={Code2} label={`Regex${regexDraft.length ? ` (${regexDraft.length})` : ''}`} />
          <TabBtn active={tab === 'sample'} onClick={() => setTab('sample')} icon={FileText} label="Sample" />
          <div className="ml-auto">
            {validation && (
              validationOk
                ? <span className="flex items-center gap-1 text-[11px] text-green-600"><CheckCircle2 className="w-3.5 h-3.5" /> Đạt</span>
                : <span className="flex items-center gap-1 text-[11px] text-red-600"><AlertTriangle className="w-3.5 h-3.5" /> {errorCount} lỗi</span>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden">
          {tab === 'preview' && (
            previewHtml
              ? <iframe title="preview" srcDoc={previewHtml} sandbox="allow-scripts" className="w-full h-full bg-white" />
              : <Placeholder text="Chưa có gì để xem. Nhắn AI tạo UI, hoặc bấm ⚡ Tạo nhanh." />
          )}

          {tab === 'regex' && (
            <div className="h-full overflow-y-auto scrollbar-thin p-3 space-y-2">
              {regexDraft.length === 0 ? (
                <Placeholder text="Chưa có regex script nào." />
              ) : (
                regexDraft.map((s, i) => (
                  <div key={i} className="rounded-lg border border-border bg-background p-2.5 text-xs">
                    <div className="font-semibold mb-1 flex items-center gap-1.5"><Code2 className="w-3.5 h-3.5 text-primary" /> {s.scriptName || `Script ${i + 1}`}</div>
                    <div className="font-mono text-[11px] text-muted-foreground break-all">findRegex: {s.findRegex}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">placement: {JSON.stringify(s.placement)} · markdownOnly: {String(s.markdownOnly)} · {formatBytes(s.replaceString.length)}</div>
                  </div>
                ))
              )}
              {validation && validation.issues.length > 0 && (
                <div className="mt-2 space-y-1">
                  {validation.issues.map((iss, k) => (
                    <div key={k} className={`text-[11px] rounded-md px-2 py-1.5 flex items-start gap-1.5 ${iss.level === 'error' ? 'bg-red-500/10 text-red-600' : 'bg-amber-500/10 text-amber-600'}`}>
                      {iss.level === 'error' ? <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> : <Info className="w-3 h-3 mt-0.5 shrink-0" />}
                      <span><b>{iss.code}</b>{iss.scriptIndex != null ? ` [#${iss.scriptIndex + 1}]` : ''}: {iss.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'sample' && (
            <div className="h-full flex flex-col p-3 gap-2">
              <div className="text-[11px] text-muted-foreground">Đoạn văn AI mẫu — regex phải match được đoạn này. Sửa tay được (AI cũng tự cập nhật).</div>
              <textarea
                value={sampleOutput}
                onChange={(e) => useGameStudioStore.getState().setSampleOutput(e.target.value)}
                placeholder="Vd: <status>\nHP: 80/100\nLevel: 5\n</status>"
                className="flex-1 resize-none rounded-lg border border-border bg-background p-2.5 text-xs font-mono scrollbar-thin focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="border-t border-border p-2.5 flex items-center gap-2 bg-card/60">
          <button onClick={quickBuild} disabled={!schema || busy} title={schema ? 'Sinh nhanh bằng template, không tốn API' : 'Cần có schema ở tab Schema trước'}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:border-amber-500 hover:bg-amber-500/5 disabled:opacity-40">
            <Zap className="w-3.5 h-3.5 text-amber-500" /> Tạo nhanh (không AI)
          </button>
          <div className="ml-auto" />
          <button onClick={apply} disabled={!canApply}
            title={canApply ? 'Thêm vào card.data.extensions.regex_scripts' : 'Cần regex đã qua kiểm (Đạt) mới apply'}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-medium disabled:opacity-40">
            {applied ? <><Check className="w-4 h-4" /> Đã thêm</> : <>Apply vào thẻ</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───
function MessageBubble({ msg }: { msg: ReturnType<typeof useGameStudioStore.getState>['messages'][number] }) {
  if (msg.role === 'system-note') {
    const tone = msg.tone === 'ok' ? 'bg-green-500/10 text-green-700 border-green-500/20'
      : msg.tone === 'error' ? 'bg-red-500/10 text-red-700 border-red-500/20'
      : 'bg-blue-500/10 text-blue-700 border-blue-500/20';
    return <div className={`text-[11px] rounded-lg border px-3 py-1.5 mx-auto max-w-[92%] text-center ${tone}`}>{msg.content}</div>;
  }
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${isUser ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-muted rounded-bl-sm'}`}>
        {msg.content}
        {msg.actions && msg.actions.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {msg.actions.map((a, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-background/60 border border-border font-mono">{a.label}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof Eye; label: string }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-md ${active ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted'}`}>
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );
}

function Placeholder({ text }: { text: string }) {
  return <div className="h-full flex items-center justify-center text-center text-xs text-muted-foreground px-6">{text}</div>;
}
