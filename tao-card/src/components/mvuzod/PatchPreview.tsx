/**
 * PatchPreview — Test JSON Patch operations against current schema state
 * Live editor for testing patch operations before runtime
 */

import { useState, useCallback, useMemo } from 'react';
import {
  Play, RotateCcw, CheckCircle, XCircle, AlertTriangle,
} from 'lucide-react';
import type { MVUZODSchema, JSONPatchOp, PatchValidationResult } from '../../types/mvuzod.types';
import { extractPatches } from '../../lib/mvuzod/patchExtractor';
import { applyPatches } from '../../lib/mvuzod/jsonPatchEngine';
import { buildSamplePatch } from '../../lib/mvuzod/samplePatch';

// (bug 224) Mẫu KHÔNG còn ghi cứng: đường dẫn cứng là của schema khác, nên bấm Test trên thẻ
// nào cũng ra "path không tồn tại" ⇒ tab trông như hỏng. Nay mẫu dựng từ chính schema đang mở.

export function PatchPreview({ schema }: { schema: MVUZODSchema | null }) {
  const sample = useMemo(() => buildSamplePatch(schema), [schema]);
  // Mọi tab MVUZOD được giữ mount sẵn (page chỉ bật/tắt display), nên PatchPreview mount lúc
  // schema CÒN null. Dùng useState(sample) thì ô nhập đứng mãi ở mẫu dự phòng dù sau đó schema
  // đã nạp — nên phải DẪN XUẤT: chưa sửa tay thì luôn theo mẫu mới nhất của schema hiện tại.
  const [draft, setDraft] = useState<string | null>(null);
  const input = draft ?? sample;
  const [mode, setMode] = useState<'strict' | 'lenient'>('lenient');
  const [result, setResult] = useState<PatchValidationResult | null>(null);
  const [extractedOps, setExtractedOps] = useState<JSONPatchOp[]>([]);

  const initialState = useMemo(() => {
    if (!schema) return {};
    return buildDefaultState(schema.fields);
  }, [schema]);

  const handleTest = useCallback(() => {
    if (!schema) return;
    const { ops } = extractPatches(input);
    setExtractedOps(ops);
    if (ops.length === 0) {
      setResult(null);
      return;
    }
    const r = applyPatches(initialState, ops, schema, mode);
    setResult(r);
  }, [input, schema, mode, initialState]);

  const handleReset = useCallback(() => {
    setDraft(null);
    setResult(null);
    setExtractedOps([]);
  }, []);

  if (!schema) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 text-center">
        <p className="text-sm text-muted-foreground">
          Cần tạo schema trước khi test patch.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <h3 className="text-sm font-semibold">🧪 JSON Patch Preview</h3>

      {/* Input */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs text-muted-foreground">Paste AI response hoặc patch block:</label>
          <select value={mode} onChange={e => setMode(e.target.value as 'strict' | 'lenient')}
            className="text-[10px] px-2 py-0.5 rounded border border-border bg-background">
            <option value="lenient">Lenient</option>
            <option value="strict">Strict</option>
          </select>
        </div>
        <textarea value={input} onChange={e => setDraft(e.target.value)}
          rows={5}
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-xs font-mono resize-y
            focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {/* Controls */}
      <div className="flex gap-2">
        <button onClick={handleTest}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium
            hover:bg-primary/90 transition-colors">
          <Play className="w-3 h-3" /> Test Patch
        </button>
        <button onClick={handleReset}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs
            hover:bg-muted transition-colors">
          <RotateCcw className="w-3 h-3" /> Reset
        </button>
      </div>

      {/* Extracted ops */}
      {extractedOps.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium">
            Extracted {extractedOps.length} operations:
          </p>
          {extractedOps.map((op, i) => (
            <div key={i} className="px-2.5 py-1.5 rounded-md bg-muted/30 text-[10px] font-mono">
              <span className="text-primary font-medium">{op.op}</span>
              {' '}{'path' in op ? op.path : ''}
              {'value' in op ? ` → ${JSON.stringify(op.value).slice(0, 60)}` : ''}
            </div>
          ))}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={`rounded-lg p-3 border ${
          result.success ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-amber-500/5 border-amber-500/20'
        }`}>
          <div className="flex items-center gap-2 mb-2">
            {result.success ? (
              <CheckCircle className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            )}
            <span className="text-xs font-medium">
              {result.appliedOps} ops áp dụng, {result.errors.length} lỗi
            </span>
          </div>

          {result.errors.length > 0 && (
            <div className="space-y-1 mb-2">
              {result.errors.map((err, i) => (
                <p key={i} className="text-[10px] text-amber-400 flex items-center gap-1">
                  <XCircle className="w-2.5 h-2.5 shrink-0" />
                  <span className="font-mono">{err.path}</span>: {err.reason}
                  {err.fallbackApplied && <span className="text-muted-foreground">(fallback: {JSON.stringify(err.fallbackValue)})</span>}
                </p>
              ))}
            </div>
          )}

          {/* New state */}
          <details className="mt-2">
            <summary className="text-[10px] text-muted-foreground cursor-pointer">
              State sau patch
            </summary>
            <pre className="mt-1 text-[9px] font-mono text-muted-foreground bg-muted/30 rounded p-2 overflow-x-auto max-h-40">
              {JSON.stringify(result.newState, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

function buildDefaultState(fields: import('../../types/mvuzod.types').MVUZODField[]): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const field of fields) {
    const name = field.path.split('/').pop() ?? field.path;
    if (field.children?.length) {
      state[name] = buildDefaultState(field.children);
    } else {
      state[name] = field.defaultValue;
    }
  }
  return state;
}
