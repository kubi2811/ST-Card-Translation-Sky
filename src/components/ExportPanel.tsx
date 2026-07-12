import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks/useTranslation';
import { useT, useUi } from '../i18n/useLocale';
import { fmt } from '../i18n';
import { Download, AlertTriangle, Image as ImageIcon, KeyRound, Code, Activity, FileText, XCircle, Info } from 'lucide-react';
import { embedCharaToPNG } from '../utils/pngHandler';
import { cardToWorldbook } from '../utils/worldbookParser';
import { setNestedValue } from '../utils/cardFields';
import { scanFieldsHealth, buildTranslationReport, type HealthSeverity } from '../utils/cardHealth';
import { verifyFields, quickVerify, type FieldIssue, type VerifyIssue } from '../utils/aiVerify';
import type { ExportKeyMode } from '../types/card';

/** 1 dòng vấn đề trong báo cáo GỘP của "🩺 Kiểm tra tổng" (3 nguồn về chung 1 shape). */
interface MergedIssue {
  severity: HealthSeverity;
  label: string;
  path: string;   // rỗng = không nhảy tới field được (vấn đề mức card)
  detail: string;
  src: 'health' | 'deep' | 'card';
}

/** Nhãn ở module scope nên chỉ giữ KEY, tra `ui` lúc render. `desc` là chữ Hán cố ý (nhãn kỹ thuật). */
const KEY_MODE_OPTIONS: { value: ExportKeyMode; labelKey: 'epKeyModeMerge' | 'epKeyModeTranslated' | 'epKeyModeOriginal'; desc: string }[] = [
  { value: 'merge', labelKey: 'epKeyModeMerge', desc: '原Key + 译Key' },
  { value: 'translated_only', labelKey: 'epKeyModeTranslated', desc: '译Key only' },
  { value: 'original_only', labelKey: 'epKeyModeOriginal', desc: '原Key only' },
];

export default function ExportPanel() {
  const { card, fields, cardFileName, originalImage, _pngArrayBuffer, translationConfig, setTranslationConfig, phase, saveTranslationCache, locale, contentType, originalWorldbook, setJumpToFieldPath } = useStore();
  const { getExportCard } = useTranslation();
  const t = useT();
  const ui = useUi();
  const isWorldbook = contentType === 'worldbook';

  const doneCount = fields.filter((f) => f.status === 'done').length;
  const ignoredCount = fields.filter((f) => f.status === 'ignored').length;
  const hasLorebookKeys = fields.some(f => f.group === 'lorebook_keys');

  // 🩺 Sức khoẻ thẻ — quét nội dung bản dịch (script vỡ / chữ Hán sót / thuật ngữ chưa áp) chứ không chỉ trạng thái trường.
  const health = useMemo(() => scanFieldsHealth(fields, translationConfig.glossary), [fields, translationConfig.glossary]);
  const [showIssues, setShowIssues] = useState(false);

  // ═══ 🩺 KIỂM TRA TỔNG (nghiệm thu 1 nút) ═══
  // Sức khoẻ thẻ ở trên chạy passive (rẻ). Bấm nút thì chạy thêm 2 bộ kiểm NẶNG (đều local, 0 call AI):
  //  1. verifyFields — kiểm sâu từng field: macro hỏng, lệch ngoặc/HTML/JSON, cắt cụt cấu trúc, CJK sót theo tỉ lệ…
  //  2. quickVerify  — đối chiếu card gốc ↔ card xuất: macro/biến/Zod/EJS bị MẤT sau dịch.
  // Cả 3 gộp về 1 báo cáo, 1 phán quyết đạt/không đạt.
  const [deepCheck, setDeepCheck] = useState<{ fieldIssues: FieldIssue[]; cardIssues: VerifyIssue[]; at: number } | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const runTotalCheck = async () => {
    setIsChecking(true);
    await new Promise((r) => setTimeout(r, 30)); // cho UI vẽ trạng thái "đang kiểm" trước khi block main thread
    try {
      const fieldIssues = verifyFields(fields, translationConfig.mvuDictionary, translationConfig.sourceLanguage);
      const exportCard = getExportCard();
      const cardIssues = card && exportCard ? quickVerify(card, exportCard) : [];
      setDeepCheck({ fieldIssues, cardIssues, at: Date.now() });
      setShowIssues(true);
    } finally {
      setIsChecking(false);
    }
  };

  // Gộp 3 nguồn vấn đề (sức khoẻ + kiểm sâu + đối chiếu card) thành 1 danh sách, nặng trước.
  const allIssues = useMemo<MergedIssue[]>(() => {
    const merged: MergedIssue[] = health.issues.map((i) => ({
      severity: i.severity, label: i.label, path: i.path, detail: i.detail, src: 'health' as const,
    }));
    if (deepCheck) {
      // Kiểm sâu trùng 1 phần với sức khoẻ thẻ (CJK sót) — bỏ mục trùng path+loại để không báo đúp.
      const cjkPaths = new Set(health.issues.filter(i => i.kind.startsWith('residual_cjk')).map(i => i.path));
      for (const fi of deepCheck.fieldIssues) {
        if (fi.category === 'residual_source' && cjkPaths.has(fi.fieldPath)) continue;
        merged.push({ severity: fi.severity, label: fi.category.replace(/_/g, ' '), path: fi.fieldPath, detail: fi.description, src: 'deep' });
      }
      for (const ci of deepCheck.cardIssues) {
        merged.push({ severity: ci.severity, label: ci.location, path: '', detail: ci.description, src: 'card' });
      }
    }
    const rank: Record<HealthSeverity, number> = { error: 0, warning: 1, info: 2 };
    merged.sort((a, b) => rank[a.severity] - rank[b.severity]);
    return merged;
  }, [health, deepCheck]);

  const errCount = allIssues.filter((i) => i.severity === 'error').length;
  const checkOk = errCount === 0;

  const handleExportReport = () => {
    let md = buildTranslationReport(fields, cardFileName || 'card', health);
    if (deepCheck) {
      const lines: string[] = ['', '## 🩺 Kiểm tra tổng (kiểm sâu nội dung + đối chiếu card gốc)'];
      lines.push(`- Kiểm sâu nội dung: **${deepCheck.fieldIssues.length}** vấn đề · Đối chiếu macro/biến với card gốc: **${deepCheck.cardIssues.length}** vấn đề`);
      for (const fi of deepCheck.fieldIssues.slice(0, 200)) {
        lines.push(`- [${fi.severity}] **${fi.category}** \`${fi.fieldPath}\` — ${fi.description}`);
      }
      for (const ci of deepCheck.cardIssues.slice(0, 200)) {
        lines.push(`- [${ci.severity}] **${ci.location}** — ${ci.description}`);
      }
      md += '\n' + lines.join('\n');
    }
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const baseName = (cardFileName || 'card').replace(/\.(json|png)$/i, '');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}_bao-cao-dich.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = () => {
    // Auto-save translation cache before export
    saveTranslationCache();

    const exportCard = getExportCard();
    if (!exportCard) return;

    // If worldbook mode, convert back to worldbook format
    let exportData: unknown;
    if (isWorldbook && originalWorldbook) {
      exportData = cardToWorldbook(exportCard, originalWorldbook);
    } else {
      exportData = exportCard;
    }

    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    // Generate filename
    const baseName = cardFileName.replace(/\.json$/i, '');
    const langSuffix = translationConfig.targetLanguage === 'Tiếng Việt'
      ? 'vi'
      : translationConfig.targetLanguage === 'English'
        ? 'en'
        : translationConfig.targetLanguage === '日本語'
          ? 'ja'
          : translationConfig.targetLanguage === '한국어'
            ? 'ko'
            : translationConfig.targetLanguage.slice(0, 2).toLowerCase();
    const fileName = `${baseName}_${langSuffix}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPng = async () => {
    if (!originalImage) return;
    // Auto-save translation cache
    saveTranslationCache();

    const exportCard = getExportCard();
    if (!exportCard) return;

    try {
      const json = JSON.stringify(exportCard);
      // Prefer _pngArrayBuffer if available (especially after reload), fallback to originalImage
      const imageData = _pngArrayBuffer || originalImage;
      const dataUrl = await embedCharaToPNG(imageData, json);
      
      const baseName = cardFileName.replace(/\.(json|png)$/i, '');
      const langSuffix = translationConfig.targetLanguage === 'Tiếng Việt' ? 'vi' : 'translated';
      const fileName = `${baseName}_${langSuffix}.png`;

      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = fileName;
      a.click();
    } catch (e) {
      console.error('Failed to export PNG:', e);
      alert('Failed to export PNG');
    }
  };

  // Reconstruct translated regex scripts
  const translatedRegexes = useMemo(() => {
    if (!card || !card.data || !card.data.extensions || !card.data.extensions.regex_scripts) {
      return [];
    }
    const originalRegexScripts = card.data.extensions.regex_scripts;
    
    // Find all fields in group 'regex' with status === 'done' and non-empty translated content
    const doneRegexFields = fields.filter(
      (f) => f.group === 'regex' && f.status === 'done' && f.translated
    );
    
    if (doneRegexFields.length === 0) return [];
    
    // Group fields by script index
    const fieldsByScriptIndex: Record<number, typeof doneRegexFields> = {};
    for (const field of doneRegexFields) {
      const match = field.path.match(/^data\.extensions\.regex_scripts\[(\d+)\]\.(.+)$/);
      if (match) {
        const idx = parseInt(match[1], 10);
        if (!fieldsByScriptIndex[idx]) {
          fieldsByScriptIndex[idx] = [];
        }
        fieldsByScriptIndex[idx].push(field);
      }
    }
    
    // Reconstruct
    const results = [];
    for (const idxStr of Object.keys(fieldsByScriptIndex)) {
      const idx = parseInt(idxStr, 10);
      const originalScript = originalRegexScripts[idx];
      if (!originalScript) continue;
      
      const cloned = JSON.parse(JSON.stringify(originalScript));
      const scriptFields = fieldsByScriptIndex[idx];
      for (const field of scriptFields) {
        const match = field.path.match(/^data\.extensions\.regex_scripts\[(\d+)\]\.(.+)$/);
        if (match) {
          const relativePath = match[2];
          setNestedValue(cloned, relativePath, field.translated);
        }
      }
      results.push({
        index: idx,
        scriptName: cloned.scriptName || `Regex Script ${idx}`,
        script: cloned,
      });
    }
    return results;
  }, [card, fields]);

  // Reconstruct translated TavernHelper scripts
  const translatedTavernHelpers = useMemo(() => {
    if (!card || !card.data || !card.data.extensions) {
      return [];
    }
    const doneTavernHelperFields = fields.filter(
      (f) => f.group === 'tavern_helper' && f.status === 'done' && f.translated
    );
    
    if (doneTavernHelperFields.length === 0) return [];
    
    const fieldsByScript: Record<string, { key: string; scriptIndex: number; fields: typeof doneTavernHelperFields }> = {};
    
    for (const field of doneTavernHelperFields) {
      let key = '';
      let scriptIndex = -1;
      
      // Pattern 1: Tuple format
      const matchTuple = field.path.match(/^data\.extensions\.([a-zA-Z0-9_]+)\[\d+\]\[1\]\[(\d+)\]\.(.+)$/);
      if (matchTuple) {
        key = matchTuple[1];
        scriptIndex = parseInt(matchTuple[2], 10);
      } else {
        // Pattern 2: scripts array format
        const matchScripts = field.path.match(/^data\.extensions\.([a-zA-Z0-9_]+)\.scripts\[(\d+)\]\.(.+)$/);
        if (matchScripts) {
          key = matchScripts[1];
          scriptIndex = parseInt(matchScripts[2], 10);
        } else {
          // Pattern 3: direct array format
          const matchDirect = field.path.match(/^data\.extensions\.([a-zA-Z0-9_]+)\[(\d+)\]\.(.+)$/);
          if (matchDirect && matchDirect[1] !== 'regex_scripts') {
            key = matchDirect[1];
            scriptIndex = parseInt(matchDirect[2], 10);
          }
        }
      }
      
      if (key && scriptIndex !== -1) {
        const id = `${key}_${scriptIndex}`;
        if (!fieldsByScript[id]) {
          fieldsByScript[id] = { key, scriptIndex, fields: [] };
        }
        fieldsByScript[id].fields.push(field);
      }
    }
    
    const results = [];
    for (const id of Object.keys(fieldsByScript)) {
      const { key, scriptIndex, fields: scriptFields } = fieldsByScript[id];
      const extData = card.data.extensions[key];
      if (!extData) continue;
      
      let originalScript: any = null;
      if (Array.isArray(extData)) {
        const tupleEntry = extData.find(
          (item: any) => Array.isArray(item) && item[0] === 'scripts' && Array.isArray(item[1])
        );
        if (tupleEntry) {
          originalScript = tupleEntry[1][scriptIndex];
        } else {
          originalScript = extData[scriptIndex];
        }
      } else if (extData && typeof extData === 'object' && 'scripts' in extData && Array.isArray((extData as any).scripts)) {
        originalScript = (extData as any).scripts[scriptIndex];
      }
      
      if (!originalScript) continue;
      
      const cloned = JSON.parse(JSON.stringify(originalScript));
      for (const field of scriptFields) {
        let relPath = '';
        const matchT = field.path.match(/^data\.extensions\.([a-zA-Z0-9_]+)\[\d+\]\[1\]\[(\d+)\]\.(.+)$/);
        if (matchT) relPath = matchT[3];
        else {
          const matchS = field.path.match(/^data\.extensions\.([a-zA-Z0-9_]+)\.scripts\[(\d+)\]\.(.+)$/);
          if (matchS) relPath = matchS[3];
          else {
            const matchD = field.path.match(/^data\.extensions\.([a-zA-Z0-9_]+)\[(\d+)\]\.(.+)$/);
            if (matchD) relPath = matchD[3];
          }
        }
        
        if (relPath) {
          setNestedValue(cloned, relPath, field.translated);
        }
      }
      results.push({
        key,
        index: scriptIndex,
        name: cloned.name || `TavernHelper Script ${scriptIndex}`,
        script: cloned,
      });
    }
    return results;
  }, [card, fields]);

  if (!card || fields.length === 0) return null;

  const handleExportSingleRegex = (script: any, name: string) => {
    const json = JSON.stringify(script, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const baseName = cardFileName.replace(/\.(json|png)$/i, '');
    const cleanName = name.replace(/[^a-zA-Z0-9_\u00C0-\u1EF9-]/g, '_');
    const fileName = `${baseName}_regex_${cleanName}.json`;
    
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportAllRegex = () => {
    const scripts = translatedRegexes.map(r => r.script);
    const json = JSON.stringify(scripts, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const baseName = cardFileName.replace(/\.(json|png)$/i, '');
    const fileName = `${baseName}_regex_all.json`;
    
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportSingleTavernHelper = (script: any, name: string) => {
    const json = JSON.stringify(script, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const baseName = cardFileName.replace(/\.(json|png)$/i, '');
    const cleanName = name.replace(/[^a-zA-Z0-9_\u00C0-\u1EF9-]/g, '_');
    const fileName = `${baseName}_th_${cleanName}.json`;
    
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportAllTavernHelper = () => {
    const scripts = translatedTavernHelpers.map(t => t.script);
    const json = JSON.stringify(scripts, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const baseName = cardFileName.replace(/\.(json|png)$/i, '');
    const fileName = `${baseName}_th_all.json`;
    
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card fade-in" style={{ padding: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>{t.stepExport}</h3>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {doneCount}/{fields.length} {t.fieldsTranslated}
        </span>
      </div>

      {/* 🩺 Kiểm tra tổng — sức khoẻ thẻ (passive) + nút chạy kiểm sâu + đối chiếu card gốc, gộp 1 báo cáo */}
      <div
        style={{
          padding: '10px 12px',
          background: checkOk ? 'rgba(80, 200, 120, 0.06)' : 'rgba(240, 100, 100, 0.07)',
          border: `1px solid ${checkOk ? 'rgba(80,200,120,0.25)' : 'rgba(240,100,100,0.3)'}`,
          borderRadius: 'var(--radius-md)',
          marginBottom: '12px',
          fontSize: '0.8rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: allIssues.length || !deepCheck ? '8px' : 0, flexWrap: 'wrap' }}>
          <Activity size={15} style={{ flexShrink: 0, color: checkOk ? 'var(--accent-success)' : 'var(--accent-danger)' }} />
          <span style={{ fontWeight: 600, color: checkOk ? 'var(--accent-success)' : 'var(--accent-danger)', flex: 1, minWidth: '180px' }}>
            {deepCheck
              ? (checkOk ? ui.epTotalPass : fmt(ui.epTotalFail, { count: errCount }))
              : (checkOk ? ui.epHealthOk : fmt(ui.epHealthBad, { count: errCount }))}
          </span>
          <button
            onClick={runTotalCheck}
            disabled={isChecking || fields.length === 0}
            title={ui.epTotalHint}
            style={{
              padding: '4px 12px', fontSize: '0.72rem', fontWeight: 700, cursor: isChecking ? 'wait' : 'pointer',
              color: '#fff', background: 'var(--accent-primary)', border: 'none',
              borderRadius: 'var(--radius-sm)', opacity: isChecking || fields.length === 0 ? 0.6 : 1, flexShrink: 0,
            }}
          >
            {isChecking ? ui.epTotalChecking : ui.epTotalBtn}
          </button>
        </div>
        {deepCheck && (
          <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
            {fmt(ui.epTotalDoneLine, {
              deep: deepCheck.fieldIssues.length,
              macro: deepCheck.cardIssues.length,
              time: new Date(deepCheck.at).toLocaleTimeString(),
            })}
          </div>
        )}

        {/* Chỉ số nhanh */}
        {(health.counts.error > 0 || health.counts.brokenScripts > 0 || health.counts.residualCjkCode > 0 || health.counts.residualCjkText > 0 || health.counts.pending > 0) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
            {health.counts.error > 0 && <span>{fmt(ui.epCntError, { count: health.counts.error })}</span>}
            {health.counts.pending > 0 && <span>{fmt(ui.epCntPending, { count: health.counts.pending })}</span>}
            {health.counts.brokenScripts > 0 && <span style={{ color: 'var(--accent-danger)', fontWeight: 600 }}>{fmt(ui.epCntBroken, { count: health.counts.brokenScripts })}</span>}
            {health.counts.residualCjkCode > 0 && <span style={{ color: 'var(--accent-danger)', fontWeight: 600 }}>{fmt(ui.epCntCjkCode, { count: health.counts.residualCjkCode })}</span>}
            {health.counts.residualCjkText > 0 && <span>{fmt(ui.epCntCjkText, { count: health.counts.residualCjkText })}</span>}
            {health.counts.glossaryUnapplied > 0 && <span>{fmt(ui.epCntGlossary, { count: health.counts.glossaryUnapplied })}</span>}
          </div>
        )}

        {/* Danh sách GỘP cả 3 nguồn (thu gọn) — bấm dòng có path để nhảy tới field trong Field Editor */}
        {allIssues.length > 0 && (
          <>
            <button
              onClick={() => setShowIssues(v => !v)}
              style={{ marginTop: '8px', background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', padding: 0 }}
            >
              {showIssues ? ui.epHideDetails : fmt(ui.epShowDetails, { count: allIssues.length })}
            </button>
            {showIssues && (
              <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '260px', overflow: 'auto' }}>
                {allIssues.slice(0, 80).map((iss, idx) => (
                  <div
                    key={idx}
                    onClick={() => iss.path && setJumpToFieldPath(iss.path)}
                    title={iss.path ? ui.epJumpTitle : undefined}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: '0.7rem', color: 'var(--text-secondary)', cursor: iss.path ? 'pointer' : 'default', padding: '2px 4px', borderRadius: 'var(--radius-sm)' }}
                    onMouseEnter={(e) => { if (iss.path) e.currentTarget.style.background = 'rgba(124,106,240,0.08)'; }}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <IssueIcon severity={iss.severity} />
                    <span>
                      {iss.src !== 'health' && (
                        <span style={{ fontSize: '0.58rem', fontWeight: 700, color: iss.src === 'deep' ? 'var(--accent-secondary)' : '#fbbf24', border: `1px solid ${iss.src === 'deep' ? 'rgba(56,189,248,0.4)' : 'rgba(251,191,36,0.4)'}`, borderRadius: '3px', padding: '0 4px', marginRight: '4px' }}>
                          {iss.src === 'deep' ? ui.epSrcDeep : ui.epSrcCard}
                        </span>
                      )}
                      <b>{iss.label}</b> — {iss.detail} <span style={{ color: 'var(--text-muted)', fontSize: '0.64rem' }}>{iss.path}</span> {iss.path && <span style={{ color: 'var(--accent-primary)', fontSize: '0.64rem' }}>{ui.epJump}</span>}
                    </span>
                  </div>
                ))}
                {allIssues.length > 80 && (
                  <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>{fmt(ui.epMoreIssues, { count: allIssues.length - 80 })}</span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Lorebook Key Mode Selector */}
      {hasLorebookKeys && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)',
            marginBottom: '6px',
          }}>
            <KeyRound size={13} />
            {ui.epKeyModeTitle}
          </div>
          <div style={{
            display: 'flex', gap: '4px',
            background: 'var(--bg-primary)',
            borderRadius: 'var(--radius-sm)',
            padding: '3px',
            border: '1px solid var(--border-subtle)',
          }}>
            {KEY_MODE_OPTIONS.map(opt => {
              const isActive = translationConfig.exportKeyMode === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setTranslationConfig({ exportKeyMode: opt.value })}
                  style={{
                    flex: 1,
                    padding: '5px 4px',
                    fontSize: '0.7rem',
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? 'var(--accent-primary)' : 'var(--text-muted)',
                    background: isActive ? 'rgba(124,106,240,0.1)' : 'transparent',
                    border: isActive ? '1px solid rgba(124,106,240,0.25)' : '1px solid transparent',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    lineHeight: 1.3,
                    textAlign: 'center',
                  }}
                  title={opt.desc}
                >
                  {ui[opt.labelKey]}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            {translationConfig.exportKeyMode === 'merge'
              ? ui.epKeyModeDescMerge
              : translationConfig.exportKeyMode === 'translated_only'
                ? ui.epKeyModeDescTranslated
                : ui.epKeyModeDescOriginal
            }
          </div>
        </div>
      )}

      {/* ⚡ Dịch nhẹ / nhiều field bỏ qua: nói TRƯỚC cho user biết ruột card giữ tiếng gốc là
          CHỦ Ý — chặn báo nhầm "xuất ra tiếng Trung dù dịch rồi". */}
      {(translationConfig.lightSkipContent || ignoredCount >= 5) && (
        <div style={{
          padding: '8px 10px', marginBottom: '10px', fontSize: '0.7rem', lineHeight: 1.55,
          background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.35)',
          borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
        }}>
          {ui.epLightExportNote}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
        <button
          className="btn btn-primary"
          onClick={handleExport}
          disabled={phase === 'translating' || doneCount === 0}
          style={{ width: '100%' }}
        >
          <Download size={16} />
          {t.downloadJson}
        </button>

        {originalImage && !isWorldbook && (
          <button
            className="btn btn-secondary"
            onClick={handleExportPng}
            disabled={phase === 'translating' || doneCount === 0}
            style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
          >
            <ImageIcon size={16} />
            {t.downloadPng || 'Download PNG'}
          </button>
        )}

        {/* 📄 Báo cáo dịch — tổng quan + danh sách vấn đề (Markdown tải về) */}
        <button
          className="btn btn-secondary"
          onClick={handleExportReport}
          disabled={fields.length === 0}
          style={{ width: '100%', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
          title={ui.epReportTitle}
        >
          <FileText size={15} />
          {ui.epReportBtn}
        </button>
      </div>

      {/* Script Export Section */}
      {(translatedRegexes.length > 0 || translatedTavernHelpers.length > 0) && (
        <div style={{ marginTop: '20px', borderTop: '1px solid var(--border-subtle)', paddingTop: '15px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: 600, marginBottom: '12px', color: 'var(--text-primary)' }}>
            <Code size={15} style={{ color: 'var(--accent-primary)' }} />
            {ui.epScriptSection}
          </div>
          
          {translatedRegexes.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Regex Scripts ({translatedRegexes.length})</span>
                {translatedRegexes.length > 1 && (
                  <button
                    onClick={handleExportAllRegex}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--accent-primary)',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '2px 6px',
                      borderRadius: 'var(--radius-sm)',
                      transition: 'background 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(124, 106, 240, 0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                    title={ui.epDownloadAllRegexTitle}
                  >
                    <Download size={11} />
                    {ui.epDownloadAll}
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '6px', flexDirection: 'column' }}>
                {translatedRegexes.map((item) => (
                  <div 
                    key={`regex-${item.index}`} 
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between', 
                      padding: '6px 10px', 
                      background: 'var(--bg-secondary)', 
                      borderRadius: 'var(--radius-sm)', 
                      border: '1px solid var(--border-subtle)',
                      transition: 'border-color 0.2s, background-color 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(124, 106, 240, 0.3)';
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border-subtle)';
                      e.currentTarget.style.backgroundColor = 'var(--bg-secondary)';
                    }}
                  >
                    <span 
                      style={{ 
                        fontSize: '0.7rem', 
                        color: 'var(--text-primary)', 
                        fontWeight: 500,
                        overflow: 'hidden', 
                        textOverflow: 'ellipsis', 
                        whiteSpace: 'nowrap', 
                        maxWidth: '220px' 
                      }} 
                      title={item.scriptName}
                    >
                      {item.scriptName}
                    </span>
                    <button
                      onClick={() => handleExportSingleRegex(item.script, item.scriptName)}
                      style={{ 
                        padding: '4px 8px', 
                        cursor: 'pointer', 
                        background: 'rgba(124, 106, 240, 0.1)', 
                        border: '1px solid rgba(124, 106, 240, 0.2)', 
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--accent-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(124, 106, 240, 0.2)';
                        e.currentTarget.style.borderColor = 'rgba(124, 106, 240, 0.4)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(124, 106, 240, 0.1)';
                        e.currentTarget.style.borderColor = 'rgba(124, 106, 240, 0.2)';
                      }}
                      title={ui.epDownloadRegexTitle}
                    >
                      <Download size={11} />
                      JSON
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {translatedTavernHelpers.length > 0 && (
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>TavernHelper Scripts ({translatedTavernHelpers.length})</span>
                {translatedTavernHelpers.length > 1 && (
                  <button
                    onClick={handleExportAllTavernHelper}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--accent-primary)',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '2px 6px',
                      borderRadius: 'var(--radius-sm)',
                      transition: 'background 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(124, 106, 240, 0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                    title={ui.epDownloadAllThTitle}
                  >
                    <Download size={11} />
                    {ui.epDownloadAll}
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '6px', flexDirection: 'column' }}>
                {translatedTavernHelpers.map((item) => (
                  <div 
                    key={`th-${item.key}-${item.index}`} 
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between', 
                      padding: '6px 10px', 
                      background: 'var(--bg-secondary)', 
                      borderRadius: 'var(--radius-sm)', 
                      border: '1px solid var(--border-subtle)',
                      transition: 'border-color 0.2s, background-color 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(124, 106, 240, 0.3)';
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border-subtle)';
                      e.currentTarget.style.backgroundColor = 'var(--bg-secondary)';
                    }}
                  >
                    <span 
                      style={{ 
                        fontSize: '0.7rem', 
                        color: 'var(--text-primary)', 
                        fontWeight: 500,
                        overflow: 'hidden', 
                        textOverflow: 'ellipsis', 
                        whiteSpace: 'nowrap', 
                        maxWidth: '220px' 
                      }} 
                      title={item.name}
                    >
                      {item.name}
                    </span>
                    <button
                      onClick={() => handleExportSingleTavernHelper(item.script, item.name)}
                      style={{ 
                        padding: '4px 8px', 
                        cursor: 'pointer', 
                        background: 'rgba(124, 106, 240, 0.1)', 
                        border: '1px solid rgba(124, 106, 240, 0.2)', 
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--accent-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(124, 106, 240, 0.2)';
                        e.currentTarget.style.borderColor = 'rgba(124, 106, 240, 0.4)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(124, 106, 240, 0.1)';
                        e.currentTarget.style.borderColor = 'rgba(124, 106, 240, 0.2)';
                      }}
                      title={ui.epDownloadThTitle}
                    >
                      <Download size={11} />
                      JSON
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Icon nhỏ theo mức độ vấn đề trong danh sách sức khoẻ thẻ. */
function IssueIcon({ severity }: { severity: HealthSeverity }) {
  if (severity === 'error') return <XCircle size={12} style={{ flexShrink: 0, marginTop: 1, color: 'var(--accent-danger)' }} />;
  if (severity === 'warning') return <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1, color: 'var(--accent-warning)' }} />;
  return <Info size={12} style={{ flexShrink: 0, marginTop: 1, color: 'var(--text-muted)' }} />;
}
