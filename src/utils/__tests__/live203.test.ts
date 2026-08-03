/**
 * TẠM — chạy THẬT bug 203 bằng API key của user (apiKey/apiKey.txt, không commit).
 * Chỉ chạy khi có biến môi trường LIVE203=1, để suite thường không bao giờ gọi mạng.
 *   $env:LIVE203='1'; npx vitest run src/utils/__tests__/live203.test.ts
 * Xoá file này sau khi chẩn xong.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { translateText, fieldGroupToFieldType, setExtraProviders, resetProviderPool, computePoolConcurrency } from '../apiClient';
import { jsParseErrorAny } from '../scriptSafety';
import { repairUnquotedObjectKeys } from '../repairObjectKeys';
import type { ProxySettings } from '../../types/card';

const ROOT = path.resolve(__dirname, '../../..');
const KEYFILE = path.join(ROOT, 'apiKey', 'apiKey.txt');
const SRC = path.join(ROOT, 'bug', '203', 'message.txt');
// Kết quả ghi vào bug/203/ — thư mục này nằm trong .gitignore nên bằng chứng chạy thật
// ở lại đúng máy đang chạy, không bao giờ bị đẩy lên remote.
const OUTDIR = path.join(ROOT, 'bug', '203');

interface Prov { url: string; keys: string[] }

function readProviders(): Prov[] {
  const raw = fs.readFileSync(KEYFILE, 'utf8');
  const out: Prov[] = [];
  let cur: Prov | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const mp = t.match(/^Provie?r\s*:\s*(\S+)/i);
    if (mp) { cur = { url: mp[1], keys: [] }; out.push(cur); continue; }
    const mk = t.match(/^Key\d*\s*:\s*(\S+)/i);
    if (mk && cur) cur.keys.push(mk[1]);
  }
  return out.filter((p) => p.keys.length > 0);
}

const baseConfig = (url: string, keys: string[], model: string): ProxySettings => ({
  provider: 'openai',
  proxyUrl: url,
  apiKey: keys[0],
  apiKeys: keys,
  model,
  maxTokens: 0,
  temperature: 0.3,
  topP: 1, topK: 0, minP: 0,
  frequencyPenalty: 0, presencePenalty: 0, repetitionPenalty: 1,
  requestDelay: 0,
  retryDelay: 1000,
  requestTimeout: 300000,
  maxRetries: 2,
  minResponseRatio: 0.3,
  systemPromptPrefix: '',
  useCorsProxy: false,
  useStream: true,
  expertMode: false,
  primaryModelRpm: 5,
  secondaryModel: '',
  secondaryModelRpm: 17,
  enableSecondaryModel: false,
  secondaryModelThreshold: 0,
} as unknown as ProxySettings);

const MODEL = process.env.LIVE203_MODEL || 'gemini-3.1-pro-preview';

describe.skipIf(process.env.LIVE203 !== '1')('bug 203 — chạy thật', () => {
  it('smoke: gọi được provider', { timeout: 300_000 }, async () => {
    const provs = readProviders();
    const lines: string[] = [`providers=${provs.length}`];
    let anyOk = false;
    for (const p of provs) {
      for (const url of [p.url.replace(/\/+$/, ''), p.url.replace(/\/+$/, '') + '/v1']) {
        const cfg = baseConfig(url, p.keys, MODEL);
        try {
          const r = await translateText('你好世界', 'test', cfg, 'Tiếng Việt', '中文');
          lines.push(`OK   ${url} (${p.keys.length} key) → ${JSON.stringify(r.slice(0, 80))}`);
          anyOk = true;
        } catch (e) {
          lines.push(`FAIL ${url} → ${(e as Error).message.slice(0, 200)}`);
        }
      }
    }
    fs.writeFileSync(path.join(OUTDIR, 'live203-smoke.txt'), lines.join('\n'), 'utf8');
    expect(anyOk, lines.join('\n')).toBe(true);
  });

  it('dịch nguyên entry schema và bản dịch PHẢI parse được', { timeout: 1_800_000 }, async () => {
    const provs = readProviders();
    const url = process.env.LIVE203_URL || provs[0].url.replace(/\/+$/, '');
    const cfg = baseConfig(url, provs[0].keys, MODEL);
    setExtraProviders([]);
    resetProviderPool();

    const text = fs.readFileSync(SRC, 'utf8');
    expect(jsParseErrorAny(text), 'bản GỐC phải parse sạch, nếu không thì phép thử vô nghĩa').toBeNull();

    const rawChunks: string[] = [];
    const doneChunks: string[] = [];
    const started = Date.now();
    const translated = await translateText(
      text,
      'tavernHelper[1].content (ZOD)',
      cfg,
      'Tiếng Việt',
      '中文',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      fieldGroupToFieldType('tavern_helper'),
      undefined,
      undefined,
      undefined,
      (idx, chunk, total) => { doneChunks[idx] = chunk; console.log(`  ✓ chunk ${idx + 1}/${total} (${chunk.length} ký tự)`); },
      computePoolConcurrency(cfg),
      false,
      (chunks) => { rawChunks.push(...chunks); console.log(`  → cắt ${chunks.length} phần: ${chunks.map((c) => c.length).join(', ')}`); },
      'preserve',
      false,
      undefined,
    );

    // Đúng chuỗi hậu xử lý của app (useTranslation.ts:1074-1131): vá khoá mất nháy TRƯỚC,
    // rồi mới tới chốt cú pháp. Bỏ bước này thì phép thử không phải là thứ user chạy.
    const raw = translated;
    const keyFix = repairUnquotedObjectKeys(translated);
    const finalText = keyFix.repaired ? keyFix.code : translated;

    const errBefore = jsParseErrorAny(raw);
    const err = jsParseErrorAny(finalText);
    const report = [
      `model=${MODEL} url=${url}`,
      `thời gian: ${Math.round((Date.now() - started) / 1000)}s`,
      `gốc=${text.length} ký tự → dịch=${finalText.length} ký tự`,
      `số phần=${rawChunks.length} (${rawChunks.map((c) => c.length).join(', ')})`,
      `AI trả về: ${errBefore ? `vỡ dòng ${errBefore.line} (${errBefore.msg})` : 'đã sạch sẵn'}`,
      `vá khoá mất nháy: ${keyFix.fixed.length} khoá${keyFix.fixed.length ? ` — ${keyFix.fixed.slice(0, 8).join(', ')}${keyFix.fixed.length > 8 ? '…' : ''}` : ''}`,
      `parse KẾT QUẢ CUỐI: ${err ? `VỠ dòng ${err.line}: ${err.msg}` : 'SẠCH ✓'}`,
      `còn chữ Hán: ${(finalText.match(/[一-鿿]/g) || []).length} ký tự`,
    ].join('\n');
    const translated2 = finalText;
    void translated2;
    fs.writeFileSync(path.join(OUTDIR, 'live203-report.txt'), report, 'utf8');
    fs.writeFileSync(path.join(OUTDIR, 'live203-translated.js'), finalText, 'utf8');
    fs.writeFileSync(path.join(OUTDIR, 'live203-ai-raw.js'), raw, 'utf8');
    console.log(report);
    expect(err, report).toBeNull();
  });
});
