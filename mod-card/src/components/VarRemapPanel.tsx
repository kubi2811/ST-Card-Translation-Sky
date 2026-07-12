'use client';

import { useState } from 'react';
import { CardV3 } from '@/types/card';
import { LLMConfig } from '@/lib/llm';
import { ModOrchestrator } from '@/lib/orchestrator';
import { CardParser, VariableRemap } from '@/lib/parser';
import { useT } from '@/i18n/I18nProvider';
import { fmt } from '@/i18n';

interface Row extends VariableRemap { include: boolean; }

/**
 * MOD BIẾN MVU-ZOD: nhập yêu cầu → AI đề xuất đổi tên/nghĩa biến → duyệt/sửa từng dòng → áp dụng
 * (đổi đồng bộ schema + getvar + initvar + mvu_update). Áp deterministic (không nhờ AI ghép JSON lớn).
 */
export default function VarRemapPanel({ card, llmConfig, extraProviders = [], onApplied }: {
  card: CardV3;
  llmConfig: LLMConfig;
  extraProviders?: LLMConfig[];
  onApplied: (newCard: CardV3, count: number) => void;
}) {
  const t = useT();
  const [request, setRequest] = useState('');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [applied, setApplied] = useState(false);

  const varCount = CardParser.extractVariables(card).length;

  const analyze = async () => {
    if (!llmConfig.apiKey) { setError(t.errNoApiKey); return; }
    if (!request.trim()) { setError(t.vrErrNoRequest); return; }
    setLoading(true); setError(''); setRows([]); setApplied(false);
    try {
      const remaps = await new ModOrchestrator(llmConfig, extraProviders).remapMvuVariables(card, request.trim());
      if (remaps.length === 0) { setError(t.vrErrNoRemap); }
      setRows(remaps.map(r => ({ ...r, include: true })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  };

  const apply = () => {
    const selected = rows.filter(r => r.include && r.oldKey && ((r.newKey && r.newKey !== r.oldKey) || r.newDescribe));
    if (selected.length === 0) { setError(t.vrErrNoRow); return; }
    const newCard = CardParser.applyVariableRemap(card, selected);
    onApplied(newCard, selected.length);
    setApplied(true);
  };

  const setRow = (i: number, patch: Partial<Row>) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  return (
    <div className="bg-neutral-900 p-4 rounded-lg shadow-sm border border-purple-700">
      <h2 className="text-lg font-extrabold text-neutral-100 mb-1">{t.vrTitle}</h2>
      <p className="text-xs text-neutral-300 font-semibold mb-2">
        {fmt(t.vrDesc, { count: varCount })}
      </p>

      <textarea
        value={request} onChange={e => setRequest(e.target.value)} rows={3}
        placeholder={t.vrPh}
        className="w-full text-sm rounded-md border-2 border-neutral-700 p-2 bg-neutral-900 focus:bg-neutral-800 focus:ring-indigo-500 focus:border-indigo-500 placeholder-neutral-500 text-neutral-100 font-medium"
      />

      <div className="flex items-center gap-2 mt-2">
        <button onClick={analyze} disabled={loading}
          className="px-3 py-1.5 rounded-md text-sm font-bold text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50">
          {loading ? t.vrAnalyzing : t.vrAnalyze}
        </button>
        {rows.length > 0 && (
          <button onClick={apply}
            className="px-3 py-1.5 rounded-md text-sm font-bold text-white bg-green-600 hover:bg-green-700">
            {fmt(t.vrApply, { count: rows.filter(r => r.include).length })}
          </button>
        )}
        {applied && <span className="text-xs text-green-300 font-bold">{t.vrApplied}</span>}
      </div>

      {error && <p className="text-xs text-red-600 font-semibold mt-2">{error}</p>}

      {rows.length > 0 && (
        <div className="mt-3 max-h-72 overflow-y-auto border border-neutral-800 rounded">
          <table className="w-full text-xs">
            <thead className="bg-neutral-800 text-neutral-200 sticky top-0">
              <tr>
                <th className="p-1.5 w-8"></th>
                <th className="p-1.5 text-left">{t.vrColOld}</th>
                <th className="p-1.5 text-left">{t.vrColNew}</th>
                <th className="p-1.5 text-left">{t.vrColDesc}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={r.include ? 'bg-neutral-900' : 'bg-neutral-900 opacity-60'}>
                  <td className="p-1.5 text-center">
                    <input type="checkbox" checked={r.include} onChange={e => setRow(i, { include: e.target.checked })} />
                  </td>
                  <td className="p-1.5 font-mono text-neutral-300">{r.oldKey}</td>
                  <td className="p-1.5">
                    <input value={r.newKey || ''} onChange={e => setRow(i, { newKey: e.target.value })}
                      className="w-full font-mono px-1 py-0.5 border border-neutral-700 rounded text-indigo-200 font-bold" />
                  </td>
                  <td className="p-1.5">
                    <input value={r.newDescribe || ''} onChange={e => setRow(i, { newDescribe: e.target.value })}
                      placeholder={t.vrKeepPh}
                      className="w-full px-1 py-0.5 border border-neutral-700 rounded text-neutral-200" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
