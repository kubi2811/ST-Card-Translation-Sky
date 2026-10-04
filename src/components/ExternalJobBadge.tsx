/**
 * (bug 239) Nhãn nổi ở màn hình chính: "Link ngoài vẫn đang dịch — phần 3/12".
 *
 * Lượt dịch link ngoài giờ chạy tiếp khi đóng Regex Manager. Nhưng chạy mà không ai thấy thì người
 * dùng lại tưởng nó đã dừng, hoặc tệ hơn — tắt tab giữa chừng. Nhãn này nói rõ nó còn sống, và bấm
 * vào là mở lại đúng chỗ.
 */
import { useStore } from '../store';
import { useHeavyScriptJob } from '../utils/heavyScriptJob';
import { Loader2, Link2 } from 'lucide-react';
import { useUi } from '../i18n/useLocale';
import { fmt } from '../i18n';

export const EXTERNAL_FIELD_PATH = 'custom_external_link';

/** Có lượt dịch link ngoài nào đang chạy không (dùng cả ngoài React). */
export function isExternalTranslateActive(): boolean {
  if (useHeavyScriptJob.getState().running) return true;
  return useStore.getState().fields.some(f => f.path === EXTERNAL_FIELD_PATH && f.status === 'translating');
}

export default function ExternalJobBadge({ onOpen }: { onOpen: () => void }) {
  const ui = useUi();
  const heavyRunning = useHeavyScriptJob((s) => s.running);
  const heavyActive = useHeavyScriptJob((s) => s.activeIdx);
  const heavyTotal = useHeavyScriptJob((s) => s.parts.length);
  const heavyDone = useHeavyScriptJob((s) => s.results.filter(Boolean).length);
  const field = useStore((s) => s.fields.find(f => f.path === EXTERNAL_FIELD_PATH && f.status === 'translating'));

  if (!heavyRunning && !field) return null;

  let text: string;
  if (heavyRunning) {
    text = fmt(ui.xbHeavy, { i: Math.max(1, heavyActive + 1), n: heavyTotal, done: heavyDone });
  } else {
    const total = field!.totalChunks || 0;
    const done = (field!.completedChunks || []).filter(c => !!c?.trim()).length;
    text = total > 0 ? fmt(ui.xbExternal, { done, total }) : ui.xbExternalNoChunks;
  }

  return (
    <button
      onClick={onOpen}
      title={ui.xbTip}
      style={{
        position: 'fixed', right: 16, bottom: 16, zIndex: 900,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', borderRadius: 999, cursor: 'pointer',
        background: 'var(--bg-elevated, #1e1e2a)', color: 'var(--text-primary)',
        border: '1px solid var(--accent-primary)', boxShadow: '0 4px 18px rgba(0,0,0,0.35)',
        fontSize: '0.75rem',
      }}
    >
      <Loader2 size={14} className="spin" color="var(--accent-primary)" />
      <Link2 size={14} />
      {text}
    </button>
  );
}
