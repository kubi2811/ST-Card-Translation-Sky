/**
 * (bug 251) PhatSiz — xuất/nhập workspace: toàn bộ dữ liệu card đang dịch (raw + bản dịch) để chia
 * sẻ, TRỪ kết nối/API: "dữ liệu chỗ kết nối và API hoàn toàn không được đụng vào hoặc chia sẻ".
 * Test khoá chặt điều kiện sống còn: không một mẩu key/URL proxy nào lọt ra file.
 */
import { describe, it, expect } from 'vitest';
import {
  buildWorkspace, parseWorkspace, collectSecrets, stripSensitiveKeys, workspaceFileName, WORKSPACE_FORMAT,
} from '../workspaceIO';
import type { CharacterCard, TranslationField, SavedPreset } from '../../types/card';

const KEY1 = 'sk-live-THIS-IS-A-REAL-LOOKING-KEY-123456';
const KEY2 = 'AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKE00';
const GH = 'ghp_FAKEGITHUBTOKEN1234567890abcdef';

const state = {
  proxy: { apiKey: KEY1, apiKeys: [KEY2], proxyUrl: 'https://my-private-proxy.example/v1' },
  providers: [{ apiKey: 'sk-provider2-SECRET-xxxxxxxx', apiKeys: [] }],
};

const card = {
  data: { name: 'Thẻ/Thử', description: '你好', character_book: { entries: [{ content: '内容' }] } },
} as unknown as CharacterCard;

const fields = [
  // (bug 255) Từ điển chỉ đi theo mục có trong văn bản gốc — gốc phải chứa đủ các khoá dùng bên dưới.
  { path: 'data.description', label: 'desc', group: 'description', original: '你好 好感度 甲 A', translated: 'Xin chào', status: 'done', retries: 0 },
  { path: 'data.character_book.entries[0].content', label: 'e0', group: 'lorebook', original: '内容', translated: '', status: 'translating', retries: 0,
    completedChunks: ['Nội'], rawChunks: ['内'], totalChunks: 2 },
] as unknown as TranslationField[];

const preset = {
  id: 'p', name: 'Preset', fileName: 'p.json', importedAt: 1,
  preset: { temperature: 1, reverse_proxy: 'https://leak.example', proxy_password: 'hunter2', prompts: [{ name: 'Main', content: 'Viết hay' }] },
} as unknown as SavedPreset;

function build(extra: Partial<Record<string, unknown>> = {}) {
  return buildWorkspace({
    card, cardFileName: 'the.json', contentType: 'card', fields, phase: 'translating', currentFieldIndex: 1,
    mvuKeyMetadata: { 好感度: { sources: ['zod'] } },
    translationConfig: { mvuDictionary: { 好感度: 'Độ Hảo Cảm' }, ejsEntryNameDict: { 甲: 'Giáp' }, ejsKeywordDict: {}, glossary: [{ source: 'A', target: 'B' }], translationPrompt: 'Dịch mượt', ...extra },
    activePreset: preset,
  }, [{ id: 'ext-1', name: 'a.js', url: 'https://cdn/a.js', kind: 'other', kindReason: '', original: 'x', translated: 'y', updatedAt: 1 }],
  collectSecrets(state, [GH]), '2.58.0');
}

describe('(bug 251) xuất workspace — đủ dữ liệu, KHÔNG có API', () => {
  it('có đủ: thẻ, field + chunk, từ điển MVU/EJS, thuật ngữ, prompt, preset, link ngoài', () => {
    const { file } = build();
    expect(file.format).toBe(WORKSPACE_FORMAT);
    expect(file.card.data?.name).toBe('Thẻ/Thử');
    expect(file.fields[0].translated).toBe('Xin chào');
    expect(file.fields[1].completedChunks).toEqual(['Nội']);
    expect((file.translationConfig as any).mvuDictionary).toEqual({ 好感度: 'Độ Hảo Cảm' });
    expect((file.translationConfig as any).translationPrompt).toBe('Dịch mượt');
    expect(file.activePreset?.preset).toBeTruthy();
    expect(file.externalLinks).toHaveLength(1);
    expect(file.stats).toMatchObject({ fields: 2, done: 1, dictMvu: 1, dictEjs: 1, glossary: 1, externalLinks: 1 });
  });

  it('không chứa proxy/providers, không một key nào — kể cả URL proxy riêng', () => {
    const { json } = build();
    for (const s of [KEY1, KEY2, GH, 'sk-provider2-SECRET-xxxxxxxx', 'my-private-proxy.example', '"proxy"', '"providers"']) {
      expect(json).not.toContain(s);
    }
  });

  it('preset SillyTavern: gỡ reverse_proxy / proxy_password, giữ prompt', () => {
    const { json, removedKeys } = build();
    expect(json).not.toContain('leak.example');
    expect(json).not.toContain('hunter2');
    expect(json).toContain('Viết hay');
    expect(removedKeys.some(k => k.endsWith('reverse_proxy'))).toBe(true);
  });

  it('key bị dán nhầm vào CHÍNH nội dung thẻ/cấu hình cũng bị xoá trước khi ghi file', () => {
    const { json, scrubbedHits } = build({ translationPrompt: `ghi chú: key của tôi là ${KEY1}` });
    expect(json).not.toContain(KEY1);
    expect(scrubbedHits).toBe(1);
    expect(json).toContain('[ĐÃ XOÁ KEY]');
  });

  it('đang dịch dở ⇒ xuất ra trạng thái tạm dừng / field về pending (không tự chạy ở máy người nhận)', () => {
    const { file } = build();
    expect(file.phase).toBe('paused');
    expect(file.fields[1].status).toBe('pending');
  });
});

describe('(bug 251) nhập workspace', () => {
  it('đọc lại đúng file vừa xuất', () => {
    const { json } = build();
    const ws = parseWorkspace(json);
    expect(ws.fields).toHaveLength(2);
    expect(ws.card.data?.name).toBe('Thẻ/Thử');
  });

  it('file bị ai đó chèn proxy/providers/key ⇒ bỏ qua hết khi nạp', () => {
    const { file } = build();
    const evil = JSON.stringify({ ...file, proxy: { apiKey: 'x' }, providers: [{ apiKey: 'y' }],
      translationConfig: { ...file.translationConfig, apiKey: 'zzz', nested: { authorization: 'Bearer q' } } });
    const ws = parseWorkspace(evil) as any;
    expect(ws.proxy).toBeUndefined();
    expect(ws.providers).toBeUndefined();
    expect(ws.translationConfig.apiKey).toBeUndefined();
    expect(ws.translationConfig.nested.authorization).toBeUndefined();
  });

  it('từ chối file không phải workspace / phiên bản mới hơn', () => {
    expect(() => parseWorkspace('{"data":{}}')).toThrow(/không phải file workspace/);
    expect(() => parseWorkspace('không phải json')).toThrow(/JSON/);
    const { file } = build();
    expect(() => parseWorkspace(JSON.stringify({ ...file, version: 99 }))).toThrow(/mới hơn/);
  });
});

describe('(bug 251) tiện ích', () => {
  it('stripSensitiveKeys không gỡ nhầm khoá thường (maxTokens, exportKeyMode, mvuKeyMetadata)', () => {
    const r = stripSensitiveKeys({ maxTokens: 1, exportKeyMode: 'merge', mvuKeyMetadata: {}, max_tokens: 2, api_key: 'x', apiKey: 'y' });
    expect(Object.keys(r).sort()).toEqual(['exportKeyMode', 'maxTokens', 'max_tokens', 'mvuKeyMetadata']);
  });
  it('tên file an toàn', () => {
    expect(workspaceFileName({ card, cardFileName: 'x' })).toBe('Thẻ_Thử.workspace.json');
  });
});
