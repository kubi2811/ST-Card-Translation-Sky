/**
 * (bug 174) NHẬP THẺ VÀO SILLYTAVERN LÀ ĐỎ NGAY: “[MVU zod]开局 '1' 变量初始化失败 —
 * Invalid option: expected one of "Ignis"|…|"Null" → at ["Người Chơi"]["Phả Hệ"]”.
 * ─────────────────────────────────────────────────────────────────────────────
 * Thẻ user gửi (bug/174/Eldran MVU + EJS.json) khai trong [initvar]:
 *
 *     'Người Chơi':
 *       'Phả Hệ': Null          ← KHÔNG có nháy
 *
 * và trong Zod: z.enum([… ,'Null']).prefault("Null").
 * Nhìn mắt thường thì khớp. Nhưng MVU nạp initvar bằng YAML, mà YAML coi `Null` (cả `null`,
 * `NULL`, `~`) là GIÁ TRỊ RỖNG — nên tới tay Zod nó là null chứ không phải chuỗi "Null".
 * Enum không có null ⇒ đỏ ngay lúc khởi tạo, cả bộ biến không nạp được.
 *
 * Vì sao tool không thấy: bộ đọc initvar của chính tool (simulateCard.parseScalar) chỉ coi
 * `null` chữ thường là rỗng, còn `Null` thì trả về CHUỖI "Null" — tức tool đọc ra một đằng,
 * engine thật đọc ra một nẻo. Mô phỏng xanh mượt trong khi thẻ ra lò là hỏng.
 *
 * Vá theo 3 lớp, test dưới đây khoá cả 3:
 *   1. Đọc cho ĐÚNG như engine  (parseYamlScalar)
 *   2. Ghi ra thì không bao giờ để lọt scalar lập lờ  (emitYamlScalar / formatYAMLValue)
 *   3. Thẻ do AI viết thì vá lại trước khi đóng gói  (quoteAmbiguousInitVarScalars)
 * và thêm một chốt để lần sau tool tự bắt được: giá trị initvar phải thoả ràng buộc schema.
 */
import { describe, it, expect } from 'vitest';
import {
  parseYamlScalar,
  emitYamlScalar,
  quoteAmbiguousInitVarScalars,
} from '../yamlScalars';
import { parseInitVar, simulateCard } from '../simulateCard';
import { generateInitVarYAML } from '../scriptGenerator';
import type { MVUZODSchema } from '../../../types/mvuzod.types';

/** Đúng cây biến của thẻ user, rút gọn còn phần liên quan. */
const SCHEMA: MVUZODSchema = {
  version: '1.0',
  fields: [
    {
      path: '/Người Chơi', type: 'object', label: 'Người Chơi', defaultValue: {}, constraints: {},
      children: [
        { path: '/Người Chơi/Tên', type: 'string', label: 'Tên', defaultValue: 'Vô Danh', constraints: {} },
        {
          path: '/Người Chơi/Phả Hệ', type: 'string', label: 'Phả Hệ', defaultValue: 'Null',
          constraints: { enumValues: ['Ignis', 'Glacis', 'Virens', 'Fulmen', 'Umbra', 'Ferrum', 'Anima', 'Lai', 'Null'] },
        },
        { path: '/Người Chơi/Veil Point', type: 'number', label: 'Veil Point', defaultValue: 100, constraints: { min: 0 } },
      ],
    },
  ],
} as unknown as MVUZODSchema;

/** Nguyên văn [initvar] của thẻ user (phần liên quan). */
const INITVAR_USER = `'Người Chơi':
  'Tên': Vô Danh
  'Phả Hệ': Null
  'Veil Point': 100`;

describe('(bug 174) đọc scalar YAML phải giống hệt engine MVU', () => {
  it('mọi biến thể của null đều là RỖNG, không phải chuỗi', () => {
    for (const tok of ['null', 'Null', 'NULL', '~', '']) {
      expect(parseYamlScalar(tok), `"${tok}" phải ra null`).toBeNull();
    }
  });

  it('mọi biến thể của true/false đều là boolean', () => {
    for (const tok of ['true', 'True', 'TRUE']) expect(parseYamlScalar(tok)).toBe(true);
    for (const tok of ['false', 'False', 'FALSE']) expect(parseYamlScalar(tok)).toBe(false);
  });

  it('chuỗi bọc nháy thì GIỮ NGUYÊN là chuỗi — đây chính là đường thoát', () => {
    expect(parseYamlScalar('"Null"')).toBe('Null');
    expect(parseYamlScalar("'Null'")).toBe('Null');
  });

  it('chữ thường vẫn là chữ, số vẫn là số', () => {
    expect(parseYamlScalar('Sáng')).toBe('Sáng');
    expect(parseYamlScalar('3000')).toBe(3000);
    expect(parseYamlScalar('-1.5')).toBe(-1.5);
  });

  it('ca thật: đọc [initvar] của thẻ user ra đúng cái mà Zod nhìn thấy', () => {
    const data = parseInitVar(INITVAR_USER) as Record<string, Record<string, unknown>>;
    expect(data['Người Chơi']['Phả Hệ'], 'engine thấy null — tool phải thấy y hệt').toBeNull();
  });
});

describe('(bug 174) ghi ra thì KHÔNG được để lọt scalar lập lờ', () => {
  it('chuỗi "Null" phải được bọc nháy', () => {
    expect(emitYamlScalar('Null')).toBe('"Null"');
    expect(parseYamlScalar(emitYamlScalar('Null'))).toBe('Null');
  });

  it('chuỗi trông như số / boolean cũng vậy', () => {
    for (const s of ['123', 'true', 'False', '~', '.inf', '0x1F']) {
      expect(parseYamlScalar(emitYamlScalar(s)), `"${s}" đi vòng phải về nguyên chuỗi`).toBe(s);
    }
  });

  it('chuỗi có dấu cách đầu/cuối phải bọc nháy, kẻo YAML cắt mất', () => {
    expect(parseYamlScalar(emitYamlScalar('Điểm '))).toBe('Điểm ');
  });

  it('số và boolean thật thì để trần', () => {
    expect(emitYamlScalar(3000)).toBe('3000');
    expect(emitYamlScalar(true)).toBe('true');
  });

  it('chuỗi thường không bị bọc nháy vô cớ — giữ initvar dễ đọc', () => {
    expect(emitYamlScalar('Sơ Thức')).toBe('Sơ Thức');
  });

  it('generateInitVarYAML: enum có giá trị "Null" ra file là chạy được', () => {
    const yaml = generateInitVarYAML(SCHEMA);
    const back = parseInitVar(yaml) as Record<string, Record<string, unknown>>;
    expect(back['Người Chơi']['Phả Hệ'], 'sinh ra rồi đọc lại phải vẫn là chuỗi "Null"').toBe('Null');
  });
});

describe('(bug 174) vá lại initvar do AI viết trước khi đóng gói', () => {
  it('ca thật: bọc nháy đúng chỗ "Phả Hệ", không đụng số', () => {
    const { content, fixed } = quoteAmbiguousInitVarScalars(INITVAR_USER, SCHEMA);
    expect(fixed.length, 'phải ghi nhận đã sửa gì để còn báo cho user').toBeGreaterThan(0);
    const back = parseInitVar(content) as Record<string, Record<string, unknown>>;
    expect(back['Người Chơi']['Phả Hệ']).toBe('Null');
    expect(back['Người Chơi']['Veil Point'], 'số phải còn là số, không thành chuỗi').toBe(100);
    expect(back['Người Chơi']['Tên']).toBe('Vô Danh');
  });

  it('không có schema thì vẫn cứu được ca null (chuỗi rỗng vô nghĩa với MVU)', () => {
    const { content } = quoteAmbiguousInitVarScalars("'Phả Hệ': Null\n'Năm': 3000", null);
    const back = parseInitVar(content) as Record<string, unknown>;
    expect(back['Phả Hệ']).toBe('Null');
    expect(back['Năm']).toBe(3000);
  });

  it('không có schema thì KHÔNG đụng true/false — biến boolean thật vẫn là boolean', () => {
    const { content } = quoteAmbiguousInitVarScalars('Đã Thức Tỉnh: false', null);
    expect(parseInitVar(content)['Đã Thức Tỉnh']).toBe(false);
  });

  it('giá trị đã bọc nháy sẵn thì để yên, không bọc chồng', () => {
    const { content, fixed } = quoteAmbiguousInitVarScalars(`'Phả Hệ': "Null"`, SCHEMA);
    expect(fixed).toEqual([]);
    expect(content).toBe(`'Phả Hệ': "Null"`);
  });

  it('không phá cấu trúc: map lồng, mảng rỗng, record rỗng đều giữ nguyên', () => {
    const src = `'Thế Giới':\n  'Năm': 3000\n'Kho Đồ': []\n'NPC': {}`;
    const { content } = quoteAmbiguousInitVarScalars(src, null);
    const back = parseInitVar(content) as Record<string, unknown>;
    expect(back['Kho Đồ']).toEqual([]);
    expect(back['NPC']).toEqual({});
    expect((back['Thế Giới'] as Record<string, unknown>)['Năm']).toBe(3000);
  });
});

describe('(bug 174) tool phải TỰ BẮT được ca này trước khi user xuất thẻ', () => {
  it('giá trị initvar không thuộc enum của schema → báo lỗi, không im lặng', () => {
    const res = simulateCard({ initVarContent: INITVAR_USER, schema: SCHEMA });
    const bad = res.issues.filter((i) => i.code === 'sim-initvar-value-invalid');
    expect(bad.length, 'đúng cái lỗi đỏ user gặp mà tool lại không hé răng').toBeGreaterThan(0);
    expect(bad[0].message).toMatch(/Phả Hệ/);
    expect(bad[0].level).toBe('error');
  });

  it('sửa xong thì hết báo', () => {
    const { content } = quoteAmbiguousInitVarScalars(INITVAR_USER, SCHEMA);
    const res = simulateCard({ initVarContent: content, schema: SCHEMA });
    expect(res.issues.filter((i) => i.code === 'sim-initvar-value-invalid')).toEqual([]);
  });

  it('sai kiểu (chuỗi nằm ở ô số) cũng bị bắt', () => {
    const res = simulateCard({
      initVarContent: `'Người Chơi':\n  'Tên': Vô Danh\n  'Phả Hệ': "Ignis"\n  'Veil Point': nhiều`,
      schema: SCHEMA,
    });
    expect(res.issues.some((i) => i.code === 'sim-initvar-value-invalid' && /Veil Point/.test(i.message))).toBe(true);
  });

  it('thẻ đúng chuẩn thì KHÔNG báo oan', () => {
    const res = simulateCard({
      initVarContent: `'Người Chơi':\n  'Tên': Vô Danh\n  'Phả Hệ': "Ignis"\n  'Veil Point': 100`,
      schema: SCHEMA,
    });
    expect(res.issues.filter((i) => i.code === 'sim-initvar-value-invalid')).toEqual([]);
  });
});
