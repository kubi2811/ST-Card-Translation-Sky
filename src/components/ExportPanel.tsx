import { useMemo } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks/useTranslation';
import { useT } from '../i18n/useLocale';
import { Download, AlertTriangle, Image as ImageIcon, KeyRound, Code } from 'lucide-react';
import { embedCharaToPNG } from '../utils/pngHandler';
import { cardToWorldbook } from '../utils/worldbookParser';
import { setNestedValue } from '../utils/cardFields';
import type { ExportKeyMode } from '../types/card';

const KEY_MODE_OPTIONS: { value: ExportKeyMode; labelEn: string; labelVi: string; desc: string }[] = [
  { value: 'merge', labelEn: 'Merge (Both)', labelVi: 'Gộp (Cả hai)', desc: '原Key + 译Key' },
  { value: 'translated_only', labelEn: 'Translated Only', labelVi: 'Chỉ bản dịch', desc: '译Key only' },
  { value: 'original_only', labelEn: 'Original Only', labelVi: 'Chỉ bản gốc', desc: '原Key only' },
];

export default function ExportPanel() {
  const { card, fields, cardFileName, originalImage, _pngArrayBuffer, translationConfig, setTranslationConfig, phase, saveTranslationCache, locale, contentType, originalWorldbook } = useStore();
  const { getExportCard } = useTranslation();
  const t = useT();
  const isWorldbook = contentType === 'worldbook';

  if (!card || fields.length === 0) return null;

  const doneCount = fields.filter((f) => f.status === 'done').length;
  const errorCount = fields.filter((f) => f.status === 'error').length;
  const pendingCount = fields.filter((f) => f.status === 'pending').length;
  const hasIssues = errorCount > 0 || pendingCount > 0;
  const hasLorebookKeys = fields.some(f => f.group === 'lorebook_keys');

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

      {hasIssues && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            padding: '10px 12px',
            background: 'rgba(240, 196, 106, 0.08)',
            border: '1px solid rgba(240, 196, 106, 0.2)',
            borderRadius: 'var(--radius-md)',
            marginBottom: '12px',
            fontSize: '0.8rem',
            color: 'var(--accent-warning)',
          }}
        >
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
          <div>
            {t.exportWarning}
          </div>
        </div>
      )}

      {/* Lorebook Key Mode Selector */}
      {hasLorebookKeys && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)',
            marginBottom: '6px',
          }}>
            <KeyRound size={13} />
            {locale === 'vi' ? 'Chế độ xuất từ khóa Lorebook' : 'Lorebook Key Export Mode'}
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
                  {locale === 'vi' ? opt.labelVi : opt.labelEn}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            {translationConfig.exportKeyMode === 'merge'
              ? (locale === 'vi' ? 'Giữ từ khóa gốc + thêm từ khóa đã dịch (khuyến nghị)' : 'Keep original + add translated keywords (recommended)')
              : translationConfig.exportKeyMode === 'translated_only'
                ? (locale === 'vi' ? 'Chỉ giữ từ khóa đã dịch, xóa từ khóa gốc' : 'Keep only translated keywords, remove originals')
                : (locale === 'vi' ? 'Giữ nguyên từ khóa gốc, bỏ qua bản dịch' : 'Keep original keywords unchanged, ignore translations')
            }
          </div>
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
      </div>

      {/* Script Export Section */}
      {(translatedRegexes.length > 0 || translatedTavernHelpers.length > 0) && (
        <div style={{ marginTop: '20px', borderTop: '1px solid var(--border-subtle)', paddingTop: '15px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: 600, marginBottom: '12px', color: 'var(--text-primary)' }}>
            <Code size={15} style={{ color: 'var(--accent-primary)' }} />
            {locale === 'vi' ? 'Xuất Script đã Dịch/Mod' : 'Export Translated/Modded Scripts'}
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
                    title={locale === 'vi' ? 'Xuất toàn bộ regex thành file JSON mảng' : 'Export all regex as a single JSON array file'}
                  >
                    <Download size={11} />
                    {locale === 'vi' ? 'Tải tất cả' : 'Download all'}
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
                      title={locale === 'vi' ? 'Tải Regex JSON' : 'Download Regex JSON'}
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
                    title={locale === 'vi' ? 'Xuất toàn bộ TavernHelper thành file JSON mảng' : 'Export all TavernHelper as a single JSON array file'}
                  >
                    <Download size={11} />
                    {locale === 'vi' ? 'Tải tất cả' : 'Download all'}
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
                      title={locale === 'vi' ? 'Tải TavernHelper JSON' : 'Download TavernHelper JSON'}
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
