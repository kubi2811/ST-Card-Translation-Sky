import { useState } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n/useLocale';
import { testConnection, getModelSuggestions, getDefaultProxyUrl, fetchModelsFromProxy } from '../utils/apiClient';
import type { AIProvider } from '../types/card';
import {
  Settings,
  Eye,
  EyeOff,
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
} from 'lucide-react';

const PROVIDERS: { value: AIProvider; label: string }[] = [
  { value: 'openai', label: 'OpenAI Compatible' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google (Gemini)' },
  { value: 'custom', label: 'Custom / Local' },
];

export default function ProxyConfig() {
  const { proxy, setProxy, connectionStatus, setConnectionStatus, scannedModels, setScannedModels, addToast, locale } = useStore();
  const t = useT();
  const [showKey, setShowKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showKeyRotation, setShowKeyRotation] = useState(false);
  const [scanning, setScanning] = useState(false);

  const suggestions = [
    ...scannedModels,
    ...getModelSuggestions(proxy.provider).filter(s => !scannedModels.includes(s))
  ];

  const handleProviderChange = (provider: AIProvider) => {
    setProxy({
      provider,
      proxyUrl: getDefaultProxyUrl(provider),
      model: getModelSuggestions(provider)[0] || '',
    });
    setConnectionStatus('untested');
    setTestMessage('');
    setScannedModels([]);
  };

  const handleScanModels = async () => {
    setScanning(true);
    try {
      const models = await fetchModelsFromProxy(proxy);
      setScannedModels(models);
      const successMsg = locale === 'vi'
        ? `Đã tải thành công ${models.length} mô hình từ proxy!`
        : `Successfully loaded ${models.length} models from proxy!`;
      addToast('success', successMsg);
    } catch (err: any) {
      const errorMsg = locale === 'vi'
        ? `Lỗi khi quét mô hình: ${err.message || String(err)}`
        : `Failed to scan models: ${err.message || String(err)}`;
      addToast('error', errorMsg);
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
      <div className="section-header" onClick={() => {}}>
        <span className="section-title">
          <Settings size={16} style={{ color: 'var(--accent-primary)' }} />
          {t.apiConfiguration}
        </span>
        {statusBadge()}
      </div>
      <div className="section-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* Provider */}
        <div>
          <label className="label">{t.aiProvider}</label>
          <select
            className="input"
            value={proxy.provider}
            onChange={(e) => handleProviderChange(e.target.value as AIProvider)}
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        {/* Proxy URL */}
        <div>
          <label className="label">{t.apiBaseUrl}</label>
          <input
            className="input input-mono"
            value={proxy.proxyUrl}
            onChange={(e) => setProxy({ proxyUrl: e.target.value })}
            placeholder="http://localhost:8080/v1"
          />
        </div>

        {/* API Key */}
        <div>
          <label className="label">{t.apiKey}</label>
          <div style={{ position: 'relative' }}>
            <input
              className="input input-mono"
              type={showKey ? 'text' : 'password'}
              value={proxy.apiKey}
              onChange={(e) => setProxy({ apiKey: e.target.value })}
              placeholder="sk-..."
              style={{ paddingRight: '40px' }}
            />
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => setShowKey(!showKey)}
              style={{
                position: 'absolute',
                right: '4px',
                top: '50%',
                transform: 'translateY(-50%)',
                padding: '4px',
              }}
              type="button"
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        {/* API Key Rotation */}
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
            onClick={() => setShowKeyRotation(!showKeyRotation)}
          >
            {showKeyRotation ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <RefreshCw size={13} />
            API Key Rotation
            {proxy.apiKeys.filter(k => k.trim()).length > 0 && (
              <span style={{
                fontSize: '0.65rem',
                padding: '1px 6px',
                background: 'rgba(124,106,240,0.1)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--accent-primary)',
                fontWeight: 600,
              }}>
                {proxy.apiKeys.filter(k => k.trim()).length + 1} keys
              </span>
            )}
          </div>

          {showKeyRotation && (
            <div className="fade-in" style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                {t.apiKey} pool — one per line. Auto-rotates on rate limit (429). Primary key above is always included.
              </div>
              <textarea
                className="input input-mono"
                rows={4}
                value={proxy.apiKeys.join('\n')}
                onChange={(e) => setProxy({ apiKeys: e.target.value.split('\n') })}
                placeholder={`sk-key2...\nsk-key3...\nAIza...`}
                style={{ fontSize: '0.75rem', resize: 'vertical' }}
              />
              <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                {proxy.apiKeys.filter(k => k.trim()).length === 0
                  ? 'No extra keys. Using primary key only.'
                  : `${proxy.apiKeys.filter(k => k.trim()).length} extra key(s) + 1 primary = ${proxy.apiKeys.filter(k => k.trim()).length + 1} keys in rotation`
                }
              </div>
            </div>
          )}
        </div>

        {/* Model */}
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <label className="label" style={{ marginBottom: 0 }}>{t.model}</label>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={handleScanModels}
              disabled={scanning || !proxy.proxyUrl}
              style={{
                fontSize: '0.7rem',
                padding: '2px 6px',
                color: 'var(--accent-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                height: 'auto',
                minHeight: 'auto',
              }}
            >
              {scanning ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <RefreshCw size={11} />
              )}
              {scanning ? t.scanningModels : t.scanModels}
            </button>
          </div>
          <input
            className="input input-mono"
            value={proxy.model}
            onChange={(e) => setProxy({ model: e.target.value })}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            placeholder="gpt-4o"
          />
          {showSuggestions && suggestions.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                zIndex: 50,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                marginTop: '4px',
                maxHeight: '180px',
                overflowY: 'auto',
                boxShadow: 'var(--shadow-md)',
              }}
            >
              {suggestions.map((s) => (
                <div
                  key={s}
                  style={{
                    padding: '6px 12px',
                    fontSize: '0.8rem',
                    fontFamily: 'var(--font-mono)',
                    cursor: 'pointer',
                    transition: 'background 0.1s',
                  }}
                  onMouseDown={() => {
                    setProxy({ model: s });
                    setShowSuggestions(false);
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  {s}
                </div>
              ))}
            </div>
          )}
        </div>

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

        {/* Test Connection */}
        <button
          className="btn btn-secondary"
          onClick={handleTest}
          disabled={testing || !proxy.proxyUrl}
        >
          {testing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
          {testing ? t.testing : t.testConnection}
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
