/**
 * UpdateRulesEditor — 4 entry [mvu_update] sinh từ schema.
 * ─────────────────────────────────────────────────────────────────────────────
 * Tab này TỪNG có bộ sinh riêng, và bộ đó lệch hẳn với bộ mà Auto Creator / Export Wizard dùng:
 *   • Quy tắc: lá string/boolean ra đúng một dòng `Tên:` trống — AI trong game không biết khi nào
 *     được đổi nên để im cả ván ("có cái cập nhật được, có cái không").
 *   • Danh sách biến: chỉ đi một tầng, biến lồng sâu không bao giờ được liệt kê.
 *   • Định dạng: dạy "JSON Patch (RFC 6902)" — mà RFC có op `add`, MVU KHÔNG nhận (mvuReference).
 *   • Vị trí ghi vào thẻ: positionExt=0 kèm depth=4 (depth bị bỏ qua), role=1 (=user, phải là
 *     system), order cả ba entry đều 100 nên không có thứ tự xác định.
 * Nay chỉ còn là MÀN HÌNH cho bộ sinh chuẩn trong scriptGenerator.ts; ghi vào thẻ đi qua
 * injectMvuSystemEntry để dùng chung một đặc tả vị trí và một đường dò trùng.
 */

import { useState, useMemo, useCallback } from 'react';
import {
  FileText, Copy, Check,
  Sparkles, Eye, RefreshCw, Wand2, Loader2, Download, Megaphone,
} from 'lucide-react';
import type { MVUZODSchema, MVUZODField } from '../../types/mvuzod.types';
import { useCardStore } from '../../store/cardStore';
import { useSettingsStore } from '../../store/settingsStore';
import { callAI } from '../../lib/ai/client';
import type { ChatMessage } from '../../types';
import { MVUZOD_UPDATE_RULES_PROMPT, MVUZOD_OUTPUT_FORMAT_PROMPT } from '../../prompts/modeMVUZOD';
import { parseSchemaInferenceResponse } from '../../lib/mvuzod/schemaInferencer';
import {
  generateUpdateRulesEntry,
  generateOutputFormatEntry,
  generateVariableListEntry,
  generateEmphasisEntry,
} from '../../lib/mvuzod/scriptGenerator';
import { injectMvuSystemEntry, type MvuSystemEntryId } from '../../lib/mvuzod/injectSystemEntry';
import { checkMvuOutputContract } from '../../lib/mvuzod/mvuReference';
import { copyWithToast } from '../../lib/copyToClipboard';   // (bug 224) copy chạy được cả trong iframe của Hub
import { useToastStore } from '../../store/toastStore';


// ─── Main Component ──────────────────────────────────────────────────────

type TabId = 'rules' | 'format' | 'varlist' | 'emphasis';

export function UpdateRulesEditor({ schema }: {
  schema: MVUZODSchema | null;
}) {
  const [activeTab, setActiveTab] = useState<TabId>('rules');
  const [copied, setCopied] = useState<string | null>(null);
  const [customFormatYAML, setCustomFormatYAML] = useState<string | null>(null);

  const rulesYAML = useMemo(() =>
    schema ? generateUpdateRulesEntry(schema) : '(Chưa có schema)',
    [schema]
  );

  const formatYAML = useMemo(() =>
    customFormatYAML || (schema ? generateOutputFormatEntry(schema) : '(Chưa có schema)'),
    [customFormatYAML, schema]
  );

  // 'selective' = mỗi biến một macro riêng (đi hết mọi tầng), thay vì đổ nguyên stat_data —
  // thẻ lớn mà đổ cả cụm thì tốn token và AI khó tra đúng biến.
  const varListYAML = useMemo(() =>
    schema ? generateVariableListEntry(schema, 'selective') : '(Chưa có schema)',
    [schema]
  );

  const emphasisText = useMemo(() => generateEmphasisEntry(), []);

  const [injected, setInjected] = useState<{ level: 'success' | 'warning' | 'error'; message: string } | null>(null);

  const handleInject = useCallback((systemId: MvuSystemEntryId, content: string) => {
    if (!schema) return;
    const res = injectMvuSystemEntry(systemId, content, schema);
    setInjected({ level: res.level, message: res.message });
    setTimeout(() => setInjected(null), 6000);
  }, [schema]);

  const handleCopy = useCallback((content: string, label: string) => {
    void copyWithToast(content, label, useToastStore.getState()).then((ok) => {
      if (!ok) return;
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    });
  }, []);

  const tabs = [
    { id: 'rules' as const, systemId: 'update_rules' as const, label: 'Update Rules', icon: FileText, yaml: rulesYAML,
      entryName: '[mvu_update] Quy tắc cập nhật biến', placement: 'before_char · order 100',
      description: 'Hướng dẫn AI khi nào và cách nào update biến' },
    { id: 'format' as const, systemId: 'output_format' as const, label: 'Output Format', icon: Sparkles, yaml: formatYAML,
      entryName: '[mvu_update] Định dạng đầu ra biến', placement: 'before_char · order 101',
      description: 'Template <Analysis> CoT + <JSONPatch>' },
    { id: 'varlist' as const, systemId: 'varlist' as const, label: 'Variable List', icon: Eye, yaml: varListYAML,
      entryName: 'Danh sách biến', placement: '@D0 · role system · order 200',
      description: 'Macro hiển thị giá trị biến cho AI đọc' },
    { id: 'emphasis' as const, systemId: 'emphasis' as const, label: 'Nhấn mạnh', icon: Megaphone, yaml: emphasisText,
      entryName: '[mvu_update] Nhấn mạnh định dạng đầu ra biến', placement: '@D0 · role system · order 999',
      description: 'Nhắc AI ở CUỐI prompt — thiếu entry này model hay quên xuất khối cập nhật' },
  ];

  const activeTabData = tabs.find(t => t.id === activeTab)!;

  if (!schema) {
    return (
      <div className="rounded-xl border border-border bg-card/50 p-6 text-center">
        <RefreshCw className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">Tạo Schema trước để generate Update Rules</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Tab bar */}
      <div className="flex gap-1 p-0.5 rounded-lg bg-muted/30">
        {tabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Entry info */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-foreground">
            Entry: <code className="text-primary">{activeTabData.entryName}</code>
          </p>
          <p className="text-[10px] text-muted-foreground">{activeTabData.description}</p>
          <p className="text-[10px] text-muted-foreground/70">Vị trí khi inject: <code>{activeTabData.placement}</code></p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => handleCopy(activeTabData.yaml, activeTab)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary
              text-xs font-medium hover:bg-primary/20 transition-colors"
          >
            {copied === activeTab ? (
              <><Check className="w-3 h-3" /> Đã copy!</>
            ) : (
              <><Copy className="w-3 h-3" /> Copy nội dung</>
            )}
          </button>
          <button
            onClick={() => handleInject(activeTabData.systemId, activeTabData.yaml)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500/80 to-teal-500/80
              text-white text-xs font-medium hover:from-emerald-500 hover:to-teal-500 transition-all
              shadow-sm shadow-emerald-500/10"
          >
            <Download className="w-3 h-3" /> Inject vào card
          </button>
          {activeTab === 'rules' && <AIUpdateRulesButton schema={schema} />}
          {activeTab === 'format' && <AIOutputFormatButton schema={schema} setCustomFormatYAML={setCustomFormatYAML} />}
        </div>
      </div>

      {/* Inject status */}
      {injected && (
        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${
          injected.level === 'success'
            ? 'bg-emerald-500/10 border-emerald-500/20'
            : injected.level === 'warning'
              ? 'bg-amber-500/10 border-amber-500/20'
              : 'bg-red-500/10 border-red-500/20'
        }`}>
          <Check className={`w-3 h-3 ${
            injected.level === 'success' ? 'text-emerald-400'
              : injected.level === 'warning' ? 'text-amber-400' : 'text-red-400'
          }`} />
          <span className={`text-[10px] font-medium ${
            injected.level === 'success' ? 'text-emerald-400'
              : injected.level === 'warning' ? 'text-amber-400' : 'text-red-400'
          }`}>{injected.message}</span>
        </div>
      )}

      {/* (việc 87) Hợp đồng với engine: khối cập nhật phải có ĐỦ <UpdateVariable>/<Analysis>/
          <JSONPatch>. Soi ngay trên màn hình để không ai inject nhầm bản thiếu thẻ — thiếu là
          SillyTavern báo "变量更新失败" mà trong tool chẳng thấy dấu hiệu gì. */}
      {(activeTab === 'format' || activeTab === 'emphasis') && (() => {
        const contract = checkMvuOutputContract(activeTabData.yaml);
        return (
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${
            contract.ok ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/10 border-red-500/30'
          }`}>
            <span className={`text-[10px] font-medium ${contract.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {contract.ok
                ? '✓ Đủ hợp đồng engine: <UpdateVariable> + <Analysis> + <JSONPatch>'
                : `✗ Thiếu thẻ ${contract.missing.join(', ')} — engine MVU sẽ không bóc được lệnh cập nhật`}
            </span>
          </div>
        );
      })()}

      {/* YAML Preview */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-3 py-2 border-b border-border bg-muted/20 flex items-center gap-2">
          <FileText className="w-3 h-3 text-primary" />
          <span className="text-[10px] font-medium">Nội dung Worldbook Entry</span>
          <span className="text-[9px] text-muted-foreground ml-auto">{activeTabData.placement}</span>
        </div>
        <pre className="p-4 max-h-96 overflow-y-auto text-xs font-mono text-foreground/80
          whitespace-pre-wrap leading-relaxed scrollbar-thin">
          {activeTabData.yaml}
        </pre>
      </div>

      {/* Quick tips */}
      <div className="rounded-lg border border-border bg-muted/10 p-3">
        <p className="text-[10px] font-medium text-muted-foreground mb-1">💡 Hướng dẫn sử dụng</p>
        {activeTab === 'rules' && (
          <ul className="text-[10px] text-muted-foreground space-y-0.5">
            <li>• Bấm <strong>Inject vào card</strong> — entry cũ cùng loại sẽ được CẬP NHẬT, không đẻ thêm bản trùng</li>
            <li>• Mọi biến đều có <code>check</code>: biến nào schema không khai thì máy sinh bù (biến không có luật là biến đứng im cả ván)</li>
            <li>• Biến <code>_</code> readonly tự động bị bỏ qua</li>
            <li>• Muốn luật bám cốt truyện hơn thì bấm <strong>AI tạo check rules</strong> rồi sinh lại</li>
          </ul>
        )}
        {activeTab === 'format' && (
          <ul className="text-[10px] text-muted-foreground space-y-0.5">
            <li>• <code>&lt;Analysis&gt;</code> CoT bắt AI phân tích TRƯỚC khi update — giảm hallucination</li>
            <li>• 5 operations MVU nhận: replace, delta, insert, remove, move — <strong>KHÔNG</strong> có <code>add</code>/<code>test</code>/<code>copy</code> của RFC 6902</li>
            <li>• Mảng lệnh PHẢI nằm trong <code>&lt;JSONPatch&gt;</code>; để trần là engine không bóc ra được lệnh nào</li>
            <li>• Path bắt đầu từ root (KHÔNG có <code>stat_data</code> prefix), giữ nguyên dấu và khoảng trắng của tên biến</li>
          </ul>
        )}
        {activeTab === 'varlist' && (
          <ul className="text-[10px] text-muted-foreground space-y-0.5">
            <li>• Dùng macro <code>&#123;&#123;format_message_variable::stat_data.X&#125;&#125;</code> — đủ đường dẫn từ <code>stat_data</code></li>
            <li>• Inject sẽ đặt entry ở <code>@D0, role system</code> để AI luôn thấy giá trị mới nhất</li>
            <li>• Mỗi biến một dòng riêng (đi hết mọi tầng) thay vì đổ nguyên cụm — đỡ token, AI tra đúng biến hơn</li>
          </ul>
        )}
        {activeTab === 'emphasis' && (
          <ul className="text-[10px] text-muted-foreground space-y-0.5">
            <li>• Entry ngắn đặt ở <code>@D0</code> — thứ model đọc SAU CHÓT trước khi viết</li>
            <li>• Card MVU thật nào cũng có entry này; thiếu nó model hay bỏ khối cập nhật ở những lượt dài</li>
            <li>• Nội dung là hợp đồng cố định với engine, không nên sửa tay</li>
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── AI Update Rules Generator ──────────────────────────────────────────

function AIUpdateRulesButton({ schema }: { schema: MVUZODSchema }) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const entries = useCardStore(s => s.card.data.character_book?.entries ?? []);
  const setMvuzodSchema = useCardStore(s => s.setMvuzodSchema);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatus('Đang kết nối AI...');
    try {
      const activeProfile = useSettingsStore.getState().getActiveProfile();
      const params = useSettingsStore.getState().generationParams;
      if (!activeProfile?.apiKey) throw new Error('Chưa cấu hình API AI.');

      const schemaDesc = JSON.stringify(schema, null, 2);
      const sampleEntries = entries.slice(0, 30).map(e =>
        `Comment: ${e.comment}\nContent:\n${e.content.slice(0, 400)}`
      ).join('\n---\n');

      setStatus(`Gửi schema + ${Math.min(30, entries.length)} entries...`);

      const messages: ChatMessage[] = [
        { role: 'system', content: MVUZOD_UPDATE_RULES_PROMPT },
        { role: 'user', content: `SCHEMA:\n${schemaDesc}\n\nLOREBOOK (${entries.length} entries, mẫu ${Math.min(30, entries.length)}):\n${sampleEntries}\n\nHãy sinh check rules cho từng biến.` },
      ];

      const response = await callAI({
        profile: activeProfile,
        params: { ...params, useJsonResponseFormat: true },
        messages,
      });

      setStatus('Phân tích phản hồi...');
      const parsed = parseSchemaInferenceResponse(response.text);
      const rules = (parsed as Record<string, unknown>).updateRules as Record<string, {
        type?: string;
        range?: string;
        format?: string;
        checkRules?: string[];
      }>;

      if (!rules || typeof rules !== 'object') throw new Error('AI không trả về updateRules hợp lệ.');

      // Apply rules to schema fields
      const updatedSchema = structuredClone(schema);
      applyRulesToFields(updatedSchema.fields, rules);
      setMvuzodSchema(updatedSchema);
      setStatus('✅ Đã cập nhật check rules!');
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('');
    } finally {
      setLoading(false);
    }
  }, [schema, entries, setMvuzodSchema]);

  return (
    <div className="flex items-center gap-2">
      <button onClick={handleGenerate} disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-500/80 to-primary/80
          text-white text-xs font-medium hover:from-violet-500 hover:to-primary transition-all
          disabled:opacity-50 disabled:cursor-wait">
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
        {loading ? 'AI đang tạo...' : 'AI tạo check rules'}
      </button>
      {status && <span className="text-[10px] text-muted-foreground">{status}</span>}
      {error && <span className="text-[10px] text-red-400 max-w-xs truncate" title={error}>{error}</span>}
    </div>
  );
}

function applyRulesToFields(
  fields: MVUZODField[],
  rules: Record<string, { type?: string; range?: string; format?: string; checkRules?: string[] }>,
) {
  for (const field of fields) {
    const ruleData = rules[field.path];
    if (ruleData) {
      if (!field.constraints) field.constraints = {};
      if (ruleData.checkRules?.length) field.constraints.checkRules = ruleData.checkRules;
      if (ruleData.range) field.constraints.updateRange = ruleData.range;
      if (ruleData.format) field.constraints.updateFormat = ruleData.format;
    }
    if (field.children?.length) {
      applyRulesToFields(field.children, rules);
    }
  }
}

// ─── AI Output Format Generator ──────────────────────────────────────────

function AIOutputFormatButton({ schema, setCustomFormatYAML }: { schema: MVUZODSchema, setCustomFormatYAML: (yaml: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatus('Đang kết nối AI...');
    try {
      const activeProfile = useSettingsStore.getState().getActiveProfile();
      const params = useSettingsStore.getState().generationParams;
      if (!activeProfile?.apiKey) throw new Error('Chưa cấu hình API AI.');

      const schemaDesc = JSON.stringify(schema, null, 2);

      const messages: ChatMessage[] = [
        { role: 'system', content: MVUZOD_OUTPUT_FORMAT_PROMPT },
        { role: 'user', content: `SCHEMA:\n${schemaDesc}\n\nHãy sinh định dạng đầu ra biến (Output Format).` },
      ];

      const response = await callAI({
        profile: activeProfile,
        params: { ...params, useJsonResponseFormat: false },
        messages,
      });

      setStatus('Đang xử lý kết quả...');
      let result = response.text.trim();
      if (result.startsWith('```yaml')) {
         result = result.replace(/^```yaml\n/, '').replace(/\n```$/, '');
      } else if (result.startsWith('```')) {
         result = result.replace(/^```\n/, '').replace(/\n```$/, '');
      }
      
      setCustomFormatYAML(result);
      setStatus('✅ Đã tạo Định dạng đầu ra!');
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('');
    } finally {
      setLoading(false);
    }
  }, [schema, setCustomFormatYAML]);

  return (
    <div className="flex items-center gap-2">
      <button onClick={handleGenerate} disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-500/80 to-primary/80
          text-white text-xs font-medium hover:from-violet-500 hover:to-primary transition-all
          disabled:opacity-50 disabled:cursor-wait">
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
        {loading ? 'AI đang tạo...' : 'AI tạo Output Format'}
      </button>
      {status && <span className="text-[10px] text-muted-foreground">{status}</span>}
      {error && <span className="text-[10px] text-red-400 max-w-xs truncate" title={error}>{error}</span>}
    </div>
  );
}

