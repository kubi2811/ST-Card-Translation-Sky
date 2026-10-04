/**
 * (bug 239 + 240) TIẾN ĐỘ DỊCH LINK NGOÀI — từng mảnh, đọc thẳng từ field trong store.
 *
 * User (gogopikachu): "khi dịch link ngoài với t/h phải chia chunk thì tiến độ không thể quan sát
 * được (bên F12 có thể thấy tiến độ chunk) và cũng không thể kiểm tra tình trạng chunk, độ match,
 * số lượng chữ Hán còn lại."
 *
 * Engine vốn đã ghi `rawChunks` / `completedChunks` / `totalChunks` / `failedChunkIndex` vào field
 * theo từng mảnh — chỉ là tab Link ngoài chưa bao giờ đọc ra. Field nằm trong store chính nên
 * thoát Regex Manager rồi vào lại vẫn thấy đúng tiến độ, kể cả khi lượt dịch vẫn đang chạy.
 */
import { useMemo, useState, useEffect } from 'react';
import { useStore } from '../store';
import type { TranslationField } from '../types/card';
import { auditChunks } from '../utils/chunkAudit';
import { countResidualHan } from '../utils/residualCjkScan';
import TranslateActivityLog from './TranslateActivityLog';
import { useUi } from '../i18n/useLocale';
import { fmt } from '../i18n';
import { Check, X, Loader2, ChevronDown, ChevronRight } from 'lucide-react';

interface Props {
  field: TranslationField;
  /** fieldName mà engine dùng để bắn nhật ký (chính là label của field). */
  label: string;
}

export default function ExternalTranslateProgress({ field, label }: Props) {
  const css = useStore((s) => s.translationConfig.cssCjkHandling) || 'preserve';
  const ui = useUi();
  const [open, setOpen] = useState(true);
  const translating = field.status === 'translating';

  // Đồng hồ: lượt dịch link ngoài lớn chạy cả chục phút — phải thấy là nó còn sống.
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!translating) { setStartedAt(null); return; }
    setStartedAt(t => t ?? Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [translating]);

  const raw = field.rawChunks || [];
  const done = field.completedChunks || [];
  const total = field.totalChunks || raw.length || 0;

  const rows = useMemo(() => {
    if (total === 0) return [];
    const audit = raw.length ? auditChunks(raw, done) : null;
    const issueOf = new Map(audit?.issues.map(i => [i.index, i]) || []);
    return Array.from({ length: total }, (_, i) => {
      const src = raw[i] || '';
      const out = done[i] || '';
      const has = !!out.trim();
      return {
        i,
        chars: src.length,
        has,
        failed: field.failedChunkIndex === i,
        srcHan: src ? countResidualHan(src, css) : 0,
        leftHan: has ? countResidualHan(out, css) : undefined,
        ratio: has && src.length ? out.length / src.length : undefined,
        // Chỉ nhận xét mảnh đã có bản dịch; mảnh trống thì trạng thái đã nói đủ.
        issue: has ? issueOf.get(i)?.detail : undefined,
      };
    });
  }, [raw, done, total, field.failedChunkIndex, css]);

  // Đường 1 mảnh (fast path) không ghi completedChunks — field đã 'done' thì coi như đủ.
  const doneCount = field.status === 'done' ? total : rows.filter(r => r.has).length;
  const finalHan = field.status === 'done' && field.translated ? countResidualHan(field.translated, css) : undefined;

  // Field chưa từng chạy và không có gì để báo → ẩn.
  if (!translating && total === 0 && field.status !== 'error' && field.status !== 'done') return null;

  const elapsed = startedAt ? Math.round((now - startedAt) / 1000) : 0;

  return (
    <div style={{ padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: `1px solid ${translating ? 'var(--accent-primary)' : 'var(--border-subtle)'}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => setOpen(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 0, display: 'flex' }}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <b style={{ fontSize: '0.78rem' }}>{ui.xpTitle}</b>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
          {translating
            ? (total > 0 ? fmt(ui.xpRunning, { done: doneCount, total }) : ui.xpPreparing)
            : field.status === 'error' ? fmt(ui.xpStoppedErr, { done: doneCount, total: total || '?' })
            : total > 0 ? fmt(ui.xpChunks, { done: doneCount, total }) : ui.xpDoneSingle}
          {translating && elapsed > 0 ? ` · ${elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}p${String(elapsed % 60).padStart(2, '0')}`}` : ''}
        </span>
        {finalHan !== undefined && (
          <span style={{ fontSize: '0.72rem', color: finalHan ? 'var(--accent-warning, #f59e0b)' : 'var(--accent-success, #4ade80)' }}>
            · {finalHan ? fmt(ui.xpFinalLeft, { n: finalHan }) : ui.xpFinalClean}
          </span>
        )}
        {translating && (
          <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
            {ui.xpBackgroundHint}
          </span>
        )}
      </div>

      {open && (
        <>
          {total > 0 && (
            <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-primary)', overflow: 'hidden', margin: '8px 0 6px' }}>
              <div style={{ width: `${Math.round((doneCount / total) * 100)}%`, height: '100%', background: 'var(--accent-success, #4ade80)', transition: 'width 0.3s' }} />
            </div>
          )}

          {rows.length > 1 && (
            <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 6 }}>
              {rows.map(r => {
                const color = r.failed ? '#f87171' : r.has ? (r.leftHan || r.issue ? '#f59e0b' : '#4ade80') : 'var(--text-muted)';
                return (
                  <div key={r.i} style={{ fontSize: '0.68rem', display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', padding: '2px 6px', borderRadius: 4, background: 'var(--bg-primary)' }}>
                    <span style={{ color, width: 14, textAlign: 'center' }}>
                      {r.failed ? <X size={11} /> : r.has ? <Check size={11} /> : translating ? <Loader2 size={11} className="spin" /> : '•'}
                    </span>
                    <span style={{ fontWeight: 600, minWidth: 58 }}>{fmt(ui.xpChunkLabel, { i: r.i + 1, n: total })}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{r.chars.toLocaleString()} {ui.hsChars}</span>
                    {r.ratio !== undefined && (
                      <span style={{ color: 'var(--text-muted)' }} title={ui.xpRatioTip}>· {fmt(ui.xpRatio, { r: r.ratio.toFixed(2) })}</span>
                    )}
                    {r.leftHan !== undefined && (
                      <span style={{ color: r.leftHan ? '#f59e0b' : '#4ade80' }}>
                        · {r.leftHan ? fmt(ui.xpHanLeft, { left: r.leftHan, src: r.srcHan }) : ui.xpClean}
                      </span>
                    )}
                    {r.failed && <span style={{ color: '#f87171' }}>· {ui.xpChunkFailed}</span>}
                    {r.issue && <span style={{ color: '#f59e0b', flexBasis: '100%', paddingLeft: 22 }}>{r.issue}</span>}
                  </div>
                );
              })}
            </div>
          )}

          {field.status === 'error' && field.error && (
            <div style={{ fontSize: '0.68rem', color: '#f87171', marginBottom: 6 }}>
              {field.error} — {ui.xpRetryHint}
            </div>
          )}

          <TranslateActivityLog fieldPrefix={label} hideSurgicalTicks />
        </>
      )}
    </div>
  );
}
