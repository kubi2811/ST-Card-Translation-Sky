import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { useUi } from '../i18n/useLocale';
import { fmt } from '../i18n';
import { BookMarked, ChevronDown, ChevronRight } from 'lucide-react';
import type { GlossaryEntry } from '../types/card';

type Origin = 'name' | 'harvest' | 'preset' | 'manual';

/**
 * (User yêu cầu 2026) VISUALIZE "bộ quy tắc dịch" của từng thẻ — trả lời thắc mắc "dictionary hình
 * như cố định". Thực ra Từ điển TỰ lớn dần: Pha 0 quét tên riêng trước dịch, HỌC thêm tên/biệt danh
 * trong khi dịch (harvest), tự nạp bộ thuật ngữ khớp thể loại. Panel này hiện read-only, gom theo
 * NGUỒN GỐC để user thấy rõ card này đang dịch theo luật nào. Sửa/thêm vẫn ở phần Cấu hình.
 */
const GROUP_META: Record<Origin, { icon: string; labelKey: 'gvGroupName' | 'gvGroupHarvest' | 'gvGroupPreset' | 'gvGroupManual'; color: string }> = {
  name:    { icon: '📖', labelKey: 'gvGroupName',    color: '#818cf8' },
  harvest: { icon: '📚', labelKey: 'gvGroupHarvest', color: '#4ade80' },
  preset:  { icon: '🏷️', labelKey: 'gvGroupPreset',  color: '#fbbf24' },
  manual:  { icon: '✍️', labelKey: 'gvGroupManual',  color: '#38bdf8' },
};
const GROUP_ORDER: Origin[] = ['name', 'harvest', 'preset', 'manual'];

export default function GlossaryVizPanel() {
  const card = useStore((s) => s.card);
  const glossary = useStore((s) => s.translationConfig.glossary);
  const ui = useUi() as Record<string, string>;
  const [expanded, setExpanded] = useState(true);

  const groups = useMemo(() => {
    const g: Record<Origin, GlossaryEntry[]> = { name: [], harvest: [], preset: [], manual: [] };
    for (const e of glossary) {
      if (!e.source?.trim() && !e.target?.trim()) continue;
      const origin: Origin = e.origin ?? (e.auto ? 'name' : 'manual');
      g[origin].push(e);
    }
    return g;
  }, [glossary]);

  const total = useMemo(() => glossary.filter((e) => e.source?.trim() || e.target?.trim()).length, [glossary]);

  if (!card) return null;

  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', overflow: 'hidden' }}>
      {/* Header */}
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
      >
        <BookMarked size={16} style={{ color: 'var(--accent-primary)' }} />
        <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{ui.gvTitle}</span>
        <span style={{ padding: '1px 7px', borderRadius: 8, fontSize: '0.62rem', fontWeight: 700, background: 'rgba(124,106,240,0.12)', color: 'var(--accent-primary)' }}>
          {total}
        </span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>{expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
      </div>

      {expanded && (
        <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '10px 0 12px', lineHeight: 1.55 }}>
            {ui.gvHint}
          </div>

          {total === 0 ? (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '14px', textAlign: 'center', background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border-subtle)' }}>
              {ui.gvEmpty}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 420, overflowY: 'auto' }}>
              {GROUP_ORDER.map((origin) => {
                const entries = groups[origin];
                if (entries.length === 0) return null;
                const meta = GROUP_META[origin];
                return (
                  <div key={origin}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <span style={{ fontSize: '0.7rem' }}>{meta.icon}</span>
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: meta.color }}>{ui[meta.labelKey]}</span>
                      <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>({entries.length})</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {entries.map((e, i) => (
                        <div
                          key={`${e.source}-${i}`}
                          title={`${e.source} → ${e.target}`}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-primary)', border: `1px solid ${meta.color}22`, fontSize: '0.7rem', maxWidth: '100%' }}
                        >
                          <span style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted)' }}>{e.source}</span>
                          <span style={{ color: meta.color }}>→</span>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.target || '…'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: 12, fontStyle: 'italic' }}>
            {fmt(ui.gvEditHint, { name: GROUP_META.name.icon, harvest: GROUP_META.harvest.icon })}
          </div>
        </div>
      )}
    </div>
  );
}
