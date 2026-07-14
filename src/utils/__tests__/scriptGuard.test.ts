import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { jsParseErrorAny, isLikelyJsScript, isImportOnlyScript } from '../scriptSafety';
import { codeChunkBroken, isCodeChunk } from '../apiClient';
import { scanFieldsHealth } from '../cardHealth';
import type { TranslationField } from '../../types/card';

/**
 * (User 2026 — bugNeedFix/7) Script TavernHelper 71K (st-map-search-widget) dịch xong bị CỤT ĐUÔI
 * giữa 1 regex literal (mất 383/1455 dòng, "Invalid regular expression: missing /") mà pipeline vẫn
 * nhận 'done' (65k/71k = 91% nên lọt guard tỉ lệ). Fixture = 2 file THẬT của user.
 */

const fx = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf-8');
const RAW = fx('script-raw.mapwidget.js.txt');
const BUG = fx('script-bug.mapwidget.js.txt');

describe('jsParseErrorAny — parse JS trần (acorn, cả module lẫn script)', () => {
  it('script GỐC 71K parse sạch', () => {
    expect(jsParseErrorAny(RAW)).toBeNull();
  });
  it('script BUG (cụt đuôi giữa regex) → báo lỗi kèm SỐ DÒNG ~1072', () => {
    const err = jsParseErrorAny(BUG);
    expect(err).not.toBeNull();
    expect(err!.line).toBeGreaterThanOrEqual(1070);
    expect(err!.line).toBeLessThanOrEqual(1074);
  });
  it("script ES MODULE (mở đầu import 'https://…jsdelivr…') vẫn parse sạch (template cộng đồng)", () => {
    const mod = "import 'https://testingcf.jsdelivr.net/gh/x/y/dist/index.js';\nconsole.log('ok');";
    expect(jsParseErrorAny(mod)).toBeNull();
  });
});

describe('isLikelyJsScript / isImportOnlyScript', () => {
  it('script thật 71K → true; văn xuôi → false; EJS → false (đường EJS riêng lo)', () => {
    expect(isLikelyJsScript(RAW)).toBe(true);
    expect(isLikelyJsScript('Đây là một đoạn văn mô tả nhân vật, không phải code gì cả nhé bạn ơi. Có dấu chấm; và ngoặc (như này) thôi.')).toBe(false);
    expect(isLikelyJsScript('<% if (x) { %> văn <% } %> const a = 1; const b = 2; const c = 3; const d = 4; const e = 5;')).toBe(false);
  });
  it('script CHỈ import CDN (+comment) → true (bỏ qua không dịch, nội dung thật trên CDN)', () => {
    expect(isImportOnlyScript("// tự cập nhật\nimport 'https://testingcf.jsdelivr.net/gh/a/b/dist/i.js';\n")).toBe(true);
    expect(isImportOnlyScript(RAW)).toBe(false);
  });
});

describe('codeChunkBroken — guard cấu trúc CHUNK code (deterministic)', () => {
  const okChunk = RAW.slice(0, 9000);
  it('chunk code giữ nguyên → null (ổn)', () => {
    expect(isCodeChunk(okChunk)).toBe(true);
    expect(codeChunkBroken(okChunk, okChunk)).toBeNull();
  });
  it('CỤT output (dịch < 55% gốc) → báo "cụt"', () => {
    expect(codeChunkBroken(okChunk, okChunk.slice(0, 3000))).toContain('cụt');
  });
  it('LỆCH cân bằng ngoặc (mất nhánh code) → báo lệch', () => {
    const broken = okChunk.replace('(function initWidget() {', '(function initWidget()');
    const r = codeChunkBroken(okChunk, broken);
    expect(r).not.toBeNull();
  });
  it('bản dịch chuỗi có thêm CẶP ngoặc cân → KHÔNG báo nhầm', () => {
    const trans = okChunk.replace("'st-map-search-widget'", "'tiện ích (bản đồ)'");
    expect(codeChunkBroken(okChunk, trans)).toBeNull();
  });
});

describe('cardHealth — soi script JS trần (TavernHelper)', () => {
  const mkField = (o: string, t: string | undefined, status: TranslationField['status']): TranslationField =>
    ({ path: 'p', label: 'tavernHelper[2].content', original: o, translated: t || '', status, group: 'tavern_helper', retries: 0 } as unknown as TranslationField);

  it('gốc lành + bản dịch CỤT → error broken_script kèm dòng + gợi ý Sửa nhanh', () => {
    const rep = scanFieldsHealth([mkField(RAW, BUG, 'done')]);
    const iss = rep.issues.find(i => i.kind === 'broken_script');
    expect(iss).toBeTruthy();
    expect(iss!.severity).toBe('error');
    expect(iss!.detail).toContain('dòng');
    expect(rep.ok).toBe(false);
  });
  it('card IMPORT có script GỐC vỡ sẵn (chưa dịch) → warning source_script_broken NGAY', () => {
    const rep = scanFieldsHealth([mkField(BUG, undefined, 'pending')]);
    const iss = rep.issues.find(i => i.kind === 'source_script_broken');
    expect(iss).toBeTruthy();
    expect(iss!.detail).toContain('GỐC');
  });
  it('gốc lành + dịch lành → không báo gì', () => {
    const rep = scanFieldsHealth([mkField(RAW, RAW.replace("'Live'", "'Trực tiếp'"), 'done')]);
    expect(rep.issues.filter(i => i.kind === 'broken_script' || i.kind === 'source_script_broken').length).toBe(0);
  });
});
