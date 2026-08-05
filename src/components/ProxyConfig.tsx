import { useState } from 'react';
import { useStore } from '../store';
import { useT, useUi } from '../i18n/useLocale';
import { fmt } from '../i18n';
import { testConnection, getModelSuggestions, fetchModelsFromProxy, detectProviderFromUrl } from '../utils/apiClient';
import ProviderPoolConfig from './ProviderPoolConfig';
import KeysTextarea from './KeysTextarea';
import ModelPicker from './ModelPicker';
import {
  Settings,
  ChevronDown,
  ChevronRight,
  Wifi,
  WifiOff,
  Loader2,
  Zap,
  CircleDot,
  RotateCcw,
  RefreshCw,
  ShieldCheck,
  BrainCircuit,
  Layers,
} from 'lucide-react';

// Nhãn hiển thị loại provider TỰ NHẬN từ Base URL (badge cạnh ô URL — user không phải chọn tay).
const PROVIDER_LABEL: Record<string, string> = {
  openai: 'OpenAI-compatible',
  anthropic: 'Anthropic (Claude)',
  google: 'Google (Gemini)',
  custom: 'Custom / Local',
};

export default function ProxyConfig() {
  // (bugNeedFix/39) selector hẹp — trước đây subscribe toàn store, re-render theo mọi set() lúc dịch.
  const proxy = useStore((s) => s.proxy);
  const setProxy = useStore((s) => s.setProxy);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const setConnectionStatus = useStore((s) => s.setConnectionStatus);
  const scannedModels = useStore((s) => s.scannedModels);
  const setScannedModels = useStore((s) => s.setScannedModels);
  const addToast = useStore((s) => s.addToast);
  const locale = useStore((s) => s.locale);
  const resetProxy = useStore((s) => s.resetProxy);
  const t = useT();
  const ui = useUi();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  const [scanning, setScanning] = useState(false);

  const suggestions = [
    ...scannedModels,
    ...getModelSuggestions(proxy.provider).filter(s => !scannedModels.includes(s))
  ];

  // (User 2026) Bỏ field "Loại" — đổi Base URL là tự nhận diện provider (định dạng request).
  const handleUrlChange = (url: string) => {
    setProxy({ proxyUrl: url, provider: detectProviderFromUrl(url) });
    setConnectionStatus('untested');
    setTestMessage('');
  };

  const handleScanModels = async () => {
    setScanning(true);
    try {
      const models = await fetchModelsFromProxy(proxy);
      setScannedModels(models);
      addToast('success', fmt(ui.pcScanOk, { count: models.length }));
    } catch (err: any) {
      addToast('error', fmt(ui.pcScanFail, { msg: err.message || String(err) }));
    } finally {
      setScanning(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestMessage('');
    try {
      const result = await testConnection(proxy);
      setConnectionStatus(result.ok ? 'connected' : 'failed');
      setTestMessage(result.message);
    } catch {
      setConnectionStatus('failed');
      setTestMessage('Unexpected error during test');
    }
    setTesting(false);
  };

  const statusBadge = () => {
    switch (connectionStatus) {
      case 'connected':
        return <span className="badge badge-success"><Wifi size={10} /> {t.connected}</span>;
      case 'failed':
        return <span className="badge badge-danger"><WifiOff size={10} /> {t.failed}</span>;
      default:
        return <span className="badge badge-neutral"><CircleDot size={10} /> {t.notTested}</span>;
    }
  };

  return (
    <div className="section">
      {/* (bug 213) Bỏ onClick rỗng: class .section-header có style :hover đổi nền nên header trông
          như bấm mở/đóng được, bấm lại chẳng làm gì. Tàn dư của collapsible cũ — giờ
          CollapsibleSection ở App.tsx đã đảm nhận việc thu gọn. */}
      <div className="section-header">
        <span className="section-title">
          <Settings size={16} style={{ color: 'var(--accent-primary)' }} />
          {t.apiConfiguration}
        </span>
        {statusBadge()}
      </div>
      <div className="section-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* ═══ PROVIDER #1 (CHÍNH) — card teal ĐỒNG BỘ giao diện với "Provider bổ sung" bên dưới.
            Về lý thuyết provider chính và provider phụ hoàn toàn ngang hàng (engine gộp chung pool)
            nên giao diện phải giống nhau, không ưu tiên mục nào (feedback user). ═══ */}
        <div style={{ border: '1px solid var(--accent-secondary)', borderRadius: 'var(--radius-sm)', padding: 10, display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(56,189,248,0.04)' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Layers size={14} style={{ color: 'var(--accent-secondary)', flexShrink: 0 }} />
            <span style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-primary)' }}>{ui.pcMainProviderTitle}</span>
          </div>

          {/* Base URL (full) — loại provider TỰ NHẬN từ URL (badge bên phải, không còn field "Loại") */}
          <div>
            <label style={{ fontSize: '0.64rem', color: 'var(--text-muted)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
              Base URL
              <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: 8, color: 'var(--accent-secondary)', background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.25)' }}>
                → {PROVIDER_LABEL[proxy.provider] || proxy.provider}
              </span>
            </label>
            <input
              className="input input-mono"
              value={proxy.proxyUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="https://api.openai.com/v1 · …generativelanguage.googleapis.com · …anthropic.com"
              style={{ fontSize: '0.78rem', padding: '6px 9px', width: '100%' }}
            />
          </div>

          {/* API Key — nhiều key, mỗi dòng 1 key (KeysTextarea fix bug Enter không xuống dòng) */}
          {(() => {
            const allKeys = [proxy.apiKey, ...(proxy.apiKeys || [])].filter(Boolean);
            const keyCount = allKeys.filter(k => k.trim()).length;
            return (
              <div>
                <label style={{ fontSize: '0.64rem', color: 'var(--text-muted)', marginBottom: 2, display: 'block', fontWeight: 600 }}>
                  {t.apiKey}{' '}
                  {keyCount > 0 && <span style={{ color: 'var(--accent-secondary)' }}>{keyCount} key</span>}{' '}
                  <span style={{ fontWeight: 400 }}>{ui.pcKeyHint}</span>
                </label>
                <KeysTextarea
                  className="input input-mono"
                  keys={allKeys}
                  onKeys={(keys) => setProxy({ apiKey: keys[0] || '', apiKeys: keys.slice(1) })}
                  rows={2}
                  placeholder={ui.pcKeyPh}
                  style={{ fontSize: '0.72rem', resize: 'vertical', width: '100%' }}
                />
              </div>
            );
          })()}

          {/* Nút Load model (như provider phụ) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={handleScanModels}
              disabled={scanning || !proxy.proxyUrl}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', fontSize: '0.72rem', fontWeight: 600, cursor: scanning ? 'default' : 'pointer', background: 'var(--bg-elevated)', color: 'var(--accent-secondary)', border: '1px solid var(--accent-secondary)', borderRadius: 'var(--radius-sm)' }}
            >
              {scanning ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />} Load model
            </button>
            {scannedModels.length > 0 && (
              <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>{scannedModels.length} model</span>
            )}
          </div>
          {/* Model chính + RPM chính (2 cột — như provider phụ) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 8 }}>
            <div>
              <label style={{ fontSize: '0.64rem', color: 'var(--text-muted)', marginBottom: 2, display: 'block', fontWeight: 600 }}>{ui.ppPrimaryModel}</label>
              <ModelPicker
                className="input input-mono"
                value={proxy.model}
                onChange={(m) => setProxy({ model: m })}
                models={suggestions}
                placeholder="gpt-4o"
                style={{ fontSize: '0.78rem', padding: '6px 9px', width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.64rem', color: 'var(--text-muted)', marginBottom: 2, display: 'block', fontWeight: 600 }} title={ui.pcPrimaryRpmTitle}>{ui.ppPrimaryRpm}</label>
              <input
                className="input" type="number" min={1} max={1000}
                value={proxy.primaryModelRpm ?? 5}
                onChange={(e) => setProxy({ primaryModelRpm: Math.max(1, parseInt(e.target.value) || 5) })}
                style={{ padding: '6px 6px', fontSize: '0.8rem', textAlign: 'center' }}
              />
            </div>
          </div>

          {/* Model phụ (như provider phụ) */}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!proxy.enableSecondaryModel} onChange={(e) => setProxy({ enableSecondaryModel: e.target.checked })} />
            <span style={{ fontWeight: 600 }}>{ui.pcSecondary}</span>
            <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>{ui.pcSecondaryHint}</span>
          </label>
          {proxy.enableSecondaryModel && (
            <div className="fade-in" style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px', gap: 8 }}>
              <div>
                <label style={{ fontSize: '0.64rem', color: 'var(--text-muted)', marginBottom: 2, display: 'block', fontWeight: 600 }}>{ui.ppSecondaryModel}</label>
                <ModelPicker
                  className="input input-mono"
                  value={proxy.secondaryModel ?? ''}
                  onChange={(m) => setProxy({ secondaryModel: m })}
                  models={suggestions}
                  placeholder="flash…"
                  style={{ fontSize: '0.76rem', padding: '6px 9px', width: '100%' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.64rem', color: 'var(--text-muted)', marginBottom: 2, display: 'block', fontWeight: 600 }} title={ui.pcSecondaryRpmTitle}>{ui.ppSecondaryRpm}</label>
                <input
                  className="input" type="number" min={1} max={1000}
                  value={proxy.secondaryModelRpm ?? 17}
                  onChange={(e) => setProxy({ secondaryModelRpm: Math.max(1, parseInt(e.target.value) || 17) })}
                  style={{ padding: '6px 6px', fontSize: '0.8rem', textAlign: 'center' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.64rem', color: 'var(--text-muted)', marginBottom: 2, display: 'block', fontWeight: 600 }} title={ui.pcThresholdTitle}>{ui.ppThreshold}</label>
                <input
                  className="input" type="number" min={0} max={100000}
                  value={proxy.secondaryModelThreshold ?? 0}
                  onChange={(e) => setProxy({ secondaryModelThreshold: Math.max(0, parseInt(e.target.value) || 0) })}
                  style={{ padding: '6px 6px', fontSize: '0.8rem', textAlign: 'center' }}
                  placeholder="10000"
                />
              </div>
            </div>
          )}
        </div>

        {/* Provider bổ sung — đa provider chạy song song */}
        <ProviderPoolConfig />

        {/* (Audit đợt 2) CORS Proxy + Expert Mode đã dời vào mục "Advanced Settings" bên dưới
            — knob tình huống/chuyên sâu, người dùng thường không cần thấy ở tầng cơ bản. */}

        {/* Test Connection */}
        <button
          className="btn btn-secondary"
          onClick={handleTest}
          disabled={testing || !proxy.proxyUrl}
        >
          {testing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
          {testing ? t.testing : t.testConnection}
        </button>

        {/* Reset API Configuration */}
        <button
          className="btn btn-ghost"
          style={{
            color: 'var(--accent-warning)',
            border: '1px dashed var(--border-subtle)',
            fontSize: '0.8rem',
            gap: '6px',
            marginTop: '2px',
          }}
          onClick={() => {
            if (confirm(t.confirmResetApi)) {
              resetProxy();
              addToast('success', t.apiConfigResetSuccess);
            }
          }}
        >
          <RotateCcw size={13} />
          {t.resetApiConfig}
        </button>
        {testMessage && (
          <div
            style={{
              fontSize: '0.75rem',
              color: connectionStatus === 'connected' ? 'var(--accent-success)' : 'var(--accent-danger)',
              padding: '6px 8px',
              background: connectionStatus === 'connected'
                ? 'rgba(106,240,138,0.05)'
                : 'rgba(240,106,106,0.05)',
              borderRadius: 'var(--radius-sm)',
              wordBreak: 'break-word',
            }}
          >
            {testMessage}
          </div>
        )}

        {/* Advanced Settings */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '8px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              fontSize: '0.8rem',
              color: 'var(--text-secondary)',
              userSelect: 'none',
            }}
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {t.advancedSettings}
          </div>

          {showAdvanced && (
            <div
              className="fade-in"
              style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}
            >
              {/* CORS Proxy Toggle */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: proxy.useCorsProxy
                    ? 'rgba(106, 240, 138, 0.06)'
                    : 'rgba(240, 180, 106, 0.06)',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${proxy.useCorsProxy ? 'rgba(106,240,138,0.2)' : 'rgba(240,180,106,0.2)'}`,
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <ShieldCheck
                    size={15}
                    style={{ color: proxy.useCorsProxy ? 'var(--accent-success)' : 'var(--text-muted)', flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{t.corsProxy}</div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '1px' }}>
                      {proxy.useCorsProxy ? t.corsProxyActive : t.corsProxyInactive}
                    </div>
                  </div>
                </div>
                <label
                  style={{
                    position: 'relative',
                    display: 'inline-block',
                    width: '36px',
                    height: '20px',
                    flexShrink: 0,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={proxy.useCorsProxy}
                    onChange={(e) => {
                      setProxy({ useCorsProxy: e.target.checked });
                      setConnectionStatus('untested');
                      setTestMessage('');
                    }}
                    style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      inset: 0,
                      borderRadius: '10px',
                      background: proxy.useCorsProxy ? 'var(--accent-success)' : 'var(--border-default)',
                      transition: 'background 0.2s',
                    }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      top: '2px',
                      left: proxy.useCorsProxy ? '18px' : '2px',
                      width: '16px',
                      height: '16px',
                      borderRadius: '50%',
                      background: 'white',
                      transition: 'left 0.2s',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    }}
                  />
                </label>
              </div>

              {/* Expert Mode Toggle */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: proxy.expertMode
                    ? 'rgba(124, 106, 240, 0.06)'
                    : 'rgba(180, 180, 180, 0.04)',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${proxy.expertMode ? 'rgba(124,106,240,0.2)' : 'rgba(180,180,180,0.1)'}`,
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <BrainCircuit
                    size={15}
                    style={{ color: proxy.expertMode ? 'var(--accent-primary)' : 'var(--text-muted)', flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>Expert Mode</div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '1px' }}>
                      {proxy.expertMode
                        ? 'XML reasoning active — higher quality, +30% tokens'
                        : 'Standard mode — faster, lower token cost'}
                    </div>
                  </div>
                </div>
                <label
                  style={{
                    position: 'relative',
                    display: 'inline-block',
                    width: '36px',
                    height: '20px',
                    flexShrink: 0,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={proxy.expertMode}
                    onChange={(e) => {
                      setProxy({ expertMode: e.target.checked });
                    }}
                    style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      inset: 0,
                      borderRadius: '10px',
                      background: proxy.expertMode ? 'var(--accent-primary)' : 'var(--border-default)',
                      transition: 'background 0.2s',
                    }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      top: '2px',
                      left: proxy.expertMode ? '18px' : '2px',
                      width: '16px',
                      height: '16px',
                      borderRadius: '50%',
                      background: 'white',
                      transition: 'left 0.2s',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    }}
                  />
                </label>
              </div>

              {/* Max Tokens */}
              <div>
                <label className="label">{t.maxTokensPerRequest}</label>
                <input
                  className="input"
                  type="number"
                  min={256}
                  max={1048576}
                  value={proxy.maxTokens}
                  onChange={(e) => setProxy({ maxTokens: parseInt(e.target.value) || 65536 })}
                />
                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Gemini 2.5 Pro: max 65535 output tokens, 1M input context
                </div>
              </div>

              {/* Temperature */}
              <div>
                <label className="label">
                  {t.temperature}: {proxy.temperature.toFixed(1)}
                </label>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={proxy.temperature}
                  onChange={(e) => setProxy({ temperature: parseFloat(e.target.value) })}
                />
              </div>

              {/* Top P */}
              <div>
                <label className="label">
                  {t.topP}: {proxy.topP.toFixed(2)}
                  {proxy.topP !== 1 && <span style={{ fontSize: '0.55rem', color: 'var(--accent-primary)', marginLeft: '6px' }}>🎯 {t.presetOverride}</span>}
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={proxy.topP}
                  onChange={(e) => setProxy({ topP: parseFloat(e.target.value) })}
                />
              </div>

              {/* Top K */}
              <div>
                <label className="label">
                  {t.topK}: {proxy.topK}
                  {proxy.topK !== 0 && <span style={{ fontSize: '0.55rem', color: 'var(--accent-primary)', marginLeft: '6px' }}>🎯 {t.presetOverride}</span>}
                </label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={500}
                  value={proxy.topK}
                  onChange={(e) => setProxy({ topK: parseInt(e.target.value) || 0 })}
                />
              </div>

              {/* Min P */}
              <div>
                <label className="label">
                  {t.minP}: {proxy.minP.toFixed(2)}
                  {proxy.minP !== 0 && <span style={{ fontSize: '0.55rem', color: 'var(--accent-primary)', marginLeft: '6px' }}>🎯 {t.presetOverride}</span>}
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={proxy.minP}
                  onChange={(e) => setProxy({ minP: parseFloat(e.target.value) })}
                />
              </div>

              {/* Frequency Penalty */}
              <div>
                <label className="label">
                  {t.frequencyPenalty}: {proxy.frequencyPenalty.toFixed(2)}
                  {proxy.frequencyPenalty !== 0 && <span style={{ fontSize: '0.55rem', color: 'var(--accent-primary)', marginLeft: '6px' }}>🎯 {t.presetOverride}</span>}
                </label>
                <input
                  type="range"
                  min={-2}
                  max={2}
                  step={0.01}
                  value={proxy.frequencyPenalty}
                  onChange={(e) => setProxy({ frequencyPenalty: parseFloat(e.target.value) })}
                />
              </div>

              {/* Presence Penalty */}
              <div>
                <label className="label">
                  {t.presencePenalty}: {proxy.presencePenalty.toFixed(2)}
                  {proxy.presencePenalty !== 0 && <span style={{ fontSize: '0.55rem', color: 'var(--accent-primary)', marginLeft: '6px' }}>🎯 {t.presetOverride}</span>}
                </label>
                <input
                  type="range"
                  min={-2}
                  max={2}
                  step={0.01}
                  value={proxy.presencePenalty}
                  onChange={(e) => setProxy({ presencePenalty: parseFloat(e.target.value) })}
                />
              </div>

              {/* Repetition Penalty */}
              <div>
                <label className="label">
                  {t.repetitionPenalty}: {proxy.repetitionPenalty.toFixed(2)}
                  {proxy.repetitionPenalty !== 1 && <span style={{ fontSize: '0.55rem', color: 'var(--accent-primary)', marginLeft: '6px' }}>🎯 {t.presetOverride}</span>}
                </label>
                <input
                  type="range"
                  min={1}
                  max={2}
                  step={0.01}
                  value={proxy.repetitionPenalty}
                  onChange={(e) => setProxy({ repetitionPenalty: parseFloat(e.target.value) })}
                />
              </div>

              {/* Request Delay */}
              <div>
                <label className="label">{t.delayBetweenRequests}</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={10000}
                  step={100}
                  value={proxy.requestDelay}
                  onChange={(e) => setProxy({ requestDelay: parseInt(e.target.value) || 0 })}
                />
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {t.delayBetweenRequestsHint}
                </div>
              </div>

              {/* Retry Delay */}
              <div>
                <label className="label">{t.retryDelay}</label>
                <input
                  className="input"
                  type="number"
                  min={100}
                  max={30000}
                  step={100}
                  value={proxy.retryDelay}
                  onChange={(e) => setProxy({ retryDelay: parseInt(e.target.value) || 1000 })}
                />
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {t.retryDelayHint}
                </div>
              </div>

              {/* Request Timeout */}
              <div>
                <label className="label">{t.requestTimeout}</label>
                <input
                  className="input"
                  type="number"
                  min={5000}
                  max={1800000}
                  step={1000}
                  value={proxy.requestTimeout}
                  onChange={(e) => setProxy({ requestTimeout: parseInt(e.target.value) || 600000 })}
                />
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {t.requestTimeoutHint}
                </div>
              </div>

              {/* Max Retries */}
              <div>
                <label className="label">{t.maxRetriesOnFailure}</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={10}
                  value={proxy.maxRetries}
                  onChange={(e) => setProxy({ maxRetries: parseInt(e.target.value) || 3 })}
                />
              </div>

              {/* Min Response Ratio */}
              <div>
                <label className="label">
                  {t.minResponseLengthRatio}: {(proxy.minResponseRatio * 100).toFixed(0)}%
                </label>
                <input
                  type="range"
                  min={0}
                  max={0.5}
                  step={0.05}
                  value={proxy.minResponseRatio}
                  onChange={(e) => setProxy({ minResponseRatio: parseFloat(e.target.value) })}
                />
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {t.minResponseLengthRatioHint}
                </div>
              </div>

              {/* System Prompt Prefix */}
              <div>
                <label className="label">{t.systemPromptPrefix}</label>
                <textarea
                  className="input"
                  rows={3}
                  value={proxy.systemPromptPrefix}
                  onChange={(e) => setProxy({ systemPromptPrefix: e.target.value })}
                  placeholder={t.systemPromptPrefixPlaceholder}
                />
              </div>

              {/* Stream Toggle */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  marginTop: '4px',
                }}
              >
                <input
                  type="checkbox"
                  checked={proxy.useStream}
                  onChange={(e) => setProxy({ useStream: e.target.checked })}
                  style={{ cursor: 'pointer' }}
                />
                Use Streaming (SSE)
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  Disable if proxy doesn't support streams
                </span>
              </label>

              {/* Reset Defaults */}
              <button
                className="btn btn-ghost"
                style={{
                  width: '100%',
                  marginTop: '4px',
                  color: 'var(--accent-warning)',
                  border: '1px dashed var(--border-subtle)',
                  fontSize: '0.8rem',
                  gap: '6px',
                }}
                onClick={() => {
                  setProxy({
                    maxTokens: 65536,
                    temperature: 0.3,
                    topP: 1,
                    topK: 0,
                    minP: 0,
                    frequencyPenalty: 0,
                    presencePenalty: 0,
                    repetitionPenalty: 1,
                    requestDelay: 500,
                    retryDelay: 1000,
                    requestTimeout: 600000,
                    maxRetries: 3,
                    minResponseRatio: 0.15,
                    systemPromptPrefix: '',
                    expertMode: false,
                    useStream: true,
                  });
                }}
              >
                <RotateCcw size={13} />
                {t.resetDefaults}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
