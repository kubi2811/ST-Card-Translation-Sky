import { useState, useRef, useCallback, useEffect } from 'react';
import App from './App';
import { FLOWS, type FlowDef } from './flows';
import { RotateCw, ExternalLink, Bug, Play, Square } from 'lucide-react';
import HubUpdateButton from './components/HubUpdateButton';
import { APP_VERSION } from './version';
import { useUi } from './i18n/useLocale';
import { getUiLang, setUiLang, UI_LANGS, fmt } from './i18n';
import { useToolServers, ensureToolServerPolling } from './hub/useToolServers';

const RAIL_WIDTH = 78;
const LS_KEY = 'hub-active-flow';

/** Link file Excel để mọi người báo lỗi (mở tab mới khi bấm nút "Báo lỗi" ở header). */
const BUG_REPORT_URL = 'https://onedrive.live.com/:x:/g/personal/9d827193364b0865/IQChejAgqiJJR5jbZcOTvFzuARJ72g4PVNDz_XNopPwkQ38?rtime=EXxXpf_e3kg&redeem=aHR0cHM6Ly8xZHJ2Lm1zL3gvYy85ZDgyNzE5MzM2NGIwODY1L0lRQ2hlakFncWlKSlI1amJaY09UdkZ6dUFSSjcyZzRQVk5Eel9YTm9wUHdrUTM4P2U9QUY0ZUQx';

/** Gắn ?lang= vào URL tool con để iframe mở đúng ngôn ngữ đang chọn. */
const withLang = (u: string): string => {
  if (!u) return u;
  return `${u}${u.includes('?') ? '&' : '?'}lang=${getUiLang()}`;
};

/**
 * Top-level Hub shell. A slim left rail switches between "flows" (tools).
 *
 * Switching NEVER interrupts work:
 *  - The translate tool (native) is always mounted; it's just hidden (display:none) when
 *    another flow is active, so a running translation keeps going.
 *  - Each iframe tool is mounted on first visit and then kept mounted (hidden when inactive),
 *    so its in-progress state/generation is preserved when you switch away and back.
 */
export default function AppHub() {
  const [active, setActive] = useState<string>(() => {
    try { return localStorage.getItem(LS_KEY) || 'translate'; } catch { return 'translate'; }
  });
  // Iframe flows are lazily mounted on first activation, then kept alive.
  const [visited, setVisited] = useState<Set<string>>(() => new Set([active]));

  const select = useCallback((id: string) => {
    setActive(id);
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    try { localStorage.setItem(LS_KEY, id); } catch { /* ignore */ }
  }, []);

  const iframeFlows = FLOWS.filter((f) => f.kind === 'iframe');
  const activeFlow = FLOWS.find((f) => f.id === active);

  // Poll trạng thái server tool con (chấm sáng/mờ trên rail + màn chờ lazy-start).
  useEffect(() => { ensureToolServerPolling(); }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      {/* ─── Header chung trên cả 5 app ─── */}
      <GlobalHeader activeFlow={activeFlow} />

      {/* ─── Rail + Content ─── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Flow rail */}
        <nav
          style={{
            width: RAIL_WIDTH,
            flexShrink: 0,
            background: 'var(--bg-secondary, #16161e)',
            borderRight: '1px solid var(--border-subtle, #2a2a3e)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '10px 0',
            gap: '6px',
          }}
        >
          {FLOWS.map((f) => (
            <RailButton key={f.id} flow={f} active={active === f.id} onClick={() => select(f.id)} />
          ))}
          {/* Push the update button to the bottom of the rail */}
          <div style={{ flexGrow: 1 }} />
          <HubUpdateButton />
        </nav>

        {/* Content */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          {/* Native translate tool — always mounted, hidden when inactive so it never stops */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              overflow: 'auto',
              display: active === 'translate' ? 'block' : 'none',
            }}
          >
            <App />
          </div>

          {/* Iframe tools — mounted on first visit, then kept alive */}
          {iframeFlows.map((f) =>
            visited.has(f.id) ? (
              <IframeFlow key={f.id} flow={f} active={active === f.id} />
            ) : null
          )}
        </div>
      </div>
    </div>
  );
}

/** Nút đổi ngôn ngữ giao diện (VI / EN / 中文). Bấm → lưu + reload trang. */
function LangSwitcher() {
  const ui = useUi();
  const current = getUiLang();
  return (
    <div
      title={ui.langLabel}
      style={{
        display: 'flex', alignItems: 'center', flexShrink: 0,
        background: 'var(--bg-primary, #0f0f14)',
        borderRadius: 8,
        border: '1px solid var(--border-subtle, #2a2a3e)',
        overflow: 'hidden',
      }}
    >
      {UI_LANGS.map((l) => {
        const on = l.id === current;
        return (
          <button
            key={l.id}
            onClick={() => { if (!on) setUiLang(l.id); }}
            title={l.title}
            style={{
              padding: '5px 10px',
              fontSize: '0.7rem',
              fontWeight: on ? 700 : 500,
              background: on ? 'var(--accent-primary, #7c6af0)' : 'transparent',
              color: on ? '#fff' : 'var(--text-muted, #b6b2c9)',
              border: 'none',
              cursor: on ? 'default' : 'pointer',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {l.short}
          </button>
        );
      })}
    </div>
  );
}

/** Header thương hiệu chung — nằm trên shell Hub nên hiển thị nhất quán trên cả 5 app. */
function GlobalHeader({ activeFlow }: { activeFlow?: FlowDef }) {
  const ui = useUi();
  return (
    <header
      style={{
        flexShrink: 0,
        height: 54,
        display: 'flex',
        alignItems: 'center',
        gap: 13,
        padding: '0 18px',
        background: 'linear-gradient(90deg, var(--bg-secondary, #16161e) 0%, #191826 100%)',
        borderBottom: '1px solid var(--border-subtle, #2a2a3e)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Logo mark */}
      <div
        style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 17, fontWeight: 800, color: '#0f0f14',
          background: 'linear-gradient(135deg, #7c6af0, #4ecdc4)',
          boxShadow: '0 0 12px rgba(124,106,240,0.55)',
        }}
      >
        ST
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, minWidth: 0 }}>
          <span style={{ fontSize: '1.18rem', fontWeight: 800, letterSpacing: 0.3, whiteSpace: 'nowrap',
            background: 'linear-gradient(90deg, #a99cff, #4ecdc4)', WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            Silly Tavern Multitools
          </span>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted, #b6b2c9)' }}>v{APP_VERSION}</span>
        </div>
        <span style={{ fontSize: '0.64rem', fontWeight: 500, letterSpacing: 0.2, whiteSpace: 'nowrap',
          color: 'var(--text-muted, #8b88a0)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ opacity: 0.7 }}>{ui.hubMadeBy}</span>
          <span style={{ fontWeight: 700, background: 'linear-gradient(90deg, #a99cff, #4ecdc4)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            Guillichan&nbsp;×&nbsp;Sky
          </span>
        </span>
      </div>

      {/* Bên phải header: tool đang mở + nút đổi ngôn ngữ */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
        {activeFlow && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7,
            fontSize: '0.86rem', color: activeFlow.color || 'var(--text-secondary, #d6d3e4)', fontWeight: 600 }}>
            <span style={{ fontSize: '1.2rem' }}>{activeFlow.emoji}</span>
            <span>{ui[activeFlow.labelKey]}</span>
          </div>
        )}
        {/* Nút Báo lỗi → mở file Excel (OneDrive) ở tab mới cho mọi người ghi bug */}
        <a
          href={BUG_REPORT_URL}
          target="_blank"
          rel="noopener noreferrer"
          title={ui.hubReportBug}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '5px 11px', borderRadius: 8, textDecoration: 'none',
            fontSize: '0.8rem', fontWeight: 700, whiteSpace: 'nowrap',
            color: '#ffb4a6',
            background: 'rgba(255,90,70,0.12)',
            border: '1px solid rgba(255,90,70,0.35)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,90,70,0.22)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,90,70,0.12)'; }}
        >
          <Bug size={15} strokeWidth={2.4} />
          <span>{ui.hubReportBug}</span>
        </a>
        <LangSwitcher />
      </div>
    </header>
  );
}

function RailButton({ flow, active, onClick }: { flow: FlowDef; active: boolean; onClick: () => void }) {
  const color = flow.color || 'var(--accent-primary)';
  const ui = useUi();
  // Trạng thái server của tab (chỉ tab có serverToolId — tab native/tĩnh luôn "sáng").
  const st = useToolServers((s) => (flow.serverToolId ? s.status[flow.serverToolId] : undefined));
  const hasServer = !!flow.serverToolId;
  const starting = st?.phase === 'starting';
  const running = !!st?.running;
  // Server tắt → icon mờ đi cho biết "tool này đang nghỉ, bấm là dậy".
  const dimmed = hasServer && !!st && !running && !starting;
  const dotColor = !hasServer || !st ? null : running ? '#22c55e' : starting ? '#f59e0b' : '#5b5b6e';
  const stateTip = !hasServer || !st ? '' :
    running ? ` — ${ui.toolSrvRunningTip}` : starting ? ` — ${ui.toolSrvStartingTip}` : ` — ${ui.toolSrvStoppedTip}`;
  return (
    <button
      onClick={onClick}
      title={ui[flow.labelKey] + stateTip}
      style={{
        width: RAIL_WIDTH - 14,
        padding: '8px 2px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '3px',
        border: '1px solid ' + (active ? color : 'transparent'),
        borderRadius: 10,
        background: active ? 'rgba(124,106,240,0.12)' : 'transparent',
        color: active ? color : 'var(--text-secondary, #a09cb5)',
        cursor: 'pointer',
        transition: 'all 0.15s',
        position: 'relative',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-hover, #2a2a3e)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {dotColor && (
        <span
          className={starting ? 'animate-pulse' : undefined}
          style={{
            position: 'absolute', top: 5, right: 7,
            width: 7, height: 7, borderRadius: '50%',
            background: dotColor,
            boxShadow: running ? '0 0 5px rgba(34,197,94,0.8)' : starting ? '0 0 5px rgba(245,158,11,0.8)' : 'none',
          }}
        />
      )}
      <span style={{ fontSize: '1.5rem', lineHeight: 1, opacity: dimmed ? 0.55 : 1, transition: 'opacity 0.2s' }}>{flow.emoji}</span>
      <span style={{ fontSize: '0.68rem', fontWeight: 700, textAlign: 'center', lineHeight: 1.15, opacity: dimmed ? 0.7 : 1 }}>{ui[flow.labelKey]}</span>
    </button>
  );
}

function IframeFlow({ flow, active }: { flow: FlowDef; active: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [nonce, setNonce] = useState(0);
  const [ready, setReady] = useState(false);
  // User bấm Dừng thủ công → KHÔNG auto-start lại khi tab vẫn active (tránh loop stop/start);
  // hiện nút "Khởi động" to giữa màn cho tới khi user chủ động bấm.
  const [manuallyStopped, setManuallyStopped] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [, forceTick] = useState(0); // ticker 1s cho đồng hồ "({s}s)" khi đang khởi động
  const ui = useUi();
  const url = flow.url || '';
  const label = ui[flow.labelKey];

  const toolId = flow.serverToolId;
  const st = useToolServers((s) => (toolId ? s.status[toolId] : undefined));
  const pending = useToolServers((s) => (toolId ? s.pending[toolId] : undefined));
  const startSrv = useToolServers((s) => s.start);
  const stopSrv = useToolServers((s) => s.stop);

  // The tool's dev server may still be booting. Poll the URL until it's reachable, THEN mount
  // the iframe — so the user never sees a permanent "refused to connect".
  // Đang Dừng thủ công thì NGƯNG poll: server chết dần trong ~1-2s, poll trúng lúc còn sống
  // sẽ bật ready lại → iframe remount ngay sau khi bấm Dừng (race bắt được khi verify live).
  useEffect(() => {
    if (ready || !url || manuallyStopped) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        await fetch(url, { mode: 'no-cors', cache: 'no-store' });
        if (!cancelled) setReady(true); // server answered → up
      } catch {
        if (!cancelled) timer = setTimeout(check, 1500); // connection refused → retry
      }
    };
    check();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [url, ready, manuallyStopped]);

  // ─── Lazy-start: bấm tab là đủ để bày tỏ ý định → tự khởi động server tool ───
  // Không auto khi: server đang chạy/đang lên, đang có thao tác bay, vừa bị Dừng thủ công,
  // hoặc lần khởi động trước lỗi (đợi user bấm "Thử lại" để không spam log lỗi).
  useEffect(() => {
    if (!active || !toolId || manuallyStopped) return;
    if (!st) return;                                     // chưa có status đầu tiên → chờ poll
    if (st.running || st.phase === 'starting' || st.phase === 'error' || pending) return;
    void startSrv(toolId);
  }, [active, toolId, manuallyStopped, st, pending, startSrv]);

  // Đồng hồ giây trên màn "Đang khởi động…"
  const starting = !!toolId && !ready && st?.phase === 'starting';
  useEffect(() => {
    if (!starting) return;
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [starting]);

  const reload = () => {
    // Re-probe + remount the iframe (also recovers if the tool server was restarted).
    setReady(false);
    setNonce((n) => n + 1);
  };

  const handleStop = async () => {
    if (!toolId) return;
    setManuallyStopped(true);
    setReady(false);
    const ok = await stopSrv(toolId);
    if (!ok) setManuallyStopped(false); // dừng thất bại → về lại trạng thái cũ, hiện lỗi từ status
  };

  const handleStart = () => {
    if (!toolId) return;
    setManuallyStopped(false);
    setReady(false); // ready cũ có thể là đồ thừa từ trước khi Dừng → bắt poll xác nhận lại
    void startSrv(toolId);
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: active ? 'flex' : 'none',
        flexDirection: 'column',
        background: 'var(--bg-primary, #0f0f14)',
      }}
    >
      {/* Slim toolbar — reload / open-in-tab + hint if the tool server isn't up */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '8px 14px',
          borderBottom: '1px solid var(--border-subtle, #2a2a3e)',
          background: 'var(--bg-secondary, #16161e)',
          fontSize: '0.85rem',
          color: 'var(--text-muted, #b6b2c9)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: '0.95rem', color: flow.color || 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '1.15rem' }}>{flow.emoji}</span> {label}
        </span>
        <span style={{ opacity: 0.85 }}>{ready ? ui.toolbarHintReady : ui.toolbarHintWaiting}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          {toolId && st?.running && (
            <button
              onClick={handleStop}
              disabled={pending === 'stop'}
              title={ui.toolSrvStopTip}
              style={{ ...toolbarBtn, color: '#ffb4a6', opacity: pending === 'stop' ? 0.6 : 1 }}
            >
              <Square size={15} /> {ui.toolSrvStop}
            </button>
          )}
          <button onClick={reload} title={ui.toolbarReload} style={toolbarBtn}>
            <RotateCw size={16} /> {ui.toolbarReload}
          </button>
          <a href={withLang(url)} target="_blank" rel="noreferrer" title={ui.toolbarOpenNewTab} style={{ ...toolbarBtn, textDecoration: 'none' }}>
            <ExternalLink size={16} /> {ui.toolbarNewTab}
          </a>
        </div>
      </div>
      {ready && !manuallyStopped ? (
        <iframe
          key={nonce}
          ref={ref}
          src={withLang(url)}
          title={label}
          style={{ flex: 1, width: '100%', border: 0, background: 'var(--bg-primary, #0f0f14)' }}
        />
      ) : toolId && manuallyStopped ? (
        /* ─── Đã Dừng thủ công → chờ user chủ động bật lại (không auto-start) ─── */
        <div style={waitScreen}>
          <div style={{ fontSize: '2rem', opacity: 0.5 }}>{flow.emoji}</div>
          <div>{ui.toolSrvStoppedMsg}</div>
          <button onClick={handleStart} disabled={pending === 'stop'} style={{ ...bigStartBtn, borderColor: flow.color || 'var(--accent-primary)', color: flow.color || 'var(--accent-primary)' }}>
            <Play size={18} /> {fmt(ui.toolSrvStartTool, { name: label })}
          </button>
          {st?.lastError && <div style={{ fontSize: '0.8rem', color: '#ffb4a6' }}>{fmt(ui.toolSrvStopFailed, { error: st.lastError })}</div>}
        </div>
      ) : toolId && st?.phase === 'error' ? (
        /* ─── Server chết non → hiện lý do + log + Thử lại ─── */
        <div style={waitScreen}>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#ffb4a6' }}>{fmt(ui.toolSrvErrorTitle, { name: label })}</div>
          {st.lastError && <div style={{ fontSize: '0.85rem', maxWidth: 560, textAlign: 'center' }}>{st.lastError}</div>}
          {st.logTail.length > 0 && (
            <pre style={logTailBox}>{st.logTail.join('\n')}</pre>
          )}
          <button onClick={handleStart} style={{ ...bigStartBtn, borderColor: flow.color || 'var(--accent-primary)', color: flow.color || 'var(--accent-primary)' }}>
            <RotateCw size={16} /> {ui.toolSrvRetry}
          </button>
        </div>
      ) : (
        /* ─── Đang chờ server lên (auto-start đã gửi / server ngoài đang boot) ─── */
        <div style={waitScreen}>
          <RotateCw size={24} className="spin" style={{ color: flow.color || 'var(--accent-primary)' }} />
          <div>
            {toolId && st?.startedAt
              ? fmt(ui.toolSrvStarting, { name: label, s: Math.max(0, Math.floor((Date.now() - st.startedAt) / 1000)) })
              : <>{ui.hubWaitPrefix} <b>{label}</b> {ui.hubWaitSuffix} ({url.replace('http://', '')})…</>}
          </div>
          <div style={{ fontSize: '0.8rem', opacity: 0.85 }}>{ui.hubFirstRunHint}</div>
          {toolId && (
            <>
              {st && st.logTail.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <button onClick={() => setShowLog((v) => !v)} style={{ ...toolbarBtn, fontSize: '0.75rem', padding: '4px 10px' }}>
                    {showLog ? '▾' : '▸'} {ui.toolSrvLogTail}
                  </button>
                  {showLog && <pre style={logTailBox}>{st.logTail.join('\n')}</pre>}
                </div>
              )}
              <button onClick={handleStop} style={{ ...toolbarBtn, fontSize: '0.78rem', color: '#ffb4a6' }}>
                <Square size={13} /> {ui.toolSrvCancel}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const waitScreen: React.CSSProperties = {
  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  gap: 12, color: 'var(--text-muted, #b6b2c9)', fontSize: '0.95rem', padding: 16,
};

const bigStartBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '10px 22px', fontSize: '0.95rem', fontWeight: 700,
  border: '1.5px solid var(--accent-primary)', borderRadius: 10,
  background: 'transparent', cursor: 'pointer',
};

const logTailBox: React.CSSProperties = {
  maxWidth: 640, maxHeight: 180, overflow: 'auto', margin: 0,
  padding: '8px 12px', borderRadius: 8, fontSize: '0.72rem', lineHeight: 1.5,
  background: 'var(--bg-secondary, #16161e)', border: '1px solid var(--border-subtle, #2a2a3e)',
  color: 'var(--text-muted, #b6b2c9)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', textAlign: 'left',
};

const toolbarBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 12px',
  fontSize: '0.82rem',
  fontWeight: 600,
  border: '1px solid var(--border-subtle, #2a2a3e)',
  borderRadius: 7,
  background: 'var(--bg-elevated, #252536)',
  color: 'var(--text-secondary, #d6d3e4)',
  cursor: 'pointer',
};
