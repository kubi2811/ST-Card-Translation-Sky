// (bugNeedFix/97) Script 酒馆助手 do app sinh ra bị 3 lỗi:
//  1. công tắc "按钮" tắt sẵn ⇒ 6 nút của bundle MVU không hiện, người chơi tưởng MVU hỏng;
//  2. script "Cấu trúc biến …" chỉ có `export const Schema = …`, thiếu import + registerMvuSchema
//     ⇒ schema khai báo xong nằm im, MVU không bao giờ nhận;
//  3. khoá tên biến có DẤU CÁCH bị viết trần trong code Zod ⇒ SyntaxError, chết cả file.
import { describe, it, expect } from 'vitest';
import { parse } from 'acorn';
import {
  buildMVUImportScript, buildSchemaScript, buildMVUZODScripts, wrapSchemaCodeForTavernHelper,
} from '../tavernScriptBuilder';
import { generateSchemaScript, zodKey } from '../scriptGenerator';
import type { MVUZODSchema } from '../../../types/mvuzod.types';

/** Schema y hệt ca của user: khoá tiếng Việt CÓ DẤU CÁCH, lồng 2 tầng, có enum. */
const SCHEMA: MVUZODSchema = {
  version: 1,
  fields: [
    {
      path: 'Thế Giới', type: 'object', constraints: {},
      children: [
        { path: 'Thế Giới/Lịch SC', type: 'string', constraints: { enumValues: ['Tháng 1', 'Tháng 2'] } },
        { path: 'Thế Giới/Khung Giờ', type: 'string', constraints: { prefault: 'Sáng' } },
        { path: 'Thế Giới/Cường Độ Rift', type: 'number', constraints: { prefault: 2 } },
      ],
    },
    {
      path: 'Người Chơi', type: 'object', constraints: {},
      children: [
        { path: 'Người Chơi/Cảnh Giới', type: 'string', constraints: { prefault: 'Sơ thức' } },
        { path: 'Người Chơi/Tầng', type: 'number', constraints: { prefault: 1 } },
      ],
    },
  ],
} as unknown as MVUZODSchema;

/** Parse đúng như 酒馆助手 chạy: ES module (script có `import` ở đầu). */
function parseAsModule(code: string) {
  return parse(code, { ecmaVersion: 2022, sourceType: 'module' });
}

describe('Lỗi 3 — khoá có dấu cách phải bọc nháy (gốc của đề xuất dùng _)', () => {
  it('zodKey bọc nháy tên có dấu cách, giữ nguyên identifier thuần', () => {
    expect(zodKey('Thế Giới')).toBe('"Thế Giới"');
    expect(zodKey('Khung Giờ')).toBe('"Khung Giờ"');
    expect(zodKey('stat_data')).toBe('stat_data');
    expect(zodKey('_readonly')).toBe('_readonly');
  });

  it('generateSchemaScript sinh ra JS PARSE ĐƯỢC (trước đây SyntaxError ngay dòng đầu)', () => {
    const code = generateSchemaScript(SCHEMA);
    expect(code).toContain('"Thế Giới": z.object({');
    expect(code).not.toMatch(/^\s*Thế Giới:/m);   // không còn khoá trần
    expect(() => parseAsModule(code)).not.toThrow();
  });

  it('KHÔNG đổi chuẩn tên biến sang _ (chuẩn dấu cách chốt ở bug #8 vẫn giữ)', () => {
    const code = generateSchemaScript(SCHEMA);
    expect(code).toContain('Thế Giới');
    expect(code).not.toContain('Thế_Giới');
  });
});

describe('Lỗi 2 — script Cấu trúc biến phải tự chạy được', () => {
  it('có dòng import mvu_zod + lệnh registerMvuSchema(Schema)', () => {
    const s = buildSchemaScript(SCHEMA, 'Eldran System GM');
    expect(s.content).toContain("import { registerMvuSchema } from 'https://");
    expect(s.content).toContain('registerMvuSchema(Schema)');
    expect(s.content).toContain('export const Schema = z.object({');
    expect(() => parseAsModule(s.content)).not.toThrow();
  });

  it('wrap idempotent — code đã có sẵn import/đăng ký thì không bọc chồng', () => {
    const once = wrapSchemaCodeForTavernHelper('export const Schema = z.object({});');
    const twice = wrapSchemaCodeForTavernHelper(once);
    expect(twice).toBe(once);
    expect(once.match(/registerMvuSchema\(Schema\)/g)?.length).toBe(1);
  });

  it('cứu được script cũ trong thẻ đã lỡ xuất (chỉ có Schema trần)', () => {
    const cu = 'export const Schema = z.object({\n  "Thế Giới": z.object({}),\n});';
    const fixed = wrapSchemaCodeForTavernHelper(cu);
    expect(fixed).toContain('registerMvuSchema(Schema)');
    expect(() => parseAsModule(fixed)).not.toThrow();
  });
});

describe('Lỗi 1 — công tắc nút phải bật', () => {
  it('script MVU bật button (bundle MVU đăng ký 6 nút qua getButtonEvent)', () => {
    expect(buildMVUImportScript().button.enabled).toBe(true);
  });

  it('script Cấu trúc biến cũng để đúng mặc định của TavernHelper', () => {
    expect(buildSchemaScript(SCHEMA, 'X').button.enabled).toBe(true);
  });

  it('cả 2 script đều enabled và đủ field bắt buộc của TavernHelper', () => {
    for (const s of buildMVUZODScripts(SCHEMA, 'X')) {
      expect(s.enabled).toBe(true);
      expect(s.type).toBe('script');
      expect(s.id).toBeTruthy();
      expect(typeof s.info).toBe('string');
      expect(s.data).toEqual({});
    }
  });

  it('script MVU nạp đúng bundle MagVarUpdate', () => {
    const code = buildMVUImportScript().content;
    expect(code).toContain('MagicalAstrogy/MagVarUpdate/artifact/bundle.js');
    expect(() => parseAsModule(code)).not.toThrow();
  });
});

// ─── Bộ kiểm hợp nhất phải BẮT ĐƯỢC thẻ cũ đã lỡ xuất sai ───────────────────
import { validateMvuCard } from '../validateMvuCard';

const OK_ENTRIES = [
  { comment: '[initvar]', content: 'Thế Giới:\n  Ngày: 17', enabled: false },
  { comment: '[mvu_update]', content: '<UpdateVariable>\n_.set(\'Thế Giới.Ngày\', 18);\n</UpdateVariable>' },
];

describe('validateMvuCard bắt được script TavernHelper hỏng', () => {
  const codes = (th: unknown[]) =>
    validateMvuCard({ entries: OK_ENTRIES as never, tavernHelperScripts: th as never })
      .errors.concat(validateMvuCard({ entries: OK_ENTRIES as never, tavernHelperScripts: th as never }).warnings)
      .map(i => i.code);

  it('script Cấu trúc biến thiếu import + đăng ký → 2 lỗi đích danh', () => {
    const c = codes([
      { name: 'MVU', content: "import 'https://x/MagVarUpdate/artifact/bundle.js';", enabled: true, button: { enabled: true } },
      { name: 'Cấu trúc biến X', content: 'export const Schema = z.object({});', enabled: true, button: { enabled: true } },
    ]);
    expect(c).toContain('th-schema-no-import');
    expect(c).toContain('th-schema-no-register');
  });

  it('khoá có dấu cách viết trần → báo th-schema-bare-key', () => {
    const c = codes([
      { name: 'MVU', content: "import 'https://x/MagVarUpdate/artifact/bundle.js';", enabled: true, button: { enabled: true } },
      {
        name: 'Cấu trúc biến X', enabled: true, button: { enabled: true },
        content: [
          "import { registerMvuSchema } from 'https://x/mvu_zod.js';",
          'export const Schema = z.object({',
          '  Thế Giới: z.object({}),',
          '});',
          '$(() => { registerMvuSchema(Schema); });',
        ].join('\n'),
      },
    ]);
    expect(c).toContain('th-schema-bare-key');
  });

  it('công tắc nút của MVU tắt → cảnh báo th-mvu-buttons-off', () => {
    const c = codes([
      { name: 'MVU', content: "import 'https://x/MagVarUpdate/artifact/bundle.js';", enabled: true, button: { enabled: false } },
    ]);
    expect(c).toContain('th-mvu-buttons-off');
  });

  it('script do app sinh bây giờ SẠCH (không còn mã lỗi nào của nhóm th-)', () => {
    const c = codes(buildMVUZODScripts(SCHEMA, 'X'));
    expect(c.filter(x => x.startsWith('th-'))).toEqual([]);
  });
});
