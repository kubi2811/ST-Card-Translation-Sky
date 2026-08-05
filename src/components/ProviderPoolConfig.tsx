import { useStore } from '../store';
import { fetchModelsFromProxy, detectProviderFromUrl } from '../utils/apiClient';
import type { ProviderConfig, ProxySettings } from '../types/card';
import { Plus, Trash2, Server, ChevronDown, ChevronRight, RefreshCw, Loader2 } from 'lucide-react';
import { useState } from 'react';
import KeysTextarea from './KeysTextarea';
import ModelPicker from './ModelPicker';
import { useUi } from '../i18n/useLocale';
import { fmt } from '../i18n';

// Nhãn loại provider TỰ NHẬN từ Base URL (badge — không còn field "Loại").
const PROVIDER_LABEL: Record<string, string> = {
  openai: 'OpenAI-compatible', anthropic: 'Anthropic (Claude)', google: 'Google (Gemini)', custom: 'Custom / Local',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 9px', fontSize: '0.78rem', background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
};
const lbl: React.CSSProperties = { fontSize: '0.64rem', color: 'var(--text-muted)', marginBottom: 2, display: 'block', fontWeight: 600 };

/**
 * Cấu hình các PROVIDER PHỤ (ngoài provider chính #1). Engine gộp tất cả provider đang bật → rải
 * call round-robin chạy song song. Layout 2 cột cho gọn; mỗi provider có nút "Load model" riêng.
 */
export default function ProviderPoolConfig() {
  // (bug 213) selector hẹp — destructure trần từ useStore() là subscribe TOÀN store: mọi
  // set() (addLog/updateField suốt lượt dịch) đều kéo component này re-render dù chẳng liên quan.
  const providers = useStore((s) => s.providers);
  const addProvider = useStore((s) => s.addProvider);
  const updateProvider = useStore((s) => s.updateProvider);
  const removeProvider = useStore((s) => s.removeProvider);
  const ui = useUi();
  const [open, setOpen] = useState(true);

  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
      <button onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: 'var(--bg-secondary)', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '0.8rem', fontWeight: 700, textAlign: 'left' }}>
        <Server size={14} style={{ color: 'var(--accent-secondary)' }} />
        {ui.ppTitle}
        <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.7rem' }}>
          {providers.length > 0 ? fmt(ui.ppEnabledCount, { enabled: providers.filter((p) => p.enabled).length, total: providers.length }) : ui.ppEmptyHint}
        </span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </button>

      {open && (
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {providers.map((p, i) => (
            <ProviderCard key={p.id} p={p} index={i + 2} onChange={(patch) => updateProvider(p.id, patch)} onRemove={() => removeProvider(p.id)} />
          ))}

          <button onClick={addProvider}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer', background: 'transparent', color: 'var(--accent-secondary)', border: '1px dashed var(--accent-secondary)', borderRadius: 'var(--radius-sm)', justifyContent: 'center' }}>
            <Plus size={14} /> {ui.ppAdd}
          </button>
          {providers.length === 0 && (
            <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {ui.ppExplain}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProviderCard({ p, index, onChange, onRemove }: { p: ProviderConfig; index: number; onChange: (patch: Partial<ProviderConfig>) => void; onRemove: () => void }) {
  const proxy = useStore((s) => s.proxy);
  const ui = useUi();
  const [models, setModels] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState('');
  // Cờ riêng thay cho scanMsg.startsWith('Lỗi'): chuỗi đã i18n nên không dùng làm logic được nữa.
  const [scanErr, setScanErr] = useState(false);
  const keyCount = [p.apiKey, ...(p.apiKeys || [])].filter((k) => k.trim()).length;

  const scanModels = async () => {
    const firstKey = p.apiKey?.trim() || (p.apiKeys || []).find((k) => k.trim()) || '';
    if (!firstKey) { setScanErr(true); setScanMsg(ui.ppNeedKey); return; }
    setScanning(true); setScanErr(false); setScanMsg('');
    try {
      const cfg: ProxySettings = { ...proxy, provider: p.provider, proxyUrl: p.proxyUrl, apiKey: firstKey, apiKeys: p.apiKeys || [] };
      const list = await fetchModelsFromProxy(cfg);
      setModels(list);
      setScanMsg(fmt(ui.ppModelCount, { count: list.length }));
      if (!p.model && list[0]) onChange({ model: list[0] });
    } catch (e) {
      setScanErr(true); setScanMsg(ui.ppErrPrefix + (e instanceof Error ? e.message : String(e)).slice(0, 60));
    } finally { setScanning(false); }
  };

  return (
    <div style={{ border: '1px solid ' + (p.enabled ? 'var(--accent-secondary)' : 'var(--border-subtle)'), borderRadius: 'var(--radius-sm)', padding: 10, display: 'flex', flexDirection: 'column', gap: 8, background: p.enabled ? 'rgba(56,189,248,0.04)' : 'transparent' }}>
      {/* Header: bật/tắt + tên + xoá */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={p.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} title={ui.ppToggleTitle} />
        <input value={p.name} onChange={(e) => onChange({ name: e.target.value })} placeholder={`Provider #${index}`}
          style={{ ...inputStyle, flex: 1, fontWeight: 700, padding: '4px 8px' }} />
        <button onClick={onRemove} title={ui.ppRemoveTitle} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-danger)', display: 'flex', padding: 4 }}>
          <Trash2 size={15} />
        </button>
      </div>

      {/* Base URL (full) — loại provider TỰ NHẬN từ URL (badge, không còn field "Loại") */}
      <div>
        <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 6 }}>
          Base URL
          <span style={{ fontSize: '0.56rem', fontWeight: 700, padding: '1px 5px', borderRadius: 8, color: 'var(--accent-secondary)', background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.25)' }}>
            → {PROVIDER_LABEL[detectProviderFromUrl(p.proxyUrl)]}
          </span>
        </label>
        <input value={p.proxyUrl} onChange={(e) => onChange({ proxyUrl: e.target.value, provider: detectProviderFromUrl(e.target.value) })} placeholder="https://…/v1" style={inputStyle} />
      </div>

      {/* API keys */}
      <div>
        <label style={lbl}>{ui.ppApiKey} {keyCount > 0 && <span style={{ color: 'var(--accent-secondary)' }}>{fmt(ui.ppKeyCount, { count: keyCount })}</span>} {ui.ppKeyHint}</label>
        <KeysTextarea
          keys={[p.apiKey, ...(p.apiKeys || [])].filter(Boolean)}
          onKeys={(keys) => onChange({ apiKey: keys[0] || '', apiKeys: keys.slice(1) })}
          rows={2} placeholder="sk-...&#10;sk-..." style={{ ...inputStyle, resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }} />
      </div>

      {/* Nút Load model cho provider này */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={scanModels} disabled={scanning}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', fontSize: '0.72rem', fontWeight: 600, cursor: scanning ? 'default' : 'pointer', background: 'var(--bg-elevated)', color: 'var(--accent-secondary)', border: '1px solid var(--accent-secondary)', borderRadius: 'var(--radius-sm)' }}>
          {scanning ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />} Load model
        </button>
        {scanMsg && <span style={{ fontSize: '0.66rem', color: scanErr ? 'var(--accent-danger)' : 'var(--text-muted)' }}>{scanMsg}</span>}
      </div>
      {/* Model chính + RPM (2 cột) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 8 }}>
        <div>
          <label style={lbl}>{ui.ppPrimaryModel}</label>
          <ModelPicker value={p.model} onChange={(m) => onChange({ model: m })} models={models} placeholder="gemini-2.5-pro" style={inputStyle} />
        </div>
        <div>
          <label style={lbl}>{ui.ppPrimaryRpm}</label>
          <input type="number" min={1} max={1000} value={p.primaryModelRpm} onChange={(e) => onChange({ primaryModelRpm: Math.max(1, +e.target.value || 1) })} style={inputStyle} />
        </div>
      </div>

      {/* Model phụ */}
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
        <input type="checkbox" checked={p.enableSecondaryModel} onChange={(e) => onChange({ enableSecondaryModel: e.target.checked })} />
        {ui.ppSecondaryTitle}
      </label>
      {p.enableSecondaryModel && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px', gap: 8 }}>
          <div>
            <label style={lbl}>{ui.ppSecondaryModel}</label>
            <ModelPicker value={p.secondaryModel} onChange={(m) => onChange({ secondaryModel: m })} models={models} placeholder="gemini-2.5-flash" style={inputStyle} />
          </div>
          <div>
            <label style={lbl}>{ui.ppSecondaryRpm}</label>
            <input type="number" min={1} max={1000} value={p.secondaryModelRpm} onChange={(e) => onChange({ secondaryModelRpm: Math.max(1, +e.target.value || 1) })} style={inputStyle} />
          </div>
          <div>
            <label style={lbl} title={ui.ppThresholdTitle}>{ui.ppThreshold}</label>
            <input type="number" min={0} value={p.secondaryModelThreshold} onChange={(e) => onChange({ secondaryModelThreshold: Math.max(0, +e.target.value || 0) })} style={inputStyle} />
          </div>
        </div>
      )}
    </div>
  );
}
