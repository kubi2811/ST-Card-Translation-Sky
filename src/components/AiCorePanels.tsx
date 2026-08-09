/**
 * src/components/AiCorePanels.tsx — (bug 218) BA PANEL MỚI CỦA TRỢ LÝ AI.
 * ─────────────────────────────────────────────────────────────────────────────
 * Tách khỏi AiCompanionPanel.tsx (đã 5.270 dòng) — nhét thêm ba panel nữa vào đó thì file thành
 * chỗ không ai dám mở ra sửa.
 *
 *   ⚙️ System Prompt Core — xem ĐÚNG chuỗi sắp gửi đi, tách theo tầng, bật/tắt và đổi thứ tự,
 *      kèm số token từng tầng. Trước đây prompt là một template literal giữa hàm gửi tin, không
 *      ai nhìn thấy nó.
 *   🧩 Kho Kỹ Năng — nạp gói skill từ repo GitHub (mẫu oh-my-claudecode) hoặc dán tay.
 *   📌 Hội thoại đã ghim — ghim/bỏ ghim, tick NHIỀU cuộc cho Trợ Lý nhớ, và nói thẳng cho người
 *      dùng biết bỏ tick thì Trợ Lý quên những gì.
 *
 * Dùng chung ngôn ngữ hình ảnh với panel Ký ức ngay bên cạnh: lớp phủ đen, khung #0b0b0f bo góc,
 * chữ nhỏ, nút viền mảnh.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, Trash2, Download, Upload, GripVertical, RefreshCw } from 'lucide-react';
import {
  buildLayers, composeSystemPrompt, layerStats, normalizeOrder, DEFAULT_LAYER_ORDER,
  type BuildLayersInput, type LayerId,
} from '../utils/promptCore';
import {
  listSkills, deleteSkill, deletePack, setSkillEnabled, installSkillFiles,
  parseRepoUrl, packNameOf, fetchSkillFilesFromRepo, type SkillRecord,
} from '../utils/skillStore';
import {
  listConversations, setConversationPinned, setConversationRemembered, deleteConversation,
  type ConversationRecord, type RevokeResult,
} from '../utils/conversationStore';

/* ═══════════════ khung chung ═══════════════ */

function Shell({ title, sub, onClose, children, footer, wide }: {
  title: string; sub?: string; onClose: () => void;
  children: React.ReactNode; footer?: React.ReactNode; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className={`bg-[#0b0b0f] border border-zinc-800 rounded-2xl w-full ${wide ? 'max-w-4xl' : 'max-w-2xl'} max-h-[85vh] flex flex-col shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between gap-2">
          <span className="font-bold text-sm text-slate-200">{title}</span>
          <button onClick={onClose} className="p-1 hover:bg-zinc-800 rounded text-slate-400 hover:text-white"><X size={14} /></button>
        </div>
        {sub && <div className="text-[9px] text-slate-500 px-4 py-1.5 border-b border-zinc-850">{sub}</div>}
        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">{children}</div>
        {footer && <div className="px-4 py-2 border-t border-zinc-800">{footer}</div>}
      </div>
    </div>
  );
}

const btn = 'px-2 py-0.5 rounded text-[10px] border bg-zinc-800/40 border-zinc-700 hover:bg-zinc-700/50 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed';
const btnDanger = 'px-2 py-0.5 rounded text-[10px] border bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/20 text-rose-300 disabled:opacity-40 disabled:cursor-not-allowed';

/* ═══════════════ ⚙️ SYSTEM PROMPT CORE ═══════════════ */

export const PROMPT_CORE_DISABLED_KEY = 'ai_prompt_core_disabled';
export const PROMPT_CORE_ORDER_KEY = 'ai_prompt_core_order';

export function loadCoreSettings(): { disabled: LayerId[]; order: LayerId[] } {
  const read = <T,>(k: string, fb: T): T => {
    try { const s = localStorage.getItem(k); return s ? JSON.parse(s) as T : fb; } catch { return fb; }
  };
  return {
    disabled: read<LayerId[]>(PROMPT_CORE_DISABLED_KEY, []),
    order: normalizeOrder(read<LayerId[]>(PROMPT_CORE_ORDER_KEY, DEFAULT_LAYER_ORDER)),
  };
}

export function PromptCoreModal({ onClose, snapshot }: {
  onClose: () => void;
  /** Ảnh chụp NGUYÊN LIỆU của lượt kế tiếp — panel dựng lại đúng chuỗi hàm gửi tin sẽ dựng. */
  snapshot: BuildLayersInput;
}) {
  const [disabled, setDisabled] = useState<LayerId[]>(() => loadCoreSettings().disabled);
  const [order, setOrder] = useState<LayerId[]>(() => loadCoreSettings().order);
  const [xemThat, setXemThat] = useState(false);

  useEffect(() => { try { localStorage.setItem(PROMPT_CORE_DISABLED_KEY, JSON.stringify(disabled)); } catch { /* quota */ } }, [disabled]);
  useEffect(() => { try { localStorage.setItem(PROMPT_CORE_ORDER_KEY, JSON.stringify(order)); } catch { /* quota */ } }, [order]);

  const layers = useMemo(() => buildLayers({ ...snapshot, disabled, order }), [snapshot, disabled, order]);
  const { rows, totalTokens, totalChars } = useMemo(() => layerStats(layers), [layers]);
  const full = useMemo(() => composeSystemPrompt(layers), [layers]);

  const toggle = (id: LayerId) =>
    setDisabled((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  const move = (id: LayerId, delta: number) =>
    setOrder((o) => {
      const i = o.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= o.length) return o;
      const next = [...o];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <Shell
      wide
      title="⚙️ System Prompt Core"
      sub="Đây là toàn bộ chỉ dẫn Trợ Lý nhận được ở lượt tới, tách theo tầng. Tắt một tầng là lượt sau Trợ Lý không còn thấy phần đó nữa."
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-slate-500">
            Tổng: <b className="text-slate-300">{totalChars.toLocaleString()}</b> ký tự ·
            ~<b className="text-slate-300">{totalTokens.toLocaleString()}</b> token
          </span>
          <div className="flex gap-1.5">
            <button className={btn} onClick={() => { setDisabled([]); setOrder(DEFAULT_LAYER_ORDER); }}>
              <RefreshCw size={10} className="inline mr-1" />Về mặc định
            </button>
            <button className={btn} onClick={() => setXemThat((v) => !v)}>
              {xemThat ? '▲ Ẩn chuỗi thật' : '▼ Xem chuỗi thật sẽ gửi'}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-1.5">
        {layers.map((l, idx) => {
          const st = rows.find((r) => r.id === l.id)!;
          return (
            <div key={l.id} className={`border rounded-lg px-2.5 py-2 ${l.enabled ? 'bg-zinc-900/50 border-zinc-800/70' : 'bg-zinc-900/20 border-zinc-800/40 opacity-60'}`}>
              <div className="flex items-start gap-2">
                <div className="flex flex-col gap-0.5 pt-0.5">
                  <button className="text-slate-600 hover:text-slate-300 leading-none disabled:opacity-20" disabled={idx === 0} onClick={() => move(l.id, -1)} title="Lên một bậc">▲</button>
                  <button className="text-slate-600 hover:text-slate-300 leading-none disabled:opacity-20" disabled={idx === layers.length - 1} onClick={() => move(l.id, 1)} title="Xuống một bậc">▼</button>
                </div>
                <GripVertical size={12} className="text-slate-700 mt-1 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-bold text-slate-200">{idx + 1}. {l.label}</span>
                    {l.locked && <span className="text-[8px] px-1 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300">KHOÁ</span>}
                    {st.empty
                      ? <span className="text-[8px] px-1 rounded border border-zinc-700 text-slate-500">lượt này trống</span>
                      : <span className="text-[8px] px-1 rounded border border-sky-500/30 bg-sky-500/10 text-sky-300">
                          {st.chars.toLocaleString()} ký tự · ~{st.tokens.toLocaleString()} token · {st.percent}%
                        </span>}
                  </div>
                  <div className="text-[9px] text-slate-500 mt-0.5">{l.why}</div>
                  {!st.empty && (
                    <details className="mt-1">
                      <summary className="text-[9px] text-indigo-400 cursor-pointer select-none">Xem nội dung tầng này</summary>
                      <pre className="text-[9px] text-slate-400 whitespace-pre-wrap break-words mt-1 max-h-40 overflow-y-auto custom-scrollbar bg-black/30 rounded p-1.5">
                        {l.content}
                      </pre>
                    </details>
                  )}
                </div>
                <label className="flex items-center gap-1 flex-shrink-0" title={l.locked ? 'Tầng lõi không tắt được — tắt là Trợ Lý mất luật an toàn.' : 'Bật/tắt tầng này'}>
                  <input type="checkbox" checked={l.enabled} disabled={l.locked} onChange={() => toggle(l.id)} />
                </label>
              </div>
            </div>
          );
        })}
      </div>

      {xemThat && (
        <div className="mt-3">
          <div className="text-[10px] text-slate-400 mb-1">Chuỗi thật gửi kèm mọi tin nhắn ở lượt tới:</div>
          <pre className="text-[9px] text-slate-300 whitespace-pre-wrap break-words bg-black/40 border border-zinc-800 rounded-lg p-2 max-h-72 overflow-y-auto custom-scrollbar">
            {full || '(rỗng — mọi tầng đều tắt hoặc không có nội dung)'}
          </pre>
        </div>
      )}
    </Shell>
  );
}

/* ═══════════════ 🧩 KHO KỸ NĂNG ═══════════════ */

export function SkillStoreModal({ onClose, cardKey }: { onClose: () => void; cardKey?: string }) {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [repoUrl, setRepoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [paste, setPaste] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try { setSkills(await listSkills({})); } catch (e) { console.warn('[skill] load lỗi', e); }
    setLoading(false);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const napRepo = async () => {
    const ref = parseRepoUrl(repoUrl);
    if (!ref) { setMsg({ ok: false, text: 'Không đọc được địa chỉ. Dán link GitHub hoặc dạng chu-repo/ten-repo.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const files = await fetchSkillFilesFromRepo(ref);
      const r = await installSkillFiles(files, packNameOf(ref), { cardKey });
      setMsg({ ok: true, text: `Đã nạp ${r.added} kỹ năng mới, cập nhật ${r.updated}${r.skipped ? `, bỏ qua ${r.skipped} file rỗng` : ''}.` });
      setRepoUrl('');
      await reload();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Nạp thất bại.' });
    }
    setBusy(false);
  };

  const napDanTay = async () => {
    if (!paste.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const r = await installSkillFiles([{ fileName: 'dan-tay.md', content: paste }], 'dán tay', { cardKey });
      setMsg({ ok: true, text: r.added ? 'Đã thêm 1 kỹ năng.' : r.updated ? 'Đã cập nhật kỹ năng trùng tên.' : 'File không có nội dung.' });
      setPaste('');
      await reload();
    } catch (e: any) { setMsg({ ok: false, text: e?.message || 'Lỗi.' }); }
    setBusy(false);
  };

  const napFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files || []);
    if (!list.length) return;
    setBusy(true); setMsg(null);
    try {
      const files = await Promise.all(list.map(async (f) => ({ fileName: f.name, content: await f.text() })));
      const r = await installSkillFiles(files, 'từ máy', { cardKey });
      setMsg({ ok: true, text: `Đã nạp ${r.added} mới, cập nhật ${r.updated}.` });
      await reload();
    } catch (err: any) { setMsg({ ok: false, text: err?.message || 'Lỗi đọc file.' }); }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const packs = useMemo(() => {
    const m = new Map<string, SkillRecord[]>();
    for (const s of skills) m.set(s.pack, [...(m.get(s.pack) || []), s]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [skills]);

  return (
    <Shell
      wide
      title="🧩 Kho Kỹ Năng"
      sub="Kỹ năng là file .md có frontmatter (name / description / triggers). Chỉ kỹ năng có từ khoá trùng câu bạn vừa gõ mới được chèn vào prompt — nên nạp nhiều cũng không làm phình mọi lượt."
      onClose={onClose}
    >
      <div className="space-y-2 mb-3">
        <div className="flex gap-1.5">
          <input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/yeachan-heo/oh-my-claudecode/tree/main/skills"
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-slate-200"
          />
          <button className={btn} disabled={busy || !repoUrl.trim()} onClick={napRepo}>
            {busy ? <Loader2 size={10} className="inline animate-spin" /> : <Download size={10} className="inline mr-1" />}Nạp từ repo
          </button>
        </div>
        <div className="text-[9px] text-slate-500">
          Dán link THƯ MỤC chứa các file .md (chỉ đọc một tầng, không đi sâu vào thư mục con).
        </div>
        <div className="flex gap-1.5">
          <button className={btn} onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload size={10} className="inline mr-1" />Nạp file .md từ máy
          </button>
          <input ref={fileRef} type="file" accept=".md,.mdx" multiple className="hidden" onChange={napFile} />
        </div>
        <details>
          <summary className="text-[10px] text-indigo-400 cursor-pointer select-none">Hoặc dán nội dung một kỹ năng</summary>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={6}
            placeholder={'---\nname: Sửa lỗi biến MVU\ndescription: khi thẻ báo 变量更新失败\ntriggers: ["mvu", "变量更新失败"]\n---\nKiểm [initvar] trước, đối chiếu tên biến với stat_data…'}
            className="w-full mt-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[10px] font-mono text-slate-200"
          />
          <button className={btn} disabled={busy || !paste.trim()} onClick={napDanTay}>Thêm kỹ năng này</button>
        </details>
        {msg && (
          <div className={`text-[10px] px-2 py-1 rounded border ${msg.ok ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' : 'text-rose-300 border-rose-500/30 bg-rose-500/10'}`}>
            {msg.text}
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center py-8 text-slate-500 text-xs"><Loader2 size={16} className="animate-spin inline mr-2" />…</div>
      ) : skills.length === 0 ? (
        <div className="text-center py-8 text-slate-500 text-xs">Kho trống — nạp một gói ở trên để bắt đầu.</div>
      ) : (
        packs.map(([pack, list]) => (
          <div key={pack} className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-slate-300">{pack} <span className="text-slate-600">({list.length})</span></span>
              <button
                className={btnDanger}
                onClick={async () => {
                  if (!window.confirm(`Gỡ cả gói "${pack}" (${list.length} kỹ năng)?`)) return;
                  await deletePack(pack);
                  await reload();
                }}
              ><Trash2 size={10} className="inline mr-1" />Gỡ cả gói</button>
            </div>
            <div className="space-y-1">
              {list.map((s) => (
                <div key={s.id} className="flex items-start gap-2 bg-zinc-900/50 border border-zinc-800/70 rounded-lg px-2.5 py-1.5 group">
                  <input
                    type="checkbox" checked={s.enabled} className="mt-1"
                    title={s.enabled ? 'Đang bật' : 'Đang tắt — không bao giờ chèn vào prompt'}
                    onChange={async () => { await setSkillEnabled(s.id, !s.enabled); await reload(); }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-slate-200 font-medium">{s.name}</div>
                    {s.description && <div className="text-[9px] text-slate-500">{s.description}</div>}
                    <div className="text-[8px] text-slate-600 mt-0.5">
                      {s.triggers.length
                        ? <>từ khoá: {s.triggers.map((t) => <span key={t} className="inline-block px-1 mr-1 rounded bg-zinc-800 text-slate-400">{t}</span>)}</>
                        : <span className="text-amber-500/80">chưa có từ khoá — kỹ năng này sẽ KHÔNG bao giờ tự chèn</span>}
                    </div>
                  </div>
                  <button
                    className="text-slate-600 opacity-0 group-hover:opacity-100 hover:text-rose-400 flex-shrink-0"
                    title="Xoá kỹ năng này"
                    onClick={async () => { await deleteSkill(s.id); await reload(); }}
                  ><Trash2 size={11} /></button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </Shell>
  );
}

/* ═══════════════ 📌 HỘI THOẠI ĐÃ GHIM ═══════════════ */

export function RememberedChatsModal({ onClose, onOpenConversation }: {
  onClose: () => void;
  onOpenConversation?: (c: ConversationRecord) => void;
}) {
  const [rows, setRows] = useState<ConversationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try { setRows(await listConversations({})); } catch (e) { console.warn('[conv] load lỗi', e); }
    setLoading(false);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  /** Nói THẲNG cho người dùng biết vừa quên mất những gì — đây là điểm user dặn phải cẩn thận. */
  const bao = (r: RevokeResult) => {
    if (r.deleted === 0 && r.keptPinned === 0) { setNote(''); return; }
    setNote(
      `Trợ Lý đã quên ${r.deleted} ký ức rút ra từ cuộc này.`
      + (r.keptPinned ? ` Giữ lại ${r.keptPinned} ký ức bạn đã tự ghim riêng trong panel Ký ức.` : ''),
    );
  };

  const soNho = rows.filter((c) => c.remembered).length;

  return (
    <Shell
      wide
      title="📌 Hội thoại đã lưu"
      sub="Tick “Cho AI nhớ” ở nhiều cuộc cùng lúc — chúng sẽ được nạp vào đầu Trợ Lý ở mọi lượt sau. Bỏ tick, bỏ ghim hoặc xoá cuộc thì Trợ Lý QUÊN THẬT: cả nội dung lẫn những ký ức đã rút ra từ nó."
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-slate-500">
            {rows.length} cuộc đã lưu · <b className="text-slate-300">{soNho}</b> cuộc đang được nhớ
          </span>
          {note && <span className="text-[10px] text-amber-300">{note}</span>}
        </div>
      }
    >
      {loading ? (
        <div className="text-center py-8 text-slate-500 text-xs"><Loader2 size={16} className="animate-spin inline mr-2" />…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-8 text-slate-500 text-xs">Chưa có cuộc nào được lưu. Bấm ghim ở khung chat để lưu cuộc đang nói.</div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((c) => (
            <div key={c.id} className="flex items-start gap-2 bg-zinc-900/50 border border-zinc-800/70 rounded-lg px-2.5 py-1.5 group">
              <button
                title={c.pinned ? 'Đang ghim — bấm để bỏ ghim (Trợ Lý sẽ quên cuộc này)' : 'Ghim cuộc này'}
                className={`text-[13px] flex-shrink-0 ${c.pinned ? 'text-amber-300' : 'text-slate-600 hover:text-slate-300'}`}
                onClick={async () => { bao(await setConversationPinned(c.id, !c.pinned)); await reload(); }}
              >📌</button>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-slate-200 break-words" style={{ overflowWrap: 'anywhere' }}>{c.title}</div>
                <div className="text-[8px] text-slate-500 mt-0.5">
                  {c.messages.length} tin nhắn · {new Date(c.updatedAt).toLocaleString('vi-VN')}
                  {c.cardKey ? ` · ${c.cardKey}` : ''}
                </div>
              </div>
              <label className="flex items-center gap-1 text-[9px] text-slate-400 flex-shrink-0" title="Nạp cuộc này vào đầu Trợ Lý ở mọi lượt sau">
                <input
                  type="checkbox" checked={!!c.remembered}
                  onChange={async () => { bao(await setConversationRemembered(c.id, !c.remembered)); await reload(); }}
                />
                Cho AI nhớ
              </label>
              {onOpenConversation && (
                <button className={btn} onClick={() => onOpenConversation(c)} title="Mở lại cuộc này trong khung chat">Mở</button>
              )}
              <button
                className="text-slate-600 opacity-0 group-hover:opacity-100 hover:text-rose-400 flex-shrink-0"
                title="Xoá hẳn cuộc này + mọi ký ức rút ra từ nó"
                onClick={async () => {
                  if (!window.confirm(`Xoá "${c.title}"?\n\nTrợ Lý sẽ quên cả nội dung lẫn những ký ức đã rút ra từ cuộc này.`)) return;
                  bao(await deleteConversation(c.id));
                  await reload();
                }}
              ><Trash2 size={11} /></button>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}
