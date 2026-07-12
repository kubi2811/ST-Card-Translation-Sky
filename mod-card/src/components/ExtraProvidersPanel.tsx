'use client';

import { LLMConfig } from '@/lib/llm';
import { useT } from '@/i18n/I18nProvider';

const PROVIDERS: { value: LLMConfig['provider']; label: string }[] = [
  { value: 'gemini', label: 'Google (Gemini)' },
  { value: 'openai', label: 'OpenAI Compatible' },
  { value: 'anthropic', label: 'Anthropic' },
];

/**
 * Cấu hình các provider PHỤ chạy SONG SONG với provider chính. Engine rải call round-robin →
 * nhiều provider cùng lúc cho các bước mod. Mỗi provider có key/model riêng.
 */
export default function ExtraProvidersPanel({ providers, onChange }: {
  providers: LLMConfig[];
  onChange: (next: LLMConfig[]) => void;
}) {
  const t = useT();
  const update = (i: number, patch: Partial<LLMConfig>) => onChange(providers.map((p, idx) => idx === i ? { ...p, ...patch } : p));
  const remove = (i: number) => onChange(providers.filter((_, idx) => idx !== i));
  const add = () => onChange([...providers, { provider: 'gemini', apiKey: '', model: '', customUrl: '' }]);

  return (
    <div className="border border-indigo-800 rounded-lg p-3 bg-indigo-950/40/40">
      <h3 className="text-sm font-extrabold text-neutral-100 mb-1">{t.epTitle}</h3>
      <p className="text-[11px] text-neutral-300 mb-2 leading-snug">
        {t.epDesc}
      </p>

      <div className="flex flex-col gap-2">
        {providers.map((p, i) => (
          <div key={i} className="border border-neutral-700 rounded-md p-2 bg-neutral-900 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-neutral-200">Provider #{i + 2}</span>
              <button onClick={() => remove(i)} className="ml-auto text-xs text-red-600 hover:underline font-bold">{t.epRemove}</button>
            </div>
            {/* 2 field / hàng */}
            <div className="grid grid-cols-2 gap-2">
              <select value={p.provider} onChange={e => update(i, { provider: e.target.value as LLMConfig['provider'] })}
                className="text-xs border border-neutral-700 rounded px-2 py-1 bg-neutral-900 text-neutral-100 font-medium">
                {PROVIDERS.map(pr => <option key={pr.value} value={pr.value}>{pr.label}</option>)}
              </select>
              <input value={p.customUrl || ''} onChange={e => update(i, { customUrl: e.target.value })} placeholder={t.epBaseUrlPh}
                className="text-xs border border-neutral-700 rounded px-2 py-1 bg-neutral-900 text-neutral-100" />
            </div>
            <input value={p.apiKey} onChange={e => update(i, { apiKey: e.target.value })} placeholder="API Key" type="password"
              className="text-xs border border-neutral-700 rounded px-2 py-1 bg-neutral-900 text-neutral-100" />
            <input value={p.model} onChange={e => update(i, { model: e.target.value })} placeholder={t.epModelPh}
              className="text-xs border border-neutral-700 rounded px-2 py-1 bg-neutral-900 text-neutral-100" />
          </div>
        ))}
      </div>

      <button onClick={add} className="mt-2 w-full text-xs font-bold text-indigo-300 border border-dashed border-indigo-700 rounded-md py-1.5 hover:bg-indigo-900/40">
        {t.epAdd}
      </button>
    </div>
  );
}
