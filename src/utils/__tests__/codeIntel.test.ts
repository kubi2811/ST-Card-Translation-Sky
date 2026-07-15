// P3 roadmap — chẩn đoán cú pháp + prompt AI sửa (phần thuần, không đụng WASM shiki).
import { describe, it, expect } from 'vitest';
import { diagnoseCode, buildFixPrompt } from '../codeIntel';

describe('diagnoseCode — chẩn đoán JS/JSON tức thời', () => {
  it('JS vỡ (thiếu ngoặc) → báo lỗi kèm dòng', () => {
    const d = diagnoseCode('function a() {\n  return 1;\n', 'javascript');
    expect(d).not.toBeNull();
    expect(d!.message).toBeTruthy();
  });

  it('JS chuẩn (kể cả ES module import — script TavernHelper) → null', () => {
    expect(diagnoseCode('const a = 1;\nexport default a;', 'javascript')).toBeNull();
    expect(diagnoseCode("import x from 'https://cdn.example/x.js';\nx();", 'js')).toBeNull();
  });

  it('JSON vỡ → báo lỗi kèm SỐ DÒNG tính từ position', () => {
    const d = diagnoseCode('{\n  "a": 1,\n  "b": ,\n}', 'json');
    expect(d).not.toBeNull();
    expect(d!.line).toBe(3);
  });

  it('JSON chuẩn → null; ngôn ngữ chưa hỗ trợ (python) → null (không báo bừa)', () => {
    expect(diagnoseCode('{"a": 1}', 'json')).toBeNull();
    expect(diagnoseCode('def x(:', 'python')).toBeNull();
  });
});

describe('buildFixPrompt — đưa đúng dòng lỗi vào prompt', () => {
  it('có ► đánh dấu dòng lỗi + toàn bộ code trong fence', () => {
    const code = 'line1\nline2\nlỗi ở đây\nline4';
    const p = buildFixPrompt(code, 'javascript', { line: 3, message: 'Unexpected token' });
    expect(p).toContain('dòng 3');
    expect(p).toContain('3 ► lỗi ở đây');
    expect(p).toContain('```javascript\n' + code);
    expect(p).toContain('GIỮ NGUYÊN cấu trúc');
  });
});
