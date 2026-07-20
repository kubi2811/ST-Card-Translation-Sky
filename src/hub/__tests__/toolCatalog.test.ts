// (User 20/07) Phase A lazy-start: catalog server tool con phải khớp 1-1 với FLOWS,
// vì id là "hợp đồng" giữa UI (bấm tab nào) và vite middleware (spawn server nào).
// Lệch id = bấm tab mà server khác bật / 400 Tool không tồn tại.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { TOOL_SERVERS, getToolById, parseToolsRoute, isToolsMutating } from '../toolCatalog';
import { FLOWS } from '../../flows';

describe('TOOL_SERVERS ↔ FLOWS: hợp đồng id/port', () => {
  it('mỗi tool server trỏ đúng 1 flow iframe có serverToolId trùng id', () => {
    for (const t of TOOL_SERVERS) {
      const flow = FLOWS.find((f) => f.id === t.id);
      expect(flow, `flow ${t.id}`).toBeDefined();
      expect(flow!.kind).toBe('iframe');
      expect(flow!.serverToolId).toBe(t.id);
      // URL mặc định của flow phải trỏ đúng port trong catalog (env override thì thôi)
      expect(flow!.url).toContain(`:${t.port}`);
    }
  });

  it('flow có serverToolId thì id đó phải tồn tại trong catalog (không trỏ mồ côi)', () => {
    for (const f of FLOWS) {
      if (f.serverToolId) expect(getToolById(f.serverToolId), f.id).toBeDefined();
    }
  });

  it('novalcard (HTML tĩnh) và flow native KHÔNG có serverToolId — luôn "sáng"', () => {
    expect(FLOWS.find((f) => f.id === 'novalcard')!.serverToolId).toBeUndefined();
    expect(FLOWS.find((f) => f.id === 'translate')!.serverToolId).toBeUndefined();
  });

  it('port unique trong dải 5174-5177', () => {
    const ports = TOOL_SERVERS.map((t) => t.port);
    expect(new Set(ports).size).toBe(ports.length);
    for (const p of ports) expect(p).toBeGreaterThanOrEqual(5174);
    for (const p of ports) expect(p).toBeLessThanOrEqual(5177);
  });

  it('thư mục tool tồn tại thật (có package.json để npm run dev)', () => {
    for (const t of TOOL_SERVERS) {
      expect(fs.existsSync(path.join(process.cwd(), t.dir, 'package.json')), t.dir).toBe(true);
    }
  });
});

describe('parseToolsRoute — router pure của /api/tools/*', () => {
  it('khớp đủ 4 route đúng method', () => {
    expect(parseToolsRoute('/api/tools/status', 'GET')).toEqual({ kind: 'status' });
    expect(parseToolsRoute('/api/tools/start', 'POST')).toEqual({ kind: 'start' });
    expect(parseToolsRoute('/api/tools/stop', 'POST')).toEqual({ kind: 'stop' });
    expect(parseToolsRoute('/api/tools/logs?id=card-creator', 'GET')).toEqual({ kind: 'logs', id: 'card-creator' });
  });

  it('sai method / sai path → null (rơi xuống 404, không nuốt route khác)', () => {
    expect(parseToolsRoute('/api/tools/status', 'POST')).toBeNull();
    expect(parseToolsRoute('/api/tools/start', 'GET')).toBeNull();
    expect(parseToolsRoute('/api/tools/restart', 'POST')).toBeNull();
    expect(parseToolsRoute('/api/progress/save', 'POST')).toBeNull();
    expect(parseToolsRoute('/api/tools/logs', 'GET')).toEqual({ kind: 'logs', id: '' });
  });

  it('isToolsMutating: start/stop phải qua CSRF guard, status/logs thì không', () => {
    expect(isToolsMutating('/api/tools/start')).toBe(true);
    expect(isToolsMutating('/api/tools/stop')).toBe(true);
    expect(isToolsMutating('/api/tools/status')).toBe(false);
    expect(isToolsMutating('/api/tools/logs?id=preset')).toBe(false);
  });
});
