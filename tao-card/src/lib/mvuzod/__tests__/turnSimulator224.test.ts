/**
 * (bug 224) Playground thôi trùng tab Patch — nó mô phỏng NHIỀU LƯỢT.
 * ─────────────────────────────────────────────────────────────────────────────
 * Panel cũ của Playground cũng là "dán patch rồi áp", tức bản sao thứ ba của cùng một việc (và
 * bản sao đó còn tự viết lại phép áp patch bằng tay: không kiểm schema, không đỡ op "move").
 *
 * Thứ CẢ HAI tab kia không trả lời được là: "chạy vài lượt liên tiếp thì trạng thái còn đúng
 * không?". Một patch lẻ luôn trông ổn — hỏng chỉ lộ khi cộng dồn. Bốn dạng cộng dồn có thật:
 *   • delta cộng mãi vượt max / trừ mãi xuống âm (MVU KHÔNG tự kẹp biên);
 *   • AI bịa đường dẫn ngoài schema (MVU lặng lẽ bỏ qua ⇒ "chỉ số không nhúc nhích");
 *   • mảng chỉ insert, không bao giờ remove ⇒ phình mãi, ngốn ngữ cảnh;
 *   • kiểu lệch (ghi chuỗi vào biến số).
 */
import { describe, it, expect } from 'vitest';
import { simulateTurns, splitTurns, auditStateAfterTurn } from '../turnSimulator';
import type { MVUZODSchema, MVUZODField } from '../../../types/mvuzod.types';

const num = (label: string, min?: number, max?: number): MVUZODField =>
  ({ label, path: label, type: 'number', constraints: { min, max } } as unknown as MVUZODField);
const leaf = (label: string, type: string): MVUZODField =>
  ({ label, path: label, type } as MVUZODField);
const obj = (label: string, children: MVUZODField[]): MVUZODField =>
  ({ label, path: label, type: 'object', children } as unknown as MVUZODField);

const SCHEMA: MVUZODSchema = {
  fields: [
    obj('Nhân vật', [num('Máu', 0, 100), leaf('Tên', 'string')]),
    obj('Hành trang', [leaf('Kho đồ', 'array')]),
  ],
} as MVUZODSchema;

const START = { 'Nhân vật': { 'Máu': 100, 'Tên': 'A' }, 'Hành trang': { 'Kho đồ': [] as unknown[] } };
const turn = (ops: string) => `Lượt kể gì đó.\n<UpdateVariable>\n[${ops}]\n</UpdateVariable>`;

describe('(bug 224) splitTurns', () => {
  it('ngăn lượt bằng dòng --- , bỏ khoảng trắng và khối rỗng', () => {
    expect(splitTurns('a\n---\nb\n---\n\n---\n  c  ')).toEqual(['a', 'b', 'c']);
  });
  it('không có --- ⇒ một lượt', () => {
    expect(splitTurns('chỉ một lượt')).toEqual(['chỉ một lượt']);
  });
  it('rỗng ⇒ không lượt nào', () => {
    expect(splitTurns('')).toEqual([]);
    expect(splitTurns('   \n  ')).toEqual([]);
  });
});

describe('(bug 224) simulateTurns — bắt lỗi CỘNG DỒN qua nhiều lượt', () => {
  it('mỗi lượt lẻ đều hợp lệ, nhưng CỘNG DỒN thì vượt max ⇒ báo đúng ở lượt gây tràn', () => {
    const r = simulateTurns(SCHEMA, START, [
      turn('{"op":"delta","path":"/Nhân vật/Máu","value":-50}'),   // 50 — ổn
      turn('{"op":"delta","path":"/Nhân vật/Máu","value":40}'),    // 90 — ổn
      turn('{"op":"delta","path":"/Nhân vật/Máu","value":40}'),    // 130 — VƯỢT max 100
    ]);
    expect(r.turns).toHaveLength(3);
    expect(r.turns[0].issues).toEqual([]);
    expect(r.turns[1].issues).toEqual([]);
    expect(r.turns[2].issues).toHaveLength(1);
    expect(r.turns[2].issues[0].level).toBe('error');
    expect(r.turns[2].issues[0].message).toMatch(/VƯỢT max 100/);
    expect((r.finalState as typeof START)['Nhân vật']['Máu']).toBe(130);
  });

  it('trừ mãi xuống DƯỚI min cũng bắt được', () => {
    const r = simulateTurns(SCHEMA, START, [turn('{"op":"delta","path":"/Nhân vật/Máu","value":-150}')]);
    expect(r.turns[0].issues[0].message).toMatch(/DƯỚI min 0/);
  });

  it('AI bịa đường dẫn ngoài schema ⇒ báo LỖI (MVU lặng lẽ bỏ qua nên user không biết)', () => {
    const r = simulateTurns(SCHEMA, START, [turn('{"op":"replace","path":"/Nhân vật/Nội Lực","value":5}')]);
    const msgs = r.turns[0].issues.map(i => i.message).join(' | ');
    expect(msgs).toMatch(/KHÔNG có trong schema/);
    expect(msgs).toMatch(/lặng lẽ bỏ qua/);
  });

  it('mảng chỉ insert mãi ⇒ cảnh báo phình (ngưỡng 50)', () => {
    const many = Array.from({ length: 12 }, () =>
      turn('{"op":"insert","path":"/Hành trang/Kho đồ/-","value":"item"}'));
    // 60 lần insert qua 12 lượt × 5 op mỗi lượt
    const heavy = Array.from({ length: 12 }, () =>
      turn(Array.from({ length: 5 }, () => '{"op":"insert","path":"/Hành trang/Kho đồ/-","value":"item"}').join(',')));
    const r = simulateTurns(SCHEMA, START, heavy);
    const all = r.turns.flatMap(t => t.issues).map(i => i.message).join(' | ');
    expect(all).toMatch(/phình mãi/);
    expect(many.length).toBe(12);   // giữ biến khỏi bị lint bỏ
  });

  it('lượt KHÔNG có thao tác nào vẫn được ghi lại (user cần thấy "lượt này AI không cập nhật gì")', () => {
    const r = simulateTurns(SCHEMA, START, ['Chỉ có lời kể, không khối biến nào.']);
    expect(r.turns).toHaveLength(1);
    expect(r.turns[0].opsFound).toBe(0);
    expect(r.turns[0].issues).toEqual([]);
  });

  it('trạng thái đi qua từng lượt là TÍCH LUỸ, không reset', () => {
    const r = simulateTurns(SCHEMA, START, [
      turn('{"op":"replace","path":"/Nhân vật/Tên","value":"B"}'),
      turn('{"op":"delta","path":"/Nhân vật/Máu","value":-10}'),
    ]);
    const s = r.turns[1].state as typeof START;
    expect(s['Nhân vật']['Tên']).toBe('B');
    expect(s['Nhân vật']['Máu']).toBe(90);
  });

  it('ảnh chụp từng lượt ĐỘC LẬP — sửa lượt sau không đổi lượt trước', () => {
    const r = simulateTurns(SCHEMA, START, [
      turn('{"op":"delta","path":"/Nhân vật/Máu","value":-10}'),
      turn('{"op":"delta","path":"/Nhân vật/Máu","value":-10}'),
    ]);
    expect((r.turns[0].state as typeof START)['Nhân vật']['Máu']).toBe(90);
    expect((r.turns[1].state as typeof START)['Nhân vật']['Máu']).toBe(80);
    // và trạng thái đầu KHÔNG bị đụng
    expect(START['Nhân vật']['Máu']).toBe(100);
  });

  it('chưa có schema ⇒ nói thẳng, không nổ', () => {
    const r = simulateTurns(null, START, [turn('{"op":"replace","path":"/x","value":1}')]);
    expect(r.turns[0].issues[0].message).toMatch(/Chưa có schema/);
  });

  it('totalIssues đếm đúng tổng cả phiên', () => {
    const r = simulateTurns(SCHEMA, START, [
      turn('{"op":"delta","path":"/Nhân vật/Máu","value":999}'),
      turn('{"op":"replace","path":"/Bịa/Đặt","value":1}'),
    ]);
    expect(r.totalIssues).toBe(r.turns.reduce((s, t) => s + t.issues.length, 0));
    expect(r.totalIssues).toBeGreaterThanOrEqual(2);
  });
});

describe('(bug 224) auditStateAfterTurn chỉ soi chỗ ĐỔI trong lượt', () => {
  it('biến vượt biên nhưng lượt này KHÔNG đụng tới ⇒ không báo lại (khỏi lặp mỗi lượt)', () => {
    const specs = new Map([['/Nhân vật/Máu', { type: 'number', min: 0, max: 100, label: 'Máu' }]]);
    const dirty = { 'Nhân vật': { 'Máu': 500 } };
    // Lượt này chỉ đụng /Nhân vật/Tên → không có spec, sẽ báo "ngoài schema" chứ không báo Máu.
    const issues = auditStateAfterTurn(dirty, [{ op: 'replace', path: '/Nhân vật/Tên', value: 'x' }], specs);
    expect(issues.some(i => i.message.includes('Máu'))).toBe(false);
  });

  it('ghi chuỗi vào biến số ⇒ báo kiểu lệch', () => {
    const specs = new Map([['/M', { type: 'number', label: 'M' }]]);
    const issues = auditStateAfterTurn({ M: 'không phải số' }, [{ op: 'replace', path: '/M', value: 'x' }], specs);
    expect(issues[0].message).toMatch(/phải là số/);
  });
});
