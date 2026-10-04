/**
 * ─── Script Nặng (Chia Phần) ───
 * (User 2026) Bundle Vue/webpack 3M+ ký tự dán nguyên khối → AI đọc thiếu/cắt cụt, treo UI.
 * Chia AN TOÀN (utils/heavyScript) → dịch TUẦN TỰ từng phần qua translateText (surgical, giữ
 * code/biến), DỪNG/TIẾP đúng phần dang dở, dịch lại từng phần lỗi, GHÉP 1:1, glossary chung.
 *
 * (bug 239) Vòng dịch + trạng thái giờ nằm ở utils/heavyScriptJob (cấp module). Component này chỉ
 * còn NHÌN và BẤM — đóng Regex Manager không còn làm "mất" lượt đang chạy.
 * (bug 240) Mỗi phần hiện đủ: trạng thái, thời gian, chữ Hán còn sót, độ khớp độ dài, nhận xét
 * của bộ soi chunk; dưới cùng là nhật ký từng bước (thay cho F12).
 */
import { useState, useMemo, useEffect } from 'react';
import { useStore } from '../store';
import { useUi } from '../i18n/useLocale';
import { fmt } from '../i18n';
import { safeSetItem } from '../utils/safeStorage';
import { HEAVY_SCRIPT_DEFAULT_THRESHOLD } from '../utils/heavyScript';
import { useHeavyScriptJob, heavySourceSig, HEAVY_FIELD_PREFIX } from '../utils/heavyScriptJob';
import TranslateActivityLog from './TranslateActivityLog';
import { Layers, Play, Square, RefreshCw, Loader2, Check, X, ChevronDown, ChevronRight, Copy, AlertTriangle } from 'lucide-react';

interface Props {
  /** Nội dung script gốc (từ ô dán của ExternalLinkTab). */
  source: string;
}

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}p${String(s % 60).padStart(2, '0')}`;
}

export default function HeavyScriptMode({ source }: Props) {
  const addToast = useStore((s) => s.addToast);
  const ui = useUi();

  const [threshold, setThreshold] = useState(() => {
    const v = Number(localStorage.getItem('heavy-script-threshold'));
    return v > 0 ? v : HEAVY_SCRIPT_DEFAULT_THRESHOLD;
  });
  useEffect(() => { safeSetItem('heavy-script-threshold', String(threshold)); }, [threshold]);
  const [expanded, setExpanded] = useState(true);
  const [showLog, setShowLog] = useState(true);

  const job = useHeavyScriptJob();
  const sig = heavySourceSig(source);
  // Lượt trong store thuộc về script đang mở ở ô nháp? (Đang chạy thì luôn hiện, kể cả khi người
  // dùng đã đổi ô nháp — không được giấu một lượt vẫn đang tiêu API.)
  const mine = job.sig === sig || job.running;
  const parts = mine ? job.parts : [];

  // Khôi phục tiến trình đã lưu (reload trang) khi ô nháp đúng là script đó.
  useEffect(() => { if (source) job.restore(source); }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  // Đồng hồ cho phần đang chạy.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!job.running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job.running]);

  const isHeavy = source.length > threshold;
  const doneCount = mine ? job.results.filter(Boolean).length : 0;
  const totalChars = useMemo(() => parts.reduce((s, p) => s + p.chars, 0), [parts]);
  const hanLeft = mine ? job.info.reduce((s, x) => s + (x.leftHan || 0), 0) : 0;
  const hanSrc = mine ? job.info.reduce((s, x) => s + x.srcHan, 0) : 0;

  if (!isHeavy && parts.length === 0) return null; // dưới ngưỡng + chưa chia → ẩn hẳn

  const doSplit = () => {
    const n = job.split(source);
    addToast('success', fmt(ui.hsSplitDone, { n }));
  };
  const pct = parts.length ? Math.round((doneCount / parts.length) * 100) : 0;

  return (
    <div style={{ padding: '14px 16px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--accent-warning, #f59e0b)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Layers size={16} color="var(--accent-warning, #f59e0b)" />
        <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--accent-warning, #f59e0b)' }}>{ui.hsTitle}</h4>
        {job.running && (
          <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
            · {ui.hjBackground}
          </span>
        )}
        <button onClick={() => setExpanded(e => !e)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
      </div>

      {job.running && job.sig !== sig && (
        <div style={{ fontSize: '0.7rem', color: 'var(--accent-warning, #f59e0b)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertTriangle size={13} /> {ui.hjOtherScript}
        </div>
      )}

      {/* Cảnh báo tự động khi vượt ngưỡng */}
      {isHeavy && parts.length === 0 && (
        <div style={{ fontSize: '0.72rem', lineHeight: 1.5, color: 'var(--text-secondary)', background: 'rgba(245,158,11,0.08)', padding: '8px 10px', borderRadius: 6, marginBottom: 8 }}>
          ⚠ {fmt(ui.hsWarn, { chars: source.length.toLocaleString(), threshold: threshold.toLocaleString() })}
        </div>
      )}

      {expanded && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{ui.hsThreshold}</label>
            <input type="number" value={threshold} min={10000} step={10000}
              onChange={e => setThreshold(Math.max(10000, Number(e.target.value) || HEAVY_SCRIPT_DEFAULT_THRESHOLD))}
              style={{ width: 110, padding: '3px 6px', fontSize: '0.72rem', borderRadius: 4, border: '1px solid var(--border-default)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }} />

            {parts.length === 0 ? (
              <button className="btn btn-primary btn-sm" onClick={doSplit} disabled={!source.trim()}>
                <Layers size={13} /> {ui.hsSplitBtn}
              </button>
            ) : (
              <>
                {!job.running ? (
                  <button className="btn btn-primary btn-sm" onClick={() => void job.runAll()} disabled={doneCount === parts.length}>
                    <Play size={13} /> {doneCount > 0 && doneCount < parts.length ? ui.hsResume : ui.hsTranslateAll}
                  </button>
                ) : (
                  <button className="btn btn-sm" style={{ color: '#f87171', borderColor: 'rgba(248,113,113,0.4)' }} onClick={job.stop}>
                    <Square size={13} /> {ui.hsStop}
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={doSplit} disabled={job.running} title={ui.hsResplitTip}>
                  <RefreshCw size={12} /> {ui.hsResplit}
                </button>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                  {job.running && job.activeIdx >= 0
                    ? fmt(ui.hsProgressActive, { i: job.activeIdx + 1, n: parts.length })
                    : fmt(ui.hsProgress, { done: doneCount, n: parts.length })}
                  {' · '}{totalChars.toLocaleString()} {ui.hsChars}
                  {job.running && job.startedAt ? ` · ${fmt(ui.hjElapsed, { t: fmtDuration(now - job.startedAt) })}` : ''}
                </span>
              </>
            )}
          </div>

          {/* Thanh tổng + chữ Hán còn lại */}
          {parts.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-secondary)', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent-success, #4ade80)', transition: 'width 0.3s' }} />
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 4 }}>
                {pct}% · {fmt(ui.hjHanSrc, { n: hanSrc.toLocaleString() })}
                {doneCount > 0 && (
                  <> · <span style={{ color: hanLeft ? 'var(--accent-warning, #f59e0b)' : 'var(--accent-success, #4ade80)' }}>
                    {fmt(ui.hjHanLeft, { n: hanLeft.toLocaleString() })}
                  </span> {ui.hjHanNote}</>
                )}
              </div>
            </div>
          )}

          {/* Danh sách phần (trạng thái + đo lường + dịch lại riêng) */}
          {parts.length > 0 && (
            <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {parts.map((p, i) => {
                const inf = job.info[i] || { status: 'pending', srcHan: 0 };
                const st = inf.status;
                const color = st === 'done' ? (inf.leftHan || inf.verdict ? '#f59e0b' : '#4ade80')
                  : st === 'error' ? '#f87171' : st === 'translating' ? '#f59e0b' : 'var(--text-muted)';
                const time = st === 'translating' && inf.startedAt ? fmtDuration(now - inf.startedAt)
                  : inf.startedAt && inf.finishedAt ? fmtDuration(inf.finishedAt - inf.startedAt) : '';
                return (
                  <div key={i} style={{ fontSize: '0.72rem', padding: '4px 8px', background: 'var(--bg-secondary)', borderRadius: 4, border: `1px solid ${st === 'translating' ? 'rgba(245,158,11,0.4)' : 'var(--border-subtle)'}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ color, width: 16, textAlign: 'center' }}>
                        {st === 'done' ? <Check size={12} /> : st === 'error' ? <X size={12} /> : st === 'translating' ? <Loader2 size={12} className="spin" /> : '•'}
                      </span>
                      <span style={{ fontWeight: 600, minWidth: 64 }}>{fmt(ui.hsPartLabel, { i: p.index, n: parts.length })}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{p.chars.toLocaleString()} {ui.hsChars}</span>
                      {time && <span style={{ color: 'var(--text-muted)' }}>· {time}</span>}
                      {st === 'done' && inf.ratio !== undefined && (
                        <span style={{ color: 'var(--text-muted)' }} title={ui.hjRatioTip}>
                          · {fmt(ui.hjRatio, { r: inf.ratio.toFixed(2) })}
                        </span>
                      )}
                      {st === 'done' && (
                        <span style={{ color: inf.leftHan ? '#f59e0b' : '#4ade80' }}>
                          · {inf.leftHan ? fmt(ui.xpHanLeft, { left: inf.leftHan, src: inf.srcHan }) : ui.xpFinalClean}
                        </span>
                      )}
                      <button onClick={() => void job.retryOne(i)} disabled={job.running}
                        title={ui.hsRetryOne}
                        style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: job.running ? 'default' : 'pointer', color: 'var(--text-muted)', opacity: job.running ? 0.4 : 1, display: 'flex', alignItems: 'center', gap: 3, fontSize: '0.68rem' }}>
                        <RefreshCw size={11} /> {ui.hsRetryOne}
                      </button>
                    </div>
                    {(inf.error || (st === 'done' && inf.verdict)) && (
                      <div style={{ marginTop: 2, paddingLeft: 24, fontSize: '0.66rem', color: inf.error ? '#f87171' : '#f59e0b' }}>
                        {inf.error || inf.verdict}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {parts.length > 0 && doneCount === parts.length && (
            <div style={{ marginTop: 8, fontSize: '0.72rem', color: '#4ade80', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Check size={13} /> {fmt(ui.hsMerged, { n: parts.length })}
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }}
                onClick={() => { navigator.clipboard.writeText(job.merged); addToast('success', ui.hsCopied); }}>
                <Copy size={12} /> {ui.hsCopyMerged}
              </button>
            </div>
          )}

          {parts.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <button onClick={() => setShowLog(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 4, padding: 0, marginBottom: 4 }}>
                {showLog ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {ui.hjLog}
              </button>
              {showLog && <TranslateActivityLog fieldPrefix={HEAVY_FIELD_PREFIX} hideSurgicalTicks />}
            </div>
          )}
        </>
      )}
    </div>
  );
}
