import { useSyncExternalStore, useEffect, useState } from 'react';
import { useStore } from '../store';
import { CallMonitor } from '../utils/callMonitor';
import { getRateLimitUsage, getUniqueKeyCount, getLaneFailures } from '../utils/apiClient';
import { Cpu, KeyRound, Activity, Gauge } from 'lucide-react';
import { useUi } from '../i18n/useLocale';
import { fmt } from '../i18n';

/** Live panel: which model is translating which entry, how many threads are
 *  running concurrently, and the combined RPM capacity across all API keys. */
export default function ActiveCallsPanel() {
  const { proxy, phase, fields, providers } = useStore();
  const ui = useUi();

  const activeCalls = useSyncExternalStore(CallMonitor.subscribe, CallMonitor.getSnapshot);

  // % hoàn thành tổng — field xong / auto-skip / bỏ qua (ignored = user tick bỏ dịch) đều tính là đã xử lý.
  const total = fields.length;
  const accounted = fields.filter((f) => f.status === 'done' || f.status === 'skipped' || f.status === 'ignored').length;
  const overallPct = total > 0 ? Math.round((accounted / total) * 100) : 0;

  // RPM usage decays over time without events, so refresh on a light interval while active.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (phase !== 'translating') return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const isTranslating = phase === 'translating';
  if (!isTranslating && activeCalls.length === 0) return null;

  // Tổng key TOÀN pool = provider chính + mọi provider phụ đang bật (trước đây chỉ
  // đếm proxy chính nên hiện "1 API key" dù có 2 provider).
  const keyCount = getUniqueKeyCount(proxy)
    + providers.filter((p) => p.enabled && p.model?.trim()).reduce((s, p) => s + getUniqueKeyCount(p), 0);
  const usage = getRateLimitUsage();
  // Lane FAIL liên tiếp (proxy chung nghẽn ngoài RPM): lane fail được nghỉ 15s/lần,
  // hiện cảnh báo vàng; fail ≥5 lần liên tiếp → tô ĐỎ + số lần để user biết lane đang chết.
  const failures = getLaneFailures();
  const accent = 'var(--accent-secondary)';

  // Đếm call ĐANG CHẠY (in-flight) theo từng lane (providerId+model) → hiện làm số CHÍNH để phân
  // biệt bận/rảnh. (RPM là cửa sổ 60s tính theo LÚC BẮT ĐẦU call; call chạy >60s rơi khỏi cửa sổ
  // nên hiện 0/RPM dù VẪN đang chạy → trước đây trông như lane rảnh.)
  const inFlightMap: Record<string, number> = {};
  for (const c of activeCalls) {
    const k = (c.providerId || 'default') + '|' + c.model;
    inFlightMap[k] = (inFlightMap[k] || 0) + 1;
  }

  // ─── Dựng lanes (provider + model) để hiện RPM tách theo từng provider ───
  const rlKey = (id: string, model: string) => (id === 'default' ? model : `${id}${model}`);
  const flKey = (id: string, model: string) => id + '|' + model;
  type Lane = { providerId: string; providerName: string; model: string; limit: number; used: number; inFlight: number; isSecondary: boolean; failCount: number };
  const lanes: Lane[] = [];
  const enabledProviders = providers.filter((p) => p.enabled && p.model?.trim());
  const showProviderName = enabledProviders.length > 0; // chỉ hiện tên provider khi có >1 provider
  const addLanes = (id: string, name: string, cfg: { model: string; primaryModelRpm: number; enableSecondaryModel: boolean; secondaryModel: string; secondaryModelRpm: number; apiKey: string; apiKeys: string[] }) => {
    const kc = getUniqueKeyCount(cfg);
    if (cfg.model) lanes.push({ providerId: id, providerName: name, model: cfg.model, isSecondary: false, limit: (cfg.primaryModelRpm > 0 ? cfg.primaryModelRpm : 5) * kc, used: usage[rlKey(id, cfg.model)] || 0, inFlight: inFlightMap[flKey(id, cfg.model)] || 0, failCount: failures[rlKey(id, cfg.model)]?.count || 0 });
    if (cfg.enableSecondaryModel && cfg.secondaryModel?.trim()) lanes.push({ providerId: id, providerName: name, model: cfg.secondaryModel, isSecondary: true, limit: (cfg.secondaryModelRpm > 0 ? cfg.secondaryModelRpm : 17) * kc, used: usage[rlKey(id, cfg.secondaryModel)] || 0, inFlight: inFlightMap[flKey(id, cfg.secondaryModel)] || 0, failCount: failures[rlKey(id, cfg.secondaryModel)]?.count || 0 });
  };
  addLanes('default', 'Provider #1', proxy);
  enabledProviders.forEach((p, i) => addLanes(p.id, p.name || `Provider #${i + 2}`, p));

  // ─── Token THẬT của run (usage từ API; call nào API không trả thì là ước lượng "~") ───
  const tok = CallMonitor.getTokenTotals();
  const kFmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
  const tokApprox = tok.estimatedCalls > 0 ? '~' : '';
  const tokByLane: Record<string, { input: number; output: number }> = {};
  for (const l of tok.lanes) tokByLane[l.providerId + '|' + l.model] = { input: l.input, output: l.output };

  return (
    <div
      style={{
        marginBottom: '12px',
        padding: '12px',
        background: 'rgba(56,189,248,0.05)',
        border: '1px solid rgba(56,189,248,0.2)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', fontWeight: 700, color: accent }}>
          <Activity size={14} className={activeCalls.length > 0 ? 'spin' : ''} />
          {fmt(ui.acRunning, { count: activeCalls.length })}
          {total > 0 && (
            <span style={{ fontSize: '0.66rem', fontWeight: 700, color: 'var(--accent-primary)', background: 'rgba(124,106,240,0.14)', padding: '1px 7px', borderRadius: '10px' }}>
              {overallPct}% ({accounted}/{total})
            </span>
          )}
        </span>
        <div style={{ display: 'flex', gap: '12px', fontSize: '0.65rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <KeyRound size={11} /> {keyCount} API key{keyCount > 1 ? 's' : ''}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Activity size={11} /> {fmt(ui.acPeak, { count: CallMonitor.getPeakConcurrency() })}
          </span>
          <span>{fmt(ui.acCompleted, { count: CallMonitor.getCompleted() })}</span>
          {tok.calls > 0 && (
            <span
              title={`Token thật cả lượt dịch (đọc từ usage của API): ${tok.input.toLocaleString()} vào / ${tok.output.toLocaleString()} ra, ${tok.calls} call.${tok.estimatedCalls > 0 ? ` ${tok.estimatedCalls} call API không trả usage — phần đó ước lượng từ ký tự (dấu ~).` : ''}`}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 700, color: 'var(--text-secondary)' }}
            >
              🧮 {tokApprox}{kFmt(tok.input)} vào · {tokApprox}{kFmt(tok.output)} ra
            </span>
          )}
        </div>
      </div>

      {/* RPM theo từng provider + model (mỗi lane 1 thanh) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: activeCalls.length > 0 ? '10px' : '0' }}>
        {lanes.map((lane) => {
          // Bar theo số call ĐANG CHẠY (in-flight) để nhìn phát biết lane bận/rảnh, không bị RPM
          // "cửa sổ 60s" đánh lừa (call chạy lâu rơi khỏi cửa sổ).
          const pct = lane.limit > 0 ? Math.min(100, (lane.inFlight / lane.limit) * 100) : 0;
          const laneActiveColor = lane.isSecondary ? '#fbbf24' : accent;
          return (
            <div key={lane.providerId + '|' + lane.model + '|' + (lane.isSecondary ? 's' : 'p')}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.66rem', marginBottom: '3px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--text-secondary)', minWidth: 0 }}>
                  <Cpu size={11} style={{ flexShrink: 0, color: lane.isSecondary ? '#fbbf24' : accent }} />
                  {showProviderName && <span style={{ fontSize: '0.55rem', color: 'var(--text-muted)', background: 'var(--bg-secondary)', padding: '0 4px', borderRadius: '3px', flexShrink: 0 }}>{lane.providerName}</span>}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: lane.failCount >= 5 ? 'var(--accent-danger)' : undefined, fontWeight: lane.failCount >= 5 ? 700 : undefined }}>{lane.model}</span>
                  {lane.isSecondary && <span style={{ fontSize: '0.55rem', color: '#fbbf24', flexShrink: 0 }}>{ui.acSecondary}</span>}
                  {lane.failCount > 0 && (
                    <span
                      title={`Lane này đã fail ${lane.failCount} lần liên tiếp (429/5xx/timeout — proxy có thể đang nghẽn). Mỗi lần fail lane tự nghỉ 15s, call dồn sang lane khác; thành công sẽ tự reset.`}
                      style={{
                        flexShrink: 0, fontSize: '0.55rem', fontWeight: 800, padding: '0 5px', borderRadius: '3px',
                        color: lane.failCount >= 5 ? '#fff' : 'var(--accent-danger)',
                        background: lane.failCount >= 5 ? 'var(--accent-danger)' : 'rgba(239,68,68,0.15)',
                        border: '1px solid var(--accent-danger)',
                      }}
                    >
                      ⚠ lỗi ×{lane.failCount}
                    </span>
                  )}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <span
                    title="Số call ĐANG CHẠY trên lane này ngay lúc này (in-flight). >0 = đang bận."
                    style={{ display: 'flex', alignItems: 'center', gap: '3px', fontWeight: 700, color: lane.inFlight > 0 ? laneActiveColor : 'var(--text-muted)' }}
                  >
                    ▶ {lane.inFlight}
                  </span>
                  <span
                    title="RPM: số call BẮT ĐẦU trong 60 giây qua / giới hạn. Chỉ đếm lúc BẮT ĐẦU nên call chạy >60s không còn tính ở đây (nhìn ▶ để biết lane có bận không)."
                    style={{ display: 'flex', alignItems: 'center', gap: '3px', color: 'var(--text-muted)', fontSize: '0.6rem' }}
                  >
                    <Gauge size={10} /> {lane.used}/{lane.limit}
                  </span>
                  {tokByLane[lane.providerId + '|' + lane.model] && (
                    <span
                      title="Token lane này đã dùng trong lượt dịch (vào / ra)"
                      style={{ color: 'var(--text-muted)', fontSize: '0.58rem', fontFamily: 'monospace' }}
                    >
                      🧮 {kFmt(tokByLane[lane.providerId + '|' + lane.model].input)}/{kFmt(tokByLane[lane.providerId + '|' + lane.model].output)}
                    </span>
                  )}
                </span>
              </div>
              <div className="progress-track" style={{ height: '4px' }}>
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: pct > 85 ? 'var(--accent-danger)' : lane.isSecondary ? '#fbbf24' : 'linear-gradient(90deg, var(--accent-secondary), var(--accent-primary))',
                    borderRadius: 'inherit',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Active call list */}
      {activeCalls.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '180px', overflowY: 'auto' }}>
          {activeCalls.map((c) => (
            <ActiveCallRow key={c.id} model={c.model} provider={c.provider} keyLabel={c.keyLabel} label={c.label} startedAt={c.startedAt} isSecondary={c.model === proxy.secondaryModel} />
          ))}
        </div>
      )}
    </div>
  );
}

const PROVIDER_LABEL: Record<string, string> = {
  openai: 'OpenAI', anthropic: 'Claude', google: 'Gemini', custom: 'Custom',
};

function ActiveCallRow({ model, provider, keyLabel, label, startedAt, isSecondary }: { model: string; provider?: string; keyLabel: string; label: string; startedAt: number; isSecondary: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const providerName = provider ? (PROVIDER_LABEL[provider] || provider) : '';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '5px 8px',
        background: 'rgba(0,0,0,0.18)',
        borderRadius: '4px',
        borderLeft: `2px solid ${isSecondary ? '#fbbf24' : 'var(--accent-secondary)'}`,
        fontSize: '0.66rem',
      }}
    >
      <span
        style={{
          fontWeight: 700,
          color: isSecondary ? '#fbbf24' : 'var(--accent-secondary)',
          background: isSecondary ? 'rgba(251,191,36,0.12)' : 'rgba(56,189,248,0.12)',
          padding: '1px 6px',
          borderRadius: '3px',
          flexShrink: 0,
          maxWidth: '120px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={`${providerName ? providerName + ' · ' : ''}${model}`}
      >
        {model}
      </span>
      {providerName && (
        <span style={{ fontSize: '0.55rem', color: 'var(--text-muted)', background: 'var(--bg-secondary)', padding: '1px 5px', borderRadius: '3px', flexShrink: 0 }} title="Provider">
          {providerName}
        </span>
      )}
      <span style={{ color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={label}>
        {label}
      </span>
      <span style={{ color: 'var(--text-muted)', flexShrink: 0, fontSize: '0.58rem' }}>{keyLabel}</span>
      <span style={{ color: 'var(--text-muted)', flexShrink: 0, fontFamily: 'monospace' }}>{elapsed}s</span>
    </div>
  );
}
