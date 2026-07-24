// (Goal 100.2) Harness "chạy được thật": initvar → form ghi → status bar đọc.
// Đây là bài kiểm CHẤP NHẬN cho bug #162 — trước đây không có cách nào chứng minh
// form của card tự tạo có làm biến đổi thật hay không ngoài AI review suông.
import { describe, it, expect } from 'vitest';
import {
  parseMvuCommands, applyMvuCommands, readMvuVar, runFormCycle, checkFormWritePath,
} from '../mvuHarness';
import { buildProgrammaticRegex } from '../programmaticRegexBuilder';
import { normalizeMVUZODSchema } from '../normalizeSchema';

describe('parseMvuCommands — máy đếm ngoặc như engine', () => {
  it('parse lệnh với tên biến tiếng Việt có dấu + khoảng trắng', () => {
    const cmds = parseMvuCommands(`_.set('Người Chơi.Cảnh Giới', 'Trúc Cơ');//đột phá`);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].type).toBe('set');
    expect(cmds[0].args).toEqual(['Người Chơi.Cảnh Giới', 'Trúc Cơ']);
  });

  it('chuỗi lồng chứa ");" không làm gãy (đúng ca engine phòng thủ)', () => {
    const cmds = parseMvuCommands(`_.set('a.b', ["x);", "y"]);`);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].args[1]).toEqual(['x);', 'y']);
  });

  it('nhiều lệnh trên nhiều dòng + dạng 3 tham số', () => {
    const cmds = parseMvuCommands(`_.set('a', 1, 2);\n_.add('b', 5);\n_.delete('c');`);
    expect(cmds.map((c) => c.type)).toEqual(['set', 'add', 'delete']);
  });

  it('_.setup(...) của code thường KHÔNG bị nhận nhầm là lệnh', () => {
    expect(parseMvuCommands('_.setup(config); store.set(1);')).toHaveLength(0);
  });
});

describe('applyMvuCommands — hành vi ghi mirror engine', () => {
  it('cặp [giá_trị, "mô tả"]: ghi vào [0], GIỮ mô tả', () => {
    const sd: Record<string, unknown> = { 'Cảnh Giới': ['Luyện Khí', 'cảnh giới tu luyện'] };
    applyMvuCommands(sd, `_.set('Cảnh Giới', 'Trúc Cơ');`);
    expect(sd['Cảnh Giới']).toEqual(['Trúc Cơ', 'cảnh giới tu luyện']);
  });

  it('ô đang là số: chuỗi số tự ép về number (update_variables.ts:791)', () => {
    const sd: Record<string, unknown> = { 'Máu': [100, 'máu tối đa 100'] };
    applyMvuCommands(sd, `_.set('Máu', '85');`);
    expect(sd['Máu']).toEqual([85, 'máu tối đa 100']);
  });

  it('_.add cộng dồn số qua cặp VWD', () => {
    const sd: Record<string, unknown> = { 'Thế Giới': { 'Ngày': [1, 'ngày trong game'] } };
    applyMvuCommands(sd, `_.add('Thế Giới.Ngày', 1);`);
    expect(readMvuVar(sd, 'Thế Giới.Ngày')).toBe(2);
  });

  it('path không tồn tại → báo thất bại đích danh, không nổ', () => {
    const sd: Record<string, unknown> = { A: 1 };
    const r = applyMvuCommands(sd, `_.set('X.Y.Z', 1);`);
    expect(r.applied).toBe(0);
    expect(r.failed[0].reason).toContain('path');
  });
});

describe('runFormCycle — ĐỦ VÒNG initvar → form → status bar (bài kiểm bug #162)', () => {
  it('vòng đời chuẩn: giá trị nhập từ form phải ĐỌC LẠI ĐƯỢC như status bar sẽ thấy', () => {
    const initvar = JSON.stringify({
      'Người Chơi': {
        'Tên': ['(chưa đặt)', 'tên do người chơi nhập ở form mở đầu'],
        'Máu': [100, 'máu hiện tại'],
      },
      'Thế Giới': { 'Ngày': 1 },
    });
    const formCmds = [
      `_.set('Người Chơi.Tên', "Lâm Phong");//form thiết lập`,
      `_.set('Người Chơi.Máu', '90');//form thiết lập`,
      `_.add('Thế Giới.Ngày', 1);//qua ngày`,
    ].join('\n');

    const r = runFormCycle(initvar, formCmds, [
      { path: 'Người Chơi.Tên', expect: 'Lâm Phong' },
      { path: 'Người Chơi.Máu', expect: 90 },
      { path: 'Thế Giới.Ngày', expect: 2 },
    ]);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('form "ghi mà không ăn" (path lệch schema) → harness PHẢI bắt được', () => {
    const r = runFormCycle(
      JSON.stringify({ 'Người Chơi': { 'Tên': 'x' } }),
      `_.set('Nhân Vật.Tên', 'y');`, // sai nhánh gốc — đúng kiểu lỗi 4-hệ-tên-biến của bugNeedFix/41
      [{ path: 'Người Chơi.Tên', expect: 'y' }],
    );
    expect(r.ok).toBe(false);
    expect(r.problems.length).toBeGreaterThan(0);
  });
});

describe('checkFormWritePath — mã form SINH RA phải đi đúng đường Mvu', () => {
  const schema = normalizeMVUZODSchema({
    version: '1.0',
    fields: [
      { path: '/Player', type: 'object', label: 'Người Chơi', constraints: {}, defaultValue: {},
        children: [
          { path: '/Player/Name', type: 'string', label: 'Tên', constraints: {}, defaultValue: '' },
          { path: '/Player/HP', type: 'number', label: 'Máu', constraints: {}, defaultValue: 100 },
        ] },
    ],
  });

  it('CHÍNH CA BUG #162: opening_form của builder phải qua được phép kiểm', () => {
    const r = buildProgrammaticRegex({ schema, component: 'opening_form', gameName: 'T' });
    const all = r.scripts.map((s) => s.replaceString ?? '').join('\n');
    const check = checkFormWritePath(all);
    expect(check.problems).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it('mã kiểu CŨ dùng /setvar → trượt, chỉ đích danh bug #162', () => {
    const legacy = `function onConfirm(){ executeSlashCommands('/setvar key="stat_data.X" value="1"'); }`;
    const check = checkFormWritePath(legacy);
    expect(check.ok).toBe(false);
    expect(check.problems.some((p) => p.includes('/setvar'))).toBe(true);
  });
});
