import { useEffect, useRef, useState } from 'react';
import { Download, X, RefreshCw, Sparkles, Check, AlertTriangle } from 'lucide-react';
import { APP_VERSION } from '../version';
import { useUi } from '../i18n/useLocale';

interface Commit { hash: string; subject: string; }
type Phase = 'idle' | 'open' | 'updating' | 'done';
// Lưu SỐ commit đang chờ mà user đã bấm "Để sau/Đóng". Chỉ tự mở lại popup khi số này
// THAY ĐỔI (có commit mới hơn) → không làm phiền lặp lại cùng một bản.
const DISMISS_KEY = 'update-autopopup-dismissed-behind';
// (User yêu cầu 2026) Quét cập nhật NHANH hơn: nền 3 phút/lần + quét NGAY khi user quay lại tab
// (visibilitychange/focus) → push xong là thấy badge +N trong ~vài giây. Debounce ≥60s để không
// spam `git fetch`. Endpoint /api/check-update chỉ chạy git fetch (rẻ), 3 phút/lần vô hại.
const AUTO_CHECK_MS = 3 * 60 * 1000;   // nền: 3 phút/lần
const FOCUS_DEBOUNCE_MS = 60 * 1000;   // quét-khi-focus: tối đa 1 lần/phút

/**
 * Always-visible Hub update control. Lives right below the flow list so it shows in
 * EVERY flow (Dịch / Tạo Card / Tạo Preset / Mod Card / Trích Card). All tools are one git
 * repo, so a single "Cập nhật" (git pull) updates them all at once.
 *
 * - Checks on load; shows a green pulsing badge when the repo is behind origin.
 * - Auto-opens the modal once per session when updates are found.
 * - Click any time to re-check + update.
 */
export default function HubUpdateButton() {
  const ui = useUi();
  const [phase, setPhase] = useState<Phase>('idle');
  const [commits, setCommits] = useState<Commit[]>([]);
  const [behind, setBehind] = useState(0);
  const [checking, setChecking] = useState(false);
  const [log, setLog] = useState('');
  const [error, setError] = useState('');
  const checkedOnce = useRef(false);
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;

  const dismissedBehind = () => {
    try { return parseInt(sessionStorage.getItem(DISMISS_KEY) || '0', 10) || 0; } catch { return 0; }
  };

  const check = async (opts?: { openIfFound?: boolean; openAlways?: boolean }) => {
    setChecking(true);
    try {
      const r = await fetch('/api/check-update');
      if (r.ok) {
        const data = await r.json();
        if (data?.ok) {
          setError('');
          const nBehind = data.behind || 0;
          setBehind(nBehind);
          setCommits(Array.isArray(data.commits) ? data.commits : []);
          // Tự mở popup khi có bản mới VÀ số commit khác lần user đã bỏ qua (tức có commit mới hơn).
          // Không đè khi đang cập nhật/đang mở dở (chỉ auto-open lúc idle).
          const isNew = nBehind > 0 && nBehind !== dismissedBehind();
          if (opts?.openAlways || (opts?.openIfFound && isNew && phaseRef.current === 'idle')) setPhase('open');
          return nBehind;
        }
        // ok:false → không kiểm tra được (không phải git clone / fetch lỗi / offline). BÁO RÕ.
        setError(String(data?.error || ui.updErrCheck));
        setBehind(0); setCommits([]);
        if (opts?.openAlways) setPhase('open');
        return 0;
      }
    } catch {
      setError(ui.updErrApi);
      if (opts?.openAlways) setPhase('open');
    }
    finally { setChecking(false); }
    return 0;
  };

  const lastCheckAt = useRef(0);
  useEffect(() => {
    if (checkedOnce.current) return;
    checkedOnce.current = true;
    const doCheck = () => { lastCheckAt.current = Date.now(); check({ openIfFound: true }); };
    doCheck();
    // Nền: quét lại mỗi 3 phút.
    const id = setInterval(doCheck, AUTO_CHECK_MS);
    // Quét NGAY khi user quay lại tab (bật màn/đổi tab về), nhưng tối đa 1 lần/phút.
    const onFocus = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastCheckAt.current < FOCUS_DEBOUNCE_MS) return;
      doCheck();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runUpdate = async () => {
    setPhase('updating');
    setLog('');
    try {
      const res = await fetch('/api/update', { method: 'POST' });
      if (!res.body) throw new Error('No response body');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        setLog((p) => p + dec.decode(value, { stream: true }));
      }
      setPhase('done');
    } catch (e: any) {
      setLog((p) => p + `
${ui.updErrPrefix}: ${e?.message || String(e)}`);
      setPhase('done');
    }
  };

  const closeModal = () => {
    // Ghi nhớ số commit hiện đang chờ → lần quét 30 phút sau chỉ bật lại nếu có commit mới hơn.
    try { sessionStorage.setItem(DISMISS_KEY, String(behind)); } catch { /* ignore */ }
    setPhase('idle');
  };

  const hasUpdate = behind > 0;

  return (
    <>
      {/* ─── Rail button ─── */}
      <button
        onClick={() => check({ openAlways: true })}
        title={hasUpdate
          ? ui.updTitleHasUpdate.replace('{count}', String(behind))
          : error ? ui.updTitleError.replace('{error}', error) : ui.updTitleCheck}
        style={{
          position: 'relative',
          width: 64,
          padding: '9px 2px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          border: '1.5px solid ' + (hasUpdate ? '#39ff14' : '#00e5ff'),
          borderRadius: 10,
          background: hasUpdate ? 'rgba(57,255,20,0.15)' : 'rgba(0,229,255,0.10)',
          color: hasUpdate ? '#8dff6b' : '#5ff4ff',
          cursor: 'pointer',
          textShadow: hasUpdate ? '0 0 6px rgba(57,255,20,0.9)' : '0 0 6px rgba(0,229,255,0.8)',
          boxShadow: hasUpdate
            ? '0 0 12px rgba(57,255,20,0.75), inset 0 0 8px rgba(57,255,20,0.35)'
            : '0 0 10px rgba(0,229,255,0.55), inset 0 0 6px rgba(0,229,255,0.2)',
          transition: 'all 0.15s',
        }}
        className={hasUpdate ? 'hub-update-pulse' : 'hub-update-glow'}
      >
        {checking
          ? <RefreshCw size={20} className="spin" />
          : <Download size={20} />}
        <span style={{ fontSize: '0.62rem', fontWeight: 700, lineHeight: 1.15 }}>
          {hasUpdate ? ui.updRailNew : ui.updRailUpdate}
        </span>
        {hasUpdate && (
          <span style={{
            position: 'absolute', top: 2, right: 6, minWidth: 15, height: 15, padding: '0 3px',
            borderRadius: 8, background: '#22c55e', color: '#04120a', fontSize: '0.55rem',
            fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{behind}</span>
        )}
      </button>

      {/* ─── Modal ─── */}
      {phase !== 'idle' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10002 }}>
          <div style={{ background: 'var(--bg-primary, #0f0f14)', width: '92%', maxWidth: 560, borderRadius: 12, border: '1px solid var(--accent-secondary, #4ecdc4)', boxShadow: '0 12px 40px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle, #2a2a3e)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Sparkles size={18} style={{ color: 'var(--accent-secondary, #4ecdc4)' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary, #f1f0f7)' }}>
                  {phase === 'updating' ? ui.updModalUpdating
                    : phase === 'done' ? ui.updModalDone
                    : hasUpdate ? ui.updModalHasUpdate.replace('{count}', String(behind))
                    : error ? ui.updModalCheckFailed : ui.updModalLatest}
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted, #9b98ae)' }}>{ui.updModalSub.replace('{version}', APP_VERSION)}</div>
              </div>
              {phase !== 'updating' && (
                <button onClick={closeModal} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex' }}><X size={18} /></button>
              )}
            </div>
            <div style={{ padding: '16px 18px', maxHeight: 340, overflowY: 'auto' }}>
              {phase === 'open' && hasUpdate && (
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {commits.map((c) => (
                    <li key={c.hash} style={{ fontSize: '0.78rem', lineHeight: 1.45 }}>
                      <code style={{ color: 'var(--accent-secondary)', fontSize: '0.7rem' }}>{c.hash}</code>{' '}
                      <span style={{ color: 'var(--text-primary, #f1f0f7)' }}>{c.subject}</span>
                    </li>
                  ))}
                </ul>
              )}
              {phase === 'open' && !hasUpdate && !error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary, #c8c5d8)', fontSize: '0.85rem' }}>
                  <Check size={16} style={{ color: '#22c55e' }} /> {ui.updNoNewCommits}
                </div>
              )}
              {phase === 'open' && !hasUpdate && !!error && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.82rem' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: '#fbbf24' }}>
                    <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{error}</span>
                  </div>
                  <div style={{ color: 'var(--text-muted, #b6b2c9)', fontSize: '0.75rem', lineHeight: 1.5 }}>
                    {ui.updHelp1} <code style={{ color: 'var(--accent-secondary)' }}>git pull origin main</code> {ui.updHelp2} <code style={{ color: 'var(--accent-secondary)' }}>git clone</code> {ui.updHelp3}
                  </div>
                </div>
              )}
              {(phase === 'updating' || phase === 'done') && (
                <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 12, borderRadius: 6, fontSize: '0.75rem', fontFamily: 'monospace', minHeight: 120, maxHeight: 300, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{log || ui.updPreparing}</pre>
              )}
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border-subtle, #2a2a3e)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {phase === 'open' && hasUpdate && (
                <>
                  <button onClick={closeModal} style={btnGhost}>{ui.updLater}</button>
                  <button onClick={runUpdate} style={btnPrimary}><Download size={14} /> {ui.updNow}</button>
                </>
              )}
              {phase === 'open' && !hasUpdate && <button onClick={closeModal} style={btnPrimary}>{ui.updClose}</button>}
              {phase === 'done' && <button onClick={() => window.location.reload()} style={btnPrimary}><RefreshCw size={14} /> {ui.updReload}</button>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const btnPrimary: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontWeight: 600, background: 'var(--accent-primary, #7c6af0)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem' };
const btnGhost: React.CSSProperties = { padding: '8px 16px', fontWeight: 600, background: 'transparent', color: 'var(--text-secondary, #c8c5d8)', border: '1px solid var(--border-subtle, #2a2a3e)', borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem' };
