import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { translateText } from '../utils/apiClient';
import type { TranslationFieldType } from '../utils/masterPrompt';
import { applyMvuToText } from '../utils/mvuSync';
import { Code2, Play, Copy, CheckCircle2, Loader2, Trash2 } from 'lucide-react';

/**
 * Custom Code Translation Panel
 * Allows users to paste external code (e.g. HTML UI loaded via links),
 * translate it using the same AI settings + MVU dictionary as the current card,
 * then copy the result to self-host.
 */
export default function CustomTranslatePanel() {
  const { proxy, translationConfig } = useStore();
  const [input, setInput] = useState(() => localStorage.getItem('custom-translate-input') || '');
  const [output, setOutput] = useState(() => localStorage.getItem('custom-translate-output') || '');
  const [isTranslating, setIsTranslating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [fieldType, setFieldType] = useState<TranslationFieldType>('mixed');
  const [strictPreservation, setStrictPreservation] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    localStorage.setItem('custom-translate-input', input);
  }, [input]);

  useEffect(() => {
    localStorage.setItem('custom-translate-output', output);
  }, [output]);

  const handleTranslate = async () => {
    if (!input.trim()) return;
    setIsTranslating(true);
    setError('');
    setOutput('');
    abortRef.current = new AbortController();

    try {
      // Build MVU dict injection prompt
      let effectivePrompt = translationConfig.translationPrompt || '';
      const mvuDict = translationConfig.enableMvuSync
        ? translationConfig.mvuDictionary
        : {};
      const mvuEntries = Object.entries(mvuDict).filter(([k, v]) => k && v && k !== v);

      if (mvuEntries.length > 0) {
        const dictList = mvuEntries.map(([k, v]) => `  "${k}" → "${v}"`).join('\n');
        effectivePrompt += `\n\nCRITICAL — MVU/Zod VARIABLE REPLACEMENT DICTIONARY:
Replace the following variable names with their translated equivalents EVERYWHERE they appear:
${dictList}
- Replace ALL occurrences consistently. Do NOT invent your own translations.`;
      }

      if (strictPreservation) {
        effectivePrompt += `\n\n[STRICT CODE PRESERVATION MODE ENABLED]
- DO NOT translate any JSON keys, JSON Patch paths, macro structures, or EJS/HTML tags.
- Ensure bracket matching is 100% accurate.
- If unsure about translating a specific code segment, RETURN THE ORIGINAL CODE UNCHANGED.`;
      }

      const result = await translateText(
        input,
        'Custom Code',
        proxy,
        translationConfig.targetLanguage,
        translationConfig.sourceLanguage,
        effectivePrompt,
        undefined, // customSchema
        abortRef.current.signal,
        undefined, // contextHint
        translationConfig.glossary,
        undefined, // previousTranslation
        fieldType,
        translationConfig.enableMvuSync ? translationConfig.mvuDictionary : undefined,
      );
      let finalResult = result;

      // Hậu xử lý (Post-process) bắt buộc bằng regex để đảm bảo biến MVU được đồng bộ 100%
      // ngay cả khi AI bỏ sót hoặc dịch sai từ điển.
      if (translationConfig.enableMvuSync && mvuEntries.length > 0) {
        // Tuỳ thuộc vào fieldType mà quyết định mức độ aggressive:
        // html_dashboard, code_script thường là dạng code => aggressive = true
        // narrative, mixed => aggressive = false (chỉ áp dụng vào các cấu trúc macro)
        const isAggressive = ['html_dashboard', 'code_script', 'mixed'].includes(fieldType);
        finalResult = applyMvuToText(finalResult, translationConfig.mvuDictionary, isAggressive);
      }

      setOutput(finalResult);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== 'Cancelled') {
        setError(msg);
      }
    } finally {
      setIsTranslating(false);
      abortRef.current = null;
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setIsTranslating(false);
  };

  const handleCopy = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = output;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClear = () => {
    setInput('');
    setOutput('');
    setError('');
  };

  const mvuDict = translationConfig.enableMvuSync ? translationConfig.mvuDictionary : {};
  const mvuCount = Object.entries(mvuDict).filter(([k, v]) => k && v && k !== v).length;

  return (
    <div className="card fade-in" style={{ overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '28px', height: '28px', borderRadius: 'var(--radius-sm)',
            background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Code2 size={14} color="white" />
          </div>
          <div>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: 0 }}>
              Dịch Code Tùy Chỉnh
            </h3>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
              Dán code HTML/JS bên ngoài vào đây để dịch đồng bộ với từ điển biến
            </div>
          </div>
        </div>

        {/* MVU badge */}
        {mvuCount > 0 && (
          <span style={{
            fontSize: '0.6rem', padding: '2px 8px',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(124,106,240,0.1)',
            color: 'var(--accent-primary)',
            fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: '4px',
          }}>
            🔗 {mvuCount} biến MVU sẽ được đồng bộ
          </span>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

        {/* Field type selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
            Loại nội dung:
          </span>
          <div style={{
            display: 'flex', gap: '2px',
            background: 'var(--bg-primary)',
            borderRadius: 'var(--radius-sm)',
            padding: '2px',
            border: '1px solid var(--border-subtle)',
          }}>
            {([
              { id: 'mixed' as TranslationFieldType, label: 'Hỗn hợp' },
              { id: 'ejs_code' as TranslationFieldType, label: 'Code/EJS' },
              { id: 'narrative' as TranslationFieldType, label: 'Văn bản' },
              { id: 'regex' as TranslationFieldType, label: 'HTML/Regex' },
            ]).map(opt => (
              <button
                key={opt.id}
                onClick={() => setFieldType(opt.id)}
                style={{
                  padding: '3px 10px',
                  fontSize: '0.7rem',
                  fontWeight: fieldType === opt.id ? 600 : 400,
                  background: fieldType === opt.id ? 'rgba(124,106,240,0.12)' : 'transparent',
                  color: fieldType === opt.id ? 'var(--accent-primary)' : 'var(--text-muted)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: 'var(--text-secondary)', cursor: 'pointer', marginLeft: 'auto' }}>
            <input 
              type="checkbox" 
              checked={strictPreservation} 
              onChange={e => setStrictPreservation(e.target.checked)} 
              style={{ accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
            />
            Strict Code Preservation
          </label>
        </div>

        {/* Input */}
        <div style={{ position: 'relative' }}>
          <label style={{
            fontSize: '0.7rem', fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            marginBottom: '4px',
            display: 'block',
          }}>
            Nội dung gốc (Dán code vào đây)
          </label>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Dán nội dung HTML, CSS, JS, hoặc bất kỳ đoạn code nào cần dịch vào đây..."
            rows={10}
            style={{
              width: '100%',
              resize: 'vertical',
              fontFamily: 'monospace',
              fontSize: '0.78rem',
              lineHeight: 1.5,
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              outline: 'none',
              transition: 'border-color 0.2s',
            }}
          />
          {input && (
            <span style={{
              position: 'absolute', top: '24px', right: '8px',
              fontSize: '0.6rem', color: 'var(--text-muted)',
              background: 'var(--bg-secondary)',
              padding: '1px 6px',
              borderRadius: 'var(--radius-sm)',
            }}>
              {input.length.toLocaleString()} chars
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            onClick={isTranslating ? handleCancel : handleTranslate}
            disabled={!input.trim() && !isTranslating}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 20px',
              fontSize: '0.8rem',
              fontWeight: 600,
              background: isTranslating
                ? 'var(--accent-danger)'
                : 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
            }}
          >
            {isTranslating ? (
              <>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                Hủy dịch
              </>
            ) : (
              <>
                <Play size={14} />
                Dịch
              </>
            )}
          </button>

          {input && (
            <button
              className="btn btn-ghost"
              onClick={handleClear}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}
            >
              <Trash2 size={12} />
              Xóa
            </button>
          )}

          {output && (
            <button
              className="btn btn-ghost"
              onClick={handleCopy}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                fontSize: '0.75rem',
                color: copied ? 'var(--accent-success)' : undefined,
              }}
            >
              {copied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
              {copied ? 'Đã copy!' : 'Copy kết quả'}
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{
            padding: '8px 12px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(255,82,82,0.08)',
            border: '1px solid rgba(255,82,82,0.2)',
            color: 'var(--accent-danger)',
            fontSize: '0.75rem',
          }}>
            ❌ {error}
          </div>
        )}

        {/* Output */}
        {output && (
          <div style={{ position: 'relative' }}>
            <label style={{
              fontSize: '0.7rem', fontWeight: 600,
              color: 'var(--accent-success)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginBottom: '4px',
              display: 'block',
            }}>
              Kết quả đã dịch
            </label>
            <textarea
              value={output}
              onChange={e => setOutput(e.target.value)}
              rows={12}
              style={{
                width: '100%',
                resize: 'vertical',
                fontFamily: 'monospace',
                fontSize: '0.78rem',
                lineHeight: 1.5,
                padding: '10px 12px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--accent-success)',
                background: 'rgba(76,175,80,0.03)',
                color: 'var(--text-primary)',
                outline: 'none',
              }}
            />
            <span style={{
              position: 'absolute', top: '24px', right: '8px',
              fontSize: '0.6rem', color: 'var(--text-muted)',
              background: 'var(--bg-secondary)',
              padding: '1px 6px',
              borderRadius: 'var(--radius-sm)',
            }}>
              {output.length.toLocaleString()} chars
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
