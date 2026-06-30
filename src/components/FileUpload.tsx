import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useCardParser } from '../hooks/useCardParser';
import { useStore } from '../store';
import { useT } from '../i18n/useLocale';
import { getCardSummary } from '../utils/cardFields';
import { getWorldbookSummary } from '../utils/worldbookParser';
import CardRenamePanel from './CardRenamePanel';
import {
  Upload,
  FileJson,
  BookOpen,
  MessageSquare,
  Code,
  Layers,
  Puzzle,
  X,
  Globe,
  Loader,
  Link as LinkIcon,
} from 'lucide-react';

export default function FileUpload() {
  const { parseCardFile, updateCardFromOriginal, clearCard, isParsing, parseProgress } = useCardParser();
  const { card, cardFileName, contentType, originalWorldbook, loadTranslationCache, addLog } = useStore();
  const t = useT();

  const [urlInput, setUrlInput] = useState('');
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);

  const handleUrlLoad = async () => {
    if (!urlInput.trim()) return;
    setIsFetchingUrl(true);
    try {
      const response = await fetch(urlInput.trim());
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      
      let fileName = 'url_card';
      try {
        const urlPath = new URL(urlInput.trim()).pathname;
        const urlFile = urlPath.split('/').pop();
        if (urlFile && (urlFile.endsWith('.json') || urlFile.endsWith('.png'))) {
          fileName = urlFile;
        } else {
          if (blob.type === 'application/json') fileName += '.json';
          else if (blob.type === 'image/png') fileName += '.png';
          else fileName += '.json';
        }
      } catch (e) {
        fileName += '.json';
      }

      const file = new File([blob], fileName, { type: blob.type });
      parseCardFile(file);
      
      setTimeout(async () => {
        const restored = await loadTranslationCache(file.name);
        if (restored) addLog('info', `♻️ Restored cached translation progress for "${file.name}"`);
      }, 500);
      
      setUrlInput('');
    } catch (err: any) {
      addLog('error', `❌ Lỗi tải link: ${err.message || String(err)} (có thể do CORS)`);
    } finally {
      setIsFetchingUrl(false);
    }
  };

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        const file = acceptedFiles[0];
        parseCardFile(file);

        // Try to restore cached translation progress for this file
        setTimeout(async () => {
          const restored = await loadTranslationCache(file.name);
          if (restored) {
            addLog('info', `♻️ Restored cached translation progress for "${file.name}"`);
          }
        }, 500); // Small delay to let parseCardFile complete
      }
    },
    [parseCardFile, loadTranslationCache, addLog]
  );

  const onUpdateDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        const file = acceptedFiles[0];
        await updateCardFromOriginal(file);
      }
    },
    [updateCardFromOriginal]
  );

  const { getRootProps, getInputProps, isDragActive, isDragAccept } = useDropzone({
    onDrop,
    accept: { 'application/json': ['.json'], 'image/png': ['.png'] },
    multiple: false,
    disabled: isParsing,
  });

  const { getRootProps: getUpdateProps, getInputProps: getUpdateInputProps } = useDropzone({
    onDrop: onUpdateDrop,
    accept: { 'application/json': ['.json'], 'image/png': ['.png'] },
    multiple: false,
    noClick: false,
  });

  const summary = card ? getCardSummary(card) : null;
  const wbSummary = (contentType === 'worldbook' && originalWorldbook) ? getWorldbookSummary(originalWorldbook) : null;
  const isWorldbook = contentType === 'worldbook';

  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title">
          <FileJson size={16} style={{ color: 'var(--accent-secondary)' }} />
          {t.characterCard}
        </span>
        {card && (
          <button
            className="btn btn-ghost btn-xs"
            onClick={(e) => {
              e.stopPropagation();
              clearCard();
            }}
            title={t.clearCard}
          >
            <X size={14} />
          </button>
        )}
      </div>
      <div className="section-body">
        {!card ? (
          isParsing ? (
            /* Loading state while Worker parses large file */
            <div
              className="dropzone"
              style={{ pointerEvents: 'none', opacity: 0.9 }}
            >
              <Loader
                size={32}
                style={{
                  color: 'var(--accent-primary)',
                  marginBottom: '8px',
                  animation: 'spin 1s linear infinite',
                }}
              />
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '6px' }}>
                {parseProgress?.stage === 'reading' && 'Reading file...'}
                {parseProgress?.stage === 'parsing' && 'Parsing JSON...'}
                {parseProgress?.stage === 'extracting' && 'Extracting data...'}
                {parseProgress?.stage === 'fields' && 'Building field list...'}
                {parseProgress?.stage === 'done' && 'Almost done...'}
                {!parseProgress?.stage && 'Processing...'}
              </p>
              <div style={{
                width: '120px', height: '4px',
                background: 'var(--bg-primary)',
                borderRadius: '2px',
                overflow: 'hidden',
              }}>
                <div style={{
                  width: `${parseProgress?.percent || 0}%`,
                  height: '100%',
                  background: 'var(--accent-primary)',
                  borderRadius: '2px',
                  transition: 'width 0.3s ease',
                }} />
              </div>
            </div>
          ) : (
          <>
            <div
              {...getRootProps()}
              className={`dropzone ${isDragActive ? 'dropzone-active' : ''} ${isDragAccept ? 'dropzone-accepted' : ''}`}
            >
              <input {...getInputProps()} />
              <Upload
                size={32}
                style={{
                  color: isDragActive ? 'var(--accent-primary)' : 'var(--text-muted)',
                  marginBottom: '8px',
                }}
              />
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '4px' }}>
                {isDragActive ? '...' : t.dragDropCard}
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                {t.orClickBrowse}
              </p>
            </div>
            
            <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <LinkIcon size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input 
                  type="text" 
                  className="input" 
                  style={{ paddingLeft: '32px' }}
                  placeholder="Nhập link card (JSON/PNG)..." 
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleUrlLoad(); }}
                  disabled={isParsing || isFetchingUrl}
                />
              </div>
              <button 
                className="btn btn-secondary" 
                onClick={handleUrlLoad}
                disabled={!urlInput.trim() || isParsing || isFetchingUrl}
              >
                {isFetchingUrl ? <Loader size={14} className="spin" /> : 'Tải'}
              </button>
            </div>
          </>
          )
        ) : (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Card Name */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 12px',
                background: 'var(--bg-primary)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '1rem',
                  color: 'white',
                  flexShrink: 0,
                }}
              >
                {(summary?.name || '?')[0].toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {summary?.name}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
               {cardFileName} · {isWorldbook ? t.worldbookBadge : `${t.specVersion}: ${summary?.spec}`}
                </div>
              </div>
            </div>

            {!isWorldbook && <CardRenamePanel />}

            {isWorldbook ? (
              /* Worldbook-specific stats */
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '6px',
                }}
              >
                <StatItem icon={<Globe size={13} />} label={t.worldbookEntries} value={`${wbSummary?.entryCount || 0}`} />
                <StatItem icon={<BookOpen size={13} />} label={t.worldbookWithContent} value={`${wbSummary?.withContent || 0}`} />
              </div>
            ) : (
              /* Card-specific stats */
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '6px',
                }}
              >
                <StatItem icon={<BookOpen size={13} />} label={t.lorebookEntries} value={`${summary?.lorebookCount || 0}`} />
                <StatItem icon={<MessageSquare size={13} />} label={t.altGreetings} value={`${summary?.altGreetingsCount || 0}`} />
                <StatItem icon={<Code size={13} />} label={t.regexScripts} value={`${summary?.regexCount || 0}`} />
                <StatItem icon={<Layers size={13} />} label={t.depthPrompt} value={summary?.hasDepthPrompt ? '✓' : '—'} />
                {(summary?.tavernHelperCount ?? 0) > 0 && (
                  <StatItem icon={<Puzzle size={13} />} label="TavernHelper" value={`${summary?.tavernHelperCount}`} />
                )}
              </div>
            )}

            {/* Replace / Update Actions */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div {...getRootProps()} style={{ cursor: 'pointer' }}>
                <input {...getInputProps()} />
                <button className="btn btn-ghost btn-sm" style={{ width: '100%', fontSize: '0.75rem', border: '1px dashed var(--border-subtle)' }} title="Replace current card completely">
                  <Upload size={12} /> {t.dragDropCard}
                </button>
              </div>

              <div {...getUpdateProps()} style={{ cursor: 'pointer' }}>
                <input {...getUpdateInputProps()} />
                <button className="btn btn-primary btn-sm" style={{ width: '100%', fontSize: '0.75rem' }} title="Update from a newer original card, keeping existing translations">
                  <Upload size={12} /> Cập nhật bản gốc
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 8px',
        background: 'var(--bg-primary)',
        borderRadius: 'var(--radius-sm)',
        fontSize: '0.75rem',
      }}
    >
      <span style={{ color: 'var(--text-muted)' }}>{icon}</span>
      <span style={{ color: 'var(--text-muted)' }}>{label}:</span>
      <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{value}</span>
    </div>
  );
}
