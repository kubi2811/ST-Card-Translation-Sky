/**
 * VariablePlayground — (bug 224) BÀN THỬ NHIỀU LƯỢT, không còn là bản sao của tab Patch.
 * ─────────────────────────────────────────────────────────────────────────────
 * Bản cũ có đúng hai panel, panel thứ hai cũng là "dán patch rồi áp" — làm lại việc của tab
 * Patch, mà còn TỰ VIẾT LẠI phép áp patch bằng tay: không kiểm schema, không đỡ op "move".
 * Ba bản cài đặt cho một việc thì chỉ có cách phân kỳ dần.
 *
 * Nay panel 2 trả lời câu hỏi mà cả hai tab kia KHÔNG trả lời được: "chạy vài lượt liên tiếp
 * thì trạng thái có còn đúng không?". Một patch lẻ luôn trông ổn; hỏng chỉ lộ khi cộng dồn —
 * delta cộng máu vượt max (MVU không tự kẹp biên), mảng insert mãi mà không bao giờ remove,
 * AI bịa đường dẫn ngoài schema (MVU lặng lẽ bỏ qua). Engine nằm ở lib/mvuzod/turnSimulator.ts.
 */

import { useState, useMemo, useCallback } from 'react';
import {
  Play, RotateCcw, AlertTriangle, CheckCircle, XCircle,
  Zap, Pencil, FlaskConical, ArrowRight, ChevronDown, ChevronRight,
} from 'lucide-react';
import type { MVUZODSchema, MVUZODField } from '../../types/mvuzod.types';
import { simulateTurns, splitTurns, type SimResult } from '../../lib/mvuzod/turnSimulator';

/** Mẫu gợi ý cho ô nhiều lượt — dạy đúng cách ngăn lượt và cách viết delta. */
const SIM_PLACEHOLDER = [
  'Lượt 1: nhân vật bị đánh trúng.',
  '<UpdateVariable>',
  '[{"op":"delta","path":"/Nhân vật/Máu","value":-30}]',
  '</UpdateVariable>',
  '---',
  'Lượt 2: uống thuốc hồi máu.',
  '<UpdateVariable>',
  '[{"op":"delta","path":"/Nhân vật/Máu","value":80}]',
  '</UpdateVariable>',
].join('\n');

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface FieldValidation {
  path: string;
  label: string;
  inputValue: unknown;
  outputValue: unknown;
  valid: boolean;
  error?: string;
  transformed: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function VariablePlayground({ schema }: { schema: MVUZODSchema | null }) {
  const [draftJson, setDraftJson] = useState<string | null>(null);
  const [results, setResults] = useState<FieldValidation[]>([]);
  const [hasRun, setHasRun] = useState(false);
  const [activePanel, setActivePanel] = useState<'validate' | 'sim'>('validate');

  // Panel mô phỏng: nhiều lượt AI ngăn nhau bằng dòng ---
  const [turnsText, setTurnsText] = useState('');
  const [sim, setSim] = useState<SimResult | null>(null);
  const [simMode, setSimMode] = useState<'strict' | 'lenient'>('lenient');

  // Build default state from schema
  const defaultState = useMemo(() => {
    if (!schema) return {};
    function buildDefaults(fields: MVUZODField[]): Record<string, unknown> {
      const obj: Record<string, unknown> = {};
      for (const f of fields) {
        const name = f.path.split('/').filter(Boolean).pop() ?? f.path;
        if (f.children?.length) {
          obj[name] = buildDefaults(f.children);
        } else {
          obj[name] = f.defaultValue ?? getTypeDefault(f.type);
        }
      }
      return obj;
    }
    return buildDefaults(schema.fields);
  }, [schema]);

  // Reset to defaults
  const handleReset = useCallback(() => {
    setDraftJson(null);
    setResults([]);
    setHasRun(false);
    setSim(null);
  }, []);

  // (bug 224) Mọi tab MVUZOD giữ mount sẵn nên component này mount lúc schema CÒN null.
  // Bản cũ nạp mặc định bằng useEffect + setState (phải tắt lint cả file) và chỉ chạy một lần,
  // nên schema nạp sau là ô nhập đứng mãi ở rỗng. Nay DẪN XUẤT: chưa gõ tay thì luôn theo
  // mặc định mới nhất của schema hiện tại.
  const defaultJson = useMemo(() => JSON.stringify(defaultState, null, 2), [defaultState]);
  const inputJson = draftJson ?? defaultJson;

  // Run validation
  const handleValidate = useCallback(() => {
    if (!schema) return;

    let parsedInput: Record<string, unknown>;
    try {
      parsedInput = JSON.parse(inputJson);
    } catch (e) {
      setResults([{
        path: '__root__',
        label: 'JSON Parse',
        inputValue: inputJson,
        outputValue: null,
        valid: false,
        error: `JSON không hợp lệ: ${e instanceof Error ? e.message : String(e)}`,
        transformed: false,
      }]);
      setHasRun(true);
      return;
    }

    const validations: FieldValidation[] = [];

    function validateFields(
      fields: MVUZODField[],
      data: Record<string, unknown>,
      prefix: string,
    ) {
      for (const field of fields) {
        const name = field.path.split('/').filter(Boolean).pop() ?? field.path;
        const fullPath = prefix ? `${prefix}.${name}` : name;
        const inputValue = data[name];

        if (field.children?.length) {
          if (typeof inputValue === 'object' && inputValue !== null) {
            validateFields(field.children, inputValue as Record<string, unknown>, fullPath);
          } else {
            validations.push({
              path: fullPath,
              label: field.label,
              inputValue,
              outputValue: null,
              valid: false,
              error: `Cần object, nhận được ${typeof inputValue}`,
              transformed: false,
            });
          }
          continue;
        }

        // Leaf field validation
        const result = validateField(field, inputValue);
        validations.push({
          path: fullPath,
          label: field.label,
          inputValue,
          outputValue: result.value,
          valid: result.valid,
          error: result.error,
          transformed: result.transformed,
        });
      }
    }

    validateFields(schema.fields, parsedInput, '');
    setResults(validations);
    setHasRun(true);
  }, [schema, inputJson]);

  // Run JSON Patch
  // Chạy mô phỏng: mỗi khối ngăn bằng --- là MỘT lượt AI, áp tuần tự từ trạng thái đang nhập.
  const handleSimulate = useCallback(() => {
    let start: Record<string, unknown>;
    try {
      start = JSON.parse(inputJson);
    } catch (err) {
      setSim({
        turns: [{
          turn: 1, opsFound: 0, opsApplied: 0, state: {},
          issues: [{ level: 'error', path: '', message: `Trạng thái đầu không phải JSON hợp lệ: ${err instanceof Error ? err.message : String(err)}` }],
        }],
        finalState: {}, totalIssues: 1,
      });
      return;
    }
    const raw = splitTurns(turnsText);
    if (raw.length === 0) {
      setSim({ turns: [], finalState: start, totalIssues: 0 });
      return;
    }
    setSim(simulateTurns(schema, start, raw, simMode));
  }, [inputJson, turnsText, schema, simMode]);

  if (!schema) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <FlaskConical className="w-8 h-8 mx-auto text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground">Tạo schema trước để sử dụng Playground</p>
      </div>
    );
  }

  const passCount = results.filter(r => r.valid).length;
  const failCount = results.filter(r => !r.valid).length;
  const transformCount = results.filter(r => r.transformed).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <FlaskConical className="w-4 h-4 text-primary" />
          Variable Playground
        </h3>
        <div className="flex gap-1">
          <button
            onClick={() => setActivePanel('validate')}
            className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
              activePanel === 'validate' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            <Zap className="w-3 h-3 inline mr-1" />Validate
          </button>
          <button
            onClick={() => setActivePanel('sim')}
            className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
              activePanel === 'sim' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            <Pencil className="w-3 h-3 inline mr-1" />Mô phỏng nhiều lượt
          </button>
        </div>
      </div>

      {/* Input panel */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/20">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Input State (JSON)
          </span>
          <button onClick={handleReset}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-muted-foreground hover:bg-muted transition-colors">
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
        </div>
        <textarea
          value={inputJson}
          onChange={e => setDraftJson(e.target.value)}
          className="w-full h-48 p-3 text-xs font-mono bg-background text-foreground/90 resize-y focus:outline-none"
          spellCheck={false}
          placeholder='{"fieldName": value, ...}'
        />
      </div>

      {/* Action button */}
      {activePanel === 'validate' ? (
        <button onClick={handleValidate}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gradient-to-r from-primary to-violet-500 text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity">
          <Play className="w-3.5 h-3.5" />
          Chạy Validate + Transform
        </button>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/20">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Các lượt AI — ngăn nhau bằng một dòng ---
              </span>
              <select value={simMode} onChange={(e) => setSimMode(e.target.value as 'strict' | 'lenient')}
                className="text-[10px] px-2 py-0.5 rounded border border-border bg-background">
                <option value="lenient">Lenient</option>
                <option value="strict">Strict</option>
              </select>
            </div>
            <textarea
              value={turnsText}
              onChange={(e) => setTurnsText(e.target.value)}
              className="w-full h-40 p-3 text-xs font-mono bg-background text-foreground/90 resize-y focus:outline-none"
              spellCheck={false}
              placeholder={SIM_PLACEHOLDER}
            />
            <div className="px-3 py-2 border-t border-border text-[10px] text-muted-foreground leading-snug">
              Dán nguyên lượt AI cũng được — tool tự bóc khối cập nhật biến. Sau MỖI lượt nó soi:
              số vượt min/max (MVU <b>không</b> tự kẹp biên), mảng phình mãi vì chỉ insert, và
              đường dẫn không có trong schema (MVU lặng lẽ bỏ qua nên chỉ số đứng yên).
            </div>
          </div>
          <button onClick={handleSimulate}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-medium hover:opacity-90 transition-opacity">
            <ArrowRight className="w-3.5 h-3.5" />
            Chạy mô phỏng
          </button>
        </>
      )}

      {/* Results */}
      {activePanel === 'validate' && hasRun && (
        <div className="space-y-2">
          {/* Summary */}
          <div className="flex gap-3 text-xs">
            <span className="flex items-center gap-1 text-emerald-400">
              <CheckCircle className="w-3 h-3" /> {passCount} pass
            </span>
            {failCount > 0 && (
              <span className="flex items-center gap-1 text-red-400">
                <XCircle className="w-3 h-3" /> {failCount} fail
              </span>
            )}
            {transformCount > 0 && (
              <span className="flex items-center gap-1 text-amber-400">
                <Zap className="w-3 h-3" /> {transformCount} transformed
              </span>
            )}
          </div>

          {/* Per-field results */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {results.map((r, i) => (
              <ValidationRow key={i} result={r} />
            ))}
          </div>
        </div>
      )}

      {activePanel === 'sim' && sim && (
        <div className="space-y-2">
          <div className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border ${
            sim.totalIssues === 0
              ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400'
              : 'bg-amber-500/5 border-amber-500/20 text-amber-400'
          }`}>
            {sim.totalIssues === 0 ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            <span className="text-xs font-medium">
              {sim.turns.length} lượt · {sim.totalIssues === 0
                ? 'trạng thái vẫn đúng sau tất cả các lượt'
                : `${sim.totalIssues} vấn đề cộng dồn — xem từng lượt bên dưới`}
            </span>
          </div>

          {sim.turns.map((tn) => (
            <div key={tn.turn} className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/20">
                <span className="text-[11px] font-semibold">Lượt {tn.turn}</span>
                <span className="text-[10px] text-muted-foreground">
                  áp {tn.opsApplied}/{tn.opsFound} thao tác
                </span>
                {tn.issues.length > 0 && (
                  <span className="ml-auto text-[10px] text-amber-400">{tn.issues.length} vấn đề</span>
                )}
              </div>
              {tn.issues.length > 0 && (
                <div className="px-3 py-2 space-y-1">
                  {tn.issues.map((iss, k) => (
                    <div key={k} className="flex items-start gap-1.5">
                      {iss.level === 'error'
                        ? <XCircle className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />
                        : <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />}
                      <span className={`text-[11px] ${iss.level === 'error' ? 'text-red-300' : 'text-amber-300'}`}>
                        {iss.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-3 py-2 border-b border-border bg-muted/20">
              <span className="text-[10px] font-semibold text-muted-foreground">Trạng thái sau lượt cuối</span>
            </div>
            <pre className="p-3 text-xs font-mono text-foreground/80 max-h-48 overflow-y-auto scrollbar-thin">
              {JSON.stringify(sim.finalState, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION ROW
// ═══════════════════════════════════════════════════════════════════════════

function ValidationRow({ result }: { result: FieldValidation }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`border-b border-border/50 last:border-0 ${!result.valid ? 'bg-red-500/3' : ''}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/20 transition-colors"
      >
        {result.valid
          ? <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" />
          : <XCircle className="w-3 h-3 text-red-400 shrink-0" />
        }
        <span className="text-xs font-medium flex-1 truncate">{result.label}</span>
        <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[120px]">
          {JSON.stringify(result.inputValue)}
        </span>
        {result.transformed && (
          <>
            <ArrowRight className="w-3 h-3 text-amber-400 shrink-0" />
            <span className="text-[10px] text-amber-400 font-mono truncate max-w-[120px]">
              {JSON.stringify(result.outputValue)}
            </span>
          </>
        )}
        {expanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
      </button>
      {expanded && (
        <div className="px-3 pb-2 ml-5 text-[10px] text-muted-foreground space-y-0.5">
          <div>Path: <span className="font-mono">{result.path}</span></div>
          <div>Input: <span className="font-mono text-foreground/80">{JSON.stringify(result.inputValue)}</span></div>
          <div>Output: <span className="font-mono text-foreground/80">{JSON.stringify(result.outputValue)}</span></div>
          {result.error && <div className="text-red-400">❌ {result.error}</div>}
          {result.transformed && <div className="text-amber-400">⚡ Value đã được transform</div>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FIELD VALIDATOR
// ═══════════════════════════════════════════════════════════════════════════

function validateField(
  field: MVUZODField,
  value: unknown,
): { valid: boolean; value: unknown; error?: string; transformed: boolean } {
  if (value === undefined || value === null) {
    if (field.defaultValue !== undefined) {
      return { valid: true, value: field.defaultValue, transformed: true };
    }
    return { valid: false, value, error: 'Giá trị bị thiếu (undefined/null)', transformed: false };
  }

  switch (field.type) {
    case 'number': {
      let num: number;
      if (field.constraints.coerce) {
        num = Number(value);
        if (isNaN(num)) {
          return { valid: false, value, error: `Không thể coerce "${value}" thành number`, transformed: false };
        }
      } else {
        if (typeof value !== 'number') {
          return { valid: false, value, error: `Cần number, nhận được ${typeof value}`, transformed: false };
        }
        num = value;
      }

      let transformed = (field.constraints.coerce ?? false) && typeof value !== 'number';

      // Clamp
      if (field.constraints.clamp) {
        const [min, max] = field.constraints.clamp;
        const clamped = Math.max(min, Math.min(max, num));
        if (clamped !== num) {
          num = clamped;
          transformed = true;
        }
      } else {
        // Min/max
        if (field.constraints.min !== undefined && num < field.constraints.min) {
          return { valid: false, value: num, error: `Giá trị ${num} < min ${field.constraints.min}`, transformed };
        }
        if (field.constraints.max !== undefined && num > field.constraints.max) {
          return { valid: false, value: num, error: `Giá trị ${num} > max ${field.constraints.max}`, transformed };
        }
      }

      return { valid: true, value: num, transformed };
    }

    case 'string': {
      if (typeof value !== 'string') {
        return { valid: false, value, error: `Cần string, nhận được ${typeof value}`, transformed: false };
      }
      if (field.constraints.pattern) {
        try {
          const regex = new RegExp(field.constraints.pattern);
          if (!regex.test(value)) {
            return { valid: false, value, error: `Không match pattern /${field.constraints.pattern}/`, transformed: false };
          }
        } catch {
          // Invalid regex in schema — skip check
        }
      }
      return { valid: true, value, transformed: false };
    }

    case 'boolean': {
      if (typeof value !== 'boolean') {
        return { valid: false, value, error: `Cần boolean, nhận được ${typeof value}`, transformed: false };
      }
      return { valid: true, value, transformed: false };
    }

    case 'array': {
      if (!Array.isArray(value)) {
        return { valid: false, value, error: `Cần array, nhận được ${typeof value}`, transformed: false };
      }
      return { valid: true, value, transformed: false };
    }

    case 'record': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { valid: false, value, error: `Cần object/record, nhận được ${typeof value}`, transformed: false };
      }
      return { valid: true, value, transformed: false };
    }

    default:
      return { valid: true, value, transformed: false };
  }
}

function getTypeDefault(type: string): unknown {
  switch (type) {
    case 'number': return 0;
    case 'boolean': return false;
    case 'string': return '';
    case 'array': return [];
    case 'record': return {};
    default: return null;
  }
}

