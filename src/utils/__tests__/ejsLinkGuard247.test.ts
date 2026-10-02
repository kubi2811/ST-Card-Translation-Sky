// Bug 247 (gogopikachu) — ép keyword EJS đã dịch vào MỌI chuỗi trong nháy, kể cả link ảnh:
//   `变身状态agp4lq.png` → `Biến thân状态agp4lq.png` ⇒ link ảnh gãy hoàn toàn.
// Tên file/URL do máy chủ ảnh đặt, không phải chữ để dịch: khớp keyword ở đó luôn là khớp nhầm.
import { describe, it, expect } from 'vitest';
import {
  autoFixEjsKeywords,
  enforceEjsCovariance,
  autoFixEjsKeywordsExtended,
} from '../ejsSync';
import { isInsideLinkOrFile } from '../cjk';

const KW = { 变身: 'Biến thân' };

describe('bug 247 — keyword EJS không được ăn vào link/tên file', () => {
  it('link ảnh trong HTML ngoài khối <% %> giữ nguyên (autoFixEjsKeywordsExtended)', () => {
    const text = `<img src="https://files.catbox.moe/变身状态agp4lq.png"> <span data-x="变身">x</span>`;
    const r = autoFixEjsKeywordsExtended(text, KW);
    expect(r.text).toContain('https://files.catbox.moe/变身状态agp4lq.png');
    // chuỗi bình thường vẫn được ép như cũ
    expect(r.text).toContain('data-x="Biến thân"');
  });

  it('tên file trần trong khối <% %> giữ nguyên (autoFixEjsKeywords)', () => {
    const text = `<% const img = '变身状态agp4lq.png'; if (s === '变身') { } %>`;
    const r = autoFixEjsKeywords(text, KW);
    expect(r.text).toContain(`'变身状态agp4lq.png'`);
    expect(r.text).toContain(`'Biến thân'`);
  });

  it('URL trong <script> giữ nguyên (enforceEjsCovariance pass 6)', () => {
    const text = `<script>const a = "https://cdn.x.com/assets/变身/pose.webp"; const b = "当前变身";</script>`;
    const r = enforceEjsCovariance(text, {}, KW);
    expect(r.text).toContain('https://cdn.x.com/assets/变身/pose.webp');
    expect(r.text).toContain('"当前Biến thân"');
  });

  it('đường dẫn tương đối và data URI giữ nguyên', () => {
    const text = `<% const a = './img/变身.jpg'; const b = '../变身/x'; %>`;
    const r = autoFixEjsKeywords(text, KW);
    expect(r.text).toBe(text);
  });
});

describe('isInsideLinkOrFile — thước đo hẹp, không nuốt văn bản thường', () => {
  const at = (s: string, sub: string) => {
    const i = s.indexOf(sub);
    return isInsideLinkOrFile(s, i, i + sub.length);
  };
  it('nhận ra link và tên file', () => {
    expect(at('https://a.com/变身状态.png', '变身')).toBe(true);
    expect(at('//cdn.a.com/变身', '变身')).toBe(true);
    expect(at('变身状态agp4lq.png', '变身')).toBe(true);
    expect(at('变身.mp3?v=2', '变身')).toBe(true);
  });
  it('không coi văn bản thường là link', () => {
    expect(at('攻击/防御 变身', '变身')).toBe(false);
    expect(at('当前变身状态', '变身')).toBe(false);
    expect(at('变身. 下一句', '变身')).toBe(false);
  });
});
