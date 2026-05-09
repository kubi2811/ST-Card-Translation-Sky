import { useStore } from '../store';
import { useTranslation } from '../hooks/useTranslation';
import { useT } from '../i18n/useLocale';
import { Download, AlertTriangle, Image as ImageIcon, KeyRound } from 'lucide-react';
import { embedCharaToPNG } from '../utils/pngHandler';
import { cardToWorldbook } from '../utils/worldbookParser';
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
    </div>
  );
}
