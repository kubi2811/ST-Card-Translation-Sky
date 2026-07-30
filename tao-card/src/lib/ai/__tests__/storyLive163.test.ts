/**
 * (bug 163) CHẠY THẬT BẰNG API THẬT — không mock gì cả.
 * ─────────────────────────────────────────────────────────────────────────────
 * Vì sao cần bài này: bug 163 sống sót qua bug 158 chính vì mọi test đều ở mức hàm thuần. Test
 * mock thì chứng minh được "code gọi đúng thứ tự", nhưng KHÔNG chứng minh được "cắm truyện thật
 * vào thì có entry". User đo bằng con số cuối cùng, nên bài kiểm cũng phải đo bằng con số đó.
 *
 * MẶC ĐỊNH BỊ BỎ QUA. Chỉ chạy khi có đủ hai thứ:
 *   • file khoá   : apiKey/apiKey.txt ở gốc repo (máy user, KHÔNG lên git)
 *   • file truyện : biến môi trường LIVE_STORY trỏ tới một file .txt
 * Cách chạy:
 *   LIVE_STORY=/đường/dẫn/truyen.txt LIVE_CHUNKS=8 npx vitest run src/lib/ai/__tests__/storyLive163
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runDeepScan } from '../storyDeepScan';
import { setPoolProfiles } from '../client';
import type { ProxyProfile, GenerationParams } from '../../../types';

const KEY_FILE = resolve(__dirname, '../../../../../apiKey/apiKey.txt');
const STORY = process.env.LIVE_STORY ?? '';
const CAN_RUN = existsSync(KEY_FILE) && !!STORY && existsSync(STORY);

/** Đọc file khoá dạng "Provier: <url>" + nhiều dòng "KeyN: <key>". */
export function parseKeyFile(raw: string): Array<{ url: string; keys: string[] }> {
  const out: Array<{ url: string; keys: string[] }> = [];
  let cur: { url: string; keys: string[] } | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    const p = /^provi\w*\s*:\s*(\S+)/i.exec(l);
    if (p) { cur = { url: p[1].replace(/\/+$/, ''), keys: [] }; out.push(cur); continue; }
    const k = /^key\d*\s*:\s*(\S+)/i.exec(l);
    if (k && cur) cur.keys.push(k[1]);
  }
  return out.filter((g) => g.keys.length > 0);
}

describe.skipIf(!CAN_RUN)('(bug 163) chạy thật: truyện thật + API thật → phải ra entry', () => {
  it('quét truyện và đếm entry cuối cùng', async () => {
    const groups = parseKeyFile(readFileSync(KEY_FILE, 'utf-8'));
    expect(groups.length, 'không đọc được provider/khoá nào').toBeGreaterThan(0);

    // Mỗi provider trong file là một profile; tất cả vào POOL để chạy song song — đúng cách một
    // user có nhiều provider sẽ dùng, và cũng là cách duy nhất đo được thời gian thực tế.
    // Tên model khác nhau giữa hai provider (provider 2 có tiền tố "gcli-") nên khai theo từng
    // provider, ngăn cách bằng "|". Model CHÍNH cho khâu viết entry, model PHỤ cho khâu đọc.
    const models = (process.env.LIVE_MODEL || 'gemini-3.1-pro-preview').split('|');
    const models2 = (process.env.LIVE_MODEL2 || '').split('|');
    const profiles: ProxyProfile[] = groups.map((g, i) => ({
      id: `live${i}`, label: `live${i}`, providerType: 'openai',
      baseUrl: g.url.endsWith('/v1') ? g.url : `${g.url}/v1`,
      apiKey: g.keys.join('\n'),              // nhiều khoá → client tự xoay vòng
      customHeaders: [], selectedModel: models[i] ?? models[0],
      cachedModels: [], cachedModelsAt: null, supportsNativeToolCalling: null,
      primaryRpm: Number(process.env.LIVE_RPM || 30),
      secondaryRpm: Number(process.env.LIVE_RPM2 || process.env.LIVE_RPM || 30),
      enableSecondaryModel: !!(models2[i] ?? models2[0]),
      secondaryModel: models2[i] ?? models2[0] ?? undefined,
      inPool: true,
    } as unknown as ProxyProfile));
    console.log('model chính : ' + profiles.map((p) => p.selectedModel).join(' | '));
    console.log('model phụ   : ' + profiles.map((p) => p.secondaryModel || '(không)').join(' | '));
    setPoolProfiles(profiles);
    const profile = profiles[0];
    const params = { temperature: 1, maxTokens: 65536 } as unknown as GenerationParams;

    const story = readFileSync(STORY, 'utf-8');
    const t0 = Date.now();
    let lastLog = '';
    const st = await runDeepScan(story, profile, params, {
      maxChunks: Number(process.env.LIVE_CHUNKS || 8),
      maxVerifyRounds: Number(process.env.LIVE_VERIFY || 1),
      learnStyle: true,
      makeCard: false,
      onLog: (m) => { lastLog = m; },
      onState: (s) => {
        const p = s.passes[s.passIndex];
        if (p) process.stdout.write(`\r[${s.passIndex + 1}/${s.passes.length}] ${p.id} ${p.done}/${p.total} · ${s.stats.aiCalls} lượt AI · ${s.stats.facts} dữ kiện · ${s.stats.entries} entry     `);
      },
    });

    const secs = Math.round((Date.now() - t0) / 1000);
    const n = st.result?.entries.length ?? 0;
    process.stdout.write('\n');
    console.log(`── KẾT QUẢ THẬT ─────────────────────────────`);
    console.log(`trạng thái   : ${st.status}${st.error ? ` — ${st.error}` : ''}`);
    console.log(`truyện       : ${story.length.toLocaleString()} ký tự · ${st.chunkCount} chunk`);
    console.log(`lượt AI      : ${st.stats.aiCalls} · thời gian ${secs}s`);
    console.log(`dữ kiện gom  : ${st.stats.facts}`);
    console.log(`ENTRY CUỐI   : ${n}`);
    console.log(`log cuối     : ${lastLog}`);
    for (const r of (st.result?.report ?? []).slice(0, 12)) console.log(`  · ${r}`);
    const byCat = new Map<string, number>();
    for (const e of st.result?.entries ?? []) byCat.set(e.cat, (byCat.get(e.cat) ?? 0) + 1);
    console.log('theo loại    : ' + [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([c, k]) => `${c}=${k}`).join(' '));
    // Bộ nhớ có TRẦN cứng (worldFacts 2000, mỗi nhân vật 120 dữ kiện, nhân vật đưa vào tổng hợp
    // 60). Chạm trần thì đọc thêm truyện cũng không ra thêm entry — phải biết trần nào đang chặn
    // trước khi bảo user "quét nhiều đoạn hơn đi".
    const mem = st.memory;
    const memInfo = {
      nhanVat: mem.characters.length,
      nhanVatCoDuKien: mem.characters.filter((c) => c.facts.length > 0).length,
      duKienNhanVat: mem.characters.reduce((n, c) => n + c.facts.length, 0),
      worldFacts: mem.worldFacts.length,
      chuDeTheGioi: new Set(mem.worldFacts.map((f) => `${f.cat}|${f.topic}`)).size,
      timeline: mem.timeline.length,
      unknowns: mem.unknowns.length,
    };
    console.log('bộ nhớ       : ' + JSON.stringify(memInfo));
    console.log(`  → worldFacts ${memInfo.worldFacts}/2000${memInfo.worldFacts >= 2000 ? '  ⚠️ ĐÃ CHẠM TRẦN' : ''}`);
    console.log(`  → nhân vật có dữ kiện ${memInfo.nhanVatCoDuKien}, tổng hợp tối đa 60${memInfo.nhanVatCoDuKien > 60 ? '  ⚠️ ĐANG BỊ CẮT' : ''}`);
    writeFileSync(resolve(process.env.TEMP || '.', 'live163-result.json'),
      JSON.stringify({ status: st.status, stats: st.stats, mem: memInfo, entries: st.result?.entries ?? [], report: st.result?.report ?? [] }, null, 2));

    expect(st.status, `pipeline lỗi: ${st.error ?? ''}`).toBe('done');
    // Chính là con số trên nút "Thêm N entry vào Lorebook".
    expect(n, 'chạy thật mà vẫn 0 entry → bug 163 chưa dứt').toBeGreaterThan(0);
  }, 60 * 60 * 1000);
});
