import { useState } from 'react';
import { Download, X, History } from 'lucide-react';
import { useT } from '../i18n/useLocale';

export default function UpdateButton() {
  const t = useT();
  const [isOpen, setIsOpen] = useState(false);
  const [log, setLog] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [modalTitle, setModalTitle] = useState('');

  const runCommand = async (endpoint: string, displayTitle: string) => {
    setIsOpen(true);
    setLog('');
    setIsUpdating(true);
    setModalTitle(displayTitle);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
      });

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        setLog((prev) => prev + text);
      }
    } catch (err: any) {
      setLog((prev) => prev + `\nLỗi: ${err.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleUpdate = () => runCommand('/api/update', 'Cập nhật ứng dụng');
  const handleDowngrade = () => runCommand('/api/downgrade', 'Hạ cấp phiên bản');

  return (
    <>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        {/* Downgrade button */}
        <button
          onClick={handleDowngrade}
          title="Hạ cấp phiên bản (Trở lại 1 commit)"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '32px',
            height: '32px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-elevated)')}
        >
          <History size={16} />
        </button>

        {/* Update button */}
        <button
          onClick={handleUpdate}
          title="Cập nhật ứng dụng (Bản mới nhất)"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '32px',
            height: '32px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            color: 'var(--accent-primary)',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-elevated)')}
        >
          <Download size={16} />
        </button>
      </div>

      {isOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: 'var(--bg-primary)',
              width: '90%',
              maxWidth: '600px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
            }}
          >
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{modalTitle}</h3>
              <button
                onClick={() => !isUpdating && setIsOpen(false)}
                disabled={isUpdating}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: isUpdating ? 'not-allowed' : 'pointer',
                  color: 'var(--text-muted)',
                  padding: 4,
                  display: 'flex',
                  opacity: isUpdating ? 0.5 : 1,
                }}
              >
                <X size={20} />
              </button>
            </div>
            
            <div style={{ padding: '20px' }}>
              <pre
                style={{
                  background: '#1e1e1e',
                  color: '#d4d4d4',
                  padding: '16px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.85rem',
                  fontFamily: 'monospace',
                  minHeight: '200px',
                  maxHeight: '400px',
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  margin: 0,
                }}
              >
                {log || 'Đang chuẩn bị thực hiện...'}
              </pre>
            </div>

            <div
              style={{
                padding: '16px 20px',
                borderTop: '1px solid var(--border-subtle)',
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              {!isUpdating && (
                <button
                  onClick={() => window.location.reload()}
                  style={{
                    padding: '8px 16px',
                    background: 'var(--accent-primary)',
                    color: 'white',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  Tải lại trang
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
