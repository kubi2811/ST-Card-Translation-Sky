import { useState } from 'react';
import { useStore } from '../store';
import { Pencil, Check, X } from 'lucide-react';
import { useUi } from '../i18n/useLocale';
import { fmt } from '../i18n';

/** Inline editor to rename the card while working (incl. during translation).
 *  Clearly separates the SillyTavern character name (card.data.name / card.name)
 *  from the export file name (cardFileName) so the two are never mixed up. */
export default function CardRenamePanel() {
  // (bug 213) selector hẹp — destructure trần từ useStore() là subscribe TOÀN store: mọi
  // set() (addLog/updateField suốt lượt dịch) đều kéo component này re-render dù chẳng liên quan.
  const card = useStore((s) => s.card);
  const cardFileName = useStore((s) => s.cardFileName);
  const renameCard = useStore((s) => s.renameCard);
  const addToast = useStore((s) => s.addToast);
  const ui = useUi();
  const [open, setOpen] = useState(false);

  const currentCharName = (card?.data?.name || card?.name || '') as string;
  // Show the file name without its extension; re-attach the original extension on save.
  const extMatch = cardFileName.match(/\.(png|json)$/i);
  const ext = extMatch ? extMatch[0] : '';
  const baseFileName = ext ? cardFileName.slice(0, -ext.length) : cardFileName;

  const [charName, setCharName] = useState(currentCharName);
  const [fileName, setFileName] = useState(baseFileName);

  if (!card) return null;

  const openEditor = () => {
    setCharName(currentCharName);
    setFileName(baseFileName);
    setOpen(true);
  };

  const save = () => {
    const cleanChar = charName.trim();
    const cleanFile = fileName.trim().replace(/[\\/:*?"<>|]/g, '_'); // strip filesystem-illegal chars
    renameCard({
      charName: cleanChar || undefined,
      fileName: cleanFile ? cleanFile + ext : undefined,
    });
    addToast('success', ui.crToastRenamed);
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={openEditor}
        className="btn btn-ghost btn-xs"
        title={ui.crButtonTitle}
        style={{ padding: '3px 8px', fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--accent-secondary)' }}
      >
        <Pencil size={11} /> {ui.crButton}
      </button>
    );
  }

  return (
    <div
      style={{
        marginTop: '8px',
        padding: '10px',
        background: 'var(--bg-primary)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-sm)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        <span style={{ fontSize: '0.62rem', color: 'var(--accent-secondary)', fontWeight: 600 }}>
          {ui.crCharName}
        </span>
        <input
          className="input"
          value={charName}
          onChange={(e) => setCharName(e.target.value)}
          placeholder={ui.crCharNamePh}
          style={{ fontSize: '0.78rem' }}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
        />
        <span style={{ fontSize: '0.55rem', color: 'var(--text-muted)' }}>
          {ui.crCharNameHint1} <code>data.name</code> {ui.crCharNameHint2} <code>name</code>{ui.crCharNameHint3}
        </span>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        <span style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
          {ui.crFileName} {ext && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{fmt(ui.crFileNameExt, { ext })}</span>}
        </span>
        <input
          className="input"
          value={fileName}
          onChange={(e) => setFileName(e.target.value)}
          placeholder="ten-file-xuat"
          style={{ fontSize: '0.78rem' }}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
        />
        <span style={{ fontSize: '0.55rem', color: 'var(--text-muted)' }}>
          {ui.crFileNameHint}
        </span>
      </label>

      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
        <button onClick={() => setOpen(false)} className="btn btn-ghost btn-xs" style={{ padding: '4px 10px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <X size={12} /> {ui.crCancel}
        </button>
        <button onClick={save} className="btn btn-primary btn-xs" style={{ padding: '4px 12px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Check size={12} /> {ui.crSave}
        </button>
      </div>
    </div>
  );
}
