import React, { useState, useEffect } from 'react';
import { useStore } from '../store';
import { useThrottledStore } from '../hooks/useThrottledStore';
import { useTranslation } from '../hooks/useTranslation';
import { Code2, Play, Loader2, Trash2, CheckCircle2, Copy, Check, X, Globe } from 'lucide-react';
import { publishToGithub } from '../utils/githubApi';
import { safeSetItem } from '../utils/safeStorage';
import { useUi } from '../i18n/useLocale';
import HeavyScriptMode from './HeavyScriptMode';

const renderSafeHtml = (htmlContent: string) => {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
        <style>
          body { margin: 0; padding: 12px; background: #0f0f12; color: #e8e6f0; font-family: -apple-system, sans-serif; font-size: 0.9rem; }
        </style>
      </head>
      <body>${htmlContent}</body>
    </html>
  `;
};

export default function ExternalLinkTab() {
  // (bugNeedFix/39) selector hẹp + throttle fields — trước đây subscribe toàn store lúc dịch.
  const fields = useThrottledStore((s) => s.fields, 200);
  const setFields = useStore((s) => s.setFields);
  const updateField = useStore((s) => s.updateField);
  const phase = useStore((s) => s.phase);
  const addToast = useStore((s) => s.addToast);
  const ui = useUi();
  const { retranslateField, cancelFieldTranslation } = useTranslation();
  
  const [input, setInput] = useState(() => localStorage.getItem('custom-external-input') || '');
  const [copied, setCopied] = useState(false);
  const [heavyOutput, setHeavyOutput] = useState(''); // bản ghép của chế độ Script Nặng

  // GitHub state
  const [ghToken, setGhToken] = useState(() => localStorage.getItem('gh-token') || '');
  const [ghRepo, setGhRepo] = useState(() => localStorage.getItem('gh-repo') || '');
  const [ghBranch, setGhBranch] = useState(() => localStorage.getItem('gh-branch') || 'main');
  
  const [ghPath, setGhPath] = useState('scripts/custom-script.js');
  const [ghMessage, setGhMessage] = useState('Update translated external link');
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishUrl, setPublishUrl] = useState('');
  const [cdnUrl, setCdnUrl] = useState('');

  useEffect(() => { safeSetItem('custom-external-input', input); }, [input]);
  useEffect(() => { safeSetItem('gh-token', ghToken); }, [ghToken]);
  useEffect(() => { safeSetItem('gh-repo', ghRepo); }, [ghRepo]);
  useEffect(() => { safeSetItem('gh-branch', ghBranch); }, [ghBranch]);

  const fieldPath = 'custom_external_link';
  const field = fields.find(f => f.path === fieldPath);
  
  const isTranslating = field?.status === 'translating';
  const hasError = field?.status === 'error';
  // Ưu tiên bản ghép của chế độ Script Nặng (nếu có) — dùng cho preview/publish/output.
  const output = heavyOutput || field?.translated || '';

  const handleTranslate = async () => {
    if (!input.trim()) return;
    if (field) {
      updateField(fieldPath, { original: input, translated: '', status: 'pending', error: undefined, retries: 0 });
    } else {
      setFields([...fields, { path: fieldPath, label: ui.eltFieldLabel, group: 'regex', entryType: 'replaceString', original: input, translated: '', status: 'pending', retries: 0 }]);
    }
    setTimeout(async () => {
      try { await retranslateField(fieldPath); } catch (err) {}
    }, 50);
  };

  const handlePublish = async () => {
    if (!ghToken || !ghRepo || !ghPath || !output) {
      addToast('error', ui.eltToastMissing);
      return;
    }
    setIsPublishing(true);
    setPublishUrl('');
    setCdnUrl('');
    try {
      const result = await publishToGithub({ token: ghToken, repo: ghRepo, branch: ghBranch }, ghPath, output, ghMessage);
      if (result.success) {
        addToast('success', ui.eltToastPublished);
        setPublishUrl(result.contentUrl || '');
        setCdnUrl(`https://cdn.jsdelivr.net/gh/${ghRepo}@${ghBranch}/${ghPath}`);
      } else {
        addToast('error', ui.eltToastPushErr + result.message);
      }
    } catch (err: any) {
      addToast('error', ui.eltToastNetErr + err.message);
    } finally {
      setIsPublishing(false);
    }
  };

  const CopyBtn = ({ text, label }: { text: string, label: string }) => {
    const [c, setC] = useState(false);
    return (
      <button
        onClick={() => { navigator.clipboard.writeText(text); setC(true); setTimeout(()=>setC(false), 2000); }}
        style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem', color: c ? 'var(--accent-success)' : 'var(--text-secondary)' }}
      >
        {c ? <Check size={12} /> : <Copy size={12} />} {label}
      </button>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 12px 12px' }}>
      <div style={{ padding: '16px 20px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--accent-primary)', boxShadow: '0 4px 20px rgba(124, 106, 240, 0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <div style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-sm)', background: 'linear-gradient(135deg, #7c6af0, #c084fc)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Code2 size={14} color="white" />
          </div>
          <div>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: 0, color: 'var(--accent-primary)' }}>{ui.eltTitle}</h3>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{ui.eltSubtitle}</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '16px 20px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ position: 'relative' }}>
          <label style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '4px', display: 'block' }}>{ui.eltSourceLabel}</label>
          <textarea value={input} onChange={e => setInput(e.target.value)} disabled={isTranslating} rows={10} style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.78rem', padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none' }} />
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={isTranslating ? () => cancelFieldTranslation(fieldPath) : handleTranslate} disabled={!input.trim() && !isTranslating}>
            {isTranslating ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> {ui.eltCancelTranslate}</> : <><Play size={14} /> {ui.eltTranslate}</>}
          </button>
          {input && !isTranslating && <button className="btn btn-ghost" onClick={() => setInput('')}><Trash2 size={12} /> {ui.eltClear}</button>}
        </div>
        {hasError && <div style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', background: 'rgba(255,82,82,0.08)', border: '1px solid rgba(255,82,82,0.2)', color: 'var(--accent-danger)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}><X size={14} /> {ui.eltErrPrefix} {field?.error}</div>}

        {/* (User 2026) Script Nặng (Chia Phần) — tự hiện khi script vượt ngưỡng an toàn */}
        <HeavyScriptMode source={input} onMerged={setHeavyOutput} />

        {output && (
          <div style={{ position: 'relative', marginTop: '8px' }}>
            <label style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--accent-success)', textTransform: 'uppercase', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}><Check size={12} /> {ui.eltResultLabel}</label>
            <textarea value={output} onChange={(e) => { if (field) updateField(fieldPath, { translated: e.target.value }); }} disabled={isTranslating} rows={12} style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.78rem', padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--accent-success)', background: 'rgba(76,175,80,0.03)', color: 'var(--text-primary)', outline: 'none' }} />
          </div>
        )}
      </div>

      {output && (
        <div style={{ padding: '16px 20px', background: 'rgba(36, 41, 46, 0.3)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <Globe size={16} />
            <h4 style={{ margin: 0, fontSize: '0.85rem' }}>{ui.eltPublishTitle}</h4>
          </div>
          
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '16px', background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '6px', borderLeft: '3px solid var(--accent-primary)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--text-secondary)' }}>{ui.eltGuideTitle}</strong><br/>
            • <strong>{ui.eltGuidePat1}</strong> {ui.eltGuidePat2} <a href="https://github.com/settings/tokens/new" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)', textDecoration: 'underline' }}>{ui.eltGuidePatLink}</a>{ui.eltGuidePat3} <strong>{ui.eltGuidePat4}<code>repo</code></strong>{ui.eltGuidePat5}<br/>
            • <strong>{ui.eltGuideRepo1}</strong> {ui.eltGuideRepo2} <code>github.com/nguyenvana/my-cards</code> {ui.eltGuideRepo3} <code>nguyenvana/my-cards</code>{ui.eltGuidePeriod}<br/>
            • <strong>{ui.eltGuideBranch1}</strong> {ui.eltGuideBranch2} <code>main</code> {ui.eltGuideBranchOr} <code>master</code>{ui.eltGuidePeriod}
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{ui.eltPatLabel}</label>
              <input type="password" value={ghToken} onChange={e => setGhToken(e.target.value)} placeholder="ghp_..." style={{ width: '100%', padding: '6px 8px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid var(--border-default)', background: 'var(--bg-primary)' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Repository (user/repo)</label>
              <input value={ghRepo} onChange={e => setGhRepo(e.target.value)} placeholder="username/my-repo" style={{ width: '100%', padding: '6px 8px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid var(--border-default)', background: 'var(--bg-primary)' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Branch</label>
              <input value={ghBranch} onChange={e => setGhBranch(e.target.value)} placeholder="main" style={{ width: '100%', padding: '6px 8px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid var(--border-default)', background: 'var(--bg-primary)' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{ui.eltFileLabel}</label>
              <input value={ghPath} onChange={e => setGhPath(e.target.value)} placeholder="scripts/custom.js" style={{ width: '100%', padding: '6px 8px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid var(--border-default)', background: 'var(--bg-primary)' }} />
            </div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{ui.eltCommitLabel}</label>
            <input value={ghMessage} onChange={e => setGhMessage(e.target.value)} style={{ width: '100%', padding: '6px 8px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid var(--border-default)', background: 'var(--bg-primary)' }} />
          </div>

          <button onClick={handlePublish} disabled={isPublishing} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
            {isPublishing ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Globe size={14} />} {ui.eltPublishBtn}
          </button>

          {cdnUrl && (
            <div style={{ marginTop: '16px', padding: '12px', background: 'var(--bg-primary)', borderRadius: '6px', border: '1px solid var(--accent-success)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--accent-success)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}><CheckCircle2 size={14} /> {ui.eltCdnReady}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{ui.eltJsTag}</div>
                  <CopyBtn text={`<script src="${cdnUrl}"></script>`} label="Copy Script" />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{ui.eltCssTag}</div>
                  <CopyBtn text={`<link rel="stylesheet" href="${cdnUrl}">`} label="Copy CSS" />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Markdown:</div>
                  <CopyBtn text={`[Load Script](${cdnUrl})`} label="Copy Markdown" />
                </div>

              </div>
            </div>
          )}
        </div>
      )}

      {/* HTML Preview */}
      {(input || output) && (
        <div style={{ padding: '16px 20px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px' }}>{ui.eltPreviewTitle}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Original Preview:</div>
              <iframe title="Original Preview" srcDoc={renderSafeHtml((input || '').replace(/\$[0-9&]+/g, ui.eltSampleContent))} sandbox="allow-scripts" style={{ width: '100%', height: '300px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: '#0f0f12' }} />
            </div>
            <div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Translated Preview:</div>
              <iframe title="Translated Preview" srcDoc={renderSafeHtml((output || input || '').replace(/\$[0-9&]+/g, ui.eltSampleContent))} sandbox="allow-scripts" style={{ width: '100%', height: '300px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: '#0f0f12' }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
