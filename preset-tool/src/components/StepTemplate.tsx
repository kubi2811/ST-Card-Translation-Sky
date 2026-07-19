/**
 * StepTemplate — "Tool tạo Template Preset".
 *
 * Nhập bối cảnh/thể loại/chủ đề cốt truyện → xuất ra cấu hình System Prompt hoàn chỉnh, chia
 * thành 5 Khối độc lập bọc nhãn [TÊN_KHỐI_START]/[TÊN_KHỐI_END], rồi nạp thẳng thành 5 prompt
 * block riêng trong preset.
 *
 * Hai chế độ sinh:
 *  - "Tạo mẫu" — logic thuần, CHẠY NGAY, không cần API key.
 *  - "Tạo bằng AI" — gửi bản mẫu + bối cảnh cho AI may đo lại theo thể loại.
 */
import React, { useMemo, useState } from 'react';
import { useApp } from '../storeContext';
import { callAI } from '../utils/ai';
import { usePersistedState } from '../utils/usePersistedState';
import {
  buildTemplate,
  parseTemplateBlocks,
  validateTemplate,
  BLOCK_ORDER,
  BLOCK_TITLE,
  BLOCK_INDEX,
  type TemplateBlockId,
  type TemplateContext,
} from '../utils/templateBlocks';
import { buildTemplateSystemPrompt, buildTemplateUserMessage } from '../utils/templatePrompt';
import { Wand2, Sparkles, Copy, Download, Loader2, CheckCircle2, AlertTriangle, Square } from 'lucide-react';
import { t, fmt } from '../i18n';

const POV_OPTIONS: { value: NonNullable<TemplateContext['pov']>; label: string }[] = [
  { value: 'third_limited', label: t.tplPovThirdLimited },
  { value: 'third_omniscient', label: t.tplPovThirdOmni },
  { value: 'first', label: t.tplPovFirst },
];

export const StepTemplate: React.FC = () => {
  const { settings, addPromptBlock, addToast } = useApp();

  // Đổi tab trong workspace là component bị unmount → phải LƯU, không thì soạn xong bối cảnh
  // dài rồi qua tab Prompts xem một cái là mất trắng. (Set không JSON hoá được nên lưu dạng mảng.)
  const [context, setContext] = usePersistedState('tpl.context', '');
  const [genre, setGenre] = usePersistedState('tpl.genre', '');
  const [pov, setPov] = usePersistedState<NonNullable<TemplateContext['pov']>>('tpl.pov', 'third_limited');
  const [minPara, setMinPara] = usePersistedState('tpl.minPara', 3);
  const [maxPara, setMaxPara] = usePersistedState('tpl.maxPara', 5);
  const [offList, setOffList] = usePersistedState<TemplateBlockId[]>('tpl.off', []);
  const off = useMemo(() => new Set(offList), [offList]);

  const [output, setOutput] = usePersistedState('tpl.output', '');
  const [busy, setBusy] = useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  const ctx: TemplateContext = useMemo(
    () => ({
      context,
      genre,
      pov,
      paragraphs: { min: minPara, max: maxPara },
      blocks: Object.fromEntries(BLOCK_ORDER.map(id => [id, !off.has(id)])) as TemplateContext['blocks'],
    }),
    [context, genre, pov, minPara, maxPara, off],
  );

  const wanted = BLOCK_ORDER.filter(id => !off.has(id));
  const issues = output ? validateTemplate(output, wanted) : [];
  const parsed = output ? parseTemplateBlocks(output) : [];

  const toggleBlock = (id: TemplateBlockId) => {
    setOffList(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const handleBuildLocal = () => {
    if (!context.trim()) {
      addToast(t.tplNeedContext, 'warning');
      return;
    }
    setOutput(buildTemplate(ctx));
    addToast(t.tplBuiltLocal, 'success');
  };

  const handleBuildAI = async () => {
    if (!context.trim()) {
      addToast(t.tplNeedContext, 'warning');
      return;
    }
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      // Chỉ thị "công cụ thiết kế preset" đi qua systemPromptAddition — không đụng vào cấu hình
      // chat thường của người dùng (truyền bản sao settings).
      const reply = await callAI(
        buildTemplateUserMessage(ctx),
        [],
        { ...settings, keepContext: false, systemPromptAddition: buildTemplateSystemPrompt() },
        '',
        '',
        ctrl.signal,
      );
      const got = parseTemplateBlocks(reply);
      if (got.length === 0) {
        // AI trả về không đúng khung → giữ nguyên văn để người dùng tự xử, kèm cảnh báo thật.
        setOutput(reply);
        addToast(t.tplAiNoBlocks, 'warning');
      } else {
        setOutput(reply.trim());
        addToast(fmt(t.tplAiOk, { count: got.length }), 'success');
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') addToast(t.tplStopped, 'info');
      else addToast(fmt(t.tplAiErr, { msg: err instanceof Error ? err.message : String(err) }), 'error');
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const handleApply = () => {
    if (parsed.length === 0) {
      addToast(t.tplNothingToApply, 'warning');
      return;
    }
    parsed.forEach((b, i) => {
      addPromptBlock({
        identifier: `tpl-${b.id.toLowerCase()}`,
        name: `${BLOCK_INDEX[b.id]}. ${BLOCK_TITLE[b.id].replace(/^\d+\.\s*/, '')}`,
        role: 'system',
        system_prompt: true,
        content: b.content,
        enabled: true,
        injection_position: 0,
        injection_depth: 4,
        // Giữ đúng thứ tự khối trong preset (biến phải khai báo trước khi khối 3 GetVar).
        injection_order: 100 + i,
        forbid_overrides: false,
      });
    });
    addToast(fmt(t.tplApplied, { count: parsed.length }), 'success');
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(output);
    addToast(t.tplCopied, 'success');
  };

  const handleDownload = () => {
    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `template-preset-${(genre || 'custom').replace(/\s+/g, '-').toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const inputCls =
    'w-full bg-gray-900 border border-theme-border rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-400 transition';

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <Wand2 size={16} className="text-purple-400" /> {t.tplTitle}
        </h2>
        <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{t.tplSubtitle}</p>
      </div>

      {/* ─── Nhập bối cảnh ─── */}
      <div className="space-y-3 bg-gray-900/40 border border-theme-border rounded-xl p-4">
        <div>
          <label className="block text-[11px] font-bold text-gray-400 mb-1.5">{t.tplContextLabel}</label>
          <textarea
            value={context}
            onChange={e => setContext(e.target.value)}
            rows={5}
            placeholder={t.tplContextPh}
            className={`${inputCls} resize-y leading-relaxed`}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-bold text-gray-400 mb-1.5">{t.tplGenreLabel}</label>
            <input value={genre} onChange={e => setGenre(e.target.value)} placeholder={t.tplGenrePh} className={inputCls} />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-gray-400 mb-1.5">{t.tplPovLabel}</label>
            <select value={pov} onChange={e => setPov(e.target.value as typeof pov)} className={inputCls}>
              {POV_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-gray-400 mb-1.5">{t.tplParaLabel}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={20}
                value={minPara}
                onChange={e => setMinPara(Math.max(1, Number(e.target.value) || 1))}
                className={inputCls}
              />
              <span className="text-gray-600 text-xs">–</span>
              <input
                type="number"
                min={1}
                max={20}
                value={maxPara}
                onChange={e => setMaxPara(Math.max(1, Number(e.target.value) || 1))}
                className={inputCls}
              />
            </div>
          </div>
        </div>

        {/* Bật/tắt từng khối */}
        <div>
          <label className="block text-[11px] font-bold text-gray-400 mb-1.5">{t.tplBlocksLabel}</label>
          <div className="flex flex-wrap gap-2">
            {BLOCK_ORDER.map(id => {
              const on = !off.has(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleBlock(id)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition ${
                    on
                      ? 'bg-purple-500/15 border-purple-500/40 text-purple-300'
                      : 'bg-gray-950 border-theme-border text-gray-600 line-through'
                  }`}
                >
                  {BLOCK_TITLE[id]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={handleBuildLocal}
            disabled={busy}
            className="flex items-center gap-1.5 bg-purple-500 hover:bg-purple-600 disabled:opacity-40 text-white text-xs font-bold px-3.5 py-2 rounded-lg transition"
          >
            <Wand2 size={13} /> {t.tplBuildLocal}
          </button>
          {busy ? (
            <button
              onClick={() => abortRef.current?.abort()}
              className="flex items-center gap-1.5 bg-red-500/20 border border-red-500/40 text-red-300 text-xs font-bold px-3.5 py-2 rounded-lg transition hover:bg-red-500/30"
            >
              <Square size={13} /> {t.tplStop}
            </button>
          ) : (
            <button
              onClick={handleBuildAI}
              className="flex items-center gap-1.5 bg-gray-900 border border-theme-border hover:border-purple-500/40 text-gray-200 text-xs font-bold px-3.5 py-2 rounded-lg transition"
            >
              <Sparkles size={13} className="text-purple-400" /> {t.tplBuildAi}
            </button>
          )}
          {busy && (
            <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
              <Loader2 size={13} className="animate-spin" /> {t.tplWorking}
            </span>
          )}
        </div>
        <p className="text-[10px] text-gray-600 leading-relaxed">{t.tplBuildHint}</p>
      </div>

      {/* ─── Kết quả ─── */}
      {output && (
        <div className="space-y-3">
          {/* Tình trạng khối */}
          <div className="flex flex-wrap items-center gap-2">
            {wanted.map(id => {
              const issue = issues.find(i => i.id === id);
              const ok = !issue;
              return (
                <span
                  key={id}
                  title={issue ? t[`tplIssue_${issue.kind}` as keyof typeof t] : t.tplBlockOk}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold border ${
                    ok
                      ? 'bg-green-500/10 border-green-500/30 text-green-400'
                      : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                  }`}
                >
                  {ok ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                  {BLOCK_TITLE[id]}
                </span>
              );
            })}
          </div>

          <textarea
            value={output}
            onChange={e => setOutput(e.target.value)}
            rows={20}
            spellCheck={false}
            className={`${inputCls} font-mono text-[11px] leading-relaxed resize-y`}
          />

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleApply}
              disabled={parsed.length === 0}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold px-3.5 py-2 rounded-lg transition"
            >
              <Download size={13} /> {fmt(t.tplApplyBtn, { count: parsed.length })}
            </button>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 bg-gray-900 border border-theme-border hover:border-gray-700 text-gray-200 text-xs font-bold px-3.5 py-2 rounded-lg transition"
            >
              <Copy size={13} /> {t.tplCopy}
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 bg-gray-900 border border-theme-border hover:border-gray-700 text-gray-200 text-xs font-bold px-3.5 py-2 rounded-lg transition"
            >
              <Download size={13} /> {t.tplDownload}
            </button>
          </div>
          <p className="text-[10px] text-gray-600 leading-relaxed">{t.tplApplyHint}</p>
        </div>
      )}
    </div>
  );
};
