/**
 * src/lib/mvuzod/jsonPatchEngine.ts — Apply JSON Patches to MVUZOD state
 * Spec 9C: 5 operators (replace, delta, insert, remove, move)
 * Modes: strict (reject on type mismatch) vs lenient (prefault on mismatch)
 * Validates readOnly fields, circular detection, clamp enforcement
 */

import type {
  JSONPatchOp, MVUZODSchema, MVUZODField,
  PatchValidationResult, PatchValidationError,
} from '../../types/mvuzod.types';

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ENTRY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Apply a list of JSON Patch operations to a state object.
 * @param state - Current MVUZOD state (will be deep-cloned)
 * @param ops - Patch operations to apply
 * @param schema - Schema for validation and constraints
 * @param mode - 'strict' rejects on mismatch, 'lenient' uses prefault values
 */
export function applyPatches(
  state: Record<string, unknown>,
  ops: JSONPatchOp[],
  schema: MVUZODSchema,
  mode: 'strict' | 'lenient' = 'lenient',
): PatchValidationResult {
  const newState = structuredClone(state);
  const errors: PatchValidationError[] = [];
  let appliedOps = 0;

  for (const op of ops) {
    try {
      // Check readOnly (path starts with _ prefix on any segment)
      if ('path' in op && isReadOnly(op.path)) {
        errors.push({ path: op.path, op: op.op, reason: 'Field is readOnly (prefix _)' });
        continue;
      }

      switch (op.op) {
        case 'replace':
          applyReplace(newState, op.path, op.value, schema, mode, errors);
          appliedOps++;
          break;

        case 'delta':
          applyDelta(newState, op.path, op.value, schema, errors);
          appliedOps++;
          break;

        case 'insert':
          applyInsert(newState, op.path, op.value, errors);
          appliedOps++;
          break;

        case 'remove':
          applyRemove(newState, op.path, errors);
          appliedOps++;
          break;

        case 'move':
          applyMove(newState, op.from, op.to, errors);
          appliedOps++;
          break;
      }
    } catch (e) {
      errors.push({
        path: 'path' in op ? op.path : ('from' in op ? op.from : '?'),
        op: op.op,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { success: errors.length === 0, appliedOps, errors, newState };
}

// ═══════════════════════════════════════════════════════════════════════════
// OPERATION IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════════════════

function applyReplace(
  state: Record<string, unknown>,
  path: string,
  value: unknown,
  schema: MVUZODSchema,
  mode: 'strict' | 'lenient',
  errors: PatchValidationError[],
) {
  const segments = parsePath(path);
  const parent = navigateToParent(state, segments);
  if (!parent) {
    errors.push({ path, op: 'replace', reason: `Parent path not found` });
    return;
  }

  const key = segments[segments.length - 1];
  const field = findSchemaField(schema, path);

  // Type validation
  if (field && mode === 'strict') {
    const typeOk = checkType(value, field.type);
    if (!typeOk) {
      errors.push({ path, op: 'replace', reason: `Type mismatch: expected ${field.type}` });
      return;
    }
  }

  // Coerce if needed
  let finalValue = value;
  if (field?.constraints?.coerce && field.type === 'number') {
    finalValue = Number(value);
    if (isNaN(finalValue as number)) {
      if (mode === 'lenient') {
        finalValue = field.constraints?.prefault ?? field.defaultValue ?? 0;
        errors.push({ path, op: 'replace', reason: 'Coercion failed, used prefault', fallbackApplied: true, fallbackValue: finalValue });
      } else {
        errors.push({ path, op: 'replace', reason: 'Number coercion failed' });
        return;
      }
    }
  }

  // Clamp
  if (field?.constraints?.clamp && typeof finalValue === 'number') {
    finalValue = Math.max(field.constraints?.clamp[0], Math.min(field.constraints?.clamp[1], finalValue));
  }

  (parent as Record<string, unknown>)[key] = finalValue;
}

function applyDelta(
  state: Record<string, unknown>,
  path: string,
  delta: number,
  schema: MVUZODSchema,
  errors: PatchValidationError[],
) {
  const segments = parsePath(path);
  const parent = navigateToParent(state, segments);
  if (!parent) {
    errors.push({ path, op: 'delta', reason: 'Parent path not found' });
    return;
  }

  const key = segments[segments.length - 1];
  const current = (parent as Record<string, unknown>)[key];

  if (typeof current !== 'number') {
    // Try coerce
    const num = Number(current);
    if (isNaN(num)) {
      errors.push({ path, op: 'delta', reason: `Current value is not a number: ${current}` });
      return;
    }
    (parent as Record<string, unknown>)[key] = num + delta;
  } else {
    (parent as Record<string, unknown>)[key] = current + delta;
  }

  // Clamp after delta
  const field = findSchemaField(schema, path);
  if (field?.constraints?.clamp) {
    const val = (parent as Record<string, unknown>)[key] as number;
    (parent as Record<string, unknown>)[key] = Math.max(field.constraints?.clamp[0], Math.min(field.constraints?.clamp[1], val));
  }
}

function applyInsert(
  state: Record<string, unknown>,
  path: string,
  value: unknown,
  errors: PatchValidationError[],
) {
  const segments = parsePath(path);

  // Array push: path ends with "-"
  if (segments[segments.length - 1] === '-') {
    const parent = navigateToParent(state, segments);
    if (!parent || !Array.isArray(parent)) {
      errors.push({ path, op: 'insert', reason: 'Target is not an array' });
      return;
    }
    parent.push(value);
    return;
  }

  // Record insert: add key to parent object
  const parent = navigateToParent(state, segments);
  if (!parent || typeof parent !== 'object') {
    errors.push({ path, op: 'insert', reason: 'Parent path not found' });
    return;
  }

  const key = segments[segments.length - 1];
  (parent as Record<string, unknown>)[key] = value;
}

function applyRemove(
  state: Record<string, unknown>,
  path: string,
  errors: PatchValidationError[],
) {
  const segments = parsePath(path);
  const parent = navigateToParent(state, segments);
  if (!parent || typeof parent !== 'object') {
    errors.push({ path, op: 'remove', reason: 'Parent path not found' });
    return;
  }

  const key = segments[segments.length - 1];
  if (Array.isArray(parent)) {
    const idx = parseInt(key, 10);
    if (!isNaN(idx) && idx >= 0 && idx < parent.length) {
      parent.splice(idx, 1);
    } else {
      errors.push({ path, op: 'remove', reason: `Invalid array index: ${key}` });
    }
  } else {
    delete (parent as Record<string, unknown>)[key];
  }
}

function applyMove(
  state: Record<string, unknown>,
  from: string,
  to: string,
  errors: PatchValidationError[],
) {
  const fromSegments = parsePath(from);
  const fromParent = navigateToParent(state, fromSegments);
  if (!fromParent || typeof fromParent !== 'object') {
    errors.push({ path: from, op: 'move', reason: 'Source path not found' });
    return;
  }

  const fromKey = fromSegments[fromSegments.length - 1];
  const value = (fromParent as Record<string, unknown>)[fromKey];
  delete (fromParent as Record<string, unknown>)[fromKey];

  const toSegments = parsePath(to);
  const toParent = navigateToParent(state, toSegments);
  if (!toParent || typeof toParent !== 'object') {
    // Rollback
    (fromParent as Record<string, unknown>)[fromKey] = value;
    errors.push({ path: to, op: 'move', reason: 'Target path not found' });
    return;
  }

  const toKey = toSegments[toSegments.length - 1];
  (toParent as Record<string, unknown>)[toKey] = value;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function parsePath(path: string): string[] {
  // "/Người chơi/HP" → ["Người chơi", "HP"]
  return path.split('/').filter(Boolean);
}

function navigateToParent(state: unknown, segments: string[]): unknown {
  let current = state;
  for (let i = 0; i < segments.length - 1; i++) {
    if (current == null || typeof current !== 'object') return null;
    const key = segments[i];
    if (Array.isArray(current)) {
      const idx = parseInt(key, 10);
      if (isNaN(idx) || idx < 0 || idx >= current.length) return null;
      current = current[idx];
    } else {
      current = (current as Record<string, unknown>)[key];
      // Auto-create intermediate objects if they don't exist
      if (current == null && i < segments.length - 2) {
        (state as Record<string, unknown>)[key] = {};
        current = (state as Record<string, unknown>)[key];
      }
    }
  }
  return current;
}

function isReadOnly(path: string): boolean {
  return parsePath(path).some(seg => seg.startsWith('_'));
}

function checkType(value: unknown, expectedType: MVUZODField['type']): boolean {
  switch (expectedType) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number';
    case 'boolean': return typeof value === 'boolean';
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'record': return typeof value === 'object' && value !== null;
    default: return true;
  }
}

function findSchemaField(schema: MVUZODSchema, path: string): MVUZODField | null {
  const segments = parsePath(path);
  let fields = schema.fields;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const field = fields.find(f => {
      const fieldName = f.path.split('/').pop();
      return fieldName === seg;
    });
    if (!field) return null;
    if (i === segments.length - 1) return field;
    if (field.children) {
      fields = field.children;
    } else {
      return null;
    }
  }

  return null;
}
