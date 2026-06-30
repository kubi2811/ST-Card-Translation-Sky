import { useState } from 'react';
import { useStore } from '../store';
import { Pencil, Check, X } from 'lucide-react';

/** Inline editor to rename the card while working (incl. during translation).
 *  Clearly separates the SillyTavern character name (card.data.name / card.name)
 *  from the export file name (cardFileName) so the two are never mixed up. */
export default function CardRenamePanel() {
  const { card, cardFileName, renameCard, addToast } = useStore();
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
    addToast('success', 'Đã đổi tên card');
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={openEditor}
        className="btn btn-ghost btn-xs"
        title="Đổi tên card (tên nhân vật / tên file)"
        style={{ padding: '3px 8px', fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--accent-secondary)' }}
      >
        <Pencil size={11} /> Đổi tên
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
          Tên nhân vật (hiển thị trong SillyTavern)
        </span>
        <input
          className="input"
          value={charName}
          onChange={(e) => setCharName(e.target.value)}
          placeholder="VD: Tô Huyền"
          style={{ fontSize: '0.78rem' }}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
        />
        <span style={{ fontSize: '0.55rem', color: 'var(--text-muted)' }}>
          Cập nhật cả <code>data.name</code> và <code>name</code>. Field tên cũng được đánh dấu xong để không bị ghi đè khi xuất.
        </span>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        <span style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
          Tên file khi xuất {ext && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(đuôi {ext})</span>}
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
          Chỉ đổi tên file tải về — KHÔNG ảnh hưởng tên nhân vật bên trong.
        </span>
      </label>

      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
        <button onClick={() => setOpen(false)} className="btn btn-ghost btn-xs" style={{ padding: '4px 10px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <X size={12} /> Huỷ
        </button>
        <button onClick={save} className="btn btn-primary btn-xs" style={{ padding: '4px 12px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Check size={12} /> Lưu
        </button>
      </div>
    </div>
  );
}
