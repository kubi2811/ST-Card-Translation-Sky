'use client';

import { useMemo, useState } from 'react';
import { CardV3 } from '@/types/card';
import { LLMConfig } from '@/lib/llm';
import { ModOrchestrator, extractSections, applyModification } from '@/lib/orchestrator';
import { useT } from '@/i18n/I18nProvider';

/**
 * Đào sâu 1 PHẦN NHỎ trong 1 section (vd mở rộng chi tiết block <Appearance> trong Mô tả).
 * Tự chứa: chọn section → nêu phần cần đào sâu + yêu cầu → xem trước → áp vào thẻ.
 */
export default function SubExpandPanel({ card, llmConfig, extraProviders = [], onApplied }: {
  card: CardV3;
  llmConfig: LLMConfig;
  extraProviders?: LLMConfig[];
  onApplied: (newCard: CardV3) => void;
}) {
  const t = useT();
  const sections = useMemo(() => extractSections(card).filter(s => !s.is_code), [card]);
  const [sectionId, setSectionId] = useState(sections[0]?.section_id || '');
  const [subMarker, setSubMarker] = useState('');
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const section = sections.find(s => s.section_id === sectionId);

  const expand = async () => {
    if (!llmConfig.apiKey) { setError(t.errNoApiKey); return; }
    if (!section) { setError(t.seErrNoSection); return; }
    if (!subMarker.trim()) { setError(t.seErrNoMarker); return; }
    setLoading(true); setError(''); setResult('');
    try {
      const out = await new ModOrchestrator(llmConfig, extraProviders).expandSubSection(card, section.content, subMarker.trim(), instruction.trim());
      setResult(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  };

  const apply = () => {
    if (!section || !result) return;
    onApplied(applyModification(card, section.field_path, result));
    setResult('');
  };

  return (
    <div className="bg-neutral-900 p-4 rounded-lg shadow-sm border border-amber-700">
      <h2 className="text-lg font-extrabold text-neutral-100 mb-1">{t.seTitle}</h2>
      <p className="text-xs text-neutral-300 font-semibold mb-2">
        {t.seDesc}
      </p>

      <label className="block text-xs font-bold text-neutral-200 mb-1">{t.seSelectSection}</label>
      <select value={sectionId} onChange={e => { setSectionId(e.target.value); setResult(''); }}
        className="w-full text-sm border-2 border-neutral-700 rounded p-1.5 bg-neutral-900 text-neutral-100 font-medium mb-2">
        {sections.map(s => <option key={s.section_id} value={s.section_id}>{s.label}</option>)}
      </select>

      <input value={subMarker} onChange={e => setSubMarker(e.target.value)}
        placeholder={t.seMarkerPh}
        className="w-full text-sm border-2 border-neutral-700 rounded p-1.5 bg-neutral-900 text-neutral-100 mb-2" />

      <textarea value={instruction} onChange={e => setInstruction(e.target.value)} rows={2}
        placeholder={t.seRequestPh}
        className="w-full text-sm border-2 border-neutral-700 rounded p-1.5 bg-neutral-900 text-neutral-100 mb-2" />

      <div className="flex items-center gap-2">
        <button onClick={expand} disabled={loading}
          className="px-3 py-1.5 rounded-md text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50">
          {loading ? t.seRunning : t.seRun}
        </button>
        {result && (
          <button onClick={apply} className="px-3 py-1.5 rounded-md text-sm font-bold text-white bg-green-600 hover:bg-green-700">
            {t.seApply}
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-600 font-semibold mt-2">{error}</p>}

      {result && (
        <div className="mt-2">
          <div className="text-xs font-bold text-neutral-300 mb-1">{t.sePreview}</div>
          <textarea value={result} onChange={e => setResult(e.target.value)} rows={8}
            className="w-full text-xs border border-neutral-700 rounded p-2 bg-neutral-900 text-neutral-100 font-mono" />
        </div>
      )}
    </div>
  );
}
