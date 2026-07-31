/**
 * (bugNeedFix/178) KIỂM THẬT QUA API — gom token bằng surgical (đã sửa) → gửi model → ghép lại.
 * ─────────────────────────────────────────────────────────────────────────────
 * CHỈ chạy khi bật cờ: `LIVE_API=1 npx vitest run src/utils/__tests__/e2e178.test.ts`
 * Mặc định BỎ QUA, vì nó tốn call API thật và cần key trong apiKey/apiKey.txt — bộ test thường
 * phải chạy được offline, không phụ thuộc mạng và không đốt hạn mức của user.
 *
 * Kết quả lần chạy ngày 31/07 (model gcli-gemini-3-pro qua proxy của user):
 *   gốc  : - 模板: 【消费监测】支出{金额}元…
 *   dịch : - Mẫu: 【Giám sát chi tiêu】Chi tiêu{Số tiền} Đồng…
 * Nhãn nằm đúng trong ngoặc, không còn 【】 rỗng.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { extractCJKTokens, reinsertTranslations } from '../surgical';

const LIVE = process.env.LIVE_API === '1' && existsSync('apiKey/apiKey.txt');
const RAW = (LIVE ? readFileSync('apiKey/apiKey.txt', 'utf8') : '')
  .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const BASE = (RAW[0] ?? '').replace(/\/+$/, '');
const KEY = RAW[1] ?? '';
const MODEL = ((RAW[2] ?? '').split(':')[1] || '').trim();

const SRC = `播报协议:
  消费反馈:
    - 模板: 【消费监测】支出{金额}元（{消费对象/类型}），有效返利{返现倍数}倍到账{返现金额}元。当前余额: {新余额}元。`;

async function translateTokens(tokens: string[]): Promise<string[]> {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: 'Dịch Trung→Việt từng dòng. Trả về ĐÚNG số dòng, mỗi dòng "N. bản dịch", không giải thích.' },
        { role: 'user', content: tokens.map((t, i) => `${i + 1}. ${t}`).join('\n') },
      ],
      temperature: 0.2,
    }),
  });
  const j = await r.json();
  const text: string = j.choices?.[0]?.message?.content ?? '';
  const out = tokens.map(() => '');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\.\s*(.+)$/);
    if (m) { const i = +m[1] - 1; if (i >= 0 && i < out.length) out[i] = m[2].trim(); }
  }
  return out;
}

describe('E2E 178 qua API thật', () => {
  it.skipIf(!LIVE)('dịch trọn dòng, ngoặc ôm đúng nhãn', async () => {
    const toks = extractCJKTokens(SRC);
    const texts = toks.map(t => t.text);
    console.log('\n=== TOKEN GỬI ĐI (sau khi sửa) ===\n' + texts.map((t,i)=>`${i+1}. ${t}`).join('\n'));

    const vi = await translateTokens(texts);
    console.log('\n=== MODEL TRẢ VỀ ===\n' + vi.map((t,i)=>`${i+1}. ${t}`).join('\n'));

    toks.forEach((t, i) => { t.translated = vi[i] || t.text; });
    const out = reinsertTranslations(SRC, toks);
    console.log('\n=== BẢN GỐC ===\n' + SRC);
    console.log('\n=== BẢN DỊCH GHÉP LẠI ===\n' + out);

    expect(out).not.toContain('【】');
    const cnt = (s: string, c: string) => s.split(c).length - 1;
    for (const ch of ['【','】','（','）','{','}']) expect(cnt(out, ch)).toBe(cnt(SRC, ch));
  }, 180000);
});
