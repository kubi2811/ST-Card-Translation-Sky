/**
 * (bug 174 — "sau khi fix xong còn 1 ít lỗi lặt vặt") BỘ MÔ PHỎNG BÁO OAN.
 * ─────────────────────────────────────────────────────────────────────────────
 * Cho chính bộ mô phỏng của tool chạy trên thẻ user gửi (bug/174/Eldran MVU + EJS.json) thì ra
 * 9 lỗi ĐỎ — soi lại thì cả 9 đều là báo oan, cùng ba gốc:
 *
 *  1. `getvar('stat_data.Người Chơi.Cảnh Giới')` bị đếm THÊM một biến tên "Người". Bộ dò quét
 *     chuỗi `stat_data.` như thể đó là truy cập thuộc tính JS, mà tên biến MVU CÓ DẤU CÁCH nên
 *     nó cắt ngang ở khoảng trắng. Mỗi khối EJS dùng getvar là một dòng đỏ.
 *  2. `getvar('temp_old_vp')` — biến chat tạm do chính khối EJS đó ghi ra bằng setvar. Nó không
 *     nằm trong stat_data và cũng KHÔNG nên nằm, vậy mà bị đòi phải có trong [initvar].
 *  3. Entry "[mvu_update]Định dạng đầu ra biến" chứa KHUÔN MẪU cho AI điền
 *     (`"path": "${/đường/dẫn/tới/biến}"`), không phải lệnh thật. Bộ mô phỏng đem khuôn mẫu đi
 *     chạy, không đổi được gì, rồi kết luận "khối UpdateVariable không đổi được biến nào".
 *
 * Báo oan không vô hại: user phải đi dò 9 dòng đỏ vô nghĩa, và quen dần với việc bỏ qua màu đỏ —
 * đến lúc có lỗi thật thì cũng bỏ qua nốt.
 */
import { describe, it, expect } from 'vitest';
import { simulateCard, extractReadPaths } from '../simulateCard';
import type { MVUZODSchema } from '../../../types/mvuzod.types';

const SCHEMA: MVUZODSchema = {
  version: '1.0',
  fields: [
    {
      path: '/Người Chơi', type: 'object', label: 'Người Chơi', defaultValue: {}, constraints: {},
      children: [
        { path: '/Người Chơi/Cảnh Giới', type: 'string', label: 'Cảnh Giới', defaultValue: 'Sơ Thức', constraints: {} },
        { path: '/Người Chơi/Veil Point', type: 'number', label: 'Veil Point', defaultValue: 100, constraints: {} },
      ],
    },
  ],
} as unknown as MVUZODSchema;

const INITVAR = `'Người Chơi':
  'Cảnh Giới': Sơ Thức
  'Veil Point': 100`;

const sim = (readers: Array<{ name: string; content: string }>, updates: string[] = []) =>
  simulateCard({ initVarContent: INITVAR, schema: SCHEMA, readerSources: readers, updateContents: updates });

describe('(bug 174) tên biến CÓ DẤU CÁCH không được cắt đôi', () => {
  it('getvar("stat_data.Người Chơi.Cảnh Giới") chỉ ra MỘT biến', () => {
    const paths = extractReadPaths(`var x = getvar('stat_data.Người Chơi.Cảnh Giới', { defaults: 'Sơ Thức' });`);
    expect(paths).toContain('Người Chơi.Cảnh Giới');
    expect(paths, 'mảnh "Người" là do cắt ở khoảng trắng, không phải biến có thật').not.toContain('Người');
  });

  it('ca thật: khối EJS đọc biến hợp lệ thì KHÔNG có dòng đỏ nào', () => {
    const res = sim([{
      name: 'Bộ điều khiển EJS',
      content: `<%_ var c = getvar('stat_data.Người Chơi.Cảnh Giới', { defaults: 'Sơ Thức' }); _%>`,
    }]);
    expect(res.issues.filter(i => i.code === 'sim-reader-missing-var')).toEqual([]);
  });

  it('vẫn bắt được biến ĐỌC THẬT mà không ai khai', () => {
    const res = sim([{ name: 'X', content: `<%_ getvar('stat_data.Người Chơi.Danh Vọng'); _%>` }]);
    const miss = res.issues.filter(i => i.code === 'sim-reader-missing-var');
    expect(miss.length).toBe(1);
    expect(miss[0].message).toMatch(/Danh Vọng/);
  });

  it('truy cập kiểu JS stat_data.a.b (không dấu cách) vẫn được soi như cũ', () => {
    expect(extractReadPaths('const v = stat_data.Player.HP;')).toContain('Player.HP');
  });
});

describe('(bug 174) biến chat tạm không phải biến MVU', () => {
  it('getvar("temp_old_vp") — không có tiền tố stat_data. thì không đòi nó nằm trong initvar', () => {
    const res = sim([{
      name: 'Kiểm tra sụt giảm VP',
      content: `<%_ var o = Number(getvar('temp_old_vp', { defaults: 100 })); setvar('temp_old_vp', 1); _%>`,
    }]);
    expect(res.issues.filter(i => i.code === 'sim-reader-missing-var')).toEqual([]);
  });

  it('nhưng đọc TÊN BIẾN MVU mà QUÊN tiền tố stat_data. thì phải bị bắt', () => {
    // Đây mới là lỗi thật và rất dễ mắc: getvar('Người Chơi.Cảnh Giới') luôn trả về rỗng.
    const res = sim([{ name: 'X', content: `<%_ getvar('Người Chơi.Cảnh Giới'); _%>` }]);
    const bad = res.issues.filter(i => i.code === 'sim-reader-missing-prefix');
    expect(bad.length).toBe(1);
    expect(bad[0].message).toMatch(/stat_data/);
  });
});

describe('(bug 174) khuôn mẫu <UpdateVariable> không phải lệnh thật', () => {
  const TEMPLATE = `<UpdateVariable>
<JSONPatch>
[
  { "op": "replace", "path": "\${/đường/dẫn/tới/biến}", "value": "\${giá_trị_mới}" }
]
</JSONPatch>
</UpdateVariable>`;

  it('không báo "không đổi được biến nào" cho khuôn mẫu', () => {
    const res = sim([], [TEMPLATE]);
    expect(res.issues.filter(i => i.code === 'sim-update-noop')).toEqual([]);
    expect(res.issues.filter(i => i.code === 'sim-update-bad-path')).toEqual([]);
  });

  it('lệnh THẬT trỏ vào biến không có thì vẫn báo', () => {
    const real = `<UpdateVariable>\n_.set('Người Chơi.Không Tồn Tại', 5);\n</UpdateVariable>`;
    const res = sim([], [real]);
    expect(res.issues.some(i => i.code === 'sim-update-bad-path')).toBe(true);
  });
});
