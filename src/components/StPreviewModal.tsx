import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks/useTranslation';
import { useUi } from '../i18n/useLocale';
import { X, Eye, AlertTriangle, Columns2 } from 'lucide-react';
import {
  extractRegexScripts, substituteMacros, applyDisplayRegex, buildPreviewHtml,
  extractInitvarText, buildLineMap, resolveErrorSource, extractHelperScriptsForPreview,
  type PreviewLineRange,
} from '../utils/stPreview';

interface ScriptErr {
  msg: string;
  side: string;
  /** Nguồn lỗi tra từ bản đồ dòng — regex/tin nhắn nào của card */
  source?: PreviewLineRange | null;
}

/**
 * 👁 XEM NHƯ SILLYTAVERN — công cụ cho DỊCH GIẢ:
 * - Render tin nhắn mở đầu sau macro + regex hiển thị (mặc định tĩnh, an toàn tuyệt đối).
 * - 🧪 Chạy script + data test từ [initvar] (giả lập TavernHelper/MVU) → thấy giao diện y như chơi.
 * - Lỗi script được TRA NGƯỢC về đúng regex/field của card + nút ↪ nhảy tới field để sửa bản dịch.
 * - ⇄ So 2 bản: Gốc | Đã dịch cạnh nhau — nhìn ngay khung nào mất data/vỡ giao diện sau dịch.
 */
export default function StPreviewModal({ onClose }: { onClose: () => void }) {
  const { card, proxy, setJumpToFieldPath, addToast } = useStore();
  const { getExportCard } = useTranslation();
  const ui = useUi() as Record<string, string>;

  const [side, setSide] = useState<'translated' | 'original'>('translated');
  const [split, setSplit] = useState(false);
  const [msgIdx, setMsgIdx] = useState(0); // 0 = first_mes, 1.. = alternate_greetings[i-1]
  const [runScripts, setRunScripts] = useState(false);
  const [scriptErrors, setScriptErrors] = useState<ScriptErr[]>([]);
  const [aiTestData, setAiTestData] = useState<string | null>(null); // 🎲 stat_data do AI tạo
  const [genLoading, setGenLoading] = useState(false);

  const exportCard = useMemo(() => {
    try { return getExportCard(); } catch { return null; }
    // getExportCard đọc fields từ store — memo theo lần mở modal là đủ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dựng srcdoc + bản đồ dòng cho 1 bên (Gốc / Đã dịch)
  const buildSide = (which: 'translated' | 'original') => {
    const activeCard: any = (which === 'translated' && exportCard) ? exportCard : card;
    const data = activeCard?.data || activeCard || {};
    const messages: { label: string; text: string; fieldPath?: string }[] = [
      { label: ui.spFirstMes, text: data.first_mes || '', fieldPath: 'data.first_mes' },
      ...((data.alternate_greetings || []) as string[]).map((g, i) => ({
        label: `${ui.spGreeting} ${i + 1}`, text: g, fieldPath: `data.alternate_greetings[${i}]`,
      })),
    ];
    const current = messages[Math.min(msgIdx, messages.length - 1)] || messages[0];
    const charName = data.name || 'Char';
    const scripts = extractRegexScripts(activeCard);
    const withMacros = substituteMacros(current.text, { user: 'User', char: charName });
    const { text: rendered, applied, appliedDetails } = applyDisplayRegex(withMacros, scripts);
    const sideLabel = which === 'translated' ? ui.spTranslated : ui.spOriginal;
    // (User 2026) Script TavernHelper của card (Norma, Thiên Ý…) — nạp vào preview như 酒馆助手.
    const helper = extractHelperScriptsForPreview(activeCard);
    // Data test: ưu tiên bản AI tạo (nếu có), không thì lấy [initvar] của card.
    const srcDoc = buildPreviewHtml(rendered, charName, {
      runScripts,
      initvarText: runScripts ? (aiTestData ?? extractInitvarText(activeCard)) : null,
      sideLabel,
      helperScripts: runScripts ? helper.runnable : undefined,
    });
    const lineMap = buildLineMap(srcDoc, appliedDetails, current.label, current.fieldPath);
    return { srcDoc, lineMap, applied, messages, sideLabel, helper };
  };

  const translatedSide = useMemo(buildSide.bind(null, 'translated'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [msgIdx, runScripts, card, exportCard, aiTestData]);
  const originalSide = useMemo(buildSide.bind(null, 'original'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [msgIdx, runScripts, card, aiTestData]);

  const genTestData = async () => {
    if (!card) return;
    setGenLoading(true);
    try {
      const { generateTestVariables } = await import('../utils/testDataGen');
      const res = await generateTestVariables(card as any, proxy);
      if (res) {
        setAiTestData(res.json);
        if (!runScripts) setRunScripts(true);
        addToast('success', ui.spGenOk);
      } else {
        addToast('info', ui.spGenNone);
      }
    } catch (e: any) {
      addToast('error', (ui.spGenErr || 'Lỗi tạo data test') + ': ' + (e?.message || e));
    } finally {
      setGenLoading(false);
    }
  };

  // Nhận lỗi script từ iframe → tra bản đồ dòng ra field nguồn
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data;
      if (!d || !d.__stPreviewError) return;
      const sideName = String(d.side || '');
      const map = sideName === (ui.spOriginal || 'Gốc') ? originalSide.lineMap : translatedSide.lineMap;
      const source = d.line ? resolveErrorSource(map, Number(d.line)) : null;
      setScriptErrors(prev => {
        const key = sideName + '|' + d.__stPreviewError;
        if (prev.length >= 20 || prev.some(e => e.side + '|' + e.msg === key)) return prev;
        return [...prev, { msg: String(d.__stPreviewError), side: sideName, source }];
      });
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [originalSide, translatedSide, ui.spOriginal]);

  // Đổi bản xem/tin nhắn/chế độ → xoá lỗi cũ
  useEffect(() => { setScriptErrors([]); }, [side, msgIdx, runScripts, split]);

  if (!card) return null;
  const messages = translatedSide.messages;
  const activeSide = side === 'translated' ? translatedSide : originalSide;

  const jumpTo = (path?: string) => {
    if (!path) return;
    setJumpToFieldPath(path);
    onClose();
  };

  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: '4px 12px', fontSize: '0.72rem', fontWeight: active ? 700 : 400, cursor: 'pointer',
    color: active ? 'var(--accent-primary)' : 'var(--text-muted)',
    background: active ? 'rgba(124,106,240,0.12)' : 'transparent',
    border: active ? '1px solid rgba(124,106,240,0.35)' : '1px solid transparent',
    borderRadius: 'var(--radius-sm)',
  });

  const iframeStyle: React.CSSProperties = {
    flex: 1, width: '100%', minWidth: 0,
    border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', background: '#1e1e2e',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        width: split ? 'min(1500px, 97vw)' : 'min(940px, 94vw)', height: 'min(86vh, 800px)',
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg-secondary)', border: '1px solid var(--accent-secondary)',
        borderRadius: 'var(--radius-md)', boxShadow: '0 12px 40px rgba(0,0,0,0.5)', padding: '14px 16px',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <Eye size={16} style={{ color: 'var(--accent-secondary)' }} />
          <span style={{ fontWeight: 700, fontSize: '0.9rem', flex: 1 }}>{ui.spTitle}</span>
          <label
            title={ui.spRunScriptsHint}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: '0.7rem',
              fontWeight: 600, padding: '3px 8px', borderRadius: 'var(--radius-sm)',
              border: `1px solid ${runScripts ? 'rgba(251,191,36,0.6)' : 'var(--border-subtle)'}`,
              color: runScripts ? '#fbbf24' : 'var(--text-muted)',
              background: runScripts ? 'rgba(251,191,36,0.08)' : 'transparent',
            }}
          >
            <input type="checkbox" checked={runScripts} onChange={(e) => setRunScripts(e.target.checked)} style={{ margin: 0 }} />
            {ui.spRunScripts}
          </label>
          <button
            onClick={genTestData}
            disabled={genLoading}
            title={ui.spGenHint}
            style={{
              padding: '3px 10px', fontSize: '0.7rem', fontWeight: 600, cursor: genLoading ? 'wait' : 'pointer',
              borderRadius: 'var(--radius-sm)', border: `1px solid ${aiTestData ? 'rgba(56,189,248,0.6)' : 'var(--border-subtle)'}`,
              color: aiTestData ? 'var(--accent-secondary)' : 'var(--text-muted)',
              background: aiTestData ? 'rgba(56,189,248,0.08)' : 'transparent', opacity: genLoading ? 0.6 : 1,
            }}
          >
            {genLoading ? ui.spGenLoading : (aiTestData ? `🎲 ${ui.spGenDone}` : ui.spGenBtn)}
          </button>
          <button style={tabBtn(split)} title={ui.spSplitHint} onClick={() => setSplit(v => !v)}>
            <Columns2 size={11} style={{ verticalAlign: '-2px' }} /> {ui.spSplit}
          </button>
          {!split && (
            <div style={{ display: 'flex', gap: 4 }}>
              <button style={tabBtn(side === 'original')} onClick={() => setSide('original')}>{ui.spOriginal}</button>
              <button style={tabBtn(side === 'translated')} onClick={() => setSide('translated')}>{ui.spTranslated}</button>
            </div>
          )}
          <select
            className="input"
            value={msgIdx}
            onChange={(e) => setMsgIdx(Number(e.target.value))}
            style={{ fontSize: '0.72rem', padding: '4px 8px', maxWidth: 210 }}
          >
            {messages.map((m, i) => <option key={i} value={i}>{m.label}</option>)}
          </select>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
            <X size={16} />
          </button>
        </div>

        {/* Ghi chú chế độ + regex đã áp + script card đã nạp */}
        <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
          {runScripts ? ui.spScriptNote : ui.spStaticNote}
          {activeSide.applied.length > 0 && <> · {ui.spApplied} {activeSide.applied.slice(0, 5).join(', ')}{activeSide.applied.length > 5 ? '…' : ''}</>}
          {runScripts && activeSide.helper.runnable.length > 0 && (
            <> · <span style={{ color: '#4ade80' }}>{ui.spHelperRan} {activeSide.helper.runnable.map(s => s.name).join(', ')}</span></>
          )}
          {runScripts && activeSide.helper.skipped.length > 0 && (
            <> · <span title={ui.spHelperSkippedTip}>{ui.spHelperSkipped} {activeSide.helper.skipped.join(', ')}</span></>
          )}
        </div>

        {/* Lỗi script — tra ra field nguồn + nút nhảy tới sửa */}
        {runScripts && scriptErrors.length > 0 && (
          <div style={{
            marginBottom: 8, padding: '6px 10px', maxHeight: 110, overflow: 'auto',
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)',
            borderRadius: 'var(--radius-sm)', fontSize: '0.66rem', color: 'var(--text-secondary)',
          }}>
            <b style={{ color: 'var(--accent-danger)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <AlertTriangle size={11} /> {ui.spScriptErrors} ({scriptErrors.length})
            </b>
            {scriptErrors.map((e, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
                {split && e.side && (
                  <span style={{ flexShrink: 0, fontSize: '0.58rem', fontWeight: 700, color: '#fbbf24' }}>[{e.side}]</span>
                )}
                <span style={{ fontFamily: 'monospace', minWidth: 0, overflowWrap: 'anywhere' }}>{e.msg}</span>
                {e.source && (
                  <span style={{ flexShrink: 0 }}>
                    → <b>{e.source.label}</b>
                    {e.source.fieldPath && (
                      <button
                        onClick={() => jumpTo(e.source!.fieldPath)}
                        style={{ marginLeft: 4, padding: '0 6px', fontSize: '0.62rem', fontWeight: 700, cursor: 'pointer', color: '#fff', background: 'var(--accent-primary)', border: 'none', borderRadius: '3px' }}
                      >
                        ↪ {ui.spJumpToField}
                      </button>
                    )}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* iframe: mặc định sandbox rỗng; 🧪 → allow-scripts nhưng vẫn KHÔNG same-origin (cách ly) */}
        {split ? (
          <div style={{ flex: 1, display: 'flex', gap: 8, minHeight: 0 }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div style={{ fontSize: '0.66rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 3 }}>{ui.spOriginal}</div>
              <iframe key={`o-${msgIdx}-${runScripts ? 's' : 'n'}`} title="ST preview original"
                sandbox={runScripts ? 'allow-scripts' : ''} srcDoc={originalSide.srcDoc} style={iframeStyle} />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div style={{ fontSize: '0.66rem', fontWeight: 700, color: 'var(--accent-primary)', marginBottom: 3 }}>{ui.spTranslated}</div>
              <iframe key={`t-${msgIdx}-${runScripts ? 's' : 'n'}`} title="ST preview translated"
                sandbox={runScripts ? 'allow-scripts' : ''} srcDoc={translatedSide.srcDoc} style={iframeStyle} />
            </div>
          </div>
        ) : (
          <iframe
            key={`${side}-${msgIdx}-${runScripts ? 's' : 'n'}`}
            title="SillyTavern preview"
            sandbox={runScripts ? 'allow-scripts' : ''}
            srcDoc={activeSide.srcDoc}
            style={iframeStyle}
          />
        )}
      </div>
    </div>
  );
}
